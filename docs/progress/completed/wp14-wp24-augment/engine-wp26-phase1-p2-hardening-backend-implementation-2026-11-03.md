# WP26 · Phase1 P2 全量修复（后端交付记录）

> 日期: 2026-11-03 ｜ 任务单: `engine-wp26-phase1-p2-hardening-backend-2026-11-03.md`
> 性质: WP25 扫描出的 34 条 P2 **全修**（企业级标准，不凑合、不留尾巴）
> 状态: **代码已交付并复跑绿（未 commit）**
> 前置: [WP25 扫描报告](../../wp25-phase1-audit-report-2026-11-03.md)（本单逐条对应其 P2 编号）

---

## 1. 一句话

WP25 扫出的 **34 条 P2 全部修复**：安全 5 条（WS 黑名单 / **JWT 走握手外通道**（子协议 + `handshake.auth`）/ metrics 鉴权 / admin 角色 / 握手写动作后置）、引擎 12 条（**内核 `process.env` 改注入** + 轨迹 delta 纳入单回合 cap + 错误码 + barrel + 边界断言）、文档 15 条（**114 条死链归零** + 3 份交付记录事实修正）、配置 6 条（finishReason 透传 / sessionId 服务端生成 / socketId 闸门 / 生产 5xx 本地日志）。

**内核红线守住了**：改完之后 `src/engine-core/**` 零 `process.env`、零 `globalThis`、零 NestJS、零 IO —— 且这三条现在是**机器断言**（`boundary.spec.ts` 11 条），不是注释里的承诺。

---

## 2. 闸门（实际输出）

| 检查 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 错 0 warning** |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **84 文件 / 1264 例全绿**（WP25 基线 77 文件 / 1165 例 → **净增 7 文件 99 例**） |
| `grep -r "process.env" src/engine-core/` | **零命中**（P2-14 验收；由 `boundary.spec.ts` 断言⑩ 机器守住） |
| `boundary.spec.ts` | **11 条断言全绿**（WP15 时期 9 条 → 本单加 ⑩⑪ 两条） |

> ⚠️ e2e 套件（`test/e2e/**`）不在默认 `vitest run` 范围内：`/metrics` 断言已按新口径更新（无凭据 401 / 带 token 200），需 `pnpm test:e2e` 真机跑。

---

## 3. 逐条交付明细（对应 WP25 报告 P2 编号）

### 3.1 安全侧（5 条）

