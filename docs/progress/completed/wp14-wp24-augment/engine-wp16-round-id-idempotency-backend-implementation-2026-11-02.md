# WP16 · round_id 幂等 + 断流不重复叠加（后端交付记录）

> 日期: 2026-11-02 ｜ 任务单: `engine-wp16-round-id-idempotency-backend-2026-11-02.md`
> 归属: Phase1 稳健性 / 内测前硬需求
> 状态: **代码已交付并复跑绿（未 commit）**
> 红线: `src/engine-core/**` 一行不动 —— 实测 `git diff --stat HEAD -- src/engine-core` 为空

---

## 1. 一句话

给 turn 加**内存态幂等**，两道闸门都拦在 **turn 处理入口**：

1. **同一会话同一 `round_id`** → 直接复用已提交结果，不重复执行 BDI、不重复更新状态、不重复调 LLM；
2. **流式断流不叠加** → 本轮状态已提交但回复没发完时，重发同一 `round_id` 返回特殊错误码
   `turn_incomplete`，前端据此 **round_id + 1** 走新一轮（不重放旧轮）。

---

## 2. 改动面（7 个源文件 + 2 个测试文件）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/engine-adapters/wiring/turn-idempotency.service.ts`（**新**） | 幂等表本体：`Map<sessionId, Map<roundId, TurnEntry>>`；条目分「在跑 / 已落定」两态；`begin/lookup/clearSession` |
| 2 | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | turn 入口幂等闸门（`streamTurn`）；断流标不完整；重放路径（`replayStream`）；`openSession`/`closeSession` 清表；快照构造 |
| 3 | `src/engine-adapters/wiring/engine.providers.ts` | 工厂第 11 位传幂等表 |
| 4 | `src/engine-adapters/wiring/engine.module.ts` | 装配 `TurnIdempotencyService`（模块内单例） |
| 5 | `src/voice/voice-turn-backend.port.ts` | 窄接口加**可选**字段 `roundId`；导出 `TURN_INCOMPLETE_CODE` |
| 6 | `src/voice/voice.types.ts` | WS 协议 `user_text` 加**可选**字段 `roundId` |
| 7 | `src/voice/voice.service.ts` | 轮次号透传；`turn_incomplete` 不回落旧链路 + 不落逐字稿；`replayed` 不重复落逐字稿 |
| 8 | `src/agent/llm/llm.types.ts` | `LlmStreamChunk.done` 加**可选**字段 `replayed`（只增可选，老链路恒不设） |
| 9 | `test/engine-adapters/wp16-round-id-idempotency.spec.ts`（**新**） | **13 例**（引擎侧闸门） |
| 10 | `test/voice/wp16-turn-incomplete.spec.ts`（**新**） | **6 例**（voice 层接线） |

**没动**：`src/engine-core/**`、TTS / ASR / 帧协议格式、旧链路的 `VisitorService`、Flutter 端、`admin-dashboard/`。

---

## 3. 流程

```
WS: user_text { text, roundId? }
  → VoiceService.onUserText(…, roundId)
      → buildTurnOptions(…, roundId)            ← 原样透传 (窄接口可选字段)
      → EngineStreamBackend.streamTurn(opts)
          ├─ roundId 缺省 / 非法 → 正常跑 (零回归, 老客户端不受影响)
          ├─ 表里没有这一轮      → 同步登记「在跑」→ buildStream(…, settle)
          │                        └─ 引擎这一轮落定 → settle(快照)
          │                             └─ complete = 没abort && 没中途降级 && 没抛错
          ├─ 表里「已落定」      → replayStream(快照)
          │                        ├─ complete=true  → content(正文) + done(replayed=true)
          │                        └─ complete=false → error(turn_incomplete)
          └─ 表里「还在跑」      → 等它落定 → replayStream(快照)（并发重发不重跑 BDI）
  → VoiceService.consumeLlmStream
      ├─ error(code=turn_incomplete) → 发 error 帧, cancel TTS, outcome='turn_incomplete'
      │                                **不回落旧链路**, **不落逐字稿**
      └─ done(replayed=true)         → outcome='replayed' → **不重复落逐字稿**
```

---

## 4. 与任务单的偏差（10 条，都有理由）

