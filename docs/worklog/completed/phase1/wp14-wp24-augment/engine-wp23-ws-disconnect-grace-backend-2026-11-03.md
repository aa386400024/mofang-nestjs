# WP23 · WS 断连重连追平（无定时器、无硬切、重连即补漏）

> 日期：2026-11-03 ｜ 仓库：`E:\Work\Project\backend\mofang-nestjs`
> 性质：Phase1 M3 内测前护栏——对标微信/Slack/Discord 的断线追平范式，不做"30s 宽限期 then 判死"这种游戏式妥协
> 状态：✅ **已交付并复跑绿**（2026-11-03，**未 commit**，改动全在工作区）→ 交付记录: `engine-wp23-ws-disconnect-grace-backend-implementation-2026-11-03.md`（同目录）
> 口径修正（2026-11-03）：原描述"断连超 30s=会话结束"是游戏式妥协，已放弃。改为对话式追平（对标微信/Slack/Discord）：断线不杀会话、不挂定时器；重连握手带 `lastSeenTurnIndex=N`，服务端把 N 之后所有 committed turn 塞进 `session_catchup` 帧推回；进程重启过走 WP12 resumeFromSessionId 重建 BDI；断连状态下跳过 TTS 合成（不烧音频钱）；2 小时 idle 兜底。
> ⚠️ **两条已知边界**（交付记录 §5 有详述）：① 内核 BDI 状态仓储是**内存态**，真正的进程重启后恢复不了 BDI 快照（只能恢复长时记忆召回 + 角色基线），治本要内核 `BdiStateRepository` DB 化（Phase2）；② 路径 2 的 BDI 快照靠 WP19-R 留痕还原，而留痕在 prod 默认关（`ENGINE_DEBUG_TRACE_ENABLED`），关着则补漏帧带文本、不带 BDI 快照。
> ⚠️ **前端仍待接**（另派单）：握手带 `lastSeenTurnIndex` / `dbSessionId`、处理 `session_catchup` / `session_reattached` / `session_stale`、把补漏轮次渲染成文字气泡、"重连中"提示 —— 本单只做后端，一行前端代码没写。
> 🔴 **本单不改 `src/engine-core/**`**：会话生命周期、catch-up 回放、重连恢复全在 `src/voice/` 与 `src/engine-adapters/wiring/` 加；内核纯层零改动。
> 🔗 前置：WP16（round_id 幂等）✅、WP18（逐字稿落库）✅、WP19-R（每轮 BDI 快照入 trace）✅、WP12（resumeFromSessionId 从持久化快照恢复 BDI）✅——本单**复用**这些已有资产，不重写。

---

## 0. 为什么有这条（现状实锤 + 范式选择）

### 0.1 现状

`src/voice/voice.gateway.ts:480-490` 的 `handleDisconnect` 一断线就立刻：
```ts
this.voice.endSession(data.sessionId, 'user_finish');
this.sessions.remove(data.sessionId);
```

问题：
- 用户切后台、WiFi 闪断、电梯里 5 秒没信号 → WS 断 → 服务端立刻判死会话 → BDI/情绪/阻抗/信任全清。
- 用户网恢复时重连，握手是全新会话，来访像不认识他了，用户毫无感知地被"重置"。

### 0.2 范式选择（为什么不是 30s grace timer）

30s 宽限期是实时游戏范式（League/CS2）——因为游戏状态高频可变、没法每帧落库，只能挂几秒等玩家回来。**但心塑是对话/AI 产品，对标应该是微信/Slack/Discord 文本聊天、OpenAI Realtime**：

| 范式 | 服务端行为 | 断线用户体感 |
|---|---|---|
| 游戏式（A 方案，已放弃） | 断线挂 30s 定时器，超时判死 | 30s 内回来没事，31s 回来整场没了 |
| **对话式（本单 B 方案）** | 断线不 endSession、不挂定时器；重连时客户端报"我上次听到 turn=N"，服务端补 N 之后所有 committed turn | 断线期间客户端转圈"重连中"，回来后漏掉的几句自动补上，**不弹窗、不结束、不归零** |

对话式的核心：**服务端不存在"会话被断连杀死"这个事件**。会话要么用户主动结束（`session_finish`），要么跑了很久没人理（超长 idle 兜底）。断线只是 socket 层的事，业务会话继续活。

---

## 1. 范围

### 1.1 断线不杀会话（核心改动）

**改 `handleDisconnect`**：
- 注销 frame sink（往死连接写帧无意义）——**保持现状**。
- ❌ **不要**立刻 `endSession`。
- ❌ **不要**从 `this.sessions` map 删 sessionId。
- ❌ **不要**挂 setTimeout 定时器判死。
- ✅ 会话对象留在内存里，in-flight 的 LLM 渲染/TTS 让它自然跑完（状态由 WP16 在 promise 链上落定，不 abort）。

