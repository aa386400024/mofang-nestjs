# WP18 · 会话结束 → 复盘报告生成链路端到端打通 · 后端交付记录

> 任务单: [`engine-wp18-session-report-generation-e2e-2026-10-29.md`](./engine-wp18-session-report-generation-e2e-2026-10-29.md)
> 前置: WP0–WP7 / [WP8-A](./engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md) / [WP8-B](./engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md) / [WP9-A](./engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md) / [WP9-B](./engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md) / [WP9-C](./engine-wp9c-voice-render-token-budget-safety-boundaries-implementation-2026-10-29.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-29

---

## 0. 一句话结论

**任务单 §0 的三个疑问，全部用实测回答了**，其中两个答案是"链路本来是通的"，一个答案是"**有一条链路从来就是坏的**"：

1. **transcript 落库？通。** `persistTurnIfComplete` → `VoiceSessionBridgeRegistry.appendTurn` → `VptSessionBridgeService.doAppendTurn` —— **与新旧链路无关**（走窄接口 `VoiceSessionBridge`，引擎路径照样落）。实测 `turnCount=6`（3 轮 × 咨询师 + 来访者）。
2. **报告 worker 触发？通。** `endSession` → `bridges.close` → 派发 CBT 流派 job（技术统计的唯一来源）+ `triggerSupervisor` → agent 主报告。实测两条队列都跑完。
3. **报告字段有值？原本是空壳 —— 现在有值了。** 真实探针跑出一份完整报告：**六维 48/38/45/28/42/52、4 条 annotations、5 条 errorPatterns、5 条 growthSuggestions、techStats.commentary 非空、4 流派 feedback 齐**。

**本轮治本的三个真缺口**（全部是"看着像配置问题、实际是结构问题"的病）：

| # | 缺口 | 症状 | 治法 |
|---|---|---|---|
| ① | **主报告思考吃光预算** | M3.1-Flash 思考吃掉 2499/2500 token → `finish_reason=length` → **正文一个字未出** → JSON 解析必败 → 报告恒 `parse_error` | 主报告**专属 LLM 参数档**（`high` / `8192` / `120s`，env 可配） |
| ② | **JSON 容错只在 counselor 侧** | agent 主报告用裸 `JSON.parse`；模型加个 ```json 围栏就挂 | 容错抽取**上移到 `src/shared`**（消双胞胎），两边共用一份 |
| ③ | **截断与格式错误混为一谈** | 失败原因一律 `json_parse_failed`，没法定位 | `finishReason` 贯通到 `LlmStreamChunk`，截断单独标 `truncated_by_length` |

**红线全部守住**：`src/engine-core/` 整树零改动（`git diff --stat HEAD -- src/engine-core` **为空**）；wiring 顶层零 SDK 直引（WP8-A §8-9 护栏 34 例全绿）；不删旧 visitor 链路；**零 DB schema 变更 / 零 migration / 零 DB FK**。

**四态已验三态**（pending / completed / no_content 探针实测全绿），parse_error 由单测钉住。

---

## 1. §1.1 报告生成触发链路 —— 逐环节确认

| 环节 | 旧 visitor 链路 | **新引擎路径** | 结论 |
|---|---|---|---|
| 建会话落库 | `VptSessionBridgeService.open` → `training_sessions` 行 | **同一处**（`VoiceSessionBridgeRegistry`，窄接口，与后端实现无关） | ✅ 本来就通 |
| 逐字稿落库 | `persistTurnIfComplete` → `bridges.appendTurn` | **同一处** | ✅ 本来就通 |
| 每轮分析（轻提示 / 标记） | `TurnAnalysisProcessor.enqueue` | **同一处** | ✅ 本来就通 |
| 技术统计（techStats） | `bridges.close` → `CounselorSupervisionProcessor.enqueue`（CBT） | **同一处** | ✅ 本来就通 |
| **主报告（六维 / annotations）** | `endSession` → `SupervisorProcessor` → `SupervisorService.runReport` | **同一处** | ⚠️ **链路通，但产出恒失败**（见 §2 缺口①） |

**结论**：新引擎路径**没有漏接**任何触发点 —— 全部走 `VoiceSessionBridge` / `VoiceTurnBackend` 这两条**窄接口**，装配层选实现，业务层不感知。真正的问题不在"接没接"，而在"接上的那条主报告链路产出不了东西"。

---

## 2. 缺口① · 主报告思考吃光预算（核心）

### 2.1 实测事实（真实上游 MiniMax-M3.1-Flash，真实督导 prompt 2342 字符）

| 变体 | 耗时 | `finish_reason` | content | 思考 token | JSON |
|---|---|---|---|---|---|
| **A 改前现状** `max_tokens=2500` | 18~21s | **length** | **0 ~ 656 字（半截）** | **2252 ~ 2499** | ❌ |
| B `max_completion_tokens=2500` | 18.5s | **length** | **0 字** | **2499** | ❌ |
| C `max_completion_tokens=2500` + `reasoning_effort=low` | 6.8s | stop | 1400~1627 字 | 145~391 | ✅ |
| D `max_completion_tokens=8192`（默认思考深度） | 25.6s | stop | 1619~1829 字 | 2677~3536 | ✅ |
| **E `max_completion_tokens=8192` + `medium`** | **8.8s** | stop | 1555 字 | **314** | ✅ |
| **F `max_completion_tokens=8192` + `high`** | **15.5s** | stop | 1640 字 | 1216 | ✅ |
| G `max_completion_tokens=16384` + `high` | 17.6s | stop | 1419 字 | 1750 | ✅ |

### 2.2 三条关键结论

**① `max_tokens` 与 `max_completion_tokens` 在 MiniMax 上语义一致（都含思考）** —— 所以**这不是 WP9-C 字段切换引入的回归**，这条链路**改前就是坏的**（A 变体同样 length + 空 content）。WP9-C 的字段切换对它没有影响。

**② 根因是"预算 / 思考深度不匹配"** —— 2500 的预算被思考吃满（reasoning 2499/2500），正文被挤成 0 字。而 M3.1-Flash 的**思考 token 计入生成长度上限**（仓库 `counselor-llm.config.ts` 里早就有这条注释，只是这条链路没吃到）。

**③ `finish_reason=length` 时正文是半截或全空** —— `LlmService` 其实**早就 warn 了** `[stream_truncated] finish_reason=length — max_tokens 可能不够`，但**没人消费这个信号**：主报告把它当"JSON 解析失败"处理，于是报出来的是 `json_parse_failed: Unexpected end of JSON input`，与真正的病因（预算不够）隔了一层。

### 2.3 治法：主报告**专属** LLM 参数档

新建 `src/agent/supervisor/supervisor-llm.config.ts`：

```ts
export interface SupervisorLlmProfile {
  readonly reasoningEffort: LlmReasoningEffort;
  readonly maxCompletionTokens: number;   // thinking token 也计入
  readonly timeoutMs: number;
}

export const DEFAULT_SUPERVISOR_LLM_PROFILE: SupervisorLlmProfile = {
  reasoningEffort: 'high',
  maxCompletionTokens: 8192,
  timeoutMs: 120_000,
};
```

**为什么默认取 `high` + `8192`（而不是实测更快的 `medium` + `8192` / `low` + `2500`）**：

- 仓库里"读完整逐字稿 → 出结构化临床评估"这条任务的**既有档位**是 counselor 侧的 4 流派督导（`counselor-llm.config.ts` 的 `supervision` profile：`high` / `8192` / `120s`）。**主报告与 4 流派是同一类任务**，同档 = 消双胞胎。
- 任务单口径（WP9-C §2.1）：supervision 属"重推理任务"，不随 render 的 low 档走。
- 实测 `high` + `8192` 15.5s 出完整 JSON，120s 超时窗口充裕（报告是会话结束后的异步环节，前端轮询，15s 可接受）。

**为什么 env 可配**（思考深度是**模型相关**的，换模型 / 调上游策略后同一档位可能又不够）：

| env | 默认 |
|---|---|
| `ENGINE_SUPERVISION_REASONING_EFFORT` | `high` |
| `ENGINE_SUPERVISION_MAX_TOKENS` | `8192` |
| `ENGINE_SUPERVISION_TIMEOUT_MS` | `120000` |

**非法值回落默认而不是抛错** —— 这是运维旋钮，配错不该让服务起不来（报告生成是收尾环节，不该成为启动的硬依赖）。

**装配**：`SupervisorModule` 用 `useFactory` + `inject: [ConfigService]` 注册 `SUPERVISOR_LLM_PROFILE` token；`SupervisorService` 走 `@Optional() @Inject(...)` 接收 —— **单测直接 `new SupervisorService(llm, repos)` 仍然可用，零破坏**。

### 2.4 taskKind 路由（任务单 §4 终局形态）

本轮落地后，**三条结构化输出链路各有各的档位**，互不传导：

| taskKind | 档位归属 | 思考深度 | 长度上限 |
|---|---|---|---|
| render（voice 渲染） | `render-config.factory.ts`（`ENGINE_RENDER_*`） | `low` | `1500` |
| **supervision（主报告）** | **`supervisor-llm.config.ts`（`ENGINE_SUPERVISION_*`）** | **`high`** | **`8192`** |
| supervision（4 流派） | `counselor-llm.config.ts` | `high` | `8192` |
| liveTurnAnalysis / consent / practice | `counselor-llm.config.ts` 各档 | low / medium | 各异 |

新增 taskKind 只需加一档，**不改路由逻辑**。

---

## 3. 缺口② · JSON 容错抽取上移到 shared（消双胞胎）

### 3.1 病状

同一个模型、同一个"爱加 ```json 围栏 / 爱写废话"的行为，在两条链路上表现完全不同：

- **counselor 侧**（4 流派 / 每轮分析 / 练习评判 / 知情同意）：`CounselorLlmJsonClient` → `extractJsonPayload()` → **容错后照样出结果**；
- **agent 侧**（主报告）：裸 `JSON.parse(rawText)` → **一个围栏就 `parse_error`**。

实测也印证了这点：变体 D（`6000` + `low`）预算充足、思考正常，却仍然 `jsonOk=false` —— 因为模型输出里带了非 JSON 的东西。

### 3.2 治法

**实现上移到 `src/shared/llm/llm-json-payload.ts`**（唯一真相源）：

- `stripThinkingTags(raw)` —— 剥掉内联 `<think>...</think>`；
- `extractJsonPayload(raw)` —— 依次处理围栏 / 前后废话 / 思考块；抠不出返回 `null`。

**为什么必须落 shared 而不是留在 counselor**：仓库依赖方向是 **counselor → agent**，**agent 不能引 counselor**（反向会成环）。所以唯一真相只能落在两边都能引的位置。

**既有 import 路径全部照旧可用**（零破坏）：

- `counselor/config/counselor-llm.config.ts` → `export { stripThinkingTags } from '../../shared/llm/llm-json-payload'`
- `counselor/providers/llm-json.client.ts` → `export { extractJsonPayload }`（本地 import + export）

### 3.3 一条重要纪律

**截断的 JSON 不补括号** —— 抠不出就返回 `null`，由调用方按失败语义处理。补上右括号会"编造"出一份看似合法的半截数据（红线：不编造评分）。

---

## 4. 缺口③ · 截断与格式错误可区分

`LlmStreamChunk` 的 `done` 事件**只增可选字段**（老消费方零破坏）：

```ts
| { readonly type: 'done'; readonly usage: LlmUsage; readonly finishReason?: string }
```

`LlmService.parseSseStream` 记录上游的 `finish_reason` 并透传；`SupervisorService` 据此分流失败原因：

| 现象 | 失败原因码 | 含义 |
|---|---|---|
| `finish_reason=length` + 抠不出 JSON | `truncated_by_length` | **预算 / 思考档位没配够**（调大 `maxCompletionTokens` 或降思考档） |
| 正文为空 + 无截断信号 | `empty_response` | 典型的"思考吃光预算"症状 |
| 有正文但非 JSON | `json_not_found` | **prompt 契约问题**（模型没按格式输出） |

**为什么必须分开**：前者调预算能修好，后者要改 prompt 契约。混成一句 `json_parse_failed`，排查只能靠猜。

---

## 5. §1.2 报告接口字段对齐（前端 `vpt_session_report.dart` 逐项核对）

前端模型: `E:\Work\Project\frontend\xin_su_app\lib\features\counselor_training_session\voice\data\vpt_session_report.dart`
后端 DTO: `src/counselor/dto/supervision.dto.ts` 的 `SessionReportDto`

| 前端期望 | 后端字段 | 状态 | 备注 |
|---|---|---|---|
| `status`（四态） | `status` | ✅ | 派生口径在 `domain/session-core/session-core.types.ts` 的 `resolveSessionReportState` |
| `overallScore` int? | `overallScore` number \| null | ✅ | 非 completed 恒 `null`（不补 0） |
| `dimensions`（六维） | `dimensions` | ✅ | `empathy/activeListening/questioning/boundary/response/professionalism`，**字段名逐字一致** |
| `annotations[]`（type/category/message/suggestion?） | `annotations` | ✅ | 后端**多**一个 `timestamp`（锚点），前端忽略即可 |
| `errorPatterns` string[] | `errorPatterns` | ✅ | |
| `growthSuggestions` string[] | `growthSuggestions` | ✅ | |
| `techStats.questionTypes.{open,closed,semi}` | 同名 | ✅ | |
| `techStats.interventions.{reflection,paraphrase,summary,confrontation,interpretation,advice}` | 同名 | ✅ | |
| `techStats.behavior.{interruptions,silenceMs,topicJumps}` | 同名 | ✅ | |
| `techStats.commentary` | 同名 | ✅ | |
| `marks[]{turnIndex,direction,markType,note?}` | `marks` | ✅ | 结构一致；**实测本场为空数组**（见 §8） |
| `startedAt` / `endedAt` ISO date | 同名 | ✅ | 实测 `2026-10-29T08:01:46.121Z` / `...52.731Z` |
| —（前端未用） | `failureCode` / `retryable` | ➕ | 后端多给：失败原因码 + 可重试标志 |
| —（前端未用） | `feedbackBySchool` | ➕ | 4 流派反馈（vpt 下是附加，不参与状态派生） |

**结论：字段名与层级已 1:1 对齐，无需改动 DTO 或前端。** 后端多给的三个字段（`failureCode` / `retryable` / `feedbackBySchool`）是"前端没消费但后端该给"的，前端忽略不影响。

---

## 6. §1.3 四态边界

| 场景 | status | 验证方式 |
|---|---|---|
| **正常（3 轮）** | `completed` | ✅ 探针实测（六维 48/38/45/28/42/52、4 条 annotations） |
| **刚结束 5 秒内拉取** | `pending` | ✅ 探针实测（首轮拉取 = `pending`，31.6s 后转 `completed`） |
| **空局（连上直接结束）** | `no_content` | ✅ 探针实测（`overallScore=null` / `dimensions=null` / `annotations=[]` / `turnCount=0`） |
| **生成失败** | `parse_error` | ✅ 单测钉住（`truncated_by_length` / `empty_response` / `json_not_found` 三种原因） |

**`no_content` 不编造任何数据**（实测 JSON 全文）：

```json
{ "status": "no_content", "overallScore": null, "dimensions": null,
  "annotations": [], "errorPatterns": [], "growthSuggestions": [],
  "techStats": null, "marks": [], "feedbackBySchool": {},
  "turnCount": 0, "createdAt": null }
```

**`parse_error` 不返回 500**：`getSessionReport` 抛 `NotFoundException`（不存在 / 跨用户）→ 404；其余一律返回带 `failureCode` 的 `parse_error` 行。

**四态派生逻辑本轮未改** —— 它本就在 `domain/session-core/session-core.types.ts` 的 `resolveSessionReportState`（纯函数），且有既存单测 `test/counselor/session-report-status.spec.ts`（20+ 例）覆盖。

---

## 7. §1.5 逐字稿对齐

- **咨询师的话和来访者的话都在逐字稿里** —— 实测 `turnCount=6`（3 轮 × 2 条），`transcript` 表里逐条落库。
- **`turnIndex` 对得上** —— `marks` 的 `turnIndex` 与 `appendTurn` 的 `turnIndex` 同源（`VptSessionBridgeService.doAppendTurn` 里 `visitorTurnIndex = row.transcript.length - 1`）。
- **新引擎路径与旧 visitor 链路的逐字稿格式完全一致** —— 都走 `VptSessionBridgeService.appendTurn` → `TrainingTranscriptTurn`（`ChatRole` 3 档），**报告生成器不需要适配两套**。
- 报告里的 `annotations[].timestamp` 锚在 transcript 的 ms 时间戳上（实测 155805 / 155808），与逐字稿轮次对应。

---

## 8. §1.4 探针增强（`scripts/e2e-voice-ws-probe.mjs`）

### 8.1 `--report` 模式

```
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice --report       # 正常 → completed
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice empty --report # 空局 → no_content
```

流程：**跑 3 轮对话 → `session_finish` → 拿 `dbSessionId` → 轮询 `GET /counselor/supervision/report/:dbSessionId` → 断言 → 打印报告 JSON 全文**。

**两段轮询**（关键）：主报告（agent/supervisor）与技术统计（4 流派 counselor-supervision）是**两个队列两个 LLM，不同时到**。只等 status 会在 techStats 还没落库时就断言，那是**假红**。所以先等 status 落终态（≤60s），completed 时再等 techStats（≤150s）。

**17 项断言**：落库 / `session_ended` 帧 / 200 / 404 边界 / 首次 `pending` / `completed` / `overallScore` 非空 / 六维非全 0 / annotations 非空 + type 合法 / growthSuggestions 非空 / techStats 已生成 / commentary 非空 / startedAt / endedAt / turnCount>0。

### 8.2 探针自身修掉的 4 个 bug（都是实测暴露的）

| bug | 症状 | 修法 |
|---|---|---|
| **JWT 缺 `type: 'access'`** | WS 握手通、HTTP 报告接口 **401**（`JwtAuthGuard` 校验 `payload.type`） | payload 补齐 `type` / `jti` / `username` / `roles`（与守卫口径逐项对齐） |
| **`tts_done` 就断连** | 收不到 `session_ended` 帧（连带丢掉 `reportStatus`） | 报告模式下等 `session_ended` 才关 |
| **`maybeFinish` 漏"轮次跑完"检查** | 第 1 轮的 `tts_done` 就发了 `session_finish` → 后端 `endSession` 删掉会话资源 → 后续轮次到达时报"会话未开启" | 三个条件都满足才发（轮次完 + TTS 完 + 未发过） |
| **发轮次太快（400ms）** | 新 `user_text` 在上一轮 TTS 还在合成时到达 → **barge-in 打断上一轮** → 逐字稿少一轮 | voice 模式等上一轮 `tts_done` 再发下一轮 |

**后端行为是对的** —— 第 3 个 bug 暴露的是"会话已结束后到达的消息被拒"，那是正确语义；错在探针提前结束了会话。

---

## 9. 闸门实测

```
npx tsc -p tsconfig.build.json --noEmit    → 0 错
npx tsc -p tsconfig.scripts.json --noEmit  → 0 错
npm run lint                               → 0 error 0 warning
npx jest test/engine-adapters/wp8-wiring.spec.ts   → 34 例全绿（§8-9 护栏未改未破）
npx jest test/agent test/shared             → 3 套件 34 例全绿（WP18 新增）
npx jest test/engine-core test/engine-adapters test/voice test/llm test/agent test/shared
                                             → 全绿
node --check scripts/e2e-voice-ws-probe.mjs → OK
npm run build + npm start                  → Nest 起服务成功
git diff --stat HEAD -- src/engine-core    → 空（内核整树零改动）
```

**真实上游端到端**（探针实测，非 mock）：
- 正常场景：首次 `pending` → 31.6s 后 `completed`，六维 48/38/45/28/42/52，4 条 annotations（good/warn/error/warn），5 条 errorPatterns，5 条 growthSuggestions，techStats.commentary 非空，`feedbackBySchool.cbt` 有值，`turnCount=6`。
- 空局场景：`no_content`，230ms 内出结论，全部字段为 null / 空数组。
- 404 边界：不存在的 sessionId → HTTP 404。

### 9.1 `test/counselor/drill-judge.spec.ts` 的 2 个失败 —— **既有债，与本轮无关**

```
✕ 否定守卫: 命中词前有否定字时该次命中不计入, 但同词后面的未否定出现仍计入
✕ 评判式回应 → 不评判锚点未覆盖, 且给"这里可以多问一句"方向提示
```

该文件与 `src/counselor/drills` 本轮**一行未碰**（`git status` 可查）；上一轮 WP9-C 的全量 jest 只跑 `engine-core / engine-adapters / voice / agent / llm` 五个目录，**没覆盖 `test/counselor`**，所以这两颗雷此前一直藏着。本轮顺手复跑时暴露，**属另一个 WP 的范围，不在本轮擅自修**。

---

## 10. 改动面清单

### 10.1 新增文件（4）

| 文件 | 职责 |
|---|---|
| `src/shared/llm/llm-json-payload.ts` | JSON 载荷容错抽取（**唯一真相源**） |
| `src/agent/supervisor/supervisor-llm.config.ts` | 主报告专属 LLM 参数档（类型 + 默认值 + env 解析） |
| `test/shared/wp18-llm-json-payload.spec.ts` | 容错抽取用例 |
| `test/agent/wp18-supervisor-llm-profile.spec.ts` | 参数档用例 |
| `test/agent/wp18-supervisor-report.spec.ts` | 主报告生成链路用例 |

### 10.2 修改文件（6）

| 文件 | 改动 |
|---|---|
| `src/agent/supervisor/supervisor.service.ts` | 参数档注入 + `maxCompletionTokens`/`reasoningEffort`/`timeoutMs` + 容错抽取 + 失败原因分流 |
| `src/agent/supervisor/supervisor.module.ts` | 注册 `SUPERVISOR_LLM_PROFILE`（useFactory + env） |
| `src/agent/llm/llm.types.ts` | `LlmStreamChunk` 的 `done` 加**可选** `finishReason?` |
| `src/agent/llm/llm.service.ts` | `parseSseStream` 记录并透传 `finish_reason` |
| `src/counselor/config/counselor-llm.config.ts` | `stripThinkingTags` 改 re-export（路径不变） |
| `src/counselor/providers/llm-json.client.ts` | `extractJsonPayload` 改 re-export（路径不变） |
| `scripts/e2e-voice-ws-probe.mjs` | `--report` 模式 + 4 个探针 bug 修复 |

### 10.3 红线核对

| 红线 | 核对结果 |
|---|---|
| 不改 `src/engine-core/**` | ✅ `git diff --stat HEAD -- src/engine-core` **为空** |
| wiring 顶层不直引 SDK | ✅ `wp8-wiring.spec.ts` §8-9 护栏 **34 例全绿**，未改未破 |
| 不删旧 visitor 链路 | ✅ 一行未删；`visitor.service.ts` 本轮零改动 |
| 不改 DB schema / 不加 DB FK | ✅ 零 migration、零 entity 改动 |
| 不做 4 流派 `feedbackBySchool` | ✅ 本轮**只读**该字段，未改其产出逻辑 |
| 不做报告重跑端点 | ✅ 未实现 |
| 不改 Flutter 前端 | ✅ 零改动（后端字段已 1:1 对齐，前端不用动） |
| 不编造评分 | ✅ `no_content` / `parse_error` 一律 null / 空数组 / 占位 0，且**失败行不参与分数派生** |

---

## 11. commit 文案

```
feat(engine): 会话结束→复盘报告生成链路打通，探针 --report 模式验证四态与六维评分
```

---

## 12. 用户验收（探针）

服务起着（`ENGINE_VOICE_ENABLED=true`），在仓库根跑：

```powershell
# 正常会话 → completed (六维非全 0 / annotations 非空 / techStats 非空)
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice --report

# 空局 → no_content (不编造评分)
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice empty --report
```

### 12.1 已知边界 / 后续项

- **`marks` 实测为空数组**：结构正确（本轮不造数据），但**本场没识别出移情 / 阻抗标记**。`TurnAnalysisService` 每轮分析日志显示 `hint=n mark=n` —— 模型没判出标记。这是**标注识别质量**问题，不是链路问题（数据通路已验）；如需提高召回，属模型/prompt 调优，另立项。
- **主报告耗时 ~15s**（`high` 档思考 1216 token）：报告是会话结束后的异步环节，前端轮询可接受。若要更快，把 `ENGINE_SUPERVISION_REASONING_EFFORT` 调成 `medium`（实测 8.8s）。
- **`supervision_reports` 与 `supervision_feedback` 是两条链路**：vpt 下前者是"报告正身"（决定 status 与分数），后者是附加（技术统计 + 多流派展示）。这条边界本轮**未改**（既有 `resolveHasMainReportChannel` 已立）。
- **`test/counselor/drill-judge.spec.ts` 的 2 个既有失败**：与本轮无关（§9.1），属另一个范围。
- **流式 usage 上报**：agent 侧 `LlmService` 的流式 usage 仍是 0（MiniMax SSE 流不带 usage chunk），**不影响报告正确性**（分数与字段来自解析结果），但运营观测看不到 token 口径。若要补，需上游支持 `stream_options.include_usage`，另立项。
