# WP14 优化项：block 时不发 llm_start —— 交付记录

> 日期：2026-11-02 ｜ 任务单：`docs/worklog/wp14-block-no-llm-start-optimization-2026-11-02.md`
> 前置：WP14 主单已交付（`docs/worklog/engine-wp14-student-risk-disposal-backend-implementation-2026-11-02.md`）
> 状态：**代码已交付并复跑绿（未 commit）**
> 红线：`src/engine-core/**` 一行不动 —— 实测 `git diff --stat HEAD -- src/engine-core` 为空

---

## 1. 一句话

阻断级危机现在**先弹 modal、不先转 loading 圈**：voice 层在发 `llm_start` 之前先问一次 safety，
判成 `block` 就直接发 `crisis_modal` + 写审计 + 置重点监测，**不调内核 turn / render**，
于是全程没有 `llm_start` / `llm_done` / `tts` 帧（"开始了但永远不会结束"的孤儿帧消失）。

---

## 2. 改动面（5 个文件 + 2 个测试文件）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/voice/voice-turn-backend.port.ts` | 窄接口加**可选**方法 `preCheckSafety?(input)` + 两个新类型 `VoiceSafetyPreCheckInput` / `VoiceSafetyPreCheckResult` |
| 2 | `src/voice/voice.service.ts` | `onUserText` 里在 `beginTtsTurn` **之前**插 `runPreCheckSafety`；新增私有方法 `runPreCheckSafety` |
| 3 | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | 实现 `preCheckSafety`；构造参数**末位**新增 `riskProbe`；`recordStudentRiskEvent` 签名从吃 `TurnRenderResult` 改成吃 `turnIndex: number` |
| 4 | `src/engine-adapters/wiring/engine.providers.ts` | `EngineStreamBackendDeps` 加 `riskProbe?`；`createEngineStreamBackend` 位置参数追加到**第 10 位** |
| 5 | `src/engine-adapters/wiring/engine.module.ts` | `EngineStreamBackend` 的 `useFactory` 注入 `RISK_PROBE`（与内核**同一个**探测器实例） |
| 6 | `src/engine-adapters/rendering/student-risk-disposal.ts` | `buildStudentRiskDecisionFromProbe(result, probeSource?)` —— 探测来源可显式传入（缺省仍是 `psyguard`，既有调用方行为不变） |
| 7 | `test/voice/wp14-pre-check-gate.spec.ts`（新） | voice 层帧序列 9 例（含端到端） |
| 8 | `test/engine-adapters/wp14-block-no-llm-start.spec.ts`（新） | adapter 层前置判定 10 例 |

**没动**：`src/engine-core/**`（红线）、`visitor_output` 侧处置、`PSYGUARD_LEVEL_MAP`、阈值、
内核 turn / render 的任何路径（**不重构流式路径**）。

---

## 3. 时序（改前 → 改后）

**改前**（block 轮）：

```
voice: llm_start ──► 内核 turn（内部判 safety → block） ──► 不调 render ──► crisis_modal
       ↑ 前端 loading 圈先转起来        ↑ 后端根本没渲染 → 没有 llm_done
```

**改后**（block 轮）：

```
voice: 前置 gate（probe）─► block ─► crisis_modal + 审计 + monitored
                            └─► 直接 return: 不起 TTS / 不调内核 turn / 不发 llm_done / tts_done
```

**改后**（warn / pass 轮）：与改前**逐帧一致**（`llm_start` → `llm_text`×N → `llm_done`）。

---

## 4. 任务单 §5 六条验收 —— 逐条对照

| # | 验收条 | 落地方式 | 用例 |
|---|---|---|---|
| ① | "我想死" → 先收 `crisis_modal`，全程无 `llm_start` / `llm_done` / tts 帧 | gate 排在 `beginTtsTurn` **之前**；block 直接 return | `voice` 套件「判 block → 只发 crisis_modal, 内核 turn 一次都没跑」+「voice 模式 → TTS 连接根本没起」+ 端到端例 |
| ② | warn → `llm_start` → 流式回复 → `crisis_toast`，时序不变 | 前置 gate **只判不拦** warn（不推帧不写审计），toast 仍由内核侧按原时序发 | `voice` 套件「判 warn → 帧序列与优化项之前一致」；`adapter` 套件「判 warn → 不推帧不写审计」 |
| ③ | 普通话术 → 完全正常，无任何额外帧 | `pass` 一律放行 | `voice` 套件「判 pass → 帧序列逐帧一致」 |
| ④ | PsyGUARD 挂掉 → 前置 gate 走本地词典兜底，block 仍能拦住 | 复用**同一个** `RISK_PROBE` 实例 → D12 的 `fallback` 委托天然生效 | `adapter` 套件「远端 503 → 委托本地词典 → 仍判 block, source=local_dict」 |
| ⑤ | 前置 gate 超时/异常 → 静默降级到现有流程 | adapter 内部 `try/catch` → 放行；voice 层再兜一层 `try/catch` → 放行 | `adapter` 套件「探测器抛错 → 放行」；`voice` 套件「前置判定抛错 → 照常 llm_start…」 |
| ⑥ | engine-core git diff 为空 | `git diff --stat HEAD -- src/engine-core` → 空 | 闸门实测（§7） |

