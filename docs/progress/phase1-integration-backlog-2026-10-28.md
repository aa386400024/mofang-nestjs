# Phase1 装配集成轮 Backlog（WP6+）

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md)
> 愿景备查: [`../reference/ai-simulation-blueprint-v1.1.md`](../reference/ai-simulation-blueprint-v1.1.md)（冲突以母版为准；蓝图选 pgvector，本仓 D2 拍板 Qdrant）
> 设计原则原件（已转写归档，仅作依据，冲突以母版为准）：[`bdi-cognitive-engine-principles-v1.0.md`](../reference/bdi-cognitive-engine-principles-v1.0.md)（BDI 决策/渲染边界）、[`architecture-blindspot-fill-v1.0.md`](../reference/architecture-blindspot-fill-v1.0.md)（14 项盲区补全，经本仓架构裁剪后落地）。
> 日期: 2026-10-28（进度登记更新于 2026-10-29）｜ 状态: 🟢 **WP0–WP7 纯层与渲染闭环已交付；WP8-A/B 流式+WS 灰度已交付；WP9-A/B/C 角色注入+DB 角色池+语音渲染 token 预算/截断/危机路由/降级均已交付并 E2E 探针验证通过（晚晴/亦舟/危机场景全绿）；WP18 报告生成链路 E2E 已立待开工；WP10–WP17 待排期**
> 2026-10-29 增补：按两份设计原则（BDI 原则 / 盲区补全）经本仓架构裁剪，新增 Phase1 小项 WP14 学员风险兜底、WP15 算子幅度声明+回归、WP16 轻量幂等+断流不叠加；Phase2+ 保留推进队列见文末（全量保留，逐步推进，非丢弃）。
> 仓库: `E:\Work\Project\backend\mofang-nestjs`

---

## 0. 为什么有这份文档

WP0–WP5 交付的是引擎**内核纯层**：纯函数、类型契约、内存/Qdrant B 层，单测绿，但**没有一句真实来访回复走出内核**——`turn` 的 `reply` 恒为 `''`，未调 `RenderPort`、未组装 `RenderSpec`、无真实 LLM、无流式，现有 `src/agent/visitor` 仍是 prompt 直出旧链路。

本清单把"把纯层接成可用对练"的剩余工作拆成可逐日派发的 WP6+，全部落在**适配层（`src/engine-adapters/`）与编排层（NestJS）**，**不再改内核纯算子**（第 0 原则：内核保持零 `@nestjs/`、零网络、零 prompt）。

### 0.1 蓝图 Phase1 七条落地能力对账（2026-10-28）

| # | 蓝图 Phase1 落地能力 | 内核纯层 | 真实落地缺口 | 对应 WP |
|---|---|---|---|---|
| 1 | 简化版 BDI（信念-愿望-意图）+ 5Ps 角色内核注入 | ✅ WP1（规则轨分类/迁移/意图/阻抗/移情快照） | 5Ps 角色真实注入、开场基线装配 | WP9 |
| 2 | 轨迹 V1 强覆盖 + 10 个伦理盲盒剧本 | ✅ WP3（三模式纯函数/游标/触发/终态） | 10 个真实剧本内容资产、暂停恢复归档 | WP10 |
| 3 | 二级记忆（工作+短时）+ 向量检索 | ✅ WP2（窗口/衰减/冲突/晋升纯函数 + Qdrant B 层） | 短时自动摘要写入、会话结束晋升、Qdrant 写侧冲突标记、参数标定 | WP12 |
| 4 | 规则层 + PsyGUARD 双层伦理 | ✅ WP4（规则双侧判定/RiskProbePort 占位） | PsyGUARD-RoBERTa Python 服务、规则词典标定 | WP11 |
| 5 | 主模型对接 + 流式 + 中文风格优化 | ✅ WP5（渲染契约/预算/主备选择/输出校验纯层） | RenderPort 真实实现、规格组装、turn 填 reply、流式、主备执行 | WP6/7/8 |
| 6 | 基础角色资产池（PatientHub 初始人设） | — | 5Ps schema 落库、首批初始人设、审核状态 | WP9 |
| 7 | 基础可观测与运维 | — | 决策链留痕、基础指标、单会话 BDI 回放 | WP13 |

### 0.2 推进策略（先最小闭环，再并行补）

```
最小可用闭环（串行，优先打通）:
  WP6 RenderPort LLM 适配 + 主备执行
    → WP7 RenderSpec 组装 + turn 接线填 reply（决策→说话）
      → WP8 接现有 WS/vpt 会话 + 流式推送 + 切旧链路（端到端一句真实对练）

可与最小闭环并行（独立，不阻塞 6→7→8）:
  WP9 角色资产池 ｜ WP10 伦理盲盒剧本 ｜ WP11 PsyGUARD 服务 ｜ WP12 记忆遗留 ｜ WP13 可观测（贯穿）
```

> 每个 WP 独立拆成 `progress/engine-core-wpX-*-backend-*.md` 任务单后再开工；本文件只排依赖序与验收门槛，不替代任务单。

### 0.3 交付进度登记（2026-10-30 更新）

> **标注说明**：📌 = 补登（之前已交付但进度表漏记）；🆕 = 2026-10-30 新拆任务单。