### 4.1 幂等表**不存 BDI 快照本体**

任务单 §2.1.1 写「结果快照（**BDI 新状态** + 回复文本 + trace 快照）」。

**只存「这一轮产出过什么」，不存 BDI 状态**。原因：

- 状态在**内核里已经落定了**（内核 turn 是「先落状态、再渲染」：`InMemoryEngineSession.turn`
  第 5 步 `bdiStates.save(record)` 在渲染之前）。再存一份就是**第二份真相** ——
  两份状态迟早对不上，而对不上的时候没人知道该信谁。
- 幂等要解决的是「**别再跑一遍 BDI**」，不是「恢复 BDI 状态」。既然不重跑，就不需要恢复。
- trace 快照同理：留痕（WP19-R）由适配器在**第一次**那一轮写，重放不重复写。

### 4.2 表里额外记了「**在跑**」状态（任务单只说「跑完写入 Map」）

任务单 §2.1.2 只写了「成功提交后写入 Map」。但**客户端超时重发**时，服务端那一轮**多半还在跑** ——
若表里只有「跑完」，并发重发会看到「没有这一轮」，于是**各跑一遍 BDI**，
恰好是本单要消灭的那件事（本单验收 #1 写的正是「BDI 不重跑」）。

所以每轮先登记 `pending`（带一个 deferred promise），跑完落成 `done`；
并发重发 `await` 那个 promise，落定后复用**同一个**结果。已用单测钉死（引擎只被调一次）。

### 4.3 闸门放在 `streamTurn` 入口（不是任务单写的 `turn()`）

仓库里没有 `turn()` 可改 —— `EngineStreamBackend` 实现的是窄接口 `streamTurn`，
而「断流」这件事**只发生在流式路径**上（聚合 `turn()` 没有半句话的中间态）。
闸门必须拦在**流被交出去之前**，否则重放已经晚了。

### 4.4 `complete`（完整 / 不完整）的判定口径 —— 任务单只说「回复没发完的标记为不完整」

落成**三条，缺一不可**：

| 条 | 为什么 |
|---|---|
| 没被 abort | 被 barge-in / 客户端取消打断的轮次，客户端多半没拿到全话 |
| 没中途降级 | 渲染器锁定候选后中途崩 → 降级成兜底句，而**已说出去的半句收不回来**：兜底句替代不了那半句 |
| 引擎没抛错 | 内核错误（ABORTED / SESSION_NOT_FOUND…）本轮压根没跑完 |

**且「降级但一个字都没产出」算完整** —— 那种情况下兜底句是**完整**发出去的
（适配器会把兜底句当 content 吐给前端），客户端拿到的是一句完整的话。
把它判成不完整 → 客户端换号重发 → **同一句话把 BDI 再推一遍**，那才是漂移。

### 4.5 快照落定写在 **promise 链**上，不写在生成器函数体尾部

消费方随时可能**放弃**这条流（barge-in 时 voice 层直接不再拉了）——
那样生成器尾部**根本不会执行**，快照就永远写不进去，
而「这一轮跑过、留下了什么」是**已经发生的事实**，与消费方还在不在读无关。
写在 `turnStream(...).then/.catch` 上，无论消费方走不走，快照都落得下来。

### 4.6 `round_id` 必须由**客户端**带 —— 仓里原本根本没有这个字段

任务单 §2.2 反复说「前端带的还是同一个 round_id」，但**本仓的 WS 协议里压根没有 round_id**
（`user_text` 只有 `text` / `generation`）。所以本单顺带把契约定出来：

- WS 协议 `user_text` 加**可选** `roundId?: number`；
- 窄接口 `VoiceTurnBackendTurnOptions` 加**可选** `roundId?: number`；
- **缺省 = 不走幂等**，行为与 WP16 之前逐字一致（老客户端零影响）。

只认**正整数**：0 / 负数 / 小数 / NaN 一律当「没给」。
不「猜」（比如把字符串 `'3'` 转成 3）—— 猜出来的键可能与另一轮撞上，那比没幂等更糟。

### 4.7 `turn_incomplete` **不回落旧链路**（任务单没写，但必须做）

