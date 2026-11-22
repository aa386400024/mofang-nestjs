# WP22 · 语音对练限流与并发上限（后端交付记录）

> 日期: 2026-11-02 ｜ 任务单: `engine-wp22-voice-concurrency-limit-backend-2026-11-02.md`
> 归属: Phase1 稳健性 / 内测前硬需求
> 状态: **代码已交付并复跑绿（未 commit）**
> 红线: `src/engine-core/**` 一行不动 —— 实测 `git diff --stat HEAD -- src/engine-core` 为空

---

## 1. 一句话

给 WS 语音对练加两道闸门，都拦在**开会话这一口**：

1. **单用户并发上限（默认 1）** —— 同一 `userId` 开第二场直接拒（`session_already_active`），
   **不自动关旧会话**（防用户误操作丢进度）；
2. **全局日 token 预算**（env `VOICE_DAILY_TOKEN_BUDGET`，默认 50 万 completion tokens/天，
   `0` = 不限制）—— 当日累计超了就拒新会话（`daily_budget_exceeded`）。

拒绝时给前端发**专属 error 帧**（带自己的 code 与可读文案），不静默回落、不 500。

---

## 2. 改动面（后端 6 个源文件 + 1 个测试文件 + 1 处全局类型声明；**另有前端 16 个文件，见 §2.1**）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/voice/voice-session-limits.service.ts`（新） | 闸门本体：并发反向索引（内存 Map）+ 当日预算（Redis） |
| 2 | `src/voice/voice-session-limit.error.ts`（新） | `VoiceSessionLimitError` + 两个错误码 + 错误帧映射 |
| 3 | `src/voice/voice.service.ts` | `startSession` 拦（开场失败释放占位）；`endSession` 释放占位 + 记用量 |
| 4 | `src/voice/voice.gateway.ts` | 闸门错误 → 专属 error 帧（不是通用 `session_start_failed`） |
| 5 | `src/voice/voice-turn-backend.port.ts` | 窄接口收尾结果加**可选**字段 `totalCompletionTokens` |
| 6 | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | 收尾时把本场用量随结果带出（复用 WP24 累加器） |
| 7 | `src/voice/voice.module.ts` | 装配 `VoiceSessionLimitsService` |
| 8 | `src/shared/infra/redis/redis.service.ts` | 补 `incrby`（原子自增） |
| 9 | `src/config/envs/default.ts` | `voice.dailyTokenBudget` / `voice.maxConcurrentPerUser` |
| 10 | `typings/global.d.ts` | 声明 2 个 env 键（否则 TS4111，仓库既有治本套路） |
| 11 | `test/voice/wp22-voice-concurrency-budget.spec.ts`（新） | **28 例** |

**没动**：`src/engine-core/**`、TTS / ASR / 帧协议、`/auth/*`、`/user/*`、旧链路的 `VisitorService`。

### 2.1 前端（`admin-dashboard/`）改动 16 个文件 —— 初稿漏登记，2026-11-03 补