**边界四条的落地**：

| 边界 | 落地方式 |
|---|---|
| 不重复写审计 | 前置 gate block → **不调**内核 turn → 内核侧不会写第二条；审计表恒 1 条（端到端例断言 `auditEvents.length === 1`）。**没有**在内核侧加去重检查 |
| warn 场景不变 | 前置 gate 对 warn 返回 `warn` 但**不推帧、不写审计**，voice 层照常走原流程 |
| 前置 gate 漏判兜底 | 内核侧 safety 判定**一行未动** —— 前置漏判时内核照旧 catch（双层防御） |
| visitor_output 侧不动 | 前置 gate 只问 `counselor_input` 侧（断言 `probe.calls[0].side === 'counselor_input'`） |
| monitored 照常置位 | 前置 gate block 时 `studentRiskGate.markMonitored(handleId)`（与内核判 block 同一套动作） |

---

## 5. 与任务单的偏差（3 条，都有理由）

### 5.1 端口签名从 `preCheckSafety?(text: string)` 改成入参对象

任务单 §3.1 建议 `preCheckSafety?(text: string): Promise<{level, category?}>`。
**这个签名不够用**：判成 block 之后，后端要**当场**做三件事 ——

- 推 `crisis_modal` 帧 → 要知道推给**哪一场**（WS 会话 id 客户端可控，不能当注册键）；
- 写审计行 → 要知道**落库 id + 学员 id + 轮次**；
- 置位重点监测 → 要知道**内核句柄**。

只给一个 `text`，后端判得了，却**推不出弹窗、留不下痕** —— §3.3 的三条要求一条都落不了地。
所以实际签名是：

```ts
preCheckSafety?(input: {
  sessionId: string;      // 推帧 / 查审计 / 查句柄
  userText: string;       // 待判文本
  turnIndex: number;      // 本场第几轮 (从 1 起) —— 审计表 turn_index 口径
  publishFrame?: (frame: VoiceServerMessage) => void;  // 推给本场客户端的出口
}): Promise<{ level: 'pass' | 'warn' | 'block'; category?: string }>;
```

方法本身仍是**可选**的（旧链路 `VisitorService` 不实现它 → 天然零变化），返回值的 `level` 三档
与任务单一字不差。

### 5.2 危机帧由**后端**推，不是 voice 层自己拼

任务单 §3.3 写"直接发 `crisis_modal` 帧（复用现有的 modal 帧构造逻辑）"。
但现有的帧构造逻辑（`buildCrisisModalFrame`）住在 `engine-adapters/rendering/`，
而 **voice 层不能反向 import engine-adapters**（会成环，仓库既有依赖方向是 engine-adapters → voice）。

所以分工是：**voice 层提供出口回调**（`publishFrame: send`），**后端负责构造并推帧**。
对前端是同一件事（第一帧就是 `crisis_modal`），但没有制造依赖环，也没有把
"危机帧长什么样"复制一份到 voice 层。

### 5.3 阻断轮**仍然记逐字稿**（"问" 有 / "答" 空）

任务单没提逐字稿。不记会有两个后果：

1. **轮次编号错位** —— 审计表的 `turn_index` 与逐字稿下标必须同源
   （报告按 `(turnIndex - 1) * 2` 定位那条"问"）。少记一轮，后面每一轮的锚点都会偏；
2. **与内核阻断轮不一致** —— 主单的 block 轮（内核判 block）同样会写一条"问有答空"的逐字稿
   （`persistTurnIfComplete` 照跑）。前置 gate 若不记，两条路径的逐字稿形状就不一样了。

所以前置 gate 拦下时，voice 层照常 `persistTurnIfComplete(state, text, [], 'done', gen)`
（`visitorChunks` 为空 = "答" 空）。端到端例断言了这一条。

---

## 6. 关键决策

1. **gate 排在 TTS 之前，不只是排在 `llm_start` 之前**。
   TTS 一起来，本轮就会走完收尾并发出 `tts_done`；只把 gate 放在 `llm_start` 之前，
   照样会漏一个 tts 帧。voice 模式下 TTS 连接根本不起（用例已断言 `ttsStarts.count === 0`）。

2. **前置 gate 只拦 `block`，warn 一律放行**。
   warn 的处置（`crisis_toast`）仍由内核侧按原时序发 —— 前置 gate 若也发 toast，就是重复弹两次。