| 工作包 | 状态 | 任务单 / 交付记录 | 说明 |
|---|---|---|---|
| WP0–WP5 内核纯层 | ✅ 已交付 | `engine-core-wp0…wp5-*` | 纯函数/契约/内存·Qdrant B 层，单测绿，engine-core 零网络零 prompt |
| WP6 RenderPort LLM 适配 + 主备 | ✅ 已交付 | 任务单 `engine-wp6-llm-render-port-backend-2026-10-28.md`；记录 `engine-wp6-llm-render-port-implementation-2026-10-28.md` | 主备冷却/失败记账/鉴权失败不切备/全文 guard/降级 |
| WP7 RenderSpec 组装 + turn 填 reply | ✅ 已交付 | 任务单 `engine-wp7-spec-assembly-turn-reply-backend-2026-10-28.md`；记录 `engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md` | 决策→说话门面，问+答成对落账，降级不写记忆 |
| WP8-A DI 装配 + 聚合 turn 接线 | ✅ 已交付 | 任务单 `engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md`；记录 `engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md` | open/turn/close 调试端点聚合闭环（非流式） |
| MiniMax chat provider | ✅ 已交付 | 任务单 `llm-minimax-chat-provider-backend-2026-10-28.md`；记录 `llm-minimax-chat-provider-implementation-2026-10-28.md` | 真实 E2E reply 通（fallbackUsed=false/providerHint=minimax）；窄面 uid/AbortSignal 归 WP8-B |
| **WP8-B 流式原生渲染 + WS 灰度切旧** | ✅ 已交付并审核通过（2026-10-29） | 任务单 `engine-wp8b-streaming-ws-grayscale-backend-2026-10-29.md`；记录 `engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md` | B 方案流式原生/单一实现；tsc0 错、eslint0、370 用例全绿、engine-core 零改动；角色注入归 WP9 |
| **WP9-A 角色内核解析注入（内置种子，零 DB）** | ✅ 已交付并审核通过（2026-10-29） | `engine-wp9a-character-profile-seed-injection-backend-2026-10-29.md`；记录 `engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md` | 2 内置种子+Resolver 端口+openSession 注入；engine-core 零改动；已知命中率 0（`builtin_*`≠握手 `vpt_*`）与"角色语义未进渲染 prompt"如实记录，归 WP9-B/后续 |
| **WP9-B MySQL 角色资产池（DbResolver）** | ✅ 已交付并审核通过（2026-10-29） | 任务单 `engine-wp9b-db-character-pool-backend-2026-10-29.md`；记录 `engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md` | `character_profiles` 21 列+审核上下架+独立 `CharacterPoolModule`（装配层零 SDK）；默认 db 数据源，4 个真实 vpt slug 命中闭合；resolver 复用唯一映射；engine-core/voice 零改动。小尾巴：小满 5Ps 人称"他"应为"她"（女），seed 顺手修 |
| 📌 **WP9-C 语音渲染 token 预算/截断/危机路由/降级** | ✅ 已交付（2026-10-29） | 任务单 `engine-wp9c-voice-render-token-budget-safety-boundaries-2026-10-29.md`；记录 `engine-wp9c-voice-render-token-budget-safety-boundaries-implementation-2026-10-29.md` | max_completion_tokens / voice render 低 reasoningEffort / 截断半句不喂 TTS / 危机轮次同步 supervision_hint / LLM 空 429 降级本地话术 |
| 📌 **WP18 报告生成链路 E2E** | ✅ 已交付（2026-10-29） | 任务单 `engine-wp18-session-report-generation-e2e-2026-10-29.md`；记录 `engine-wp18-session-report-generation-e2e-implementation-2026-10-29.md` | 会话结束→transcript 落库→报告 worker 触发→四态（completed/parse_error/pending/no_content）→六维评分/annotations/techStats |
| 📌 **WP19 AdminDebugModule + BDI 快照留痕** | ✅ 已交付（2026-10-29） | 任务单 `engine-wp19-admin-debug-module-trace-2026-10-29.md`；记录 `engine-wp19-admin-debug-module-trace-2026-10-29.md` | 每轮 BDI 快照/RenderSpec 摘要/LLM usage 落库；只读 API /admin/api/sessions/:id |
| 📌 **WP20 Vue3 调试器 SPA** | ✅ 已交付（2026-10-29） | 任务单 `engine-wp20-admin-dashboard-vue3-spa-2026-10-29.md`；记录 `engine-wp20-admin-dashboard-vue3-spa-2026-10-29.md` | admin-dashboard/ 独立 Vue3+Vite+Tailwind SPA，深色主题，会话回放/BDI 快照/ECharts 轨迹图 |
| 📌 **WP21 报告 SSE 推送端点** | ✅ 已交付并审核通过（2026-10-29） | 任务单 `engine-wp21-report-sse-stream-2026-10-29.md`；记录 `engine-wp21-report-sse-stream-implementation-2026-10-29.md` | GET report/:sessionId/stream @Sse()，终态推完整报告并关流，超时推 {"status":"timeout"}，真 404 走 guard，RxJS timer 不泄漏 |
| 🆕 **WP10 10 个伦理盲盒强覆盖剧本** | ✅ 已交付并审核通过（2026-10-30） | 任务单 `engine-wp10-ethical-blindbox-scripts-backend-2026-10-30.md`；记录 `engine-wp10-ethical-blindbox-scripts-backend-implementation-2026-10-30.md` | 10 个 force_override 剧本（静态 TS 不落库）+ TrajectoryScriptResolver 端口（Symbol token, @Optional）+ 握手 scriptId 四段透传；tsc 0 / 31 例测试绿 / engine-core 零改动；三种失败口径各有 warn 不阻断会话。前端 scriptId 透传链路已通（vpt_session_start + roleplay_ws_client），fa 0 错 |
| 🆕 **WP10A character_profiles 表达风格字段预留** | ✅ 已交付并审核通过（2026-10-30） | 任务单 `engine-wp10a-character-expression-style-fields-backend-2026-10-30.md`；记录 `engine-wp10a-character-expression-style-fields-backend-implementation-2026-10-30.md` | 加 3 列（speech_volume_baseline/narrative_style/expression_tone）+ 手写幂等 migration + entity；seed 键不存在=走 DB DEFAULT（默认值只有 DDL 一处真相）；小满/亦舟 expressionTone=intellectualizing，其余走默认；tsc 0 / 14 例测试绿 / engine-core 零改动 / 不消费不暴露前端 |
| 🆕 **WP22 语音对练限流与并发上限** | 📋 已列入，待拆单 | （待写任务单） | 单用户同时 1 场 + 日 token 预算告警，防烧 LLM 额度 |
| 🆕 **WP23 WS 断连恢复口径明确** | 📋 已列入，待拆单 | （待写任务单） | 断连超 30s = 会话结束，前端明确提示，不静默丢 BDI 状态 |
| 🆕 **WP24 单场成本日志** | 📋 已列入，待拆单 | （待写任务单） | closeSession 打每场总 token + 预估费用，不做看板 |

