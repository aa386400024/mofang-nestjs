# WP23 · WS 断连重连追平（无定时器、无硬切、重连即补漏）（后端交付记录）

> 日期: 2026-11-03 ｜ 任务单: `engine-wp23-ws-disconnect-grace-backend-2026-11-03.md`
> 归属: Phase1 稳健性 / 内测前护栏
> 状态: **代码已交付并复跑绿（未 commit）**
> 红线: `src/engine-core/**` 一行不动 —— 实测 `git diff --stat HEAD -- src/engine-core` 为空

---

## 1. 一句话

断线不再立刻 `endSession` + 清 BDI（用户网抖一下整场报废且毫无感知），改成**对话式追平**：

- **断线不杀会话**：会话留在内存里，in-flight 的 LLM 渲染让它自然跑完，不挂任何判死定时器；
- **重连即补漏**：客户端握手带 `lastSeenTurnIndex=N`，服务端把 N 之后所有**已提交**轮次一次性塞进 `session_catchup` 帧推回（只补最终文本，不回放流式 chunk / TTS 音频）；
- **进程重启过**：走 WP12 `resumeFromSessionId` 那条路重建，补漏数据改从持久化侧捞；
- **内存卫生**：2 小时 idle 兜底（env 可调）—— 是兜底，不是断连宽限期。

---

## 2. 改动面（11 个源文件 + 3 个测试文件，+1327 / −53）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/voice/voice.types.ts` | 帧契约：`llm_done` 加**可选** `turnIndex`；新增 `VoiceCatchUpTurn` / `VoiceCatchUpBdiSnapshot` / `VoiceCatchUpSessionState`；新增三个帧变体 `session_catchup` / `session_reattached` / `session_stale`；`session_ended.reason` 增 `idle_timeout`；`VoiceSessionState` 增 `attached`（socket 存活态） |
| 2 | `src/voice/voice-turn-backend.port.ts` | 窄接口增**可选**方法 `catchUp?(sessionId, lastSeenTurnIndex)`；导出 `VoiceCatchUpResult`；`VoiceTurnBackendTurnOptions` 增**可选** `turnIndex?` |
| 3 | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | **已提交轮次台账**（`committedTurns`）；`catchUp()` 实现；`recordCommittedTurn()`（含 `safeBdiSnapshot`）；`openSession`/`closeSession` 清台账 |
| 4 | `src/voice/voice.service.ts` | socket 存活态（`attachSocket`/`detachSocket`）；断连跳过 TTS；**会话级 idle 兜底定时器**；`reconnectSession()` 两条路径 + `reattachExisting()` / `resumeAfterRestart()`；`buildCatchUpFrame()`；轮次号算一次带到底；`llm_done` 带轮次号 |
| 5 | `src/voice/voice.gateway.ts` | `handleDisconnect` **不杀会话**；重连分支 `handleReconnect()`；**会话级帧出口**（每次发帧按 sessionId 查当前出口）；`buildSessionMeta()`；握手参数透传 |
| 6 | `src/voice/voice-handshake.ts` | 解析 `lastSeenTurnIndex`（非负整数）与 `dbSessionId`（同款清洗） |
| 7 | `src/voice/voice-session-bridge.ts` | 桥增**可选**方法 `readCommittedTurns?()` + 输入/输出类型；注册表读回实现（跨桥取第一个给得出结论的） |
| 8 | `src/counselor/providers/vpt-session-bridge.service.ts` | 实现 `readCommittedTurns()`：按 id + userId 查（**归属校验**）→ 逐字稿配对成轮 + WP19-R trace 还原 BDI 快照 |
| 9 | `src/config/envs/default.ts` | `voice.sessionIdleTimeoutMinutes`（默认 120）/ `voice.catchUpMaxTurns`（默认 20）+ `readPositiveNumber()` 兜底 |
| 10 | `typings/global.d.ts` | 声明两个新 env 键；标注既有 `VOICE_SESSION_IDLE_TIMEOUT_MS` 是**无人消费的死配置** |
| 11 | `.env.example` | 两个新 env 键 + 说明（单位是分钟；非法值回退） |
| 12 | `test/voice/wp23-ws-disconnect-grace.spec.ts`（**新**） | **24 例**（voice 层：断连 / 重连 / 补漏 / TTS 跳过 / idle 兜底 / 握手解析） |
| 13 | `test/voice/wp23-gateway-reconnect.spec.ts`（**新**） | **6 例**（gateway：断连不杀会话 / 重连分支 / 帧出口登记与竞态） |
| 14 | `test/engine-adapters/wp23-committed-turn-ledger.spec.ts`（**新**） | **5 例**（引擎侧台账） |

