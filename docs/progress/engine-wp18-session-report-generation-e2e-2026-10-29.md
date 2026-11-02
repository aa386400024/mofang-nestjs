# WP18 · 会话结束 → 复盘报告生成链路端到端打通

> 类型: 后端任务单（行为化，不含 src 实现）
> 前置: WP9-A ✅ / WP9-B ✅ / WP9-C ✅（语音流式路径已 E2E 探针验证通过）
> 日期: 2026-10-29
> 红线: **不改 `src/engine-core/**` 纯层**；wiring 顶层不直引 SDK（wp8-wiring.spec §8-9 护栏）；不删旧 visitor 链路；不改 DB schema。

---

## 0. 开工前现状

WP9-C 探针验证了**会话内**流式路径通了：ready → llm_start/text/done → tts_audio/done，两角色回复不同，危机轮触发 supervision_hint。

但**会话结束后**的报告闭环从未验证过：
- 探针发 `session_finish` → 收 `session_ended`，但没检查后端是否真的生成了报告；
- Flutter 报告页（`vpt_session_report.dart`）期望的字段（六维评分/annotations/techStats/marks/四态）是否真的有值，还是空壳；
- 新引擎路径（`ENGINE_VOICE_ENABLED=true`）走的是 `EngineTurnService`，它结束后会不会触发报告生成 worker？还是只有旧 visitor 链路才触发？

**本 WP 目标**：跑一场完整会话 → 结束 → 报告页能看到真实评分和标注，不是转圈、不是空壳、不是 parse_error。

---

## 1. 范围（做什么）

### 1.1 确认报告生成触发链路

新引擎路径（`ENGINE_VOICE_ENABLED=true`）结束会话时：
1. transcript 是否真的落库？（不是只在内存里聊完就清）
2. 报告生成 worker（BullMQ `counselor-supervision` / `TurnAnalysisProcessor`）是否被触发？
3. 如果没触发——在 `session_finish` / `session_ended` 处补触发点，不绕过内核。

**关键问题**：旧 visitor 链路结束时怎么触发报告的？新引擎路径有没有接上同一个触发点？如果没有，是漏接还是设计如此（引擎路径应该自己触发）？

### 1.2 报告接口字段对齐

前端 `vpt_session_report.dart` 期望 `GET /counselor/supervision/report/:sessionId` 返回：

| 字段 | 前端期望 | 验收标准 |
|---|---|---|
| `status` | `pending` / `completed` / `parse_error` / `no_content` | 四态都能正确返回 |
| `overallScore` | int?（completed 时有值） | 不是 null |
| `dimensions` | `{empathy, activeListening, questioning, boundary, response, professionalism}` 各 int | 六维都有值，不是全 0 |
| `annotations` | `[{type: good/warn/error, category, message, suggestion?}]` | 至少 1 条，不是空数组 |
| `errorPatterns` | `string[]` | 可空但类型正确 |
| `growthSuggestions` | `string[]` | 至少 1 条具体建议 |
| `techStats` | `{questionTypes:{open,closed,semi}, interventions:{reflection,paraphrase,summary,...}, behavior:{interruptions,silenceMs,topicJumps}, commentary}` | 字段对齐，commentary 非空 |
| `marks` | `[{turnIndex, direction, markType, note?}]` | 可为空数组但结构正确 |
| `startedAt` / `endedAt` | ISO date | 有值 |

**不编造**：如果某个字段引擎路径确实不产出（比如 techStats 的干预分类），明确返回 null/空数组，不要造假数据填。

### 1.3 四态边界

| 场景 | 期望 status |
|---|---|
| 正常聊了 3+ 轮后结束 | `completed`，带评分和标注 |
| 刚连上没说话就退出 | `no_content`，只读终态，不轮询 |
| 报告生成时 LLM 超时/上游故障 | `parse_error`，可重试，不崩 |
| 刚结束 5 秒内拉取 | `pending`，前端轮询 |

### 1.4 探针增强

在 `scripts/e2e-voice-ws-probe.mjs` 加一个 `--report` 模式：
1. 跑完一轮对话后发 `session_finish`；
2. 拿 dbSessionId，轮询 `GET /counselor/supervision/report/:dbSessionId`；
3. 断言 status 最终是 `completed`（不是 pending 超时、不是 parse_error）；
4. 断言 dimensions 六维都有值（不是全 0）；
5. 断言 annotations 非空；
6. 断言 techStats.commentary 非空；
7. 打印报告 JSON 全文供人工核对。

再加一个空局场景：连上直接 `session_finish`（不发 user_text），断言 status = `no_content`。

### 1.5 逐字稿对齐

确认报告里引用的逐字稿（transcript）和实际 WS 会话帧一致：
- 咨询师的话（user_text）和来访的话（llm_text）都在逐字稿里；
- 时间戳/轮次编号和 marks 的 turnIndex 对得上；
- 如果新引擎路径的逐字稿格式和旧 visitor 链路不同，报告生成器要适配，不要让前端兼容两套。