voice 层既有纪律是「引擎首个增量前失败 → 透明切回旧链路」。但 `turn_incomplete` **不是引擎故障**，
是协议信号。回落会让**同一句话在两条链路上各跑一遍**（引擎侧状态已提交，旧链路侧又跑一次）
—— 正是本单要消灭的漂移。故在 `guardEngineStream` 与 `consumeLlmStream` 两处都单独放过它。

### 4.8 重放**不重复落逐字稿**（任务单没写，但不做就是数据 bug）

第一次那一轮已经把「问 + 答」落进逐字稿了；重放再落一次 = 报告里同一轮出现两条。
做法：`LlmStreamChunk.done` 加**可选** `replayed?: boolean`（老链路恒不设 → 零破坏），
voice 层据此把该轮判成 `outcome='replayed'` → 不落逐字稿、不动轮次计数。

同理，重放路径**完全不走** `buildStream` 的收尾段 —— 不写逐字稿 / 不写留痕 / 不累加用量 /
不推危机帧（那些副作用第一次那一轮已经做过了，重做一遍就是「同一轮记两次账」）。

### 4.9 `openSession` 也清表（任务单只说 `closeSession` 清）

重连走的是同一个 `openSession`，而它会**换内核句柄**（BDI 从头开始）。
留着上一场的轮次快照，会让新会话的同号重试拿到**旧状态**下的旧回复。
所以「重开 = 新会话 = 新状态」→ 一起清。与逐字稿、场次用量的重置口径一致。

### 4.10 构造参数放**第 11 位**且带默认值（既有 28 处调用点零改动）

工厂按**位置**装配；新依赖只能追加在尾部（中间插一位就得让既有调用点补 `undefined` 占位）。
默认值 `new TurnIdempotencyService()` 让仓里 28 处 `new EngineStreamBackend(...)` 的既有单测
**一行不改**也能跑（幂等是增强，不是会话的前置条件）；
生产路径由 `createEngineStreamBackend` 显式注入**模块内单例**（缺席 = 闸门形同虚设，必须注入）。

---

## 5. 验收 6 条 —— 逐条对照

| # | 验收点 | 结果 | 用例 |
|---|---|---|---|
| ① | 同 sessionId + 同 round_id 第二次请求 → 返回缓存结果，BDI 不重跑、LLM 不调 | ✅ | 「第二次请求直接回缓存结果, 引擎一次都没被多调」「重放不重复落逐字稿」「不同 round_id → 正常跑新一轮」 |
| ② | 流式中途 abort → 状态已提交但回复不完整（缓存 `complete=false`） | ✅ | 「abort 后缓存标记 complete=false」「引擎流抛错 → 同样标记不完整」「降级但一个字都没产出 → 算完整」 |
| ③ | 断流后重发同一 round_id → 返回 `turn_incomplete`，不重放旧轮 | ✅ | 「缓存 complete=false 时再调 → 回 turn_incomplete 错误码」「turn_incomplete 不可重试」 |
| ④ | 关闭会话后内存 Map 清理 | ✅ | 「closeSession 后该 sessionId 的 key 清空」「重开同一 sessionId → 上一场快照被清掉」 |
| ⑤ | `git diff --stat HEAD -- src/engine-core` 为空 | ✅ | 闸门实测（§6） |
| ⑥ | eslint 0 / tsc 0 / 全量测试绿 | ✅ | 闸门实测（§6） |

**另加 9 条边界**：
- **不带 round_id → 不走幂等**（两次同样请求各跑各的，行为与 WP16 之前逐字一致）；
- **非法轮次号（0 / 负数 / 小数）→ 当作没给**；
- **并发重发（上一轮还在跑）→ 等它落定后复用，引擎只被调一次**；
- **重放不带副作用**（逐字稿不落第二条、引擎不再被调、危机帧不推第二次）；
- **`turn_incomplete` 错误帧原样到前端**（voice 层帧序列实测）；
- **`turn_incomplete` 不回落旧链路**（旧链路的 `streamTurn` 一次都没被碰）；
- **`turn_incomplete` 不落逐字稿**（半句话进报告，每轮分析会在半句上做判定）；
- **重放不落逐字稿**（第一次那一轮已经落过了）；
- **正常轮照常落逐字稿**（零回归对照）。