> WP8 总目标拆为两段：**WP8-A（聚合装配，已交付）** 先在调试端点跑通真实 reply；**WP8-B（流式原生 + 接 voice WS + 灰度，本单）** 才是端到端对练闭环。两者不合并，避免在装配期长出第二套渲染。

---

## WP6 · RenderPort LLM 适配 + 主备执行（渲染落地底座）

- **目标**：把内核 `RenderPort` 接口接到现有 `src/llm` 路由，让"规格"能真的渲染出文本，并执行主备容灾。
- **内容**：
  1. 在 `src/engine-adapters/rendering/` 新建 `llm-render.port.ts`，实现内核 `RenderPort.render(spec)`：
     - 按 `spec.taskKind`（stable/chat/advanced）选配置化的 provider/model/温度（stable 低温、chat 高温流式、advanced 按需）；**厂商/模型/温度全部走配置，内核不写死**；MiniMax 经 openai-compatible 适配接入，不新增内核依赖；
     - 单轮用 `LlmRouterService.chat`，chat 类用 `streamChat` 聚合（流式句柄在 WP8 接）；
     - 回填 `RenderResult.text / usage / fallbackUsed / providerHint`。
  2. 主备执行：适配层持有 `FailoverState`（候选序列/已尝试/连续失败计数），逐轮调内核 `selectFailoverTarget` 选下一个；实现真实**失败计数、指数退避、冷却、健康后恢复切回主**（这些运行时状态属适配层，内核只给"选谁"）。
  3. 输出侧 `guardVisitorOutput(text, { probe })`：`block` → 不直接出声，重生成一次或降级稳定话术；`warn` → 记录信号不阻断；全部留日志。
  4. 错误归一：provider reject/超时/空回包统一转成可被 WP7 兜底的稳定结果，不炸穿 turn。
- **依赖**：WP5 契约（已交付）；复用 `src/llm` 现有路由（本期不改其公共行为，只包装）。
- **验收**：
  - 主 provider 抛错/超时一次，自动切备且本轮不中断；主恢复后冷却期满切回；
  - `RenderResult.usage/fallbackUsed/providerHint` 正确回填；
  - 输出命中 block 不被直接出声，warn 可观测；
  - 适配层单测（mock provider）覆盖选主/切备/耗尽降级/guard 处置。
- **不做**：不在内核加模型名/温度/prompt；不改 `src/llm` provider 内部；不做成本看板（WP13）。

## WP7 · RenderSpec 组装 + turn 接线填 reply（决策→说话闭环）

- **目标**：把内核每轮算出的 BDI 结果，组装成 `RenderSpec` 交给 WP6 渲染，把真实文本回填进 `reply`，让来访"先决策后说话"。
- **内容**：
  1. 在适配层建 `spec-assembler`：从 `EngineTurnOutput`（snapshot 的 intention/emotion/resistance/transference/trust、coreBeliefs、attachmentStyle、合并 forbiddenBehaviors、WP2 recall、WP3 trajectoryNote、recentTurns）组装 `RenderSpec`；用 `fitContextToBudget` 按 token 预算裁剪历史/记忆。
  2. 中文来访风格 system prompt（借鉴 PsycheChat 口语化/情绪位移）**只放适配层模板**：把意图、禁止行为、情绪阻抗、核心信念约束注入，确保不越出决策；内核不含 prompt。
  3. 接线 turn：调 `RenderPort.render` → 文本填 `EngineTurnOutput.reply`；`rememberTurn` 由只记咨询师半边改为**问+答成对写工作记忆**。
  4. 渲染失败兜底：降级稳定短句，保证对话不断流，不抛给前端。
- **依赖**：WP6（RenderPort 可用）。
- **验收**：
  - 同一咨询师行为序列，来访产出非空口语回复，且不越出 intention 目标/禁止行为；
  - 单轮 completion token 受预算上限，超限裁剪历史不超预算；
  - 失败兜底不炸穿；单测覆盖规格组装/预算裁剪/成对记忆。
- **不做**：不在内核拼 prompt；不做多流派话术（Phase2）。

## WP8 · 接现有 WS/vpt 会话 + 流式推送 + 切旧链路（端到端最小闭环）

> **已拆分（2026-10-29）**：WP8-A 聚合装配 + 调试端点 ✅ 已交付（`engine-wp8-di-wiring-aggregated-turn-*`）；WP8-B 流式原生渲染 + voice WS 灰度切旧 📋 已拆单待开工（`engine-wp8b-streaming-ws-grayscale-backend-2026-10-29.md`，B 方案单一实现）。下列内容为总目标，具体以两份拆单为准。

- **目标**：把内核 `EngineSessionPort` 接到现有语音对练会话，替换 `src/agent/visitor` prompt 直出，跑通一句"咨询师发→来访流式回"的真实闭环。
- **内容**：
  1. NestJS 编排层持有 `InMemoryEngineSession`（或后续仓储实现）+ 注入 WP6 的 `RenderPort` + WP2 的 `MemoryStore`；open/turn/close 与现有 WS/vpt 会话生命周期对齐。
  2. chat 类走 `streamChat` 增量推给现有 WS/SSE 语音播放链路；首 token 延迟、断流、中止（aborted）处理到位。
  3. 灰度切换：新引擎路径与旧 visitor 直出可按开关/会话切换，保留一键回退；不破坏既有语音双工与落库。
  4. 开场：全新会话用角色基线出首论；resume 会话携带 WP2 openingContext。
- **依赖**：WP6、WP7。
- **验收**：
  - 端到端一次完整短对练：咨询师发一句 → 来访流式逐字回一句 → BDI 快照变化可在出参看到；
  - 断网/超时/中止不挂死；开关可切回旧链路；
  - 既有前端语音播放、落库不破。
- **不做**：不重写语音 ASR/TTS 网关；不做多会话并发优化（Phase2）。

## WP9 · 角色资产池 V1（5Ps 人设 + 注入）

