# Phase1 装配集成轮 Backlog（WP6+）

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md)
> 愿景备查: [`../reference/ai-simulation-blueprint-v1.1.md`](../reference/ai-simulation-blueprint-v1.1.md)（冲突以母版为准；蓝图选 pgvector，本仓 D2 拍板 Qdrant）
> 日期: 2026-10-28 ｜ 状态: 🟡 **内核纯层 WP0–WP5 已交付，端到端装配未开始**
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

## WP10 · 10 个伦理盲盒强覆盖剧本资产

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

## WP12 · WP2 记忆遗留补齐

- **目标**：清掉 WP2 交付时标注的三项缺口，让记忆 V1 真正闭环。
- **内容**：
  1. 给 `QdrantService` 补 `setPayload`（仅改向量点 payload）与按 filter 的 `scroll` 取点，实现写侧冲突标记（`resolveConflict/applyConflictResolution` 已在内核）；
  2. 短时记忆：每轮/会话结束自动生成摘要写入，会话结束晋升长时（调 `promoteShortTermToLongTerm`），接进编排层；
  3. 标定衰减半衰期（种子 30 天）与召回阈值（种子 0.1），给出初始标定口径与可调配置，不写死。
- **依赖**：WP2（已交付）；独立可做。
- **验收**：会话结束摘要晋升长时并可被下次 resume 召回；冲突点在 payload 标记 supersededBy；参数有配置来源与标定说明。
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

## 复跑闸门（每个适配层 WP 交付前自跑，Windows PowerShell）

- `npx eslint "src/**/*.ts"` → 0 error；
- `npx tsc -p tsconfig.build.json --noEmit` → 0 error；
- `npx jest test/engine-adapters`（+ 受影响的 engine-core）→ 全绿，WP0–WP5 既有用例零回归；
- 内核 `src/engine-core/` 不得新增 `@nestjs/`、网络、prompt、模型名（边界断言 `test/engine-core/boundary.spec.ts` 会拦）。

## 明确不做（沿用母版 §8，属 Phase2+）

B 端督导工作台、UGC 全流程、多租户白标、开放 API、10 万级并发/多活、流派参数体系、MindGuard 自托管、专用心理向量。收到正式任务单前不提前开发。