| # | 做了什么 | 落点 | 回归 |
|---|---|---|---|
| **P2-1** | WS 握手加三道闸：验签 → **token type**（`type=access`）→ **黑名单**（`JwtBlacklistService.isRevoked(jti)`，与 `JwtAuthGuard` **同一份 Redis key 口径**）。命中黑名单 → `error(token_revoked)` + 断开；type 不符 → `error(unauthorized)` + 断开；两者都在**任何写动作之前**。黑名单服务走 `@Optional()` 构造注入（装配没接上时降级放行 + 一次性告警，不把安全增强变成全站事故） | `src/voice/voice.gateway.ts`、`src/voice/voice.module.ts`（**主线程补的 `UserModule` 接线**，否则黑名单处于 fail-open） | `test/voice/wp26-voice-gateway-hardening.spec.ts` 5 例 |
| **P2-2** | JWT 走**握手请求之外**的通道，**三级优先级**：① **`Sec-WebSocket-Protocol`**（`bearer, <jwt>`，给**原生 ws** 客户端用）→ ② **`handshake.auth.token`**（**Socket.IO 标准握手字段**，`socket.setAuth({ token })` / `io(url, { auth: { token } })`；token 走 Socket.IO 的 **CONNECT 包**，**不进 URL** → 同样不落 access log / Referer / 浏览器历史；**Socket.IO 客户端走这条**，Flutter 端已在用）→ ③ `?token=` query（**老客户端兜底**，Flutter 端可以删）；`Authorization` 头为第四级。子协议回显由**服务端接管**（自定义 `ws` 引擎 `handleProtocols`）：报了 `bearer` 只回显 `bearer`（**token 绝不出现在响应头**）；只报了 token 则一个都不回显。auth 通道**只认 `token` 这一个键名**（非字符串 / 空串 → 落到下一级），不认别名 | `src/voice/voice.gateway.ts`（`extractToken` + `readTokenFromAuth`） | 同上 **22 例**（含**真 socket** 握手：token 放第一位也只回显 `bearer`；**CONNECT 包实测** `handshake.auth` 真的拿到 token） |
| **P2-3** | `/metrics` 改「**默认关 + 开了必须带凭据**」：未配 `METRICS_ENABLED` → 生产 404 / 非生产开；开了但没带/带错 token → **401 fail-close**；比对用 sha256 + `timingSafeEqual`（定长、不泄漏长度）。**不做 IP 白名单**：生产开了 `trust proxy`，`req.ip` 取自 `X-Forwarded-For` 可伪造，基于它的白名单形同虚设 | `src/shared/infra/metrics/metrics.controller.ts`、`src/config/envs/default.ts`、`.env.example`、`typings/global.d.ts` | `test/shared/wp26-metrics-auth.spec.ts`、`test/config/wp26-metrics-config.spec.ts` |
| **P2-4** | 新增 `AdminRoleGuard`（class 级挂 controller，4 端点全覆盖）：basic auth 放行；否则查 **DB 真值** `users.admin_role`，**严格等于 `'admin'`** 才放行，其余（NULL / editor / reviewer / 查不到）→ 403；查询抛错 → **fail-close**。**不写 migration**：`users.admin_role` 列早已存在（`src/user/entities/user.entity.ts:49-55`，enum `editor\|reviewer\|admin`，nullable）。**不能用 token 里的 `adminRole`**：`user.service.ts:675` 是 dev fallback `user.adminRole ?? 'admin'` —— 普通学员的 token 里也是 `'admin'`，照抄 token 等于防护为 0 | `src/admin-debug/guards/admin-role.guard.ts`（新）、`admin-debug.controller.ts`、`admin-debug.module.ts` | `test/admin-debug/wp26-admin-role-guard.spec.ts` 14 例 |
| **P2-5** | 握手写动作逐个复核后**全部**在「JWT 校验 → 归属校验」之后（落库桥 / 演练登记 / 帧出口 / voice 会话四处）；`client.data.sessionId` 是 socket 自身暂存（断连清理的必要依据），保留并注释说明 | `src/voice/voice.gateway.ts` | 同上 2 例：归属校验失败 → 落库桥 0 / TTS 0 / 帧出口 0 / 演练登记 0 |

### 3.2 引擎层（12 条）