- **目标**：把蓝图第 1/6 条落地——5Ps 角色内核落库，开场注入内核，让不同来访有稳定基线。
- **内容**：
  1. 5Ps schema（主诉/易感/诱发/维持/保护因素 + 人格沟通/阻抗基线 + 专业标签 + 版本/审核状态）落 MySQL（手写 migration，禁 synchronize）；
  2. 基于 PatientHub 抽象首批初始人设（数量本期定 3–5 个最小可用，不贪多）；
  3. openSession 注入 `characterProfile`，全新会话走 `buildInitialSnapshot` 基线，resume 不覆盖；
  4. 资产审核状态字段，未审核不进对练。
- **依赖**：WP1（characterProfile 契约已交付）；可与 WP6 并行。
- **验收**：同一角色多次开场基线一致；角色切换后阻抗/情绪基线不同；未审核资产不可用；migration 可回滚。
- **不做**：UGC 提交-审核-分成流（Phase2/§8 不做清单）；流派差异化参数（Phase2）。
- **切分（2026-10-29）**：本条目拆为两轮，先打通注入链路再接 DB，避免边建表边改装配返工。
  - **WP9-A（本轮，任务单 [`engine-wp9a-character-profile-seed-injection-backend-2026-10-29.md`](./engine-wp9a-character-profile-seed-injection-backend-2026-10-29.md)）**：适配层建 `CharacterProfileResolver` 端口 + 内置 2 个硬编码种子角色（零 DB），确定性映射成 `characterProfile` 并在 openSession 注入；无角色回退中性基线。覆盖原条目第 3 条（注入）与可复现验收。
  - **WP9-B（本轮，任务单 [`engine-wp9b-db-character-pool-backend-2026-10-29.md`](./engine-wp9b-db-character-pool-backend-2026-10-29.md)）**：5Ps schema 落 MySQL（手写 migration 禁 synchronize）、审核状态/未审核不可用、`DbCharacterProfileResolver` 实现同一端口替换 builtin、角色 CRUD/上下架。覆盖原条目第 1/2/4 条与 migration 可回滚验收。
    - **闭合 WP9-A 遗留口径（2026-10-29 审核补记）**：WP9-A 单测只用 synthetic `builtin_*` key 命中，真实握手 `vpt_*` slug 在 DB resolver 落地前仍回退中性基线——这是 A 的预期行为，不返工 A。B 验收必须覆盖**一个真实 `vpt_*` slug 经 `visitor_pool_templates` 行解析出 5Ps 基线并注入 openSession**，不能只测 builtin key；同时明确"未知/未上架 slug → 回退中性 + warn"的边界仍由 resolver 端口承担。
    - **速查卡回填（防"角色上了、前端空卡"双胞胎）**：`CharacterProfile`（引擎基线）与 `VisitorCard`（codename/ageRange/occupation/presentingComplaint/riskTags，voice 层拼 ready 帧）是两个数据源描述同一个来访者。WP9-B 的 DB resolver 在返回 `characterProfile` 的同时**必须回填速查卡展示字段**（从同一 `visitor_pool_templates`/5Ps 行带出），不能让引擎是回避型、前端速查卡却是 `voice.gateway.ts` 的默认空卡。验收：新引擎路径 ready 帧的速查卡非空，且与注入角色一致。
    - **resume 重载角色基线**：WP9-A 只在 fresh openSession 传 characterProfile。B 验收必须加一条：用角色 A 开场 → close → resume → 内核 `coreBeliefs`/基线仍是 A 的信念，不是默认中性值。若角色基线不在持久化快照里，resume 后会"来访突然变中性"——这是抽离为独立会话服务时必须保住的不变量。
  - **WP9-C（可开工，smoke test 已过，任务单 [`engine-wp9c-voice-render-token-budget-safety-boundaries-2026-10-29.md`](./engine-wp9c-voice-render-token-budget-safety-boundaries-2026-10-29.md)）**：E2E 联调照出的硬化轮。token 字段切 `max_completion_tokens`（默认 1500/env 可调）、voice render 走低 reasoningEffort、截断半句不喂 TTS、危机轮次走高思考+同步 supervision_hint、LLM 空/429 降级到本地兜底话术不发 error 帧、确认 coreBeliefs 真进 render prompt。**smoke test（2026-10-29 13:42 已过）**：`.env` 开 `ENGINE_VOICE_ENABLED=true`，探针晚晴/亦舟回复不同、无 error、TTS 帧在流；回复偏短证实 token 预算需修。按任务单 §0.1 开工话术顺序做最小修复→边界硬化→探针增强。

## WP10 · 10 个伦理盲盒强覆盖剧本资产

> 任务单：[`engine-wp10-ethical-blindbox-scripts-backend-2026-10-30.md`](./engine-wp10-ethical-blindbox-scripts-backend-2026-10-30.md)（2026-10-30 已拆，待开工）
> 内容：10 个 force_override 剧本（表白/私加微信/熟人/录音纠纷/诊断证明/自杀危机/送礼/价值观评判/性暗示/开药建议），静态 TS 不落库，建 TrajectoryScriptResolver 端口，握手 query 加 scriptId 透传到 engine.open().trajectory。

- **目标**：蓝图第 2 条——10 个核心伦理/危机盲盒用强覆盖模式落地，触发点可复现。
- **内容**：
  1. 按 WP3 `TrajectoryScript` schema（元数据/节点序列/触发条件/参考素材/状态偏移/完成与异常分支）把盲盒写成可注入资产（表白、索要私人联系方式、熟人咨询、录音纠纷、诊断证明诉求、自杀危机等，按蓝图 §5.2 收敛到 10 个）；
  2. 强覆盖模式下来访严格按剧本，反复演练触发点/表现/风险点一致；
  3. 剧本经专业口径核对（本期标注为待专业复核，不冒充临床审定）。
- **依赖**：WP3 三模式纯函数（已交付）；可与最小闭环并行。
- **验收**：同一盲盒两次演练，触发点与关键表现一致可衡量；三模式可切换；剧本校验失败在开场即拒绝。
- **不做**：UGC 剧本提交流；剧本在线编辑器（Phase2）。

## WP11 · PsyGUARD-RoBERTa 独立服务 + RiskProbePort 对接

