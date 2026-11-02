# WP22 · 语音对练限流与并发上限（后端任务单）

> 日期: 2026-11-02
> 状态: ✅ 已交付并复跑绿（**未 commit**）→ 交付记录: `engine-wp22-voice-concurrency-limit-backend-implementation-2026-11-02.md`（同目录）
> 归属: Phase1 稳健性 / 内测前硬需求
> 仓库: `E:\Work\Project\backend\mofang-nestjs`

---

## 0. 为什么有这条

`@nestjs/throttler` 全局 guard 只覆盖 HTTP 端点，WS 语音对练握手/openSession **没有任何并发上限或日预算控制**。内测阶段如果出现 bug 循环（比如前端重连风暴）或恶意刷，可以直接烧 MiniMax 按量付费额度。

**目标是最便宜的防烧钱护栏，不做复杂限流系统。**

---

## 1. 目标

两道闸门，在 **openSession 入口** 拦截（WS 握手后调 `EngineStreamBackend.openSession()` 之前）：

1. **单用户并发上限 = 1**：同一 userId 同时只能有 1 场活跃语音会话。开第二场时，先关第一场（或直接拒绝 409）。
2. **全局日 token 预算**：env 可配日 token 上限，超限后拒绝新会话并提示"今日额度已用完"。

---

## 2. 具体改动点

### 2.1 单用户并发上限

**现状**：`EngineStreamBackend.handles` 是 `Map<string, string>`（sessionId → userId），只记录了会话归属，没有反向索引（userId → 活跃 sessionId）。

**改法**：

1. 在 `EngineStreamBackend`（或独立的 `VoiceSessionConcurrencyGuard`）维护一个反向 Map：`userId → activeSessionId`。
2. `openSession()` 入口先查这个 Map：
   - 如果该 userId 已有活跃 session：**直接抛业务异常**（对应 WS 帧 `error`，code=`session_already_active`，message=`您已有一场进行中的训练，请先结束再开始新的`），**不自动关旧会话**（避免用户误操作丢进度）。
   - 没有则正常 open，写入反向 Map。
3. `endSession()` / 连接断开时，从反向 Map 删除该 userId。
4. **边界**：进程重启后反向 Map 清空是可接受的（Phase1 单实例，重启后旧 WS 连接本来也断了）。

**注意**：不要改 `src/engine-core/**`。这个并发检查属于编排层/适配层，落在 `EngineStreamBackend` 或 voice 层。

### 2.2 全局日 token 预算

**现状**：WP24 已经在 closeSession 时打每场成本日志（`totalCompletionTokens`），但没有全局日累计。

**改法**：

1. 复用现有 `RedisService`（`src/shared/infra/redis/redis.service.ts`）。
2. key 设计：`voice:daily-token-budget:{YYYY-MM-DD}`，value = 当日累计 completion tokens。
3. 在 **closeSession** 时（不是 openSession 时）把本场 `totalCompletionTokens` 累加到 Redis key，设 TTL = 48 小时（跨日自动过期）。
4. 在 **openSession** 入口先读 Redis 当日累计值：
   - 超过 `VOICE_DAILY_TOKEN_BUDGET`（env，默认 500_000，约 50 万 completion tokens/天）→ 拒绝新会话，WS `error` 帧 code=`daily_budget_exceeded`。
   - 没超 → 正常放行。
5. env 配置加在 `src/config/envs/default.ts`：
   - `VOICE_DAILY_TOKEN_BUDGET`（number，默认 500_000，0 = 不限制）
   - `VOICE_MAX_CONCURRENT_PER_USER`（number，默认 1，保留扩展空间，本期恒为 1）

### 2.3 前端配合（本单不含前端改动）

WS error 帧约定：
```json
{
  "type": "error",
  "code": "session_already_active" | "daily_budget_exceeded",
  "message": "..."
}
```
前端 Flutter 已有 error 帧处理（显示 toast），本单只需保证 code 和 message 清晰可读。

---

## 3. 依赖

- WP24（成本日志，已交付）—— 复用 `totalCompletionTokens` 字段
- 现有 `RedisService`（已交付）
- `EngineStreamBackend` 的 openSession / endSession 生命周期

---

## 4. 验收标准

| # | 验收点 | 怎么测 |
|---|---|---|
| 1 | 同 userId 开第二场会话被拒，返回 `session_already_active` | 用同一账号开两个 WS 连接，第二个 openSession 收到 error 帧 |
| 2 | 第一场正常结束后，同 userId 可以开第二场 | endSession 后再 open，成功 |
| 3 | 日预算超限后新会话被拒，返回 `daily_budget_exceeded` | 临时把 env 调成 100，跑完一场后再开，被拒 |
| 4 | 日预算 env = 0 时不限制 | 设 0，任意开 |
| 5 | 引擎内核 `src/engine-core/**` 零改动 | `git diff --stat HEAD -- src/engine-core` 为空 |
| 6 | eslint 0 / tsc 0 / 全量测试绿 | 跑闸门命令 |

---

## 5. 不做