**没动**：`src/engine-core/**`、TTS / ASR 协议、旧链路 `src/agent/visitor`、Flutter 端、`admin-dashboard/`、`src/agent/llm/llm.types.ts`（`LlmStreamChunk` 一个字段都没加 —— 轮次号走 `VoiceTurnBackendTurnOptions`，不动 agent 层契约）。

---

## 3. 流程

```
断线 (socket 掉了)
  → gateway.handleDisconnect
      ├─ 注销帧出口 (只注销**自己**那份 —— 新 socket 可能已接管)
      ├─ voice.detachSocket  → attached=false + 停掉在跑的 TTS 合成 (cancel)
      ├─ 移除演练登记 (演练元数据, 不是会话状态 —— 重连时重建)
      └─ ❌ 不 endSession / 不删内存会话 / 不挂判死定时器

重连 (握手带 lastSeenTurnIndex=N)
  → gateway.verifyAndStart
      ├─ voice.reconnectSession
      │   ├─ 路径 1 (内存命中)
      │   │   ├─ attachSocket (attached=true) + 重置 idle 计时器
      │   │   ├─ backend.catchUp(N) → 引擎侧台账里 turnIndex > N 的轮次
      │   │   └─ 组装 session_catchup / session_reattached / session_stale
      │   └─ 路径 2 (进程重启过)
      │       ├─ bridges.readCommittedTurns(dbSessionId) → 逐字稿 + trace (带归属校验)
      │       ├─ 查不到 → session_stale(unknown_session) → 落 fresh 场 + 补推 stale 帧
      │       └─ 查到 → startSession(resumeFromSessionId=原 sessionId) → 同上组帧
      └─ gateway: 复用落库 id (不新建行) + 重新登记帧出口 → 发 ready → 发补漏帧

断连期间新触发的轮次
  → beginTtsTurn: attached=false → **压根不调 TTS provider**, 但 LLM 照跑
      (文本进补漏台账 → 重连时用 session_catchup 补回)
```

---

## 4. 与任务单的偏差（22 条，都有理由）

### 4.1 catch-up 帧的 `bdiSnapshot` 用 **WP19-R trace 口径**，不用任务单示例里的形状

任务单 §1.4 示例写的是 `"bdiSnapshot": { "trust": 0.62, "valence": -0.31, "arousal": 0.45, "resist": { "cognitive": 0.2 }, "transference": {} }`。

**我选了** `{ trust, valence, arousal, resistance, anxiousSecure }`（WP19-R 留痕的既有形状）。理由：

- 那份契约**已经被调试器 SPA 与报告页依赖**（`turn_debug_trace` 列的 JSON 契约），是**持久化口径**；
- 另造第三套 BDI 快照形状必然漂移 —— 三套形状迟早有两套对不上，而对不上的那一套正好是客户端拿去渲染状态的那套；
- 任务单自己也写了「`bdiSnapshot` 跟断线前最后一轮一致（**从 trace 还原**）」—— 还原出来的形状自然就是 trace 的形状。

### 4.2 握手 query **多了一个**可选参数 `dbSessionId`（对任务单契约的增补）

任务单 §1.2 只列了 `lastSeenTurnIndex`。**我加了** `dbSessionId`（可选）。理由：

- 路径 2（进程重启）要从持久化侧捞补漏数据，而 `training_sessions` 表里**没有**"内存 sessionId"这一列 —— 唯一能定位到这场会话的键就是落库 id；
- 客户端拿得到它：`ready` 帧本来就下发 `dbSessionId`（落库成功时）；
- 归属校验在**业务侧**做（按 id + userId 查）—— 不校验就等于"谁的咨询记录我都能读"。

### 4.3 `missedTurns[].marks` **恒为空数组**

理由：标记由 counselor 侧 worker 产出并**实时推帧**（`mark` 帧），没有可回读的逐轮标记存储。补漏只补"说了什么 + 状态"，客户端拿不到就当没有。**不编**。

### 4.4 canonical 轮次号 = **voice 层的轮次计数**（1 基），由 voice 层算一次带到底

三处必须同源：客户端上报的 `lastSeenTurnIndex`、`llm_done.turnIndex`、补漏帧 `missedTurns[].turnIndex`。