- **目标**：蓝图第 4 条——规则层之外接中文专项风险分类，服务挂掉自动降级规则。
- **内容**：
  1. 独立 Python FastAPI 服务（与 NestJS 同仓子目录或独立子仓，按 D4）加载 PsyGUARD-RoBERTa 11 类风险，CPU 部署，单条 <50ms；
  2. NestJS 侧实现 `RiskProbePort` 适配：HTTP 调用 + 健康检查 + 超时；`assessSafety` 规则未达 block 才问探测，超时/异常静默回落规则；
  3. 规则词典补全与全半角归一（WP4 遗留）；
  4. MindGuard 临床层只留接口占位，不本地部署（D5）。
- **依赖**：WP4（RiskProbePort/assessSafety 已交付）；可并行。
- **验收**：服务正常时命中 11 类风险给类别信号；服务挂掉/超时自动回落规则且不阻断对话；高风险有审计日志。
- **不做**：MindGuard 4B/8B 自托管（后期云 API）；本 WP 不在 CPU 承诺大模型实时。

## WP12 · WP2 记忆遗留补齐 + 跨会话接续接线

> 🔴 **2026-10-30 架构审查补记**：内核纯层 100% 支持 `resumeFromSessionId` + Qdrant 按 visitorId 跨会话召回长时记忆，但 `EngineStreamBackend.openSession()` **从来没传过这个字段**——学员关掉 App 第二天再打开同一个角色，引擎完全不记得上次。这不是"记忆技术细节"，是 M3 准入清单第 6 条直接挂的产品级缺口。本 WP 必须把"新引擎路径 resume 接线"当核心目标，不只是补 Qdrant 技术细节。

- **目标**：清掉 WP2 交付时标注的缺口，让记忆 V1 真正闭环；**并把新引擎路径的跨会话接续打通**。
- **内容**：
  1. 给 `QdrantService` 补 `setPayload`（仅改向量点 payload）与按 filter 的 `scroll` 取点，实现写侧冲突标记（`resolveConflict/applyConflictResolution` 已在内核）；
  2. 短时记忆：每轮/会话结束自动生成摘要写入，会话结束晋升长时（调 `promoteShortTermToLongTerm`），接进编排层；
  3. 标定衰减半衰期（种子 30 天）与召回阈值（种子 0.1），给出初始标定口径与可调配置，不写死。
  4. **新引擎路径逐字稿落库口径**：`EngineStreamBackend.transcripts` 现是进程内 `Map`（"供督导报告用"）。WP12 要明确 close 时由谁把逐字稿快照进报告库/记忆，不能依赖内存 Map 扛进程重启——否则新路径中途重启 = 报告 no_content。单实例 Phase1 可接受，但落库边界要写死，不留模糊。
  5. **跨会话接续接线（产品核心）**：`EngineStreamBackend.openSession()` 接收 `resumeFromSessionId`（从握手 query 或上次会话 ID 传入），传给 `engine.open()`；resume 时内核搬上一场 BDI 快照 + 召回 Qdrant 长时记忆；开场首论带 `openingContext`。验收：同一角色第二次开场，来访记得上次核心议题，不是陌生人。
- **依赖**：WP2（已交付）；独立可做。
- **验收**：会话结束摘要晋升长时并可被下次 resume 召回；冲突点在 payload 标记 supersededBy；参数有配置来源与标定说明；**同一角色第二次开场，来访 BDI 快照承接上次，开场首论带 openingContext**。
- **不做**：竞争抑制遗忘精细权重（Phase2）；Chinese-MentalBERT 专用向量（Phase2 评估）。

## WP13 · 基础可观测（贯穿）

- **目标**：蓝图第 7 条——决策链留痕、基础指标、单会话可回放。
- **内容**：
  1. 每轮留痕：标准事件、迁移前后快照 delta、intention、轨迹 trace、渲染 provider/usage、安全 verdict，落可查询日志/表；
  2. 基础指标：单轮延迟、token 用量、fallback 率、安全命中分布；
  3. 单会话 BDI 状态变化回放（情绪/阻抗/移情随轮次曲线），供专业调试；
  4. 与现有 logger/（可选 OpenTelemetry 基础埋点）对齐，不引入重型监控栈。
- **依赖**：随 WP6–WP8 边做边埋点；贯穿不单独阻塞闭环。
- **验收**：取任一会话可回放完整决策链；fallback/安全命中/用量可统计；留痕不含多余敏感原文（片段截断口径同 WP4）。
- **不做**：Prometheus/Grafana 全套、万级并发指标（Phase2/§8）。

---

## Phase1 增补 · 合规与稳健性小项（低成本，随主线插入，不扩主线）

> 来源：《盲区补全与融入方案》经本仓架构裁剪后的 Phase1 硬底线/低成本项。均落在适配层/编排层，**不改内核纯算子**；Redis 原子提交+PG 异步落库全套事务、语音断点续传等终局形态本期不做。

### WP14 · 学员自身心理风险兜底（合规硬底线）

- **目标**：伦理引擎现有双侧检测覆盖"咨询师专业越界/来访输出"，缺"学员本人代入创伤、流露抑郁/自伤意念"的平台安全义务兜底。
- **内容**：
  1. 在新引擎 turn 的**学员输入侧**加独立风险分支（与咨询师越界、来访输出检测并行，互不清零），复用现有 `crisis-detector` 三级词表（high/medium/low）并补学员倾诉/创伤表达词典；
  2. 三级处置：低=打标签静默监测、会话继续；中=温和关怀提示、提升监测等级；高=**阻断实训会话**，弹危机干预热线与转介资源，记录不可删审计日志，触发人工复核；
  3. 高风险仅暂停实训、不销毁会话，用户确认后可返回但继续重点监测；检测只针对学员输入，**不影响来访仿真逻辑**。
- **依赖**：WP4 规则纯层（已交付）；可与 WP11 并行。
- **验收**：学员输入命中 high → 阻断+热线+审计落库且不可删；medium → 关怀提示不打断；low → 静默记录；误报不影响正常对练。
- **不做**：学员侧大模型风险分类（本期规则词表，PsyGUARD 只负责来访/越界）；不做实时情绪追踪模型。