- ❌ 不做令牌桶/滑动窗口限流（Phase2）
- ❌ 不做按用户分级配额（不同用户不同额度，Phase2）
- ❌ 不做分布式锁（单实例 Phase1 足够，Redis 只是计数不是锁）
- ❌ 不做"自动关旧会话再开新的"（用户可能误操作，直接拒绝更安全）
- ❌ 不改 `src/engine-core/**` 纯层
- ❌ 不做前端 Vue/Flutter 改动（前端已有 error 帧处理）

---

## 6. 复跑闸门

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-adapters
git diff --stat HEAD -- src/engine-core
```
全部 0 error / 全绿 / engine-core 空。

> ⚠️ **命令更正**（2026-11-02 交付时核实）：本仓测试框架是 **vitest**，没有 jest ——
> §6 里的 `npx jest` 是旧写法。实际跑的是 `npx vitest run`（见交付记录 §6）。

---

## 7. 交付回写（2026-11-02）

> 状态: **代码已交付并复跑绿，未 commit**。
> 交付记录: `engine-wp22-voice-concurrency-limit-backend-implementation-2026-11-02.md`（同目录）

### 7.1 两道闸门落地在哪

都拦在 **WS 握手 → `VoiceService.startSession()`** 这一口（**任何**后端会话开起来之前）：

1. **单用户并发上限**（内存 `Map<userId, Set<sessionId>>` 反向索引，默认 1）
   —— 超限抛 `VoiceSessionLimitError('session_already_active')`，**不自动关旧会话**；
2. **全局日 token 预算**（Redis `voice:daily-token-budget:{YYYY-MM-DD}`，TTL 48h）
   —— `used >= budget` 时抛 `VoiceSessionLimitError('daily_budget_exceeded')`。
   本场用量在 `closeSession` 时累加进 Redis（复用 WP24 的 `totalCompletionTokens`）。

### 7.2 与任务单的偏差（8 条）

| # | 偏差 | 为什么 |
|---|---|---|
| 1 | 闸门放 **voice 层**，不在 `EngineStreamBackend.openSession` | `VoiceService.openBackendSession` 会 catch 引擎开场的所有异常并**静默回落旧链路** —— 闸门抛在适配器里会被吞掉，**形同虚设**。放 voice 层还顺带把旧链路也拦住（它也烧额度） |
| 2 | 索引是 `Map<userId, Set<sessionId>>`，不是单值 | §2.2.5 要求 env 可配 N；单值版在 N=2 时会丢第一场 |
| 3 | error 帧用**仓库既有嵌套格式** `{type,error:{code,message,retryable}}` | §2.3 写的是平铺格式，但前端已按嵌套格式解析（用户要求"前端不用改"） |
| 4 | 超限判 `used >= budget` | "预算 100"= 最多花 100，用满即拒（否则验收 #3 在边界上拒不掉） |
| 5 | Redis 读失败 **fail-open**、写失败只 warn | 防烧钱 ≠ 防越权；Redis 挂了不该让所有对练开不起来，且并发闸门不依赖 Redis |
| 6 | 用量通过窄接口**可选字段** `totalCompletionTokens` 传给 voice 层 | 用量累加器是适配器私有状态；可选字段不破坏旧实现（窄接口既有纪律），缺省语义是"不可得"不是 0 |
| 7 | `RedisService` 补 `incrby` | 复用既有封装（非新依赖）；`get`+`set` 是读-改-写，两场同时收尾会**少算** |
| 8 | 闸门在 `VoiceService` 构造上是 `@Optional()` | 装配缺席时会话照常开（但打 warn）；5 处既有测试直接 `new VoiceService(...)`，强制装配要改它们，而"起不来"比"没闸门"更糟 |

### 7.3 验收 6 条对照

| # | 验收点 | 结果 |
|---|---|---|
| ① | 同 userId 第二场 → `session_already_active` | ✅ 限流服务 + VoiceService + 网关帧映射 三层都钉死 |
| ② | 第一场结束后可开第二场 | ✅ 限流服务 + VoiceService 端到端 |
| ③ | 日预算超限 → `daily_budget_exceeded` | ✅ 超限 + 恰好用满两种边界 |
| ④ | env = 0 → 不限制 | ✅ 且**连 Redis 都不读** |
| ⑤ | engine-core 零改动 | ✅ `git diff --stat HEAD -- src/engine-core` 空 |
| ⑥ | eslint 0 / tsc 0 / 全量绿 | ✅ 见 §7.4 |

### 7.4 闸门实测

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npx eslint "src/**/*.ts" "test/**/*.ts" "typings/**/*.ts"` | **exit 0 · 0 error / 0 warning** |
| `npx vitest run test/voice/wp22-voice-concurrency-budget.spec.ts` | **28 例全通过** |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **67 文件 / 1061 例全通过**（本单之前 66 文件 / 1033 例，零回归） |
| `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

### 7.5 已知边界

旧链路（灰度名单外）不计入日预算 · Redis 长时间不可用时日预算 fail-open · 单实例（反向索引在内存里）·
记账失败这一场没记上 · 预算只拦新开会话、不打断进行中的会话 · 闸门拒绝时断开该 WS 连接。
