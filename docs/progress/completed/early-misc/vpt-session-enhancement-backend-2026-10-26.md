# 全真语音会话（vpt）能力增强 · 后端任务单（2026-10-26）

> 配套前端：`frontend/xin_su_app/docs/progress/unified-voice-session-and-voice-plan-2026-10-26.md`
> 现有出声闭环：`/voice/training` WS（bidi TTS 逐句出声 + 文件 ASR + barge-in），协议见
> `docs/specs/counselor-roleplay-voice-bidi-tts-2026-10-23.md` v2.1。
>
> **本单范围**：在**不破坏现有对话闭环**的前提下，补齐 vpt 从"能对聊"到"可复盘、有督导、可控制"的后端能力。
> 纯前端活（计时器、本地逐字稿、麦改点按开关、手动打点本地存）不在本单，见文末「前端自备」。
>
> **红线沿用**：上游错误归一为可识别 `error`，**不伪造成功音频/文本/报告**；MiniMax API key 永不下发前端；
> AI 只给技术方向，不输出替代话术原文、不诊断、不评判人；所有新增帧向后兼容，旧客户端忽略未知帧即可。

---

## 0. 现状基线（已有，勿重造）

| 能力 | 现有落点 | 现状 |
|---|---|---|
| 对话闭环 WS | `src/voice/voice.gateway.ts` / `voice.service.ts` / `voice.types.ts` | ✅ ready/llm_*/tts_*/cancelled/error/session_ended 全通 |
| 演练登记 | `voice-session-registry.ts` | ⚠️ **纯内存、不落库**，结束即清（注释明写"不写 training_sessions"） |
| 结束异步督导 | `voice.service.ts` `triggerSupervisor()` → `agent/supervisor/` | 🟡 fire-and-forget 入队，**无落库、无查询出口**，前端拿不到 |
| 4 流派督导 REST | `counselor/controllers/supervision.controller.ts` | ✅ schools / feedback / compare / history 四端点已在，但绑定 `training_sessions` + `sessionType`，vpt 未接入 |
| 实时轻提示模型 | `counselor/providers/live-hint.service.ts`（存+5分钟同category防抖+推送）+ `turn-analysis.processor.ts`（BullMQ 入队→执行时读档位→`turnAnalysis.analyze` 一次同时产 hint+mark）+ `entities/live-supervision-hint.entity.ts` + `enums/live-supervision-hint-tier.enum.ts` | 🟡 分析/防抖/落库已在，但推送走 session-core **SSE**（`events.publish` `live_hint`），**未接 vpt WS** |

**核心结论**：督导/报告/提示的"零件"大多已存在，本单主要是**把 vpt 内存会话接上现有体系 + 补 WS 增量帧 + 补报告查询出口**，不是从零造督导。

---

## 任务 1 · vpt 会话落库与身份贯通（其它任务的前提，先做）

**问题**：vpt 现在只有内存 `sessionId`（每次新建 uuid），结束即清，导致督导报告无处存、流派反馈无 `sessionId` 可挂、实时提示无会话归属。

**推荐路径（最省，复用现有体系）**：
- vpt 建连成功（`ready` 前）写一条 `training_sessions` 记录，`sessionType` 在现有 `SessionType` 枚举
  （`training_session` / `full_session` / `long_term_case_session`）基础上**新增** `'vpt_voice'`，不改旧值。
- 内存 `sessionId` 与落库 `training_sessions.id` 建立映射；后续督导反馈、实时提示、报告全部挂这个稳定落库 id。
- 会话结束（`session_ended` / `user_finish` / `error`）回写结束状态、时长、turn 数；transcript 随报告落库（见任务 6）。
- 鉴权/租户校验沿用现有 `JwtAuthGuard` 与一人一租户（A9）口径，查询必须校验归属，不跨用户。

**不做**：本期不接长程卷宗、不做多节串联；单场一条记录即可。

---

## 任务 2 · 实时督导轻提示接入 vpt WS（两档，默认 off）

复用现有 `turn-analysis.processor`（入队/读档位）+ `live-hint.service.record`（落库/防抖），**只把推送通道从 session-core SSE 换成 vpt WS 帧**，不重写分析器。