3. **探测来源必须如实记**。前置 gate 复用 `RISK_PROBE` 实例，D12 的本地词典兜底挂在它上面，
   于是"远端挂了委托本地词典"这条路径上，`source` 记的是 `local_dict` 而不是 `psyguard`
   —— 虚报成 `psyguard` 就是虚报远端识别能力。为此把 `buildStudentRiskDecisionFromProbe`
   的来源参数开放（缺省仍是 `psyguard`，`forceRemoteProbe` 那条路行为不变）。

4. **不引入"探测缓存 / one-shot memo"**。
   前置 gate 与内核各探一次 = 每轮**多一次** PsyGUARD 调用（见 §8 已知成本）。
   用 memo 合并成一次会**破坏任务单 §4 明确要的"双层防御"**（两层共用一份结果 = 漏判就不再兜底），
   且要额外处理"memo 命中时来源归因怎么恢复"。任务单说"别自由发挥重构"，所以没做。

5. **失败一律静默降级**。探测器抛错 → adapter 放行；voice 层再兜一层 catch → 放行。
   前置 gate 挂了不能把对练搞挂（内核侧那一层判定仍然在）。

6. **审计写入方法改成吃 `turnIndex: number`**（不再吃 `TurnRenderResult`）。
   前置 gate 路径没有内核结算结果，只有轮次号；两条路径共用一个写审计方法，避免两份真相。

---

## 7. 闸门实测（2026-11-02）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| 规范 | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 error / 0 warning** |
| 新增套件 | `npx vitest run test/voice/wp14-pre-check-gate.spec.ts test/engine-adapters/wp14-block-no-llm-start.spec.ts` | **2 文件 / 19 例全通过** |
| 全量 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **64 文件 / 997 例全通过**（优化项之前：62 文件 / 978 例 → 新增 2 文件 19 例） |
| 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

---

## 8. 已知成本与边界（诚实记录）

1. **每轮多一次 PsyGUARD 调用**。
   前置 gate 与内核各探一次 → PsyGUARD 侧 QPS ×2，每轮首字延迟多一个探测往返
   （正常几十至几百毫秒；探测超时上限 = 内核 `DEFAULT_PROBE_TIMEOUT_MS` = **500ms**）。
   远端不可达时走 D12 的本地词典兜底（**纯本地，无网络**，几乎不增加延迟）。
   这是任务单"双层防御"设计的直接代价 —— 要消掉它就得让两层共用一份探测结果，
   那会削弱双层防御（见 §6 决策 4）。**建议作为独立后续单评估**（带缓存命中时的来源归因设计）。

2. **前置 gate 拦下时，内核 turn 不执行** → 内核的 `turnIndex` / BDI 状态 / 工作记忆**不推进**，
   学员那句危机表达也**不进内核的工作记忆**（AI 来访下一轮看不到它）。
   语义上是对的（AI 这一轮本来就不该出声），但与"主单 block 轮内核照跑、只跳过渲染"不同，
   排查时要知道这个差别。

3. **审计表 `turn_index` 的两套口径**。
   前置 gate 路径写的是 voice 层给的**本场轮次**（`state.turnCount + 1`），
   内核路径写的是内核的 `turnIndex`。两者在正常轮次**恒等**；
   仅在被抢白（barge-in）的轮次之后会错开（内核轮进了但逐字稿没落）——
   那是**主单已存在**的口径问题，本单不扩大改动面。

4. **报告锚点在"前置 gate 拦下 + 该轮又被抢白"的极端组合下可能落空**：
   `anchorTimestamp` 取不到就返 0（前端按"无锚点"处理，不崩）。

5. **barge-in 期间的前置 gate**：gate 在等网络，若此时来了新一轮（generation 递增），
   本轮的危机弹窗仍会推（学员确实说了危机话），但逐字稿那一行可能不落（被抢白），
   审计行仍会落 —— 审计记的是"确实发生过的一次危机"，这是想要的口径。

---

## 9. 回写去向

- 任务单 `docs/worklog/wp14-block-no-llm-start-optimization-2026-11-02.md`：
  头部状态 + 末尾 §7「交付回写」。
- `docs/worklog/completed/phase1-backlog-archived-2026-11-03.md`：
  §Phase1 的 WP14 段落追加"优化项已交付"一行 + 本记录链接。
- **不自动 commit**。建议 commit 文案（任务单 §6 原样）：

  ```
  feat(voice): block 级危机前置 gate——发 llm_start 前判定，block 直接发 crisis_modal 不发孤儿帧
  ```

  ⚠️ 工作区里还混着 **WP14 主单**的改动（未 commit）与 **WP19-R 的遗留改动**
  （`test/admin-debug/wp19r-trace-wiring.spec.ts`，本优化项开始前就存在）。
  真要 commit 时建议**分两次**：先 WP19-R 遗留，再主单，最后本优化项 —— 或至少确认这三次的边界。