| # | 做了什么 | 落点 | 回归 |
|---|---|---|---|
| **P2-6** | 「会话未开启」改抛 `EngineCoreError(SESSION_NOT_FOUND)`（语义 404，不再落全局兜底 500） | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | 既有引擎套件 |
| **P2-7** | `mapKernelError` 的 `default` 分支：把 **code + message + 脱敏后的 details** 打进服务端 logger；响应体保持通用文案（不外泄内部结构） | `src/engine-adapters/wiring/engine-wiring.controller.ts` | 既有 wp8-wiring 套件 |
| **P2-9 / P2-10** | 150/500 口径统一成「**当前 500ms（测试期放宽），M3 内测前回改 150ms**」：4 处代码注释 + WP11 交付记录 + 审计报告 | `assess-safety.ts`、`http-psyguard.probe.ts`、`psyguard-health.checker.ts`、3 份文档 | — |
| **P2-11** | cap 报告带 **`sessionId` / `handleId`**（多人内测时运维能定位是哪场被砍） | `state-transition.ts`（`DeltaCapContext`）、`in-memory-engine-session.ts`、`delta-cap.logger.ts` | `test/engine-core/wp26-delta-cap-injection.spec.ts` |
| **P2-12** | **轨迹 delta 也走 cap**（选①，不是②）：会话层把「事件 delta + 剧本 delta」合成**本轮总 delta**，统一过一次 cap 再落快照。报告口径 = 总 delta。**为什么不能"diff 快照"**：事件先被 cap 再叠加反向轨迹 delta 时会漏算被砍掉的量（事件 +0.25→cap 0.2、轨迹 −0.05，diff 得 0.15，正确应为 0.20） | `state-transition.ts`（`aggregateTurnDelta` / `addDeltaVectors` / `applyDeltaVector`）、`trajectory-applier.ts`（暴露 raw delta，唯一转换点 `toDeltaVector`）、`in-memory-engine-session.ts` | 同上：**crisis_signal(−0.30) + judgment(−0.12) → 单回合 \|Δvalence\| = 0.30（不是 0.42）** |
| **P2-13** | 18 个 `ENGINE_CAP_*` 键**逐个字面量读**（不再用计算键 + bracket 绕过 env 治理），并**显式声明到 `NodeJS.ProcessEnv`** | 新增 `src/engine-adapters/wiring/delta-cap.config.ts`、`typings/global.d.ts` | `test/engine-adapters/wp26-delta-cap-config.spec.ts` 6 例 + `test/config/wp25-env-example-coverage.spec.ts` 用例③b |
| **P2-14** | ⭐ **内核 `process.env` 改注入**：定义 `DeltaCapConfig` 端口（9 维 × 上下向 = 18 个数值）+ `DEFAULT_DELTA_CAP_CONFIG` 种子值；`transitionState` / `transitionStateDetailed` 收 `capConfig?`；adapter 读 env 组装后注入内核会话。**观察者一并改注入**，删掉模块级单槽 `observeDeltaCaps`（它是内核唯一的模块级可变状态，且进程内第二个实例会把第一个的观察者顶掉） | `state-transition.ts`、`in-memory-engine-session.ts`、`engine.providers.ts`、`engine.module.ts`、`delta-cap.logger.ts` | `wp26-delta-cap-injection.spec.ts` 9 例 |
| **P2-15** | 文件头「边界: 纯函数, 无状态, 无随机, 可复现」**重新成立**（注入改造后三项都真了），并把 WP26 的三条治本写进文件头 | `state-transition.ts` | 断言⑩ |
| **P2-16** | WP15/WP26 的公开符号（`capTurnDelta` / `transitionStateDetailed` / `DeltaCapConfig` / `TurnDeltaCapReport` 等 17 个）**补进 barrel**，同步 `boundary.spec.ts` 的 `expectedPublic` 双向白名单；adapter 改走 barrel，不再深路径 import | `src/engine-core/index.ts`、`delta-cap.logger.ts`、`test/engine-core/boundary.spec.ts` | 断言⑥ + 断言⑪ |
| **P2-17** | `boundary.spec.ts` 加**第 10 条断言**：内核树**零 `process.env` / 零 `globalThis`**（AST 级，不是正则）。改之前 9 条断言只查 import —— WP15 引进内核第一处 env 读取时**全绿** | `test/engine-core/boundary.spec.ts` | 断言⑩ |
| **P2-18** | 补 `STORAGE_FAILURE = 'ENGINE_STORAGE_FAILURE'` 错误码（依赖侧故障的机器可读码，此前这类故障只能落裸 Error → 一律 500 且无法聚合）；`UNSUPPORTED` 标注 **Phase2**（它现在是个死码）；两个仓储端口的 `@throws` 写明 | `src/engine-core/domain/engine-errors.ts`、`domain/ports/bdi-state.repository.ts`、`domain/ports/memory.store.ts` | — |

> **另加第 11 条断言**（任务单只要求到 10 条）：禁止 `src/engine-adapters/**` 深路径 import `engine-core/` 的**非 `in-memory/`** 内部模块 —— 这正是 P2-16 那条"绕过 barrel 就绕过守卫"的根因，改完仓内**零白名单**成立。

### 3.3 文档一致性（15 条）

