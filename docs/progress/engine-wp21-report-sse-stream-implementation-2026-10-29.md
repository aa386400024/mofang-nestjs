# WP21 · 报告生成 SSE 推送端点 · 后端交付记录

> 任务单：[engine-wp21-report-sse-stream-2026-10-29.md](engine-wp21-report-sse-stream-2026-10-29.md)
> 日期: 2026-10-29
> 前置: WP18（报告链路已通）

---

## 0. 一句话结论

`GET /counselor/supervision/report/:sessionId/stream` 已落地并锁测：报告到终态**推一条完整报告**并关流（推的 JSON 与 GET 端点**逐字段一致**，真机实测 `JSON.stringify` 完全相等），等待超时推 `{"status":"timeout"}` 并关流，跨用户/不存在走**真正的 HTTP 404**，客户端断开则**轮询定时器随订阅销毁**（不泄漏）。

任务单 §2 的 5 条行为全部实现；闸门全绿（eslint 0 error 0 warning / tsc 0 错 / jest **51 套件 789 例通过**（1 套件 2 例失败 = 既有债）/ wp8-wiring 34 例全绿 / 服务真起且新路由已 mapped / `src/engine-core` 零改动）。

**真机实测踩出并修掉 3 个坑**（详见 §5.3）：SSE 里的错拿不到 404（全局 interceptor 所致）、单测桩假通过、**"探针式"轮询漏掉空局/墙钟兜底这类终态**。第三个最要命 —— 它会让"报告永远不会来"的会话干等 120s 而不是立即推终态。

---

## 1. 任务单 §2 行为表 → 实现映射（逐条对齐）

| §2 行为 | 实现 | 落点 |
|---|---|---|
| 1. 查一次报告状态（复用 `getSessionReport`） | `loadReportContext()`（归属校验 + 一次查齐 4 个来源）→ `buildReportDto()`（状态派生 + DTO 拼装） | `supervision.service.ts` |
| 2. 已终态 → 立即推一条 `data: { report json }` 并关流 | 首次装载后判定为终态 → `of({ data: report })` → 流随即 complete | `supervision-report-stream.service.ts` |
| 3. pending → interval 2s 轮询 DB → 变终态时推报告并关流 | `timer(2000, 2000)` + `concatMap` 串行轮询 → 落库后**重新装载** → 推完整报告 → `take(1)` 关流 | 同上 |
| 4. 超时 120s → 推 `data: {"status":"timeout"}` 并关流 | 轮询每轮先查截止时刻；到点推超时负载并关流 | 同上 + `report-stream.ts` |
| 5. 客户端断开 → 清理 interval | **不手写 `setInterval`/`req.on('close')`**：RxJS `timer` 的定时器随**取消订阅**销毁，而 Nest 的 SSE 通道在客户端断开时取消订阅 → 框架级保证 | 同上 |
| SSE 帧格式 `data: {json}\n\n`，不自定义 event name | Nest `@Sse()` 默认输出 `id: N` + `data: {json}`（默认 `message` 事件），与前端手写解析器只认 `data:` 前缀行对齐 | `supervision.controller.ts` |

---

## 2. 六个关键设计决策

### 2.1 决策 A · 404 走 **HTTP 状态码**，不是"200 + 一条 not_found 事件"

**任务单 §2 没写"会话不存在"怎么办** —— 但端点必须自己收口，否则就是个越权探测洞。

两种可选口径：

| 方案 | 客户端看到 | 评价 |
|---|---|---|
| 事件式 `200 + {"status":"not_found"}` | 前端把未知状态兜底成 `pending` → 继续转圈 | 客户端**分不出**"没权限"和"还在生成"，体验退化 |
| HTTP 式 `404 + JSON body` | 前端 `http` 客户端直接抛错 → 走网络错误态 | 与同路径 GET 端点口径一致，可区分 |

**跨用户与不存在返回同一个 404**（不泄露"这个 sessionId 是否存在"）。