**唯一会 endSession 的场景**：
1. 客户端主动发 `session_finish`（现有路径，不动）。
2. **超长 idle 兜底**：会话从最后一次收到客户端消息算起，超过 `VOICE_SESSION_IDLE_TIMEOUT_MINUTES`（默认 120 分钟）没收到任何上行 → 服务端主动 endSession。这是内存卫生兜底，不是用户感知到的 cliff。

### 1.2 重连握手：客户端报 lastSeenTurnIndex

**握手 query 新增一个参数**（不改现有 query 形状，只加可选字段）：

```
?sessionId=<客户端本地sessionId>
&token=<jwt>
&resumeFromSessionId=<可选, WP12 隔天继续>
&lastSeenTurnIndex=<可选, int, 客户端上一次确认收到的最后一轮 turn 序号>
```

- `lastSeenTurnIndex` 缺省 = 客户端不知道自己听到哪了（全新会话场景）→ 服务端走 fresh openSession。
- 客户端重连时带上它 = "我上次听到第 N 轮，N 之后的我都漏了，帮我补"。

### 1.3 重连时服务端的两条路径

**路径 1：内存里还有这个 session（进程没重启）**
- 握手带 `sessionId` + `lastSeenTurnIndex=N`。
- 查 `this.sessions`：命中 → **取消任何残留的清理逻辑**，把新 socket 绑回已存在的 in-memory 会话，重新注册 frame sink。
- 从 WP18 逐字稿 / WP16 幂等表 / WP19-R trace 里，捞回 `turnIndex > N` 的所有 committed turn，组装成一个 catch-up 帧推给客户端（见 §1.4）。
- **不重新 openSession、不重新初始化角色基线、不重新跑 BDI**——会话对象还活着，BDI 状态就在内存里。

**路径 2：内存里没这个 session（进程重启了）**
- 握手带 `sessionId` + `lastSeenTurnIndex=N`。
- 查 `this.sessions`：没命中。
- **复用 WP12 `resumeFromSessionId` 机制**：用这个 `sessionId` 作为 resumeFromSessionId，从持久化快照 + WP19-R trace 里重建 BDI 状态 + 记忆 + 角色基线。
  - WP12 本来是"用户隔天点继续训练"的手动入口；本单让它在重连时自动触发一次。
  - 重建完成后，同样推 catch-up 帧（turnIndex > N 的 committed turns）。
- 如果 WP12 重建失败（sessionId 根本不存在 / 快照丢了）→ 走 fresh openSession，客户端从头开始（这是异常路径，推一个 `{type: 'session_stale'}` 帧让客户端知道不能继续了）。

### 1.4 catch-up 帧契约

重连成功后，服务端推一个（不是流式多帧）：

```json
{
  "type": "session_catchup",
  "serverLatestTurnIndex": 17,
  "missedTurns": [
    {
      "turnIndex": 12,
      "userText": "我最近总是睡不着",
      "replyText": "听起来你最近压力很大，是因为工作上的事吗？",
      "bdiSnapshot": { "trust": 0.62, "valence": -0.31, "arousal": 0.45, "resist": { "cognitive": 0.2 }, "transference": {} },
      "marks": [],
      "crisisLevel": "pass"
    },
    {
      "turnIndex": 13,
      "userText": "嗯，是被领导骂了",
      "replyText": "被当众批评确实难受，你当时什么感受？",
      "bdiSnapshot": { "trust": 0.58, ... },
      "marks": [],
      "crisisLevel": "pass"
    }
  ],
  "currentSessionState": {
    "phase": "listening",
    "riskLevel": "normal",
    "monitored": false,
    "characterCode": "wanqing"
  }
}
```

要点：
- `missedTurns` 只包含 `turnIndex > lastSeenTurnIndex` 的 committed turn。
- **不推流式 chunk**（llm_text delta / tts_audio 二进制）——客户端拿到 `replyText` 自己渲染就行，TTS 重合成是客户端自己的事（漏了就漏了，不重新烧 TTS 配额）。
- 如果 `missedTurns` 为空（客户端其实没漏，只是 socket 抖了一下），就推一个 `{type: 'session_reattached', serverLatestTurnIndex: N}` 轻帧，客户端知道"连上了，没漏东西"。
- 如果 `missedTurns.length > VOICE_CATCHUP_MAX_TURNS`（默认 20）→ **不要全量补**，推 `{type: 'session_stale', reason: 'too_far_behind', serverLatestTurnIndex: N}`，让客户端自己决定从头开始（避免一个断线半小时的用户重连时一次性塞 200 条历史）。