本单后端闸门落地时，**顺带把 admin-dashboard 从"纯 mock 脚手架"切成了真接口，并补齐了 i18n 与登录页**（WP19-R 已把后端 `/admin/api/*` 收口，前端才有得接）。**初稿交付记录只登记了后端改动面，这 16 个前端文件当时没登记** —— 2026-11-03 按 `git show --stat d18a9ed` / `git show --name-only d18a9ed` 补齐。该提交共 **92 个文件 = 前端 16 + 文档 65 + 后端 11**。

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `admin-dashboard/src/api/client.ts` | 真 API 接入核心：新增 `get<T>()`（带 basic auth 头，401 弹框重输凭据后重试）；`sessions` / `session` / `characters` / `health` **4 个方法改走 `fetch('/admin/api/...')`**，其余 11 个方法仍是 mock |
| 2 | `admin-dashboard/src/api/types.ts` | 前端类型对齐 WP19 §1.1 新契约：旧字段名 `bdi` / `usage` → `bdiSnapshot` / `llmUsage`（**这是 WP19-R §9 遗留的"前端类型失配"，在本单修掉**） |
| 3 | `admin-dashboard/src/router/index.ts` | 路由表扩到 **9 个页面**（补 `/login` / `/dashboard` / `/memories` / `/psyguard` / `/cost`）+ 登录守卫（无凭据跳 `/login`） |
| 4 | `admin-dashboard/src/views/Login.vue` | **新增**：采集 basic auth 凭据 → `sessionStorage` → 探 `/admin/api/health` 验通 |
| 5 | `admin-dashboard/src/views/SessionsList.vue` | 切真 API：会话列表拉 `/admin/api/sessions` |
| 6 | `admin-dashboard/src/views/SessionDetail.vue` | 切真 API：会话详情主数据拉 `/admin/api/sessions/:id`（轨迹 / 本场记忆两块仍 mock） |
| 7 | `admin-dashboard/src/views/CharactersList.vue` | 切真 API：角色池拉 `/admin/api/characters` |
| 8 | `admin-dashboard/src/views/CharacterDetail.vue` | 仍走 mock：角色详情 / 记忆 / 历史会话三块（`api.character` / `api.memories` / `api.characterSessions`） |
| 9 | `admin-dashboard/src/views/Dashboard.vue` | **半真**：仪表盘 + 近 7 天趋势，方法签名对齐后端契约但返回值是写死的常量 |
| 10 | `admin-dashboard/src/views/MemoryBrowser.vue` | 记忆浏览器，仍走 mock（`api.memories()` 恒返空数组） |
| 11 | `admin-dashboard/src/views/PsyGuardMonitor.vue` | PsyGUARD 监控，仍走 mock（`api.psyguard()` / `api.psyguardTrend()`） |
| 12 | `admin-dashboard/src/views/CostBoard.vue` | 成本看板，仍走 mock（`api.costTrend()` / `api.sessionCosts()`） |
| 13 | `admin-dashboard/src/components/BdiTrajectoryChart.vue` | 轨迹图组件：字段 `t.bdi.*` → `t.bdiSnapshot.*`，跟 §2 的类型改名对齐 |
| 14 | `admin-dashboard/src/components/EmptyState.vue` | **新增**：空态组件（图标 + 标题 + 描述 + 可选 `pendingTag` 徽标）—— 给 mock 页面的空数据一个统一展示位 |
| 15 | `admin-dashboard/src/App.vue` | 顶栏（导航 / 深浅主题切换 / 中英切换）+ 登录页免导航 |
| 16 | `admin-dashboard/src/i18n/index.ts` | 中英 i18n 收口：`setLang()` 的 locale 收窄成 `'zh-CN' \| 'en'`（消除 `createI18n` 的宽类型报错） |

> **为什么前端改动没进初稿登记**：本单任务边界写的是"后端闸门"，`admin-dashboard` 当时被当成另一个轮次（WP20）的工作面。但同一个提交里实际改了这 16 个文件 —— **交付记录不登记 = 下一个人做对账时会漏掉一半改动面**。这正是 WP25 代码级对账在 `code-vs-blueprint-audit-2026-10-30.md` D4 / D13 反复吃到的亏（"改动面清单与真实提交对不上"）。
>
> **同一提交里还搬了 65 个文档文件**（`docs/worklog/**` → `docs/worklog/completed/<子目录>/`）。这是 2026-11-03 文档死链（P2-19 / P2-20 / P2-21）的**直接成因** —— 文件挪了目录，相对链接没跟着改，于是全仓出现 114 条死链。

---

## 3. 流程

```
WS 握手 → VoiceGateway.verifyAndStart
  → VoiceService.startSession(meta)
      → ① VoiceSessionLimitsService.acquire(userId, sessionId)
           ├─ 闸门 1: 并发上限 (内存 Map, 同步+原子: 判定与占位同一步)
           │    └─ 超限 → throw VoiceSessionLimitError('session_already_active')
           └─ 闸门 2: 当日预算 (Redis GET voice:daily-token-budget:{YYYY-MM-DD})
                └─ used >= budget → throw VoiceSessionLimitError('daily_budget_exceeded')
                     └─ 预算没过 → **释放并发占位** (不留占位泄漏)
      → ② openBackendSession (引擎 / 旧链路, 原样)
           └─ 失败 → 释放并发占位 + 抛错
      → ③ 会话建立
  → ... 对练 ...
  → VoiceService.endSession(sessionId)
      → 释放并发占位
      → 取本场 totalCompletionTokens (引擎适配器随收尾结果带出)
      → Redis INCRBY 当日计数 + EXPIRE 48h (fire-and-forget)
```