| # | 做了什么 |
|---|---|
| **P2-19 / 20 / 21** | **114 条死链归零**（README 52 + backlog 15 + completed 40+ + archive 7），逐条按真实路径重指向；改完只剩 1 条（在 WP25 交付记录里），主线程已一并修掉 |
| **P2-22** | WP20 交付记录按**代码事实**重写：「全 mock / client.ts 零真 API 调用」与代码相反 → 9 页 = **4 真 API + 1 半真 + 4 全 mock**；`USE_MOCK` 开关早已不存在；顶栏"接 `/admin/api/health`"实为静态圆点 |
| **P2-23** | 「409 / 自动关旧场」的错句在 **WP22 任务单** §1（交付记录本身口径是对的）→ 改任务单根因 + 交付记录新增 §4.9 登记偏差 |
| **P2-24** | WP11 交付记录 §5 红线表首行「不改 `src/engine-core/**`，diff 为空」→ 改为「**审核后**为 1 个文件（`assess-safety.ts`，决策 #4 明确要求改探测超时常量）；**审核前**确实为空」 |
| **P2-25** | WP22 提交 `git show --name-only d18a9ed` 实测 **92 文件 = 前端 16 + 文档 65 + 后端 11** → 交付记录新增 §2.1 **逐个登记 16 个前端文件** |
| **P2-26** | WP24 交付记录补**时序说明**：该记录写于 2026-10-30，**早于** WP19-R（2026-11-02）—— WP19-R 才是把 `traceRecorder` 真注入 DI 的那一次 |
| **P2-27** | `code-vs-blueprint-audit-2026-10-30.md` 抬头加快照提示：「本文件是 2026-10-30 的快照，不代表当前现状」，并点名 D4 已被 WP22 推翻 |
| **P2-28** | backlog §0.3 交付表**补 WP12 / WP16 两行** |
| **P2-29** | 统一 150/500 口径（本单 §1.4 + `assess-safety.ts` + `http-psyguard.probe.ts` 三处 → 见 3.2） |
| **P2-33** | `docs/architecture/v6.0-ai-engine.md` §5 env 表逐行标注接线状态（`LLM_<PROVIDER>_BASE_URL` / `LLM_TIER_*` / `RAG_TOP_K` / `RAG_SCORE_THRESHOLD` / `CRISIS_*` = ⚠️ **预留，当前代码未接线（配了不生效）**） |

### 3.4 配置与已知尾巴（6 条）

| # | 做了什么 | 落点 | 回归 |
|---|---|---|---|
| **P2-34** | `finishReason` **三处透传**：引擎 done chunk + 幂等**重放** done chunk（同一 `round_id` 两次结论必须一致）+ WS `llm_done` 帧。幂等快照新增 `finishReason?` 字段 | `engine-stream-backend.adapter.ts`、`turn-idempotency.service.ts`、`src/voice/voice.service.ts`、`src/voice/voice.types.ts` | 既有 voice 套件 |
| **P2-35** | admin mock 页 `/characters/:slug` 补 **pending 状态标注**（后端没给审核状态时显式渲染 pending chip + 「待接入真实 API」提示） | `admin-dashboard/src/views/CharacterDetail.vue` | — |
| **P2-36** | `sessionId` **服务端生成**：客户端给了合法 id → 原样用（兼容 WP23 重连）；没给或给了 `'default'` → 服务端生成 nanoid，**贯穿整场**（落库桥 / 演练登记 / voice 会话 / 帧出口 / 补漏台账同一来源），随 `ready` 帧下发 `serverSessionId` | `src/voice/voice.gateway.ts`、`src/voice/voice.types.ts` | `wp26-voice-gateway-hardening.spec.ts` 4 例 |
| **P2-38** | `handleDisconnect` 加**持有者闸门**：复用 `sessionSinks` 已记录的 `socketId`（不新建第二张表）；当前持有者不是自己 → **一律不动**（不注销帧出口 / 不 detach / 不摘演练登记） | `src/voice/voice.gateway.ts` | 同上 1 例 |
| **P2-39** | 生产 **5xx 也打 error 级本地日志**（脱敏后）：字段 = status / code / err（异常类名）/ path（去 query）/ 脱敏描述 + 脱敏堆栈。**不进日志**：请求体、请求头、URL query、SQL 原文、手机号、身份证、邮箱、凭据。**返给前端的内容一字未改** | `src/common/filters/biz-exception.filter.ts` | `test/shared/wp26-biz-exception-log.spec.ts` |
| **P2-37** | ⏳ **真机验证项**（Flutter 客户端不在本仓）—— 不在本单代码范围，**内测前需在真机确认**客户端是否总带唯一 `?sessionId=` |