#### ⚠️ 这里的坑：本仓有**全局 interceptor**，SSE 里抛错拿不到 404

Nest 11 的 SSE 通道对错误的处理有两条完全不同的路：

| 错误来源 | 结果 |
|---|---|
| handler 的 **promise 拒绝**（响应还没被通道接管） | 异常过滤器写出**真正的 HTTP 404** |
| Observable 在**订阅后**报错（此时 SSE 响应头**已提交**） | 降级成 `200 + event: error` 帧（客户端拿不到状态码） |

而 SSE 响应头是在 `setTimeout(0)` 里提交的 —— 一次**真实的 DB 查询**（异步 I/O）必然晚于这个宏任务。于是：

**第一版实现（把装载放进 `defer(() => from(loadReportContext()))`）**：
真机实测拿到的是 `200` + `event: error` 帧，**不是 404**：

```
[真机] status=200
        event: error
        id: 1
        data: 训练会话 does-not-exist-xyz 不存在或不属于当前用户
```

**根因**（读 Nest 源码 + 本仓 `src/app.ts` 定位）：本仓注册了**全局** `LoggerErrorInterceptor`（nestjs-pino）→ `InterceptorsConsumer.intercept()` 走"非空 interceptors"分支 → 返回的是 **Observable** 而不是 handler 的 promise → handler 里抛的错只能"在订阅之后"浮现 → 那时响应头已提交 → 只能降级。

（第一版还写了一个 HTTP 层单测，**它通过了但是假通过**：桩是**同步**抛错，抢在 `setTimeout(0)` 之前到达 → 拿到了 404 → 掩盖了真机行为。**教训：单测桩必须复现真实时序**（异步抛错），否则测试锁的是"实验室行为"而不是生产行为。）

**最终修法：归属校验移到 `guard`**（`src/counselor/guards/supervision-report.guard.ts`）

guard 在 interceptor 与 SSE 通道**之前**运行 —— 此时响应还没被接管，抛 `NotFoundException` 就能写出完整的 404 JSON。

```
@Get('report/:sessionId/stream')
@Sse()
@UseGuards(SupervisionReportGuard)     // ← 归属校验 (SSE 通道接管响应之前)
async streamSessionReport(...): Promise<Observable<MessageEvent>> { ... }
```

guard 复用 `SupervisionService.assertSessionOwned(userId, sessionId)`（`exists` 存在性查询，与报告装载同一套 WHERE 条件，不另写一份口径）。

**真机复验**：

```
[真机] 不存在的 sessionId → status=404  body={"code":1000,"message":"训练会话 ... 不存在或不属于当前用户","data":null}
[真机] 缺 token           → status=401
```

**单测也补齐了生产链路**：HTTP 层测试挂上**全局** `LoggerErrorInterceptor`（与 `src/app.ts` 一致）+ 桩**异步**抛错 —— 这样它测的才是生产行为。

### 2.2 决策 B · GET 与 SSE **共用同一份装载与派生**（消双胞胎）

`getSessionReport` 拆成两段：

```ts
loadReportContext(userId, sessionId)  // 归属校验 + 一次查齐 4 个来源 + 幂等回填链接
buildReportDto(context)                // 状态派生 + DTO 拼装
```

**为什么必须拆**：推送端点要"判断报告来没来"（只看 1 张表）和"把最终报告推出去"（要全部 4 个来源）。若 SSE 侧自己拼一份报告，就会出现"轮询出来的报告"和"推送收到的报告"字段不一致 —— 用户会看到两张打架的卡片。

拆完之后：`getSessionReport` = 装载 + 拼装；SSE = 装载 + 拼装。**只有一份实现**。

### 2.3 决策 C · 轮询**每轮重新装载 + 重新派生**（第一版的"探针"方案已被实测推翻）

**第一版**想省查询：轮询只问「报告行落库了没」（1 次查询），落库了再完整装载一次。

**真机实测把这个方案否掉了**（§5.3 第三个坑）：探针只覆盖了「终态由报告行决定」这一类，**漏掉了两类不由报告行决定的终态**：