### WP15 · 算子幅度声明 + 边界回归（低成本补全）

- **目标**：WP1 基线与算子叠加后已统一 `clamp01`（arousal/三维阻抗/三维移情/trust），本期只补"算子注册声明最大影响幅度"与边界回归断言，防算子叠加溢出。
- **内容**：
  1. 算子注册处声明影响方向与最大幅度（如单次 trust 增量上限），新增算子必填；
  2. 输出前统一钳位已有，补一组边界回归用例：多算子同轮叠加不越 [0,1]、幅度超限被拦截并留日志；
  3. 同方向边际递减、异常数值溢出监控告警属 Phase2，本期不做。
- **依赖**：WP1（已交付）。
- **验收**：新增算子缺幅度声明在注册/测试期失败；构造叠加用例输出全部落在 [0,1]；既有用例零回归。
- **不做**：边际递减曲线、Prometheus 溢出告警（Phase2）。

### WP16 · 轻量 round_id 幂等 + 断流不重复叠加

- **目标**：防"渲染失败/断网重试导致状态重复叠加"的半轮漂移；本期只做内存态轻量版，不上分布式事务。
- **内容**：
  1. 每轮预计算在内存完成，成功提交后再落账；同一会话同一 `round_id` 重试直接复用已提交结果，不重复执行 BDI、不重复更新状态；
  2. 流式断流/abort：本轮状态不重复叠加，用户重发改走新一轮；**语音 TTS 已播出不可撤回，本期不做断点续传**；
  3. 深度降级仅定义规则：引擎整体故障才切应急兜底，恢复后用纯规则重放补快照，Prompt 结果不反哺 BDI 状态，降级轮次不计考核；批量回溯实现放 Phase2。
- **依赖**：WP8-B（流式原生）；轻量，可随 WP8-B 收尾。
- **验收**：同一 round_id 重复请求不叠加状态；断流后重发不出现阻抗/情绪二次跳变；深度降级只留规则标记不产出可信状态。
- **不做**：Redis 原子提交+PG 异步落库三阶段事务、分布式幂等键、语音断点续传（多实例/终局形态）。

### WP17 · 新引擎路径旁路帧对齐（灰度扩量闸门）

- **为什么有这条（2026-10-29 代码审核补记）**：`EngineStreamBackend` 是"纯翻译器"——自己只吐 content/done/error 三态 chunk，**不发** `supervision_hint`/`mark` 帧、**不调**危机/伦理检测（`engine-adapters/` 下 grep `crisis|assessSafety|riskProbe` = 0 命中）。这些旁路能力目前挂在 `vpt-session-bridge`/`turn-analysis`/voice 层。WP8-B 注释写"两条链路形状完全一样"，但这只对三态 chunk 成立；旁路帧若只由旧 `VisitorService` 生命周期触发，**灰度切新路径后督导提示/移情阻抗标记/危机拦截会静默消失，对话却还在正常流式**——最难查的坏。
- **目标**：不假设"应该共享"，用端到端断言锁死新路径与旧路径的旁路行为同形，作为灰度从名单扩到全量的硬闸门。
- **内容**：
  1. 新引擎路径下，第 N 轮后前端收到至少一条 `supervision_hint` 帧（与旧路径同口径）；
  2. 新引擎路径下，移情/阻抗节点触发 `mark` 帧（direction/markType 不丢）；
  3. 新引擎路径下，学员输入命中危机话术 → 触发危机拦截/热线帧，且不被引擎流式吞掉；
  4. 确认 `vpt-session-bridge` 的每轮分析入队对新旧两条 backend 都触发（不是只在旧 VisitorService 里调）；
  5. WP13 留痕加一个 `enginePath: legacy|bdi` 字段，每场可查走的哪条链路，便于事后对比两侧差异。
- **依赖**：WP8-B（已交付）；WP11/WP14 的检测能力就绪后补危机那条断言。
- **验收**：上述 1–3 各一条绿用例（E2E/WS 录制），任意一条红则灰度不扩量、保持名单；`enginePath` 字段可在日志/报告上区分两场。
- **不做**：不重写旁路能力本身（那是 WP11/WP14）；不做双路径并行录制对比（Phase2 评估引擎）。

### WP22 · 语音对练限流与并发上限

- **为什么有这条（2026-10-30 架构审查补记）**：`@Throttle` 只在 consent 控制器上有，WS 对练接口没有任何限流/并发上限。恶意刷或 bug 循环可以直接烧 LLM 额度（MiniMax 按量付费）。
- **目标**：内测阶段最便宜的防烧钱护栏。
- **内容**：
  1. 单用户同时只能开 1 场语音会话（开第二场先关第一场，否则 409）；
  2. 全局日 token 预算告警阈值（env 可配），超限拒绝新会话并提示；
  3. 不做复杂限流系统（令牌桶/分布式），单实例 Redis 计数即可。
- **依赖**：无。
- **验收**：同用户开第二场被拒；日预算超限有日志+拒绝。
- **不做**：分布式限流、按角色分级配额（Phase2）。

### WP23 · WS 断连恢复口径明确

- **为什么有这条（2026-10-30 架构审查补记）**：`EngineStreamBackend.handles` 是进程内 Map。WS 断了重连，如果进程没重启，`endSession` 已经清了 Map，重连后要重新 openSession——重新 open 就是全新会话，BDI 状态丢失。用户网不好断一次线，这场训练的情绪/阻抗/信任全部归零重来。
- **目标**：Phase1 不做无缝续接，但要有明确口径和用户可见的提示，不要静默丢状态。
- **内容**：
  1. WS 断开超过 N 秒（env 可配，默认 30s）= 会话结束，不支持无缝重连续接 BDI 状态；
  2. 前端收到"网络中断，本场已结束"提示，不假装还在练；
  3. 不做"断线 5s 内重连续接 BDI"（那是 Phase2 多实例/会话持久化的事）。
- **依赖**：无。
- **验收**：断网 30s 后重连，前端收到会话结束提示；不出现"重连后 BDI 归零但用户不知道"。
- **不做**：会话状态持久化到 Redis/DB（Phase2）；断线无缝续接（Phase2）。