---

## 4. 关键设计决策（为什么这么改）

### 4.1 P2-14 为什么连 observer 一起改注入

任务单只要求"cap 参数改注入"。但 WP25 报告 P2-15 指出：文件头「纯函数 / 无状态 / 可复现」三项**全不成立**，其中一项就是 `let capObserver` 这个**模块级可变状态**。只改 env 不改 observer，那句自述仍然不成立 —— 而且模块级单槽还有个隐性缺陷：**进程内第二个引擎实例会把第一个的观察者顶掉**（多实例部署直接串台）。

所以 observer 一起改注入：内核 → adapter 的通道从"模块级注册表"变成"会话实例的依赖"。代价是要改 `delta-cap.logger.ts` / `engine.providers.ts` / `engine.module.ts` 与两份既有测试 —— 值，因为**内核终于名副其实**。

### 4.2 P2-12 为什么用"累加 delta 向量"而不是"diff 快照"

diff 快照方案（对比 cap 前后两份快照）有**语义偏差**：事件 delta 先被 cap 砍掉一部分，再叠加反向的轨迹 delta 时，被砍掉的量会被漏算。例：事件 +0.25 → cap 0.20，轨迹 −0.05 —— diff 得 0.15，正确应为 **0.20**（总变化量就是 +0.20）。正确流程是：

```
eventDelta  = aggregateTurnDelta(events)          // 事件原始 delta
trajDelta   = 剧本本轮叠加的原始 delta              // 唯一转换点 toDeltaVector
totalDelta  = eventDelta + trajDelta               // 本轮总 delta
cappedTotal = capTurnDelta(totalDelta, config)     // 一次性过 cap
final       = applyDeltaVector(base.snapshot, cappedTotal)
```

顺带修掉一个旧路径的隐性 bug：旧路径是 `clamp(快照) → 再叠加 → 再 clamp`，中间那次 clamp 会把"被砍掉又补回来"的量算丢（例：trust 0.05，事件 −0.25 → clamp 到 0，再叠加轨迹 +0.20 → 0.20，净变化 +0.15，与 cap 声明的 −0.25 矛盾）。新路径**一回合只 clamp 一次**。

### 4.3 P2-3 为什么不做 IP 白名单

生产开了 `app.enable('trust proxy')` → Express 的 `req.ip` 取自 `X-Forwarded-For`，**客户端可伪造**；而应用端口可直连时，基于它的白名单形同虚设。仓库也没有 CIDR 匹配库，手写一套 = 自造边界坑。改用独立 token（`METRICS_TOKEN`，`Authorization: Bearer` / `x-metrics-token`）：Prometheus 原生支持 bearer token，抓取侧零改造，且**可随时轮换**。

### 4.4 P2-4 为什么必须查 DB、不能用 token 里的 `adminRole`

`src/user/providers/user.service.ts:675` 是 `user.adminRole ?? 'admin'` —— **dev fallback**：DB 里 `admin_role` 为 NULL 的普通学员，JWT 里也是 `'admin'`。照抄 token 副本判定 = 防护为 0。加上 token 是签发时快照（角色回收后旧 token 仍可进），所以只能查 DB 真值。

### 4.5 P2-2 为什么 token 通道是**三级**而不是两条

WP26 首版只实现了 `Sec-WebSocket-Protocol` 子协议 —— 那是 **原生 ws** 客户端的通道，**Socket.IO 客户端压根不发那个头**。Flutter 端用的是 Socket.IO `setAuth({ token })`，于是首版实现对 Flutter 端等于"只有 query 能用"，P2-2 的目标（token 不进 URL）根本没达成。