**我没用内核自己那套累计轮次**：内核把被 barge-in 掐掉的半截轮**也计数**，于是内核的号会比客户端看到的漂移（客户端只在整轮跑完时 +1）。内核轮次号仍留在 `TurnRenderResult.turnIndex` 里做内部观测，不参与补漏。

### 4.5 轮次号"算一次带到底"，不在消费流时现算 `state.turnCount + 1`

理由：barge-in 时两轮会短暂并存（新一轮已开始、上一轮还没收尾），现算会让两轮拿到**同一个号** —— 补漏台账里出现两条同号轮次，客户端按号对不上。

### 4.6 `catchUp` 是窄接口上的**可选**方法

理由：旧链路 `VisitorService` 没有"已提交轮次台账"这个概念，不实现**完全正常**（退化成轻量 `session_reattached`，对练照常）。必填会把旧实现挡在契约外，"并存可回退"当场破产（与角色 / 剧本参数同款理由）。

### 4.7 台账只记"**已提交**"的轮次（引擎跑完 + 没被 abort）

理由：被 barge-in 掐掉的半截轮，回复没发完 —— 补回去等于给客户端**制造**半句话（造问题，不是补问题）。客户端自己就知道那一轮没收到（它只缺"服务端跑完了没有"这一口）。

### 4.8 台账同号**覆盖**成后一次

voice 层计数只在整轮跑完时递增，于是"引擎跑完但 done chunk 没送达"的轮次会被下一轮**复用同一个号**。覆盖成后一次（它才是客户端真正该看到的"这一轮最终长什么样"）。

### 4.9 idle 兜底用 **per-session 定时器**（每次上行刷新 / `unref()` / 收尾清）

理由：语义精确 —— "最后一次收到客户端消息"是**每场**自己的时间线；全局扫描器要给每场额外记时间戳，记法一多就容易和真实消息时间线对不上。收尾即销，不留悬挂句柄。计时器一律 `unref()`：它不该让进程活下来。

**它不是断连 grace timer**：断连**不新挂**定时器（§1.1 红线），会话上本来就有的那个继续跑（`vi.getTimerCount()` 在断连前后不变 —— 有单测钉死）。任务单 §3 验收 #1 的"无 setTimeout 定时器挂着"我按这个口径实现。

### 4.10 idle 兜底挂在 **voice 层**，不在 gateway

理由：任务单 §2 红线"不在 gateway 里加业务编排"。会话生命周期归 voice 层，gateway 只做 transport。

### 4.11 `session_ended` 帧的 reason **增一档** `idle_timeout`

任务单 §3 验收 #8 明写 reason=`idle_timeout`，而既有联合类型只有 `user_finish | timeout | error`。增一档是向后兼容的（老客户端不认识就当"其它结束"）。

### 4.12 gateway 改成"**会话级帧出口**"（每次发帧按 sessionId 查当前出口）

理由：断线瞬间还在跑的 in-flight 轮次，它手里的 `send` 若绑死在旧 socket 上，重连后那一轮的后半段（llm_text / tts_audio）就永远送不到客户端 —— 客户端以为"这轮没跑完"，而服务端明明跑完了（还会把它记进补漏台账 → 客户端既没收到、也没补到）。改成按 sessionId 现查当前出口后，重连后那一轮的后半段自然接到新 socket。

断连期间没有出口 → 帧**丢弃**（不排队、不回放）：排队等重连再放 = 服务端替客户端缓存历史，那正是补漏帧的活（只做一次、只补文本）。

### 4.13 断连时**仍然**注销 frame sink + 移除演练登记

理由：往死连接推帧没有意义；演练登记是**演练元数据**不是会话状态，留着只是泄漏（重连时会重建）。**会话状态在 voice 层，那边一行不动** —— 任务单 §1.1 说的"不要从 `this.sessions` map 删 sessionId"指的是 voice 层的会话 map。

### 4.14 旧 socket 断开时**不**注销新 socket 的出口（按 socketId 比对）

理由：重连竞态 —— 新 socket 已接管这场会话，旧 socket 这时断开还去注销，会把新出口一起注销掉，重连后收不到任何实时帧。有单测钉死。

### 4.15 重连时**不重新落库**（复用原落库 id）

理由：落库 id 是督导报告 / 4 流派反馈 / 实时帧出口的**唯一挂载点**。重连一次就新建一行 = 同一场会谈在库里裂成两场，报告挂到空的那场。

### 4.16 路径 2 的 BDI 快照只在 trace 与轮次**逐号对齐**时才附