| 终态 | 由什么决定 | 探针能发现吗 |
|---|---|---|
| `completed` / `parse_error`（vpt） | agent 主报告行落库 | ✅ |
| `completed` / `parse_error`（单次训练） | 4 流派反馈行落库 | ✅ |
| **`no_content`（空局）** | **会话已结束 + 素材不足**（在**会话行**上） | ❌ **漏** |
| **`parse_error`（墙钟陈旧兜底）** | **会话结束时刻 + 墙钟**（在**会话行**上） | ❌ **漏** |

漏了的后果很具体：实测里一个**报告永远不会生成**的空局会话，SSE 一直判"还没到"，干等到 **120s** 才推 `timeout` —— 而任务单 §4.3 要求「空局 → **立即**推 no_content」。

**教训**：**终态判定不能有第二个口径**。只要"轮询用的判据"和"GET 用的判据"不是同一份，就一定会漏掉某一类终态，而且漏掉的那类只在真机上暴露。

**最终做法**：轮询每轮直接复用 GET 端点的 `loadReportContext` + `buildReportDto`（同一份装载、同一份 domain 派生）——

- ✅ 所有终态一个不漏（报告行 / 反馈行 / 空局 / 墙钟兜底，全走同一套判定）
- ✅ 与 GET 端点**零漂移**（真机实测：同一会话 GET 与 SSE 载荷 `JSON.stringify` 完全相等）
- ✅ 推出去的载荷就是这一轮装载的结果，终态时**不用再查一次**
- ⚠️ 代价：每轮 ≈ 一次 GET 的查询量（5 条索引查询，实测 ~300ms），间隔 2s。
  与"报告通常 30s+ 才生成"相比可以接受；比起"漏推终态、用户只能靠等超时才发现"，这笔账划算得多。

### 2.4 决策 D · 用 RxJS `timer`，不手写 `setInterval` + `req.on('close')`

任务单 §3 的示例代码是手写 `setInterval` + `res.req.on('close')` 清理。手写那套的经典 bug 是：**客户端在两次轮询之间断开**，清理回调没跑到 → 定时器永远挂着。每开一次报告页漏一个，进程跑一天就是几十万个僵尸定时器。

RxJS `timer` 的定时器随**取消订阅**销毁，而 Nest 的 SSE 通道在客户端断开时会 `subscription.unsubscribe()` → "断开即停轮询"是**框架级保证**，不依赖我们自己记得清理。单测里专门锁了这条（断开后探针调用次数不再增长）。

### 2.5 决策 E · "超时"是**通道状态**，不是报告状态

`SessionReportStatus` 是**报告本身**的状态（completed / parse_error / pending / no_content），报告没有"超时"这种状态。

超时描述的是"**这条推送通道**等不到报告了"，处置是"稍后再看"；而 `parse_error` 描述的是"这份报告生成失败了"，处置是"重试生成"。两者给用户的话术与出口不同，混成一个值前端就只能给错的话术。

所以超时单独定义为推送负载 `{ status: 'timeout' }`，不塞进四态。

### 2.6 决策 F · 沿用仓库 `@Sse()` 范式，不手写 `res.write`

仓库已有 SSE 范式：`counselor/controllers/live-hint.controller.ts` 用 `@Sse()` + `Observable<MessageEvent>`；`counselor/providers/session-core-events.service.ts` 用 `new Observable(subscriber => ...)` 做断开清理。

本轮沿用 `@Sse()`：
- 帧格式、header（`text/event-stream` / `Cache-Control` / `X-Accel-Buffering: no`）、断开取消订阅**全部由框架负责**
- 任务单 §3 的示例代码 `@Sse()` 与 `@Res()` 混用（Nest 的 `@Sse` 期望返回 Observable）、`await` 用在非 async 方法、缺 `userId` 参数 —— 是示例疏漏，按仓库实际实现（`getSessionReport(userId, sessionId)` 两参）落地
- 真 404 由 **guard** 兜（见 §2.1）：`@Sse()` 通道一旦接管响应就写不出状态码，guard 是唯一能在它之前抛错的钩子