### 1.5 断连状态下跳过 TTS 合成（别白烧 MiniMax TTS 钱）

断连后 frame sink 已注销，服务端如果还按正常流程调 TTS provider，就是花钱合成一段永远没人听的音频。规则：

- **判断条件**：本轮开始渲染时，session 的 frame sink 未注册（即客户端 socket 已断开）→ **只跑 LLM 渲染、commit 文本、更新 BDI 快照，不调 TTS provider、不生成任何音频帧**。
- **LLM 不 abort**：in-flight 的 LLM 流式生成让它自然跑完（WP16 在 promise 链上落定结果），只是渲染完不调 TTS。
- **会话状态机照常推进**：LLM 完成后直接把 phase 推回 `listening`，不等 TTS 完成事件（没有 TTS 就不会有 tts_done，别卡在 speaking）。
- **重连后 catch-up**：漏的 turn 在 `missedTurns[]` 里只带 `replyText`，不带音频。客户端展示成文字气泡即可，不补 TTS。
- **重连成功后的下一轮**：frame sink 重新注册，正常走 LLM → TTS → 流式音频全链路，用户立刻恢复语音沉浸。

> 后期若要"点文字重播来访那句音频"，另开单：客户端发 `{type: 'replay_tts', turnIndex: N}`，服务端对那一句重新合成 TTS 流式推回。**本单不做。**

### 1.6 in-flight turn 的处理

断线时某一轮 LLM 正在流式渲染：
- 服务端**不要 abort**。让它跑完，WP16 的幂等表会正常落定结果。
- 客户端重连时，这轮如果已经 committed，自然出现在 `missedTurns` 里。
- 如果还在跑，客户端的 `lastSeenTurnIndex` 就是它最后一次确认的；等这轮 committed，下一轮会自动带上。
- 客户端不需要知道"服务端现在正在跑哪一轮"——它只要拿到 committed 的最终结果。

### 1.7 env 配置（就两个，别堆）

| env | 默认 | 说明 |
|---|---|---|
| `VOICE_SESSION_IDLE_TIMEOUT_MINUTES` | `120` | 会话最后一次收到客户端消息后，多久没动静就主动 endSession（内存卫生兜底，不是用户 cliff）。env 缺失/非法 → 回退 120 |
| `VOICE_CATCHUP_MAX_TURNS` | `20` | 重连时最多补多少轮；超过就推 session_stale，不塞历史 |

写入 `.env.example`。

### 1.8 日志口径

- 断连：`[onDisconnect] session=xxx socket dropped, session kept in memory`（info）。
- 重连成功（内存命中）：`[onConnect] reattached session=xxx, catchup turns=3`（info）。
- 重连成功（重启恢复）：`[onConnect] session=xxx not in memory, reconstructing via WP12 resume`（info）。
- 超长 idle 兜底：`[idleTimeout] session=xxx idle >120min, ending as idle_timeout`（warn）。
- 落后太多：`[onConnect] session=xxx too far behind (missed=57), sending session_stale`（warn）。

---

## 2. 不做（红线）

| 不做 | 理由 |
|---|---|
| 不改 `src/engine-core/**` | 内核纯层零改动；`git diff --stat HEAD -- src/engine-core` 必须为空 |
| 不挂 30s grace timer | 那是游戏式妥协，本单明确放弃 |
| 不在断线时立刻 endSession | 会话业务生命周期跟 socket 生命周期解耦 |
| 不回放流式 chunk / TTS 音频 | 只补最终文本，TTS 客户端自己重合成（不烧额外 TTS 配额）——且断连状态下服务端压根不调 TTS，见 §1.5 |
| 不做 Redis / 跨进程会话同步 | Phase1 单实例；进程重启走 WP12 从持久化快照恢复，够用 |
| 不改 WP16 幂等表行为 | 重连时客户端重发同 roundId 还是走幂等，不重跑 BDI |
| 不改 WP12 `resumeFromSessionId` 契约 | 它是手动隔天入口；本单只是把它接到重连路径上做自动重建，不改它的语义 |
| 不做"断线后客户端自动弹窗提示" | 弹"重连中"/"网络丢失"是 Flutter 端的事（前端另派单）；服务端只负责不丢状态、重连时补漏 |
| 不做 catch-up 流式化 | catch-up 是一帧快照，不是流式；漏的 turn 一次性给 |
| 不动旧 `src/agent/visitor` 直出链路 | 灰度开关保留；本单只影响 `ENGINE_VOICE_ENABLED=true` 的新引擎路径 |
| 不在 gateway 里加业务编排 | 遵守现有 gateway transport-only 原则；会话重建/catchup 组装放 `VoiceService` 或专门的 catch-up 服务 |