### WP24 · 单场成本日志

- **为什么有这条（2026-10-30 架构审查补记）**：WP19 留了每轮 LLM usage，但没有整场汇总。内测阶段先不做看板，日志里打每场总 token + 预估费用即可。
- **目标**：内测期能看到"这场花了多少钱"，不做看板。
- **内容**：closeSession 时打一条结构化日志：`sessionId / model / totalPromptTokens / totalCompletionTokens / estimatedCostCny`。
- **依赖**：WP19（usage 已留痕）。
- **验收**：日志里能 grep 到每场成本。
- **不做**：成本看板、告警、按用户汇总（Phase2）。

### WP18 · 会话结束→复盘报告生成链路端到端打通

- **为什么有这条（2026-10-29）**：WP9-C 探针只验证了会话内流式路径（ready→llm→tts），但会话结束后的报告闭环从未验证——新引擎路径（ENGINE_VOICE_ENABLED=true）结束会话时，transcript 落库了吗？报告生成 worker 触发了吗？六维评分/annotations/techStats 真有值还是空壳？Flutter 报告页期望的四态（pending/completed/parse_error/no_content）走得通吗？任务单：[`engine-wp18-session-report-generation-e2e-2026-10-29.md`](./engine-wp18-session-report-generation-e2e-2026-10-29.md)。
- **目标**：跑一场完整会话→结束→报告页能看到真实评分和标注，不是转圈、不是空壳、不是 parse_error。
- **内容**：①确认新引擎路径 session_finish→transcript 落库→报告 worker 触发链路是否接上；②报告接口字段与前端 `vpt_session_report.dart` 对齐（六维评分/annotations/techStats/marks/四态）；③四态边界（正常 completed/空局 no_content/生成失败 parse_error/刚结束 pending）；④探针加 `--report` 模式，轮询报告接口并断言 completed+六维非空；⑤逐字稿 turnIndex 与 marks 对齐。
- **依赖**：WP9-C（已交付）；不依赖 WP11 PsyGUARD。
- **验收**：探针 `--report` 正常会话 status=completed 且六维有值；空局 status=no_content；tsc/eslint 干净；wp8-wiring 护栏绿。
- **不做**：4 流派 feedbackBySchool（Phase2）；报告重跑端点；Flutter 前端代码改动（模型已写好，对齐后端返回即可）；改 engine-core 纯层。

### WP19 · 后端 AdminDebugModule + 每轮 BDI 快照留痕落库

- **为什么**：引擎跑通后调试是黑盒——角色说了句不对的话，看不到那轮 BDI 快照/prompt/usage。WP19 把每轮调试快照落库 + 暴露只读 API。任务单：[`engine-wp19-admin-debug-module-trace-2026-10-29.md`](./engine-wp19-admin-debug-module-trace-2026-10-29.md)。
- **内容**：①每轮 turn 结束把 BDI 快照（trust/valence/arousal/resist）、RenderSpec 摘要（prompt 截断 500 字）、LLM usage（tokens/TTFT/finishReason）落库（session 表加 JSONB，不加新表）；②`AdminDebugModule` 只读 API：`/admin/api/sessions`、`/admin/api/sessions/:id`、`/admin/api/characters`、`/admin/api/health`；③prod basic auth middleware。
- **依赖**：WP18 报告闭环（数据模型顺手对齐）。
- **验收**：跑一场会话后 DB 有 trace 记录；API 返回每轮 BDI 快照；prod 401 生效；旧链路零变化。
- **不做**：角色 CRUD；用户管理；完整 system prompt 落库；WebSocket 实时推送。

### WP20 · Vue 3 调试器 SPA（admin-dashboard）

- **为什么**：WP19 有数据没界面。WP20 做一个 Vue 3 + Vite + Tailwind SPA，深色主题，只读展示会话回放 + BDI 快照 + usage。任务单：[`engine-wp20-admin-dashboard-vue3-spa-2026-10-29.md`](./engine-wp20-admin-dashboard-vue3-spa-2026-10-29.md)。
- **内容**：①`/sessions` 会话列表；②`/sessions/:id` 会话回放（左逐字稿 + 右轮次 BDI 详情）；③`/characters` 角色池只读列表；④NestJS serve `dist/` 静态文件。
- **依赖**：WP19 API 就绪。
- **验收**：浏览器访问 `/admin/` 打开 SPA；会话列表/详情从 API 拉数据；深色主题；只读无编辑。
- **不做**：角色 CRUD；用户管理；实时大盘；告警；做进 Flutter App。

---

## Phase2+ 保留推进队列（逐步推进，非丢弃）

> 下列项来自两份设计原则，按本仓架构取舍后全部保留，**按依赖与价值排序成熟一个推一个**，不允许"进了 backlog 就冻结"。每项开工前再拆独立 spec/任务单；阶段为建议归属，可随主线完成度提前。