---

## 3. 端点契约

```
GET /counselor/supervision/report/:sessionId/stream
Authorization: Bearer <token>        (复用 JwtAuthGuard, 与 GET report/:sessionId 同守卫)
Accept: text/event-stream
```

**参数名说明**：任务单写的是 `:id`，本实现用 `:sessionId` —— 与同前缀的 `GET report/:sessionId` 保持同名（路径槽位位置相同，前端 URL 拼接无差异）。

**成功响应**（200 / `text/event-stream`）：

```
data: {"sessionId":"...","status":"completed","overallScore":72,"dimensions":{...},...}

```

`data:` 后面就是 **GET 端点那份报告 JSON**（逐字段一致）。

**终态取值**（前端要认识的）：

| status | 含义 | 何时推 |
|---|---|---|
| `completed` | 报告生成完成 | 报告行落库且派生为完成 |
| `parse_error` | 生成失败（带 `failureCode` / `retryable`） | 报告行落库且派生为失败 |
| `no_content` | 空局（素材不足，报告永远不会来） | 首次装载即判定 |
| `timeout` | **等待超时**（通道状态，非报告状态） | 超过 120s 仍未终态 |

**错误响应**：

| 场景 | 响应 |
|---|---|
| 会话不存在 / 不属于当前用户 | `404` + JSON body（与 GET 端点同口径，不泄露存在性） |
| 缺 token / token 失效 | `401`（`JwtAuthGuard`） |

**可配项**（env → config → 默认值）：

| env | config 键 | 默认 |
|---|---|---|
| `SUPERVISION_REPORT_STREAM_POLL_INTERVAL_MS` | `supervision.reportStreamPollIntervalMs` | 2000 |
| `SUPERVISION_REPORT_STREAM_TIMEOUT_MS` | `supervision.reportStreamTimeoutMs` | 120000 |

默认值单一真值源在 `src/counselor/config/supervision.config.ts`（与既有 `SUPERVISION_REPORT_PENDING_TIMEOUT_MS` 同处）。

---

## 4. 联调用法（与前端 / curl）

```bash
# 已生成的报告 → 立刻收到一条并关流
curl -N -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/counselor/supervision/report/$SESSION_ID/stream

# 预期:
#   HTTP/1.1 200 OK
#   Content-Type: text/event-stream
#
#   id: 1
#   data: {"sessionId":"...","status":"completed","overallScore":72,...}
#   （随后服务端关闭连接）

# 不存在的 sessionId → 真 404
curl -i -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/counselor/supervision/report/does-not-exist/stream
#   HTTP/1.1 404 Not Found
#   {"message":"训练会话 does-not-exist 不存在或不属于当前用户","statusCode":404}
```

前端（已就位，无需改动）：`report_sse_client.dart` 的 `openSse` 只取 `data:` 前缀行 → `jsonDecode` → `Map`。Nest 额外写的 `id: N` 行会被前端忽略。

---

## 5. 闸门实测

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 错 |
| `npx tsc -p tsconfig.scripts.json --noEmit` | ✅ 0 错 |
| `npm run lint` | ✅ **0 error 0 warning** |
| `npx jest`（全量） | ✅ **52 套件 / 791 例**：**51 套件 / 789 例通过**；1 套件 2 例失败 = `test/counselor/drill-judge.spec.ts` **既有债**（与 WP18 轮完全相同，未擅自修） |
| `npm test -- wp8-wiring`（护栏） | ✅ 34 例全绿 |
| `git diff --stat HEAD -- src/engine-core` | ✅ **空**（零改动） |
| 服务可起 | ✅ 新路由已 mapped（`Mapped {/counselor/supervision/report/:sessionId/stream, GET} route`）；端口 3000 被开发服 `nest start --watch` 占用，故由该开发服复验（见 §5.2） |

**WP21 新增测试（2 套件 18 例）**：