---

## 2. 明确不做项

- ❌ 不改 `src/engine-core/**` 纯层。
- ❌ 不做 4 流派反馈 `feedbackBySchool`（前端模型注释说"待逐字稿回看阶段"，本 WP 不碰）。
- ❌ 不做报告重跑端点（前端有 TODO 注释，本 WP 不实现）。
- ❌ 不改 Flutter 前端代码（报告模型已经写好了，对齐后端实际返回即可）。
- ❌ 不做 per-turn 动态评分（Phase2）。
- ❌ 不做 PsyGUARD 危机服务（WP11）。
- ❌ 不迁 PG / 不改 DB schema。

---

## 3. 验收标准

### 3.1 成功验收

| # | 项 | 怎么验 |
|---|---|---|
| 1 | tsc 0 错、eslint 干净 | 闸门命令 |
| 2 | wp8-wiring 护栏仍绿 | `npm test -- wp8-wiring` |
| 3 | 探针 `--report` 模式：正常会话结束后 status=completed | 探针输出 |
| 4 | 六维评分都有值（不是全 0） | 打印 dimensions |
| 5 | annotations 非空，至少 1 条 good/warn/error | 打印 annotations |
| 6 | techStats.commentary 非空 | 打印 techStats |
| 7 | 空局场景 status=no_content | 探针空局模式 |
| 8 | 刚结束 5 秒内拉取 status=pending | 探针加时序断言 |
| 9 | 逐字稿里咨询师和来访的话都在，turnIndex 对得上 marks | 人工核对 |

### 3.2 失败/边界验收

- 报告生成失败时 status=parse_error，不返回 500。
- 不存在的 sessionId 返回 404，不崩。
- 旧 visitor 链路（ENGINE_VOICE_ENABLED=false）行为零变化。
- 报告不编造字段——引擎路径不产出的字段返回 null/空数组，不造假评分。

---

## 4. 终局形态预留

- 报告生成触发点走 `VoiceSessionBridge` / `RiskProbePort` 同层抽象，未来引擎抽离独立服务时报告触发不耦合 NestJS。
- 六维评分的计算逻辑在 adapter 层（不在 controller），未来换评分模型只换 adapter。
- 报告 DTO 和前端 `VptSessionReport` 字段名一一对应（camelCase），不做 snake_case 转换层。

---

## 5. 闸门命令（由后端在 Windows PowerShell 跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc -p tsconfig.build.json --noEmit
npm run lint
npm test -- wp8-wiring
# 探针报告模式（后端起着服务时）：
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice --report
```

---

## 6. commit 文案（后端完成时）

```
feat(engine): 会话结束→复盘报告生成链路打通，探针 --report 模式验证四态与六维评分
```

---

## 7. 交付回写（2026-10-29）

> **状态：代码已交付并复跑绿，待用户跑探针验收。**
> 交付记录：[engine-wp18-session-report-generation-e2e-implementation-2026-10-29.md](./engine-wp18-session-report-generation-e2e-implementation-2026-10-29.md)

### 7.1 §0 的三个疑问 —— 实测答案

| §0 的疑问 | 实测答案 |
|---|---|
| transcript 是否真的落库？ | ✅ **通**。走 `VoiceSessionBridgeRegistry.appendTurn` → `VptSessionBridgeService.doAppendTurn`，**与新旧链路无关**（窄接口）。实测 `turnCount=6`（3 轮 × 2 条） |
| 报告 worker 是否被触发？ | ✅ **通**。`endSession` → `bridges.close` 派发 CBT 流派 job（技术统计唯一来源）+ `triggerSupervisor` 派发 agent 主报告。实测两条队列都跑完 |
| 报告字段有值还是空壳？ | ⚠️ **改前是空壳** —— 主报告**恒 `parse_error`**（详见 §7.3 缺口①）。本轮治本后：六维 48/38/45/28/42/52、4 条 annotations、5 条 errorPatterns、5 条 growthSuggestions、techStats.commentary 非空 |

**关键结论：新引擎路径没有漏接任何触发点** —— 全部走 `VoiceSessionBridge` / `VoiceTurnBackend` 两条窄接口，装配层选实现、业务层不感知。真正的问题不是"接没接"，而是"接上的那条主报告链路产出不了东西"。

### 7.2 §1 逐条对照

| 小节 | 落地情况 |
|---|---|
| §1.1 确认报告生成触发链路 | ✅ 逐环节核对（建会话 / 逐字稿 / 每轮分析 / 技术统计 / 主报告），**结论：链路本就通，产出侧是坏的** |
| §1.2 报告接口字段对齐 | ✅ **前端 `vpt_session_report.dart` 与后端 `SessionReportDto` 逐项核对，字段名与层级已 1:1 对齐，DTO 与前端均无需改动**（详见交付记录 §5）。后端多给 `failureCode` / `retryable` / `feedbackBySchool` 三个字段，前端忽略即可 |
| §1.3 四态边界 | ✅ **三态探针实测全绿**：`pending`（首轮拉取）/ `completed`（31.6s 后）/ `no_content`（空局 230ms 出结论）；`parse_error` 由单测钉住三种失败原因。`no_content` / `parse_error` **一律不编造数据**（null / 空数组 / 占位 0，且失败行不参与分数派生） |
| §1.4 探针 `--report` 模式 | ✅ 17 项断言；**两段轮询**（主报告与 techStats 是两个队列两个 LLM，不同时到 —— 只等 status 会假红）；顺手修掉探针自身 4 个 bug（见交付记录 §8.2） |
| §1.5 逐字稿对齐 | ✅ 咨询师与来访者的话都在逐字稿里（`turnCount=6`）；`turnIndex` 与 `marks` 同源；**新旧链路逐字稿格式完全一致**（同一处 `TrainingTranscriptTurn`），报告生成器不需要适配两套 |

### 7.3 三个真缺口（治本）

| # | 缺口 | 病根 | 治法 |
|---|---|---|---|
| ① | **主报告思考吃光预算** | M3.1-Flash 思考 token 计入生成长度上限，旧预算 2500 被思考吃满（实测 reasoning=2499/2500）→ `finish_reason=length` → **正文一字未出** → JSON 解析必败 → 报告恒 `parse_error` | 主报告**专属 LLM 参数档**：`high` / `8192` / `120s`，env 可配（`ENGINE_SUPERVISION_*`） |
| ② | **JSON 容错只在 counselor 侧** | agent 主报告用裸 `JSON.parse`；模型加个 ```json 围栏就挂（实测变体 D 预算充足却仍 `jsonOk=false`） | 容错抽取**上移到 `src/shared/llm/llm-json-payload.ts`**（消双胞胎），两边共用一份；既有 import 路径全部照旧可用 |
| ③ | **截断与格式错误混为一谈** | 失败原因一律 `json_parse_failed`，与真正的病因（预算不够）隔了一层 | `finishReason` 贯通到 `LlmStreamChunk`（**只增可选字段**），截断单独标 `truncated_by_length` |