---

## 3. 验收

| # | 验收条 | 通过标准 |
|---|---|---|
| 1 | 断连不杀会话 | 模拟 `handleDisconnect` → 断言 `voice.endSession` **未被调用**；`this.sessions.has(sessionId)` 仍为 true；无 setTimeout 定时器挂着 |
| 2 | 内存内重连 → reattach + catchup | 断连后 5s 重连带同 `sessionId` + `lastSeenTurnIndex=10` → 新 socket 绑回原会话；收到 `session_catchup` 帧，`missedTurns` 包含 turn 11/12；BDI 状态没重置 |
| 3 | 客户端没漏 → 轻量 reattached 帧 | 断连后立刻重连（`lastSeenTurnIndex` 等于服务端最新）→ 收到 `session_reattached`，`missedTurns` 为空 |
| 4 | 进程重启后重连 → WP12 重建 | 模拟进程重启（清掉内存 map），客户端重连带 `sessionId` + `lastSeenTurnIndex` → 服务端走 WP12 resumeFromSessionId 重建 BDI；catch-up 帧里的 `bdiSnapshot` 跟断线前最后一轮一致（从 trace 还原） |
| 5 | 落后太多 → session_stale | 客户端 `lastSeenTurnIndex=0`，服务端已有 30 个 committed turn → 不塞 30 条，推 `session_stale` reason=`too_far_behind` |
| 6 | 进程重启但 sessionId 不存在 | 客户端重连带一个根本不存在的 sessionId → 推 `session_stale` reason=`unknown_session`，客户端走 fresh openSession |
| 7 | in-flight turn 不 abort | 断连时一轮 LLM 正在跑 → 渲染自然完成；客户端重连时这轮已 committed，出现在 `missedTurns` 里 |
| 7b | 断连时跳过 TTS 合成 | 断连状态下新触发的轮次：LLM 跑完 commit 文本，但**不调 TTS provider**（mock TTS 服务零调用）；phase 直接推回 listening，不等 tts_done；重连后 catch-up 里这轮只有 replyText 无音频帧 |
| 8 | 超长 idle 兜底 | 会话 120 分钟无上行（测试里用短超时）→ 服务端主动 endSession，reason=`idle_timeout`；内存 map 清掉 |
| 9 | 正常结束路径不残留 | 客户端发 `session_finish` → endSession 正常；后续即使客户端重连带同 sessionId，也找不到内存会话（已正常结束） |
| 10 | WP16 幂等仍生效 | 重连后客户端按 WP16 重发同 roundId → 服务端走幂等表返回已落定结果，不重跑 BDI |
| 11 | env 生效 | `VOICE_SESSION_IDLE_TIMEOUT_MINUTES=5` → 5 分钟 idle 触发兜底；`VOICE_CATCHUP_MAX_TURNS=5` → 漏 6 条就推 session_stale |
| 12 | 旧链路零变化 | `ENGINE_VOICE_ENABLED=false` 时断连行为与本单前一致 |
| 13 | 新增单测 | 覆盖：断连不杀会话 / 内存重连 catchup / 无漏轻帧 / 重启后 WP12 重建 / 落后太多 stale / 未知 session stale / in-flight 不 abort / idle 兜底 / env 解析 |

**复跑闸门**（交付时贴实测数字）：
- `npx eslint "src/**/*.ts"` → 0 error
- `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- 新增测试套件全绿，voice + engine-adapters 既有套件零回归
- `git diff --stat HEAD -- src/engine-core` → 空

---

## 4. commit 文案

```
feat(voice): WP23 WS 断连不杀会话，重连带 lastSeenTurnIndex 触发 catch-up 补漏；进程重启走 WP12 重建 BDI，超长 idle 兜底
```

---

## 5. 一句话给后端

> 现在客户端一断线服务端立刻 endSession + 清 BDI，用户网抖一下就整场报废还毫无感知。改成：断线不 endSession、不挂定时器，会话留在内存里；客户端重连时在握手 query 带 `lastSeenTurnIndex=N`，服务端把 turnIndex > N 的所有 committed turn（用户说了什么、来访回了什么、BDI 快照、marks、危机等级）一次性塞进 `session_catchup` 帧推回来。内存里没这个 session（进程重启过）就走 WP12 resumeFromSessionId 那条路从持久化快照重建，重建完照样推 catch-up。漏 20 轮以上不补，推 `session_stale` 让客户端自己重开。内存卫生靠 2 小时 idle 兜底（env 可调），不是 30s cliff。别碰 engine-core，别回放流式 chunk 和 TTS 音频（漏的就漏了，客户端拿文本自己渲染），WP16 幂等该怎么用怎么用。