---

## 4. 与任务单的偏差（9 条，都有理由）

### 4.1 闸门放在 voice 层（`VoiceService.startSession`），不是 `EngineStreamBackend.openSession`

任务单 §2.1 说"在 `EngineStreamBackend`（或独立的 `VoiceSessionConcurrencyGuard`）维护反向 Map"，
§1 又说"在 **openSession 入口** 拦截（WS 握手后调 `EngineStreamBackend.openSession()` **之前**）"。

**这两句在实现上必须选后者**，原因很硬：`VoiceService.openBackendSession` 会 `catch`
引擎开场的**所有**异常并当场**静默回落旧链路**（`voice.service.ts:778`）。
闸门若抛在引擎适配器里，会被那个 catch 吞掉 → 变成"回落旧链路继续开会话" = **闸门形同虚设**。

所以：闸门在 voice 层、**在任何后端会话开起来之前**判。
附带好处：**新旧两条链路都被拦**（旧链路也烧额度），而放在引擎适配器里只拦得住新链路。

### 4.2 并发索引用 `Map<userId, Set<sessionId>>`，不是 `Map<userId, sessionId>`

任务单 §2.2 写的是 `userId → activeSessionId` 单值。但 §2.2.5 又要求加
`VOICE_MAX_CONCURRENT_PER_USER`（"保留扩展空间"）。单值版在 N=2 时会**丢掉第一场** ——
那不是"并发上限"，是"随机留一场"。用集合才能诚实表达"最多 N 场"。默认仍是 1。

### 4.3 error 帧用仓库**既有**的嵌套格式，不是任务单 §2.3 的平铺格式

任务单 §2.3 写的是：

```json
{ "type": "error", "code": "session_already_active", "message": "..." }
```

但本仓真实的帧格式是（`voice.types.ts` 的 `VoiceServerMessage` 联合类型 + 网关里
`unauthorized` / `template_not_found` / `session_start_failed` 全部走它）：

```json
{ "type": "error", "error": { "code": "...", "message": "...", "retryable": false } }
```

用户明确要求"前端不用改，error 帧格式它已经能处理" → **必须沿用嵌套格式**，
平铺格式前端反而认不出（只看到"连不上"）。已用单测钉死帧的逐字形状。

### 4.4 预算用 `used >= budget` 判"超限"（用满即拒）

任务单 §4 验收 #3 写"临时把 env 调成 100，跑完一场后再开，被拒"。
"预算 100"意味着"最多花 100"—— 刚好花满 100 时额度已经用尽，下一场没有额度了 → 拒。
若用严格 `>`，验收 #3 在"这场正好花了 100"的边界上就拒不掉。

### 4.5 Redis 读失败 → **放行**（fail-open），写失败 → 只记 warn

任务单没写失败语义，这里明确取"可用性优先"：

- 这道闸门防的是**烧钱**，不是**越权**。Redis 抖动就让所有人开不了对练，代价远大于放行。
- 真正防"bug 循环狂开会话"的那道闸（并发上限）是**纯内存**的，Redis 挂了它照样在。
- 写失败更必须放行：收尾路径不能因为记账失败而失败（否则 `session_ended` 帧发不出去，前端一直转圈）。

⚠️ 已知边界：Redis **长时间**不可用时，日预算形同虚设（见 §7）。

### 4.6 本场用量复用 WP24 的累加器，通过窄接口**可选字段**传给 voice 层

任务单 §3 要求"在 closeSession 时把本场 `totalCompletionTokens` 累加到 Redis"。
`totalCompletionTokens` 只存在于引擎适配器的私有累加器里（WP24），voice 层看不到。

做法：窄接口 `VoiceTurnBackendCloseResult` 加**可选**字段 `totalCompletionTokens`，
适配器在收尾时带出，voice 层读它写 Redis。

- 为什么是"可选字段"：窄接口的既有纪律（角色 / 剧本参数同款理由）—— 旧链路
  `VisitorService` 没有用量累加器，缺省即可，不能变成必填（旧实现直接塞不进契约）。