---

## 6. 闸门实测（2026-11-02）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| 规范 | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **exit 0 · 0 error / 0 warning** |
| 新增套件 | `npx vitest run test/engine-adapters/wp16-round-id-idempotency.spec.ts test/voice/wp16-turn-incomplete.spec.ts` | **2 文件 / 19 例全通过** |
| 全量 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **69 文件 / 1080 例全通过**（本单之前：67 文件 / 1061 例，零回归） |
| 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

> 首轮 eslint 报了 7 个 error + 4 个 warning（prettier 换行 / import 顺序 / 多余的类型断言），
> `--fix` 修完复跑为 exit 0 —— 只重排 import 顺序与换行、去掉两个 `as never`，**没有改任何逻辑**。
>
> 注：仓库的测试框架是 **vitest**（任务单 §6 写的 `npx jest` 是旧写法，本仓没有 jest）。

---

## 7. 已知边界（诚实记录）

1. **单实例假设** —— 幂等表在**进程内存**里。进程重启后表清空（任务单 §2.1.4 已接受：
   Phase1 单实例，重启后旧 WS 连接本来也断了）。多实例部署时同一轮可能在两个实例各跑一遍 → Phase2。
2. **幂等表不落库** —— 断线重连若是**新进程**，同号重发仍会重跑 BDI（与 §1 同源）。
3. **同一个 `round_id` 配不同文本 → 仍按 `round_id` 复用** —— `round_id` 是权威幂等键，
   文本只留作诊断（快照里存了 `userText`，便于排查客户端是否误用了号）。
   客户端若复用号又换话，会拿到上一轮的话 —— 这是「号即键」的必然取舍，由端侧保证号不复用。
4. **拿到流却从不消费 → 那一条会一直挂在「在跑」** —— 生产路径里 voice 层必然消费流
   （`resolveTurnStream → guardEngineStream → consumeLlmStream`），理论边界，记录在案。
5. **任务单 §2.3 的「深度降级批量回溯」未实现** —— 按任务单 §5 明确放 Phase2。
   本单只把「降级轮算完整（`complete=true`）」这条口径钉死了（见 §4.4），
   避免降级轮被误判成不完整 → 客户端换号重发 → 同一句话把 BDI 再推一遍。
6. **任务单 §2.3 说的「降级轮不计考核（报告里标记 `degraded: true`）」未实现** ——
   那属于报告/考核域（WP18 报告链路），本单只做引擎侧幂等，未越界改报告。
7. **前端尚未适配** —— 本单交付的是**后端契约**（WS 加 `roundId`、新增 `turn_incomplete` 错误码）。
   Flutter 端适配属前端 AI 的活（本单不做前端改动）。

---

## 8. 联调口径（前端）

### 8.1 WS 请求：`user_text` 加可选 `roundId`

```json
{ "type": "user_text", "text": "最近睡得怎么样？", "roundId": 3 }
```

- `roundId` = 客户端自己维护的**单调递增**轮次号（同一场内不重复）；
- 缺省 / 非正整数 = 后端**不走幂等**（旧行为）；
- 收到 `turn_incomplete` 时，**`roundId + 1`** 重发新一轮（不要重发同一个号 —— 会再撞一次）。

### 8.2 WS 错误帧（沿用仓库既有嵌套格式）

```json
{ "type": "error", "error": { "code": "turn_incomplete", "message": "本轮回复未发完, 请换一个轮次号重发新一轮", "retryable": false } }
```

- `turn_incomplete` = 那一轮的状态**已经提交**、但回复**没发完**（断流 / LLM 超时 / 前端 abort）；
- `retryable: false` —— 重发**同一个** `roundId` 还会撞上这一条，必须换号。

### 8.3 重放的帧序列（同一 `roundId` 重发、上一轮完整时）

```
llm_start → llm_text(正文) → llm_done
```

与正常轮**逐帧一致**（正文是上一轮的原文）；端上若要避免重复渲染，可按 `roundId` 自己去重。

---

## 9. commit 文案

```
feat(wp16): turn 加内存态幂等, 同 round_id 重发不重跑 BDI, 断流重发回 turn_incomplete
```