| 套件 | 覆盖 |
|---|---|
| `test/counselor/wp21-report-stream.spec.ts`（15 例） | 决策表 8 例（三终态 / 未到点 / 边界用 `>=` / 到点 / **终态优先于超时** / 超时负载只带 status）+ service 7 例（终态立即推且**不进入轮询** / 轮询命中后重装推送 / **空局类终态也能推到（回归用例）** / 超时推 timeout / 归属失败在返回 Observable 前就抛 / **断开后不再装载** / **轮询期 DB 抖动只跳过本轮**） |
| `test/counselor/wp21-report-sse-endpoint.spec.ts`（3 例） | **HTTP 层**（挂全局 `LoggerErrorInterceptor` + 异步抛错桩 = 生产链路）：真 404 + JSON body（且 content-type **不是** event-stream）/ 200 + `text/event-stream` + `data: {完整报告}` / 超时帧 `data: {"status":"timeout"}` |

### 5.2 真机实测（跑在开发服 `nest start --watch` 上，真实 DB）

| 场景 | 实测 |
|---|---|
| 不存在的 sessionId | ✅ **404** + `{"code":1000,"message":"训练会话 ... 不存在或不属于当前用户","data":null}` |
| 缺 token | ✅ **401** |
| 报告已终态（真实 completed 报告） | ✅ 200 + `text/event-stream` + `data: {"sessionId":"...","status":"completed","overallScore":43,"dimensions":{"empathy":30,"activeListening":45,...},"annotations":[...],...}` |
| 空局（无有效素材，报告永不生成） | ✅ **不再干等 120s** —— 轮询重新派生后立即推该会话的真实终态 |
| 墙钟陈旧兜底（会话结束 >5min 无报告） | ✅ 立即推 `parse_error` + `failureCode:"timeout"`（修复前这里会干等到 120s 才推 `timeout`） |
| 等待超时 | ✅ **120.7s** 时推 `data: {"status":"timeout"}` 并关流 |
| 首帧延迟（已终态场景） | ✅ 响应头 **146ms** / **首帧 291ms**（`GET report/:id` 基线 459ms —— 两端一致） |
| **GET 与 SSE 载荷一致性** | ✅ 同一会话 `JSON.stringify(getJson) === JSON.stringify(sseJson)` → **true**（零漂移） |

> **首帧 ~290ms 与"连接 6.3s 关闭"是两件事**：Nest 的 SSE 头里带 `Connection: keep-alive`，服务端在响应结束后会把 socket 放回 keep-alive 连接池，约 6s 后才关。**前端拿到数据帧只等 ~290ms**（Dart 客户端在读到 chunk 时即回调），连接滞留不影响体验。

### 5.3 真机实测踩出并修掉的三个坑

| 坑 | 现象 | 修法 |
|---|---|---|
| **全局 interceptor 让 SSE 里的错拿不到 404** | 404 退化成 `200 + event: error` 帧（前端会静默忽略 → 转圈没尽头） | 归属校验移到 **guard**（在 SSE 通道接管响应之前抛）→ 真 404。**见 §2.1** |
| **单测桩"同步抛错"造成假通过** | HTTP 层单测拿到 404 就通过，但真机是 200 —— 因为真机的错误来自 DB 查询（异步 I/O），必然晚于 `setTimeout(0)` 提交响应头 | 单测桩改成**异步抛错** + 挂上**全局 interceptor**，让测试复现生产时序 |
| **"探针式"轮询漏掉非报告行类终态** | 空局 / 墙钟兜底这类终态不由报告行决定 → 探针判"还没到" → 干等 120s 才推 `timeout`，而不是立即推真实终态（违反任务单 §4.3） | 轮询改为**每轮重新装载 + 重新派生**（与 GET 同一份实现），终态判定**只有一个口径**。**见 §2.3** |

---

## 6. 改动面清单

### 6.1 新增文件（5）