- 为什么缺省语义是"不可得"而不是 0：0 会被当成"这场没花钱"，两者不能混。
- 为什么不重复计费：适配器**按句柄判定**，同一场被 `closeSession` 两次时第二次拿不到累加器
  → 第二次缺省 → 调用方不会重复记账（有单测钉死）。

### 4.7 `RedisService` 补了 `incrby`（不是新依赖）

任务单要求"复用现有 `RedisService`，不引入新依赖" —— 补一个方法是**复用**而非新依赖。
为什么不用 `get` + `set` 自己拼：那是读-改-写，两场会话**同时**收尾时后写的会覆盖先写的 ——
计数会**少算**，而这个计数的用途恰恰是"防烧额度"，少算等于没算。`INCRBY` 在 Redis 侧原子完成。

### 4.8 闸门在 `VoiceService` 构造上是 `@Optional()`

与本类其余可选增强同款语义：装配缺席时**会话照常开**，只是"没有并发上限 / 没有日预算"；
但缺席时打一条 warn（`[voice_limits] 未装配会话限流闸门…`），启动日志里能看见，不静默放过。

为什么不强制装配：仓库里 5 处测试直接 `new VoiceService(...)`（`test/voice/*`、
`test/engine-adapters/*`），强制装配就得改它们；而"服务因为没装闸门而起不来"比"没有闸门"更糟。
生产装配在 `VoiceModule.providers` 里显式 provide。

### 4.9 任务单 §1 的「先关第一场 / 拒绝 409」两个选项**都没落地**（2026-11-03 补登记）

任务单 §1 写的是「开第二场时，**先关第一场**（**或直接拒绝 409**）」—— 给了两个可选口径。**本单两个都没照做**，实际口径是：

| 维度 | 任务单 §1 原话 | 本单实际落法 | 为什么这么定 |
|---|---|---|---|
| 旧会话 | 「先关第一场」 | **不自动关旧会话** | 用户可能误操作（重复点开）。默默把上一场 TTS dispose 掉 = **丢进度**，比"多开一场被拒"更伤。任务单 §5 自己写了「❌ 不做自动关旧会话再开新的」—— **§1 是与 §5 自相矛盾的那一处** |
| 拒绝方式 | 「拒绝 409」 | **独立错误码 `session_already_active`** + WS `error` 帧 | **WS 没有 HTTP 状态码**，帧里只有 `code` / `message` / `retryable`；套一个 409 是把 HTTP 思维搬过来，对前端零信息量。走独立码才能让前端分支处理（"结束旧会话后可重试" → `retryable: true`） |

**落地链路**：`voice-session-limit.error.ts`（错误码 + 文案 + `retryable` + 帧映射）→ `voice-session-limits.service.ts`（闸门判定与占位）→ `voice.service.ts:430` `startSession` 里 `await this.limits?.acquire(...)` → `voice.gateway.ts` 把闸门错误映射成**专属** `error` 帧（不是通用的 `session_start_failed`）。

> ⚠️ **2026-11-03 回写**：这条偏差初稿没登记 —— 交付记录 §1 与 §4.3 只写了"独立错误码 / 不自动关"，**没说明任务单 §1 原本写的另一套口径是什么**。读的人翻到任务单 §1 看到"先关第一场 / 409"，对不上代码，只能靠猜。已按代码事实补上，并把任务单 §1 一并改正（两边现在口径一致）。

---

## 5. 验收 6 条 —— 逐条对照

| # | 验收点 | 结果 | 用例 |
|---|---|---|---|
| ① | 同 userId 开第二场被拒 → `session_already_active` | ✅ | 限流服务「第二场被拒 + 文案逐字相同」「拒绝时不碰第一场」+ VoiceService「同 userId 第二场抛闸门错误」+ 网关「映射成专属 error 帧」 |
| ② | 第一场正常结束后，同 userId 可以开第二场 | ✅ | 限流服务「release 后可再开」+ VoiceService「endSession 后可再开」 |
| ③ | 日预算超限后新会话被拒 → `daily_budget_exceeded` | ✅ | 限流服务「累计 600 / 预算 500 → 拒」「恰好用满 → 也拒」 |
| ④ | 日预算 env = 0 时不限制 | ✅ | 限流服务「budget=0 → 放行，且**连 Redis 都不读**」 |
| ⑤ | `git diff --stat HEAD -- src/engine-core` 为空 | ✅ | 闸门实测（§6） |
| ⑥ | eslint 0 / tsc 0 / 全量测试绿 | ✅ | 闸门实测（§6） |