补的 `handshake.auth.token` 是 **Socket.IO 的标准握手字段**（`socket.setAuth({ token })` / `io(url, { auth: { token } })`）：token 走 Socket.IO 的 **CONNECT 包**，不进 URL → 同样不落 nginx access log / Referer / 浏览器历史，**与 P2-2 的目标完全一致**（而且这才是 Socket.IO 客户端的正解，不是变通）。

最终三级优先级：**子协议 > `handshake.auth` > `?token=`**。为什么新通道排在 query 前面：query 是**老客户端兜底**，可能带着一个已撤销的旧 token；新通道是客户端当前明确表达的凭证，先挑它更符合语义。子协议最高是因为它是本单明确定义的"客户端契约"通道（`bearer, <jwt>`）。

auth 通道**只认 `token` 这一个键名**（非字符串 / 空串 → 落到下一级），不认 `accessToken` 之类别名：认一堆别名等于给"拼错键名"留后门，而拼错的后果是握手失败（查得到），不是静默放行。

---

## 5. 改动面

### 5.1 内核（`src/engine-core/**` —— 本单破例允许改，但改完守住纯层红线）

| 文件 | 改动 |
|---|---|
| `cognition/state-transition.ts` | **本单核心**：cap 参数改注入（`DeltaCapConfig` 端口 + `DEFAULT_DELTA_CAP_CONFIG`）、删 `process.env` 读取、删模块级 `capObserver` 单槽、报告带 `sessionId`/`handleId`、新增 `aggregateTurnDelta` / `addDeltaVectors` / `applyDeltaVector` / `buildDeltaCapReport` / `notifyDeltaCap` |
| `cognition/trajectory/trajectory-applier.ts` | 偏移**只转换一次**（`toDeltaVector`），`TrajectoryApplication` 增 `delta?`（原始偏移），落快照改用内核 `applyDeltaVector`（不写第二份 clamp） |
| `in-memory/in-memory-engine-session.ts` | turn 管线改为「事件 delta + 剧本 delta = 总 delta → 一次 cap → 一次 clamp」；`capConfig` / `capObserver` 构造注入 |
| `domain/engine-errors.ts` | 补 `STORAGE_FAILURE`；`UNSUPPORTED` 标注 Phase2 |
| `domain/ports/bdi-state.repository.ts`、`domain/ports/memory.store.ts` | `@throws` 写明 `STORAGE_FAILURE` |
| `cognition/safety/assess-safety.ts` | 150/500 注释口径（P2-9） |
| `index.ts` | 补进 17 个公开符号（P2-16） |

> 内核**零新增文件**（新类型定义在 `state-transition.ts`，与 cap 逻辑同处）→ `boundary.spec.ts` 断言⑦ 的 42 文件清单不用改。

### 5.2 适配层 / 编排层 / 业务层

`src/engine-adapters/wiring/`（`delta-cap.config.ts` **新**、`delta-cap.logger.ts`、`engine.providers.ts`、`engine.module.ts`、`engine-stream-backend.adapter.ts`、`engine-wiring.controller.ts`、`turn-idempotency.service.ts`、`risk/http-psyguard.probe.ts`、`risk/psyguard-health.checker.ts`）、`src/engine-core/../voice/`（`voice.gateway.ts`、`voice.module.ts`、`voice.service.ts`、`voice.types.ts`）、`src/admin-debug/`（`guards/admin-role.guard.ts` **新**、`admin-debug.controller.ts`、`admin-debug.module.ts`）、`src/shared/infra/metrics/metrics.controller.ts`、`src/common/filters/biz-exception.filter.ts`、`src/config/envs/default.ts`、`typings/global.d.ts`、`.env.example`、`admin-dashboard/src/views/CharacterDetail.vue`