- **档位**：`light`（侧边静默浮窗实时推，不打断）/ `off`（不实时推，结束统一出报告；分析与落库照常，见硬约束 16）；**默认 off**，执行时读 `prefs[liveSupervisionHintTier]`（沿用 `/counselor/preferences`，未设置=off）。
- **触发时机**：每轮咨询师发言（`user_text` 处理完、LLM 回复开始前）入队轻量分析，命中规则才推；**同一 session 同一 category 5 分钟内不重复**（沿用 `live-hint.service` 现有 DB 防抖，key=sessionId+category）。
- **内容约束**：只给方向线索（如"这里连续封闭式提问"），**禁止输出替代话术原文**；正文 ≤500 字。
- **WS 新增服务端帧**（见 §协议增量 `supervision_hint`）：SSE 的 `live_hint` 仍可保留，vpt 连接额外经 WS 同包下发。
- off 档（对齐硬约束 16「档位只控展示，不控是否分析」）：**分析照常跑、mark/统计照常落库**，只是不向客户端推 `supervision_hint`，结束报告里仍可见。

---

## 任务 3 · 技术统计（复用现有 SessionTechStats，全场汇总随报告返回）

现有 `SessionTechStats`（`session-core.types.ts`，`validateSessionTechStats` 已校验）结构直接复用，**不另造 schema**：

```jsonc
{
  "questionTypes": { "open": 0, "closed": 0, "semi": 0 },
  "interventions": {
    "reflection": 0, "paraphrase": 0, "summary": 0,
    "confrontation": 0, "interpretation": 0, "advice": 0
  },
  "behavior": { "interruptions": 0, "silenceMs": 0, "topicJumps": 0 },
  "commentary": "≤1000 字客观技术评述"
}
```

- 每轮 `turnAnalysis.analyze` 已产出当轮统计，结束时按 session 聚合全场（次数累加、`silenceMs` 求和）。
- **本期不做流中实时推**，并入结束报告（任务 6）返回。
- 统计只描述技术行为，**不出分数、不评级、不判对错**（零压口径，与 B/C 轨道一致）；校验不过的项归 0，不硬凑精确值。

---

## 任务 4 · 移情 / 阻抗标记（复用 analyze 已产出的 mark）

`turnAnalysis.analyze` 每轮已同时产出 `mark: LiveTurnTransferenceMark | null`（复用，不自造分类）：

```jsonc
{ "direction": "visitor_auto",
  "markType": "resistance" | "avoidance" | "positive_transference" |
              "negative_transference" | "dissociation" | "counter_transference",
  "note": "一句话客观描述" }
```

- 标记类型直接用现有 `TransferenceMarkType` 枚举（见 `enums/transference-mark.enum.ts`），不新增 kind。
- 两种落点（后端选型，推荐先做 B）：
  - A. 流中经 WS `mark` 帧实时推（前端可在字幕旁高亮）；
  - B. 结束时随报告一次性返回 `marks[]`（含 `turnIndex` + `markType` + `direction` + `note`）。
- 标记只描述来访行为现象，**不做临床诊断、不贴病理标签**。
- 咨询师手动"反移情觉察"备注由前端本地先存，落库归后续，本期不做。

---

## 任务 5 · 暂停 / 恢复（用户主动，非中断模拟）

新增客户端控制帧，服务端**挂起而非 abort**：

- `session_pause`：暂停时挂起 LLM 流、停止 TTS 播放、暂停拾音判定；**不清 transcript、不 abort 会话、不断 WS**。
- `session_resume`：从挂起点继续，状态回待命。
- 服务端回 `paused` / `resumed` 确认帧（见 §协议增量）。
- 暂停期间收到 `user_text` 等业务帧应忽略或回明确提示，不并发跑 LLM。

> 临场中断模拟（来访迟到/爽约/换议题等非标准扰动）属长程扰动系统（§16.2），本期**不做**。

---

## 任务 6 · 复盘报告落库 + 查询出口 + 接入 4 流派反馈

**现状问题**：`triggerSupervisor()` fire-and-forget，报告不落地、前端无端点可取。

- **报告落库**：结束督导生成的结构化报告持久化到该 `training_sessions` 记录（任务 1）。整合两个已有来源为一份：`agent/supervisor` 的文字点评（亮点/建议/风险线索）+ `turn-analysis` 全程累积的技术统计（任务 3）与 mark（任务 4）。内容含：
  - 亮点（做得好的技术点，锚 `turnIndex`）；
  - 改进建议（方向，锚 `turnIndex`，不给话术原文）；
  - 替代回应**方向**提示（非整段话术）；
  - 风险线索（边界/伦理/危机识别相关，若有）；
  - 任务 3 技术统计、任务 4 标记。