**另加 9 条边界**：
- **不自动关旧会话**：拒绝第二场后第一场仍占名额（用户自己决定何时结束）；
- **同一 sessionId 重连不算第二场**（前端重连带着同一个 sessionId）；
- **占位不泄漏**：开场失败 / 预算没过都会释放占位（否则用户被自己的闸门永久锁死）；
- **收尾记账**：本场 `totalCompletionTokens` → `INCRBY` 当日计数 + `EXPIRE 48h`；
- **key 按自然日分桶**：`voice:daily-token-budget:{YYYY-MM-DD}`；
- **Redis 读失败 fail-open**、写失败只 warn；
- **非法 env 回退默认**（填错 env 不该让服务起不来）；
- **没装配闸门 → 会话照常开**；
- **DI 冒烟**：闸门放进真 Nest 容器装一次（这仓有"只跑单测、没起过服务"的启动炸弹前科，见 WP8-B）。

---

## 6. 闸门实测（2026-11-02）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| 规范 | `npx eslint "src/**/*.ts" "test/**/*.ts" "typings/**/*.ts"` | **exit 0 · 0 error / 0 warning** |
| 新增套件 | `npx vitest run test/voice/wp22-voice-concurrency-budget.spec.ts` | **28 例全通过** |
| 全量 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **67 文件 / 1061 例全通过**（本单之前：66 文件 / 1033 例，零回归） |
| 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

> 首轮 eslint 报了 5 个 prettier error + 5 个 import/order warning（全在本单新文件里），
> `--fix` 修完复跑为 exit 0 —— 只重排 import 顺序与换行，**没有改任何逻辑**。
>
> 注：仓库的测试框架是 **vitest**（任务单 §6 写的 `npx jest` 是旧写法，本仓没有 jest）。

---

## 7. 已知边界（诚实记录）

1. **旧链路（灰度名单外）的会话不计入日预算** —— 旧链路 `VisitorService` 没有用量累加器，
   "这场花了多少"在那一侧不可得。默认配置下灰度名单为空 = **全部会话走新引擎**，所以主路径全覆盖；
   只有显式排除的会话漏记。
2. **Redis 长时间不可用 → 日预算形同虚设**（fail-open，见 §4.5）。并发闸门不受影响。
3. **单实例假设** —— 并发反向索引在**进程内存**里。多实例部署时，同一用户可以在不同实例各开一场
   （任务单 §2.1 已注明"进程重启后清空是可接受的"，分布式锁属 Phase2）。
4. **额度记账失败 → 这一场没记上**（Redis 写失败只 warn）。收尾不受影响，但预算会偏低。
5. **预算只拦"新开会话"**，不打断已在进行的会话（正在烧的那一场不会因为超额而中断）。
6. **闸门拒绝时会断开该 WS 连接**（与仓库既有 `template_not_found` / `session_start_failed` 同款处理）。
7. **`retryable` 语义**：`session_already_active` → `true`（结束旧会话后可重试）；
   `daily_budget_exceeded` → `false`（今日不再放行）。前端按既有 error 帧处理逻辑消费。

---

## 8. 联调口径（前端）

WS error 帧（**沿用仓库既有嵌套格式**）：

```json
{ "type": "error", "error": { "code": "session_already_active", "message": "您已有一场进行中的训练，请先结束再开始新的", "retryable": true } }
{ "type": "error", "error": { "code": "daily_budget_exceeded", "message": "今日额度已用完，请明天再来", "retryable": false } }
```

- `session_already_active` 的 message 按任务单原文逐字一致。
- `daily_budget_exceeded` 的 message 任务单只给了"今日额度已用完"这个提示语，
  这里补成完整句「今日额度已用完，请明天再来」（含原提示语）。

**env**（可选，不配即用默认）：

| env | 默认 | 含义 |
|---|---|---|
| `VOICE_DAILY_TOKEN_BUDGET` | `500000` | 全局当日 completion token 预算；`0` = 不限制 |
| `VOICE_MAX_CONCURRENT_PER_USER` | `1` | 单用户并发语音会话上限（本期恒为 1） |