| 项 | 是什么 | 前置依赖 | 启动时机 | 阶段 |
|---|---|---|---|---|
| P1 人格调节算子 | 依恋/人格特质调节信任增量（安全型快、回避型慢） | WP1、WP9 角色基线 | 角色资产就位后 | Phase2 |
| 渲染四手法 | 阻抗-表达映射、口语化/非语言、表达层轻量随机、情绪粒度（§4.6），阈值为经验种子待校准 | WP7 规格组装、WP8-B 流式 | 主线闭环后做表达优化 | Phase2 |
| **表达风格渲染**（终局文档 P1） | WP10A 已预留 `speech_volume_baseline`/`narrative_style`/`expression_tone` 三列，Phase2 把它们接入 spec-assembler：话量基线控句长/轮次字数、叙事风格控 prompt 结构、语态倾向控情绪表达分寸；区分防御性沉默 vs 气质性沉默 | WP10A 字段预留、WP7 spec-assembler | Phase2 P1 | Phase2 |
| **突发中断事件剧本**（终局文档 P1） | 躯体不适临时离场、外部环境干扰、情绪崩溃停顿——作为 TrajectoryScript 的 trigger 节点，复用现有 pause/resume 机制，不新造状态机 | WP10 剧本资产、WP3 轨迹纯层 | 伦理盲盒之后扩展 | Phase2 P1 |
| **多人会谈**（终局文档 P2） | 开场多人在场/中途家属入场/沉默旁听角色——`participants[]` 数组 + 多 BDI 实例隔离记忆；初期仅平台官方制作，不开放 UGC | WP10A、WP2 记忆隔离 | Phase2 后期 | Phase2 |
| **完整语态/沟通策略体系**（终局文档 P2） | 答非所问/重复叙述/高频"不知道"/言语试探等沟通行为策略，用剧本节点 delta 实现（不进角色基线）；地域口语+TTS 口音（口音仅在 TTS 合成，文本标准中文） | WP10 剧本、WP5 渲染 | Phase2 后期 | Phase2 |
| 咨询同盟三维 | trust/safety/bond 独立建模，建立/破裂/修复算子，调节阻抗下降速率与记忆开放度 | WP1、P1 算子 | 长程接续需要时 | Phase2 |
| 跨会话间隔自然衰减 | resume 前按间隔对情绪/阻抗/信念/同盟差异化半衰期回落，破裂态阻抗反升 | WP2 记忆、resume 接线 | 跨会话接续上线时 | Phase2 |
| 评估引擎基础版 | 旁路异步消费 BDI 快照/对话/伦理标签，先做基础技术+伦理维度，复用 turn-analysis | WP8-B、WP13 留痕 | 复盘报告需要时 | Phase2 |
| **旧 visitor prompt 链路退役** | 删除 `src/agent/visitor` 旧直出链路与灰度开关，收敛为单一路径；不删则永久双份维护（改帧契约要改两遍） | WP17 旁路对齐连续绿、M2 通过 | M2 后即排，不长期挂着 | Phase1 收尾 |
| 角色注册中心（character service） | 把 `visitor_pool_templates`（图鉴/速查卡）与 `character_profiles`（引擎基线）收敛为单一角色服务：5Ps/基线/速查/版本/审核同源，引擎与前端同取；`CharacterProfileResolver` 终局换成对该服务的远程调用 | WP9-B、UGC 审核流 | 角色扩到几十个 / 开放 API 立项时 | Phase2 |
| 帮助 FAQ 分角色内容 | `/profile/help/faqs` 现返回成长向通用 FAQ；咨询师端前端已硬编码 5 条咨询师向占位（AI 对练/报告六维/数据隐私/危机兜底/AI 来访非真人）。后端需按 `currentRole` 分角色返回 FAQ，或提供 `?role=counselor_learner` 参数，内容由专业口径撰写 | 前端帮助页改造（2026-10-29） | 咨询师端正式上线前 | Phase2 |
| LLM 上游耗尽优雅降级（流式路径） | E2E 实测（2026-10-29）：MiniMax Token Plan 额度打满返 429 时，新引擎路径直接给前端 `error(http_429)` 硬错误帧，对话断在这一轮；WP7 原写"渲染失败降级稳定短句、不抛前端"未在流式/429 类错误上兜住。需补：额度/限流/上游故障时降级成稳定话术、会话不崩、留痕可观测；确认 WP6 主备在单 provider 时的行为。**已并入 WP9-C §2.4** | WP6/WP7、WP8-B 流式、WP9-C | 上线前必须（生产额度波动会直接打断学员训练） | Phase1 收尾 |
| 记忆会话级摘要压缩 | 单会结束生成摘要替代原始轮次，近原始远摘要，异步 | WP12 记忆遗留 | 长程会话变长后 | Phase2 |
| 角色版本 semver | 主版本进行中锁定/次版本平滑/修订实时，迁移重校准 | WP9、UGC 体系 | UGC 上线时 | Phase2 |
| UGC 角色运行时风控 | 风险画像（拦截频次/举报率/偏离度）+ 低预警/中限曝光/高自动下架 | UGC 审核流 | UGC 上线时 | Phase2 |
| 数据分级留存与销毁 | 审计永久/状态脱敏/原始对话/缓存分级，删除权+导出权；**年限待法务/等保确认，不写死** | 正式运营前 | 运营合规审查前 | Phase2 |
| 会话分支与状态回退 | 每轮快照、branch_id/parent_round_id，练习/督导/考核分支，考核不可回退 | B 端工作台 | B 端需求明确时 | Phase2 |
| 深度降级批量回溯 | 恢复后纯规则重放降级期间对话补快照，超 5 轮提示偏差可回退 | WP16 规则定义 | 稳定性有要求时 | Phase2 |
| P2 社会心理算子 | 权威关系/社会评价，按需启用 | P1、准入闸门 | 对应训练包立项 | Phase3 |
| 沉默/非语言/节奏 | SILENCE/INTERRUPT/TONE_SHIFT 事件、[silence] 留白，语音完善 | 语音链路、评估引擎 | 语音沉浸优化 | Phase2 基础 / Phase3 完善 |
| 记忆周期摘要全量 | 每 5 次会谈周期摘要，高重要度永久原始粒度 | 会话级摘要 | 长程成本上涨时 | Phase3 |
| 算子边际递减+溢出监控 | 同方向连续调节递减、异常数值监控告警 | WP15 幅度声明 | 算子库扩充后 | Phase3 |
| 多流派评估标尺 | CBT/精神分析/人本/家庭等可配置流派评分 | 评估引擎基础版 | 专业扩展时 | Phase3 |

---

## 复跑闸门（每个适配层 WP 交付前自跑，Windows PowerShell）

- `npx eslint "src/**/*.ts"` → 0 error；
- `npx tsc -p tsconfig.build.json --noEmit` → 0 error；
- `npx jest test/engine-adapters`（+ 受影响的 engine-core）→ 全绿，WP0–WP5 既有用例零回归；
- 内核 `src/engine-core/` 不得新增 `@nestjs/`、网络、prompt、模型名（边界断言 `test/engine-core/boundary.spec.ts` 会拦）。

## 明确不做（沿用母版 §8，属 Phase2+）

B 端督导工作台、UGC 全流程、多租户白标、开放 API、10 万级并发/多活、流派参数体系、MindGuard 自托管、专用心理向量。收到正式任务单前不提前开发。