- **查询端点**（复用 JwtAuthGuard，校验归属）：
  - `GET /counselor/supervision/report/:sessionId` → 取本场最新报告（含统计/标记/亮点/建议）。
- **接入现有 4 流派反馈**：把 vpt 的 `sessionId` + `sessionType='vpt_voice'` 传给现有
  `POST /counselor/supervision/feedback` 与 `/feedback/compare`，让前端能在 CBT / 精神动力学 / 人本 / 家庭治疗间切换视角、多流派对比；无需新写一套督导生成逻辑。
- 报告生成失败 → 回可识别 `error` 或报告状态 `failed`，**不返回编造内容**。

---

## 任务 7 · 来访者卡片字段下发增强（展示用，不剧透剧本）

前端来访者速查卡当前只有风格/难度/主诉。`ready` 或会话元信息里补可公开的表层字段（仍**不下发 7 大块全量剧本**）：

- 年龄区间（取下限 + 标注区间，沿用现有 ageRange 口径）、职业（表层）、主诉一句话、已知风险标签（如"涉及危机需识别转介"，仅标记不展开）。
- 量表得分、深层背景、完整阻抗/移情剧本不下发。

---

## 协议增量（WS，全部向后兼容；旧帧一字不动）

### 客户端 → 服务端（新增）
| 帧 | 载荷 | 说明 |
|---|---|---|
| `session_pause` | `{}` | 主动暂停，挂起不 abort |
| `session_resume` | `{}` | 恢复继续 |

### 服务端 → 客户端（新增）
| 帧 | 载荷 | 说明 |
|---|---|---|
| `supervision_hint` | `{ turnIndex, category, hintText, tier }` | 实时轻提示，light 档才推；只给方向（对齐 `LiveSupervisionHintDto`） |
| `mark` | `{ turnIndex, direction, markType, note }` | 任务 4 标记（若选流中方案 A；类型取 `TransferenceMarkType`） |
| `paused` | `{}` | 已确认暂停 |
| `resumed` | `{}` | 已确认恢复 |

> 技术统计与完整报告**不走 WS 流**，结束后由 `GET /counselor/supervision/report/:sessionId` 拉取，避免帧体过大。

---

## 本期不做（边界，勿回流）

- 长程卷宗四 Tab、多节串联、目标共建、假设追踪、作业反馈、概念化编辑器（§5.5）。
- 阶段性督导（3-5 节）、脱落专项复盘（依赖多节）。
- 临场中断/扰动事件模拟（§16.2）。
- 伦理实时告警引擎、反移情内在觉察系统、同辈互助、B 端白标（§17 远期）。
- 报告替代话术原文、临床诊断、分数排名。

## 前端自备（不在本单）

- 会话计时器 1s tick；本地逐字稿留存与回看；麦改**点按切换开关**（非按住 PTT）并统一文案；手动打点本地存；假督导开关在后端帧就绪前置灰/隐藏。

---

## 验收判据

1. vpt 建连成功后 `training_sessions` 落一条 `sessionType='vpt_voice'` 记录，结束回写状态/时长/轮次；跨用户查询被拒。
2. `light` 档下命中规则经 `supervision_hint` 推达，同 category 5 分钟不重复，无替代话术；`off` 档不实时推但分析/落库照常。
3. `session_pause` 挂起 LLM/TTS 且不断连、不丢 transcript；`session_resume` 可继续。
4. 结束后 `GET /counselor/supervision/report/:sessionId` 可取到含亮点/建议/技术统计/标记的报告；`/feedback` 能按 4 流派生成 vpt 视角。
5. 现有对话闭环（出声/barge-in/ASR/错误归一）回归不红；未知新帧对旧客户端无副作用。

## 留给本地执行（后端自跑）

- `npm test`（现有 `test/voice/voice-protocol.spec.ts` 回归不红；新控制帧/落库补纯函数与用例）。
- `npm run build` / `npm run lint` 通过；新增枚举/字段登记类型，env 键进 `ProcessEnv` 避免 TS4111。