**重要澄清（避免误判责任）**：实测 `max_tokens` 与 `max_completion_tokens` 在 MiniMax 上**语义一致**（都含思考），变体 A 与 B 表现完全相同 —— 所以**这不是 WP9-C 字段切换引入的回归**，这条链路**改前就是坏的**。

### 7.4 闸门实测

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 错 |
| `npx tsc -p tsconfig.scripts.json --noEmit` | ✅ 0 错 |
| `npm run lint` | ✅ **0 error 0 warning** |
| `npm test -- wp8-wiring` | ✅ **34 例全绿**（§8-9 护栏未改未破） |
| `npx jest test/agent test/shared` | ✅ **3 套件 34 例全绿**（WP18 新增） |
| `npm run build` + `npm start` | ✅ Nest 起服务成功 |
| `git diff --stat HEAD -- src/engine-core` | ✅ **空**（内核整树零改动） |
| `node --check scripts/e2e-voice-ws-probe.mjs` | ✅ OK |

**真实上游端到端**（非 mock）：正常场景首轮 `pending` → 31.6s 后 `completed`；空局 `no_content`（230ms）；不存在的 sessionId → 404。

### 7.5 既有债（与本轮无关，但顺手暴露了）

`test/counselor/drill-judge.spec.ts` **2 个失败**（否定守卫 / 评判式回应提示）。该文件与 `src/counselor/drills` 本轮**一行未碰**；此前 WP9-C 的全量 jest 只跑 `engine-core / engine-adapters / voice / agent / llm` 五个目录，**没覆盖 `test/counselor`**，所以这两颗雷此前一直藏着。属另一个范围，**本轮不擅自修**。

### 7.6 待用户验收（探针）

服务起着（`ENGINE_VOICE_ENABLED=true`）时在仓库根跑：

```powershell
# 正常会话 → completed (六维非全 0 / annotations 非空 / techStats 非空 / 首次 pending)
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice --report
# 空局 → no_content (不编造评分)
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice empty --report
```

### 7.7 已知边界

- **`marks` 实测为空数组**：结构正确（本轮不造数据），但本场没识别出移情 / 阻抗标记（`TurnAnalysisService` 日志 `hint=n mark=n`）。这是**标注识别质量**问题，不是链路问题；如需提高召回属模型 / prompt 调优，另立项。
- **主报告耗时 ~15s**（`high` 档思考 1216 token）：报告是会话结束后的异步环节，前端轮询可接受；要更快把 `ENGINE_SUPERVISION_REASONING_EFFORT` 调成 `medium`（实测 8.8s）。
- **流式 usage 上报**：agent 侧 `LlmService` 的流式 usage 仍是 0（MiniMax SSE 流不带 usage chunk），**不影响报告正确性**，但运营观测看不到 token 口径；补齐需上游支持 `stream_options.include_usage`，另立项。