| 文件 | 职责 |
|---|---|
| `src/counselor/domain/session-core/report-stream.ts` | 推送决策**纯函数** `decideReportStreamAction`（三岔：推报告 / 推超时 / 继续等）+ 超时负载构造 |
| `src/counselor/providers/supervision-report-stream.service.ts` | SSE 时间线编排：装载 → 判定 → 轮询 → 推送 → 关流（RxJS） |
| `src/counselor/guards/supervision-report.guard.ts` | SSE 端点的**归属守卫**：会话不存在 / 跨用户 → 抛 404（必须在 SSE 通道接管响应之前，见 §2.1） |
| `test/counselor/wp21-report-stream.spec.ts` | 决策表 + service 生命周期单测（14 例） |
| `test/counselor/wp21-report-sse-endpoint.spec.ts` | HTTP 层契约单测（3 例，挂全局 interceptor + 异步抛错桩 = 生产链路） |

### 6.2 修改文件（7）

| 文件 | 改动 |
|---|---|---|
| `src/counselor/providers/supervision.service.ts` | `getSessionReport` 拆成 `loadReportContext` + `buildReportDto`（GET 与 SSE **共用同一份**装载与派生）；新增 `assertSessionOwned` 归属断言（供 guard 用，`exists` 存在性查询） |
| `src/counselor/controllers/supervision.controller.ts` | 新增 `GET report/:sessionId/stream`（`@Sse()` + `@ApiProduces('text/event-stream')` + `@UseGuards(SupervisionReportGuard)`）；controller 仍 thin delegate |
| `src/counselor/counselor.module.ts` | 注册 `SupervisionReportStreamService` 与 `SupervisionReportGuard` |
| `src/counselor/config/supervision.config.ts` | 新增轮询间隔 / 超时两个阈值常量（单一真值源） |
| `src/config/envs/default.ts` | `supervision` 命名空间补两个 env 覆盖入口 |
| `typings/global.d.ts` | 补两个 env 变量的类型声明 |
| （无）`src/engine-core/**` | **零改动** |

### 6.3 红线核对

| 任务单 §5 红线 | 核对 |
|---|---|
| 不改 `src/engine-core/**` | ✅ `git diff --stat HEAD -- src/engine-core` 为空 |
| 不改报告生成逻辑本身（WP18 已交付） | ✅ 只读侧新增；报告生产链路（agent/supervisor / 两个 BullMQ 队列 / LLM 参数档）零改动 |
| 不加 DB schema 变更 | ✅ 零 migration、零 entity 改动；只新增两个 env + 两张既有表的**只读**查询 |
| 不做报告重跑端点 | ✅ 无任何写/重跑端点；`linkReportToSession` 是**既有**的幂等回填，行为未变 |

---

## 7. commit 文案

```
feat(counselor): 报告生成 SSE 推送端点 GET report/:sessionId/stream

- 新增 @Sse() 端点: 报告到终态推一条完整报告并关流, 等待超时推 {"status":"timeout"}
- GET 与 SSE 共用 loadReportContext + buildReportDto, 推的 JSON 与 GET 逐字段一致
  (真机实测 JSON.stringify 相等)
- 轮询每轮重新装载+重新派生, 与 GET 同一份实现 —— 终态判定只有一个口径,
  不漏「空局/墙钟兜底」这类不由报告行决定的终态
- 跨用户/不存在走真 HTTP 404: 归属校验放 guard (SSE 通道接管响应后就写不出状态码,
  本仓有全局 LoggerErrorInterceptor, 在 handler 里抛错只会降级成 200+event:error)
- 客户端断开 → RxJS timer 随取消订阅销毁, 不泄漏 (不手写 setInterval)
- 决策表收在 domain 纯函数 decideReportStreamAction, 超时是通道状态不是报告状态
- 新增 2 套件 18 例 (决策表 8 + service 7 + HTTP 层契约 3, 含生产链路的全局 interceptor)
- eslint 0 error 0 warning / tsc 0 错 / jest 51 套件 789 例通过 (1 套件 2 例失败 = 既有债) / engine-core 零改动
```