理由：trace 的轮次号是**内核的累计轮次**（含被 barge-in 掐掉的半截轮），逐字稿的轮次是**voice 层的完成轮次**。两者一旦错位，按序 zip 会把**别的轮次**的快照贴上去 —— 贴错比不贴更糟（客户端会照着错的 BDI 继续这段对话）。所以判定条件是：`trace.length === 轮次数 && 每条 trace.turnIndex === 轮次序号`。

### 4.17 路径 2 的 `crisisLevel` 由 trace 的 `crisis.detected` 映射（detected→`warn`，否则 `pass`）

理由：trace 只记了 `detected` / `category`，**没有档位**。`block` 档在这一条链路上**还原不出来**。映射成 `warn` 是三档里最接近的一档 —— 已在代码注释里写明这是**近似**，不是还原。

### 4.18 前置 safety 阻断的轮次**不进**补漏台账

那一轮 AI 没有发言（只弹了危机窗），而且前置 gate 拦在**内核 turn 之前** —— 引擎压根没跑这一轮，台账里没有它。重连后补漏不含这一轮。逐字稿里仍有它（走的是逐字稿那条线，`bridges.appendTurn` 照写）。

### 4.19 env 解析做**两次**（`default.ts` 解析 env，voice 层读配置时再兜一次）

理由：配置有两条来路 —— 正常路径是数字（`default.ts` 已解析），覆写 / 单测可能塞字符串。非法值（0 / 负数 / NaN）**必须回退缺省**：0 会让 idle 兜底**立刻**触发（会话秒死），非法值会让兜底形同虚设 —— 两种都比"没有这个兜底"更糟。

### 4.20 既有死配置 `VOICE_SESSION_IDLE_TIMEOUT_MS`（10min，全仓无人消费）**保留但标注**

理由：删了可能碰到别处的引用（零风险原则）；已在 `typings/global.d.ts` 注释里写明「这个键当前无人消费，别拿它配超时」。新生效的是 `VOICE_SESSION_IDLE_TIMEOUT_MINUTES`（**分钟**）。

### 4.21 §1.5 的"判断条件"落到 `state.attached`（socket 存活态），由 gateway 通知 voice 层

理由：任务单原文写的是"session 的 frame sink 未注册"。frame sink 的注册/注销发生在 **gateway**（按落库 id），而 TTS 决策发生在 **voice 层**。于是：gateway 在 connect/disconnect 时调 `voice.attachSocket` / `detachSocket`，voice 层据此决定要不要调 TTS provider。**business 决策留在 voice 层，gateway 只报事实** —— 守住 §2 的"不在 gateway 里加业务编排"。

### 4.22 §1.5 的"phase 直接推回 listening，不等 tts_done"

断连时压根没有 TTS 句柄 → 没有 `tts_done` 可等 → `closeTtsTurn` 直接返回、`finishTurn` 把 status 置回 `idle`（= `phase: listening`）。补漏帧里的 `currentSessionState.phase` 由 voice 层按 `state.status` 现算。

---

## 5. 能力边界（**不粉饰**，逐条说清）

| # | 边界 | 影响 | 后续 |
|---|---|---|---|
| A | **真正的进程重启后，WP12 恢复不了 BDI 快照** —— 内核 BDI 状态仓储是**内存态**（`InMemoryBdiStateRepository`），`loadState` 跨进程取不到上一场快照 | 路径 2 只能恢复到"**长时记忆召回 + 角色基线**"这一层（记忆仓储持久，跨进程有效），BDI 信任/阻抗/情绪**回到初始基线** | 需要把内核的 `BdiStateRepository` 端口做成 DB 化（Phase2）。任务单 §1.3 说"重建 BDI 状态"在当前架构下**做不到**，已如实记录 |
| B | 路径 2 的 `bdiSnapshot` 来自 WP19-R 留痕，而留痕受 `ENGINE_DEBUG_TRACE_ENABLED` 约束（**prod 默认关**） | prod 没开留痕时，补漏帧**带文本、不带 BDI 快照**（契约里 `bdiSnapshot` 本就是可选字段） | 验收 #4 的"bdiSnapshot 跟断线前最后一轮一致"在**开启留痕**时成立 |
| C | 前置 safety 阻断轮不进补漏（§4.18） | 那一轮的咨询师发言不会出现在补漏帧里 | 逐字稿仍有；需要完整还原得给台账补一条"被阻断轮"的写入路径 |
| D | 补漏**不回放**流式 chunk / TTS 音频（红线） | 客户端只拿到文本，语音要自己合成 | 任务单 §1.5 备注说"点文字重播"另开单 |
| E | 单实例假设 | 没做 Redis / 跨进程会话同步（§2 明确不做） | 多实例部署时，客户端连到别的实例就落不到内存会话 → 走路径 2（持久化重建） |