### 5.3 测试（净增 7 文件 87 例）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `test/engine-core/wp26-delta-cap-injection.spec.ts` **新** | 9 | P2-11 / P2-12 / P2-14 验收 |
| `test/engine-adapters/wp26-delta-cap-config.spec.ts` **新** | 6 | P2-13 env → 端口装配 |
| `test/voice/wp26-voice-gateway-hardening.spec.ts` **新** | 34 | P2-1 / P2-2 / P2-5 / P2-36 / P2-38 |
| `test/admin-debug/wp26-admin-role-guard.spec.ts` **新** | 14 | P2-4 |
| `test/shared/wp26-metrics-auth.spec.ts` + `test/shared/wp26-biz-exception-log.spec.ts` + `test/config/wp26-metrics-config.spec.ts` **新** | 31 | P2-3 / P2-39 |
| `test/engine-core/boundary.spec.ts` | +2 | 断言⑩（零 env/globalThis）、断言⑪（禁深路径 import） |
| `test/engine-core/wp15-delta-cap.spec.ts` | 改 | env 覆写用例 → **配置注入**用例（口径不变，驱动方式变了） |
| `test/engine-adapters/wp15-delta-cap-log.spec.ts` | 改 | 观察者改注入（不再有注册/注销动作）+ session/handle 标识 |
| `test/config/wp25-env-example-coverage.spec.ts` | 改 | `ENGINE_CAP_*` 族**退役派生登记**（改为字面量断言 + 内核零 cap 键断言） |
| `test/e2e/v2-user-flow.spec.ts` | 改 | `/metrics` 断言按新口径（无凭据 401 / 带 token 200） |

---

## 6. 已知尾巴 / 未核实项（如实登记）

1. **P2-2 / P2-36 的前端部分未做**（Flutter 客户端不在本仓，用户另派单）。后端已做**三兼容**：三条传法都认，优先级 **子协议 > `handshake.auth` > query**。
   - **前端契约 · Socket.IO 客户端（Flutter 端走这条）**：`socket.setAuth({ token })` / `io(url, { auth: { token } })` → 服务端读 `handshake.auth.token`。token 走 Socket.IO 的 **CONNECT 包**，不进 URL → **不会**落进 nginx access log / Referer / 浏览器历史，与 P2-2 的目标完全一致。**Flutter 端可以删掉 query 里的 `?token=`。**
   - **前端契约 · 原生 ws 客户端**：`Sec-WebSocket-Protocol: bearer, <jwt>`（**必须带 `bearer` 标记**，否则严格客户端会在"服务端没选子协议"时中断）。
   - **老客户端兜底**：`?token=` query 仍认（第三优先级）。
   - 其余不变：`ready.serverSessionId` 存下来，后续重连用 `?sessionId=<serverSessionId>` 带回来；新增错误码 `token_revoked`。
2. **P2-37 未核实**（真机验证项）：Flutter 客户端是否**总带唯一** `?sessionId=`。
3. **P2-3 的本地 `.env`** 仍有 `METRICS_ENABLED=true`（未纳入版本库）—— 本地要抓 `/metrics` 需自行补 `METRICS_TOKEN`，否则拿到 401（**这是 fail-close 的预期行为**）。
4. **P2-39 的 Sentry 通道未脱敏**：本单只收紧**本地日志**口径；Sentry 仍原样上报原始异常 + url/ip/ua，属另一次改动。
5. **`METRICS_PATH` 仍是死配置**（路由写死 `@Get('metrics')`），属 P3 范畴。
6. **P2-1 的存量 token 兼容**：按「`type` 存在则必须等于 `access`，缺失则放行」实现（2026-08-27 前的 token 不带 `type`；refresh token 本就用 `jwtRefreshSecret` 签，已被签名校验挡掉）。
7. **未核实项**（不在本仓）：生产机 `117.72.30.78` 的实际 `.env`；`mofang-psyguard` 容器实际 `PSYG_MAX_LENGTH`。
8. **P3 的 10 条仍未做**（已进 backlog Phase2 队列）；**P2-8 / P2-30 / P2-31 / P2-32 已由 WP25 回写处理**（故本单实际修 **34** 条，与任务单口径一致）。

---

## 7. 未 commit / 未 push

按约定本单**不代做提交**，改动全部留在工作区，由用户审阅后自行 commit / push。