---

## 8. 联调要点（前端侧需要确认的两处）

### 8.1 ⚠️ `timeout` 事件的前端处理 —— **需要前端补一个分支**

前端 `vpt_session_report.dart` 的 `_statusFromWire` 把**未知状态兜底成 `pending`**：

```dart
VptReportStatus _statusFromWire(String? value) => switch (value) {
      'completed' => VptReportStatus.completed,
      'parse_error' => VptReportStatus.parseError,
      'no_content' => VptReportStatus.noContent,
      _ => VptReportStatus.pending,     // ← 'timeout' 落这里
    };
```

而 `_applyTerminal` 的分支是：

```dart
_phase = report.isParseError ? parseError : completed;   // ← pending 被当成 completed
```

**后果**：若后端推的 `{"status":"timeout"}` 恰好**先于**前端自己的 120s 定时器到达，前端会把它当成"pending" → 走 `completed` 分支 → **渲染一张空的报告卡片**（overallScore=null / dimensions=null）。

**建议前端补一个分支**（在 `vpt_session_report_page.dart` 的 SSE 回调里）：

```dart
if (status == 'timeout') {
  unawaited(_sseSub?.cancel());
  _timeoutTimer?.cancel();
  if (mounted) setState(() => _sseTimedOut = true);   // 留在 pending 态 + 给出重试出口
  return;
}
```

**为什么后端不绕开**：任务单 §2.4 明确要求超时推 `{"status":"timeout"}`；而且前端 `onDone` 会 `cancel()` 自己的超时定时器 —— 若后端超时后**静默关流**，前端会永远停在转圈且没有重试出口（比推一条事件更糟）。所以"推一条明确事件"的方向是对的，缺的是前端对它的解读。

> 竞态窗口很小：前端定时器与后端截止时刻都从"开流"起算 120s，后端起点略晚（要先装载一次），通常前端先到期 → 走 `_sseTimedOut = true` 的正常路径。但"通常"不是"一定"，建议补上。

### 8.2 前端自己的 120s 定时器与后端的 120s 超时

前端 `_sseTimeoutDuration = 120s` 与后端 `supervision.reportStreamTimeoutMs = 120000` 同值，**两端一致** ✅。前端定时器到期会 `cancel()` 订阅 → 后端随之收到断开 → 轮询停止（不泄漏）✅。

---

## 9. 已知边界 / 后续项

| 项 | 说明 |
|---|---|
| **SSE 推的是主报告，不含 4 流派 techStats** | 与 GET 端点一致：主报告与 techStats 是**两个队列两个 LLM**，不同时到。GET 端点返回的 `techStats` 取自 `training_sessions.tech_stats`（4 流派反馈落的那张表），**在主报告到达时通常还没写**。推送端点推的是"那一刻"的完整 GET 快照，语义与 GET 完全一致（前端若要 techStats，可继续拉 GET 或以 techStats 落库为准） |
| **每轮轮询 = 一次 GET 的查询量** | 轮询每轮完整装载（会话行 + 报告行 + 移情标记 + 流派反馈 + 流派表，实测 ~300ms，间隔 2s）。这是"终态判定只有一个口径"的代价，也是**故意**的 —— 见 §2.3。若将来报告量级大到 DB 吃紧，正确的优化方向是"**把终态判定本身**下沉成一条轻查询"（而不是另起一套判据），否则又会漏终态 |
| **无 keepalive 帧** | 报告最长等 32s+，连接空闲期间不发任何帧。多数反向代理的空闲超时 > 2min，本轮不引入 keepalive（任务单 §2 未要求，且多发帧会让前端多解析一次）。若后续接入的代理空闲超时 < 120s，需要在轮询里加注释帧（前端解析器已能忽略非 `data:` 行） |
| **单连接单次推送** | 本端点只推一条就关流（`take(1)`）。若将来要做"主报告 + techStats 分两次推"，需要把 `take(1)` 换成按状态收敛的 `takeWhile` —— 当前**不提前泛化** |