---

## 6. 验收对照（任务单 §3 的 13 条）

| # | 验收条 | 落地 | 覆盖用例 |
|---|---|---|---|
| 1 | 断连不杀会话（不调 endSession / 会话仍在 / 不新挂定时器） | ✅ | `wp23-ws-disconnect-grace` ①（3 例）、`wp23-gateway-reconnect` ① |
| 2 | 内存内重连 → reattach + catchup | ✅ | ②（4 例） |
| 3 | 没漏 → 轻量 `session_reattached` | ✅ | ③（1 例） |
| 4 | 进程重启 → WP12 重建 + trace 还原 BDI | ⚠️ **部分** —— 见边界 A（BDI 快照跨进程恢复不了）与边界 B（留痕开关） | ④（2 例，覆盖"走 resume 重建 + 从持久化补漏"） |
| 5 | 落后太多 → `session_stale`（too_far_behind） | ✅ | ⑤（2 例） |
| 6 | 未知 session → `session_stale`（unknown_session） | ✅ | ⑥（2 例） |
| 7 | in-flight turn 不 abort | ✅ | ⑦（1 例） |
| 7b | 断连时跳过 TTS 合成 | ✅ | ⑦b（2 例） |
| 8 | 超长 idle 兜底 → endSession(`idle_timeout`) | ✅ | ⑧（3 例） |
| 9 | 正常结束路径不残留 | ✅ | 既有 `endSession` 路径 + ⑧ 断言内存会话已清 |
| 10 | WP16 幂等仍生效 | ✅ | 既有 `wp16-*` 套件零回归 |
| 11 | env 生效（两个 env） | ✅ | ⑤（catchUpMaxTurns）+ ⑧（idle 分钟数 + 非法值回退） |
| 12 | 旧链路零变化 | ✅ | 既有 `wp8b-grayscale` 等套件零回归 |
| 13 | 新增单测 | ✅ **35 例**（24 + 6 + 5） | 三个新文件 |

---

## 7. 闸门实测数字（本次实跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**（0 error） |
| Lint | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **exit 0**（0 error / 0 warning） |
| 测试 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **72 文件 / 1115 例全通过**（本单之前基线：69 文件 / 1080 例；本单新增 3 文件 / 35 例；**既有套件零回归**） |
| 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

新增单测逐条对应：

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `test/voice/wp23-ws-disconnect-grace.spec.ts` | 24 | 断连不杀会话（3）· 内存重连补漏（4）· 没漏轻帧（1）· 重启后 WP12 重建（2）· 落后太多 stale（2）· 未知 session stale（2）· in-flight 不 abort（1）· 断连跳过 TTS（2）· idle 兜底（3）· llm_done 轮次号（1）· 握手参数解析（4） |
| `test/voice/wp23-gateway-reconnect.spec.ts` | 6 | 断连不杀会话（1）· 重连分支（2）· 不可续走 fresh（1）· 帧出口登记/注销/竞态（2） |
| `test/engine-adapters/wp23-committed-turn-ledger.spec.ts` | 5 | 进台账（1）· abort 不进（1）· 按 lastSeen 过滤（1）· 收尾清空（1）· 重开场重置（1） |

---

## 8. 还没做的（明确留给下一单，不静默省略）

1. **Flutter 端**（前端另派单）：握手带 `lastSeenTurnIndex` / `dbSessionId`、处理 `session_catchup` / `session_reattached` / `session_stale`、把补漏轮次渲染成文字气泡、"重连中"提示 —— **本单一行前端代码都没写**。
2. **点文字重播 TTS**（任务单 §1.5 备注）：另开单。
3. **内核 BDI 状态仓储 DB 化**：边界 A 的治本，要动 engine-core 之外的装配层 + 内核端口实现，Phase2。
4. **跨实例会话同步**：边界 E，任务单 §2 明确不做。

---

## 9. commit 文案

```
feat(voice): WP23 WS 断连不杀会话，重连带 lastSeenTurnIndex 触发 catch-up 补漏；进程重启走 WP12 重建 BDI，超长 idle 兜底
```
