# 后端 AI 开工自检（先读这个文件，再开工）

> 你是 `mofang-nestjs`（NestJS）仓库的后端 AI。
> 这个文件是你的入口：**先读完，再决定做什么活、遵守什么红线、交付什么格式。**

---

## 0. 你在哪（项目一句话）

心塑 App 的后端引擎：咨询师用 Flutter 客户端跟 AI 心理咨询来访做语音对练。
- 内核纯层在 `src/engine-core/`（BDI 决策、记忆、轨迹、伦理、渲染契约）—— **纯函数、零网络、零 prompt、零 @nestjs/**
- 适配/装配层在 `src/engine-adapters/`（把纯层接成真实可用的对练：LLM 调用、WS 流式、DB 角色池、PsyGUARD 探测）
- 业务层在 `src/voice/` `src/counselor/` 等（WS 会话、语音网关、报告）

> **Phase1 已封版（2026-11-03）**：WP0–WP26 全交付，8 个 P1 + 34 个 P2 全修，1252 例测试全绿。Phase1 backlog 已归档到 `completed/phase1/phase1-backlog-archived-2026-11-03.md`。
>
> **Phase2 总览已出**：[`pending/phase2-overview-2026-11-03.md`](pending/phase2-overview-2026-11-03.md)（商业化准备）。
> **WP 清单**：[`pending/phase2-wp-list-2026-11-03.md`](pending/phase2-wp-list-2026-11-03.md)（WP27–WP68，分三批并行 + 技术债清理 + 混合式 BDI PoC 组）。具体任务单开工时再单独写。
>
> 🆕 **2026-11-05 新增 6 条 WP（WP63–WP68）**：混合式 BDI PoC 组，基于 Coze 下线趋势判断的架构方向校准。详见 [`../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../architecture/hybrid-bdi-agent-blueprint-v1.0.md)。这组 WP 全部在适配层做，engine-core 零改动。
>
> **Phase2 已开工（2026-11-03）**：
> - WP28（PsyGUARD 临时值回改正式值）✅ → [`completed/phase2/engine-wp28-psyguard-production-values-implementation-2026-11-03.md`](completed/phase2/engine-wp28-psyguard-production-values-implementation-2026-11-03.md)
> - WP34（P1 人格调节算子）✅ → [`completed/phase2/engine-wp34-personality-modulator-operators-implementation-2026-11-03.md`](completed/phase2/engine-wp34-personality-modulator-operators-implementation-2026-11-03.md)
> - WP36（跨会话间隔自然衰减）✅ → [`completed/phase2/engine-wp36-cross-session-decay-implementation-2026-11-03.md`](completed/phase2/engine-wp36-cross-session-decay-implementation-2026-11-03.md)
> - WP37（记忆会话级摘要压缩 · 滚动摘要）✅ → [`completed/phase2/engine-wp37-rolling-session-summary-implementation-2026-11-03.md`](completed/phase2/engine-wp37-rolling-session-summary-implementation-2026-11-03.md)
> - WP42（咨询同盟三维 trust/safety/bond）✅ → [`completed/phase2/engine-wp42-counseling-alliance-three-dimensions-implementation-2026-11-03.md`](completed/phase2/engine-wp42-counseling-alliance-three-dimensions-implementation-2026-11-03.md)
> - WP55（会话摘要补齐来访者侧 · 两侧纪要）✅ → [`completed/phase2/engine-wp55-rolling-summary-both-sides-implementation-2026-11-04.md`](completed/phase2/engine-wp55-rolling-summary-both-sides-implementation-2026-11-04.md)
> - WP57（BDI 信念层深度扩展 · 核心信念激活 + 短期信念置信度衰减）✅ → [`completed/phase2/engine-wp57-belief-layer-deep-expansion-implementation-2026-11-04.md`](completed/phase2/engine-wp57-belief-layer-deep-expansion-implementation-2026-11-04.md)
> - WP53（人格调节算子扩展到同盟三维 · safety / bond）✅ → [`completed/phase2/engine-wp53-personality-modulator-alliance-extension-implementation-2026-11-04.md`](completed/phase2/engine-wp53-personality-modulator-alliance-extension-implementation-2026-11-04.md)
> - WP52（剧本偏移接入同盟三维 · safety / bond）✅ → [`completed/phase2/engine-wp52-trajectory-snapshot-delta-alliance-implementation-2026-11-04.md`](completed/phase2/engine-wp52-trajectory-snapshot-delta-alliance-implementation-2026-11-04.md)
> - WP54（破裂态阻抗反升 · 跨会话衰减补完）✅ → [`completed/phase2/engine-wp54-rupture-resistance-floor-implementation-2026-11-04.md`](completed/phase2/engine-wp54-rupture-resistance-floor-implementation-2026-11-04.md)
> - WP50（渲染层接入同盟三维 · safety / bond）✅ → [`completed/phase2/engine-wp50-render-spec-alliance-three-dimensions-implementation-2026-11-04.md`](completed/phase2/engine-wp50-render-spec-alliance-three-dimensions-implementation-2026-11-04.md)
> - WP51（角色种子同盟三维基线 · safety / bond）✅ → [`completed/phase2/engine-wp51-character-seed-alliance-baseline-implementation-2026-11-04.md`](completed/phase2/engine-wp51-character-seed-alliance-baseline-implementation-2026-11-04.md)
> - WP56（长期记忆召回进渲染上下文 · 你还记得这些事）✅ → [`completed/phase2/engine-wp56-recall-into-render-context-implementation-2026-11-04.md`](completed/phase2/engine-wp56-recall-into-render-context-implementation-2026-11-04.md)
> - WP59（记忆召回策略配置端口统一 · 半衰期/阈值可配置，判定只有一份）✅ → [`completed/phase2/engine-wp59-recall-policy-config-port-implementation-2026-11-04.md`](completed/phase2/engine-wp59-recall-policy-config-port-implementation-2026-11-04.md)
> - WP61（会话摘要层次化 · 核心议题 / 关键事件 / 情绪转折点）✅ → [`completed/phase2/engine-wp61-session-summary-hierarchical-implementation-2026-11-04.md`](completed/phase2/engine-wp61-session-summary-hierarchical-implementation-2026-11-04.md)
> - WP49（角色大五人格字段落地 · 内核零改动，宜人性算子通路打通）✅ → [`completed/phase2/engine-wp49-character-five-factor-personality-implementation-2026-11-04.md`](completed/phase2/engine-wp49-character-five-factor-personality-implementation-2026-11-04.md)
> - WP35（渲染四手法 · 语气疏离度 + 情绪表现 + 轻量随机 + 非语言）✅ → [`completed/phase2/engine-wp35-rendering-four-techniques-implementation-2026-11-04.md`](completed/phase2/engine-wp35-rendering-four-techniques-implementation-2026-11-04.md)
> - WP41（表达风格渲染接入 · 话量基线 / 叙事风格 / 语态倾向）✅ → [`completed/phase2/engine-wp41-expression-style-rendering-implementation-2026-11-04.md`](completed/phase2/engine-wp41-expression-style-rendering-implementation-2026-11-04.md)
> - WP32（BDI 状态持久化 · 内存 → Redis，内核零改动）✅ → [`completed/phase2/engine-wp32-bdi-state-persistence-implementation-2026-11-05.md`](completed/phase2/engine-wp32-bdi-state-persistence-implementation-2026-11-05.md)
> - WP63（审议输出 Schema 与可解释性设计 · 维度/标签枚举 + 输出契约 + 双模式 prompt 模板，内核零改动）✅ → [`completed/phase2/engine-wp63-deliberation-schema-design-implementation-2026-11-05.md`](completed/phase2/engine-wp63-deliberation-schema-design-implementation-2026-11-05.md)
> - WP64（LLM 审议层 PoC · 影子模式，旁路观察，结果不写状态只写 Redis trace 表，内核零改动）✅ → [`completed/phase2/engine-wp64-llm-deliberation-poc-shadow-implementation-2026-11-05.md`](completed/phase2/engine-wp64-llm-deliberation-poc-shadow-implementation-2026-11-05.md)
> - WP65（审议影子模式 BullMQ 队列化 · 入队异步跑 + Worker 并发闸门，编排门面零改动，内核零改动）✅ → [`completed/phase2/engine-wp65-deliberation-shadow-queue-implementation-2026-11-05.md`](completed/phase2/engine-wp65-deliberation-shadow-queue-implementation-2026-11-05.md)
> - WP65 后半段（**per-session mutex + 快照版本号传递** · Redis SETNX 锁让同一会话同时只跑一个审议，拿不到锁就不入队；内核 `EngineTurnOutput.revision` 透传成审议入参的 `baseRevision` 记进 trace；**仍只做观察**，审议结果照旧不写 BDI 快照；engine-core **改 2 个文件**（预批准例外，纯加可选只读字段，决策与数值逐字不变））✅ → [`completed/phase2/engine-wp65-deliberation-mutex-revision-implementation-2026-11-06.md`](completed/phase2/engine-wp65-deliberation-mutex-revision-implementation-2026-11-06.md)
> - WP66（审议输出格式校验与重试 · 按错误类型分流，形状类与 429/5xx 走 BullMQ 重试，先写 trace 再抛，内核零改动）✅ → [`completed/phase2/engine-wp66-deliberation-format-retry-implementation-2026-11-05.md`](completed/phase2/engine-wp66-deliberation-format-retry-implementation-2026-11-05.md)
> - WP67（审议熔断与降级策略 · 会话级熔断器，连续失败 3 次暂停，冷却后半开探一个，内核零改动）✅ → [`completed/phase2/engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md`](completed/phase2/engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md)
> - WP68（意图锁定机制 · 基础版 · 审议输出加可选 intentionShift + 影子期旁路模拟锁定 N 轮，内核零改动）✅ → [`completed/phase2/engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md`](completed/phase2/engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md)
> - WP58（引擎调试面板 · /debug-chat 后端三接口 · 调试会话纯内存不落库，内核零改动）✅ → [`completed/phase2/engine-wp58-engine-debug-panel-implementation-2026-11-05.md`](completed/phase2/engine-wp58-engine-debug-panel-implementation-2026-11-05.md)
> - WP30（Admin Dashboard 切真 API · 角色详情 / 角色会话 / 剧本轨迹 / 本场记忆四端点 + 前端去 mock，内核零改动）✅ → [`completed/phase2/engine-wp30-admin-dashboard-real-api-implementation-2026-11-05.md`](completed/phase2/engine-wp30-admin-dashboard-real-api-implementation-2026-11-05.md)
> - WP31（成本看板切真 API · 成本趋势 / 会话成本两端点 + 前端去 mock（并修掉"汇总永远显示 0"的响应式 bug），内核零改动）✅ → [`completed/phase2/engine-wp31-cost-board-alert-implementation-2026-11-05.md`](completed/phase2/engine-wp31-cost-board-alert-implementation-2026-11-05.md)
> - Admin Dashboard 剩余页面切真 API + 调试会话持久化（**Dashboard / MemoryBrowser / PsyGuardMonitor 三页切真** + 调试会话**落 JSON 文件** + 3 轮后 LLM 自动命名，内核零改动）✅ → [`completed/phase2/engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md`](completed/phase2/engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md)
> - WP45（P3 技术债 8 条清理 · **挖出一个线上一直在犯的 Qdrant SDK 契约 bug**：WP12 的冲突消解标记从未真正落库 → 同主题矛盾记忆一起被召回；内核零改动）✅ → [`completed/phase2/engine-wp45-p3-tech-debt-8-items-implementation-2026-11-05.md`](completed/phase2/engine-wp45-p3-tech-debt-8-items-implementation-2026-11-05.md)
>
> - WP46（Sentry 通道脱敏 · **心理数据合规闭环** · **实测发现 `@sentry/node@11.10.0` 已删除 `sendDefaultPii` 且 `dataCollection.httpBodies` 默认采集入站请求体 —— 任务单前提不成立，本单是在堵正在流血的洞**；抽 `pii-redactor.ts` 唯一脱敏实现 + `beforeSend` 事件级递归脱敏 + 两层黑名单 + 两个 filter 对齐 + 修 7 处打原文日志；engine-core 零改动）✅ → [`completed/phase2/engine-wp46-sentry-redaction-implementation-2026-11-06.md`](completed/phase2/engine-wp46-sentry-redaction-implementation-2026-11-06.md)
>
> - WP48（env 守卫盲区 · **「读进 config」≠「真被消费」** · 全量扫描发现盲区比任务单预估的大 7 倍 —— 实际 **16 个**「配了不生效」的键，其中 **14 个躺在 `.env.example` 的【生效区】**；本单加 `// @unused-read` 标记 + 守卫用例⑤（标记 ↔ 预留区 ↔ 无人消费 三向一致 + **正对照断言**防「守卫永远绿」；engine-core 零改动）✅ → [`completed/phase2/engine-wp48-env-guard-blind-spot-implementation-2026-11-06.md`](completed/phase2/engine-wp48-env-guard-blind-spot-implementation-2026-11-06.md)
>
> - WP69（env 盲区扩面 + consent 路径修复 + 调试面板小改进 · **WP48 挖出的 14 个生效区盲区键清完**：6 个挪进预留区 + 7 个 `EMBEDDING_*` 死遗产删除 + `CONSENT_CURRENT_VERSION` **修路径治本**（配了真生效）；顺手修掉一个**线上静默失效**的 config 路径 bug；调试面板会话列表加 `active` 字段；**§2.5 trace eventTags 本单不做**（取真值须动内核 = 破红线，已登记后续单）；engine-core 零改动）✅ → [`completed/phase2/engine-wp69-env-blindspot-expansion-and-debug-panel-fixes-implementation-2026-11-06.md`](completed/phase2/engine-wp69-env-blindspot-expansion-and-debug-panel-fixes-implementation-2026-11-06.md)
> - WP58 后半段（事件 + delta 审计观测 · **adapter 层自观测**：每轮 turn 结束后自己跑一遍内核分类器拿 matchedTerms + aggregateTurnDelta 算 raw delta，落新表 `turn_delta_audits`；读端点 `GET /admin/api/debug/sessions/:sessionId/delta-audit`；env 开关 `TURN_DELTA_AUDIT_ENABLED` **缺省关**（关着时连分类器都不跑）；⚠️ engine-core **改 1 个文件**——仅 barrel 导出 `RuleBasedClassifier`（任务单 §三 明确授权，边界断言⑥ 白名单同步），**内核逻辑零改动**；⚠️ `TypeOrmModule.forFeature` **不在** `engine.module.ts`（会撞 WP8-A §8-9 装配层零 ORM 护栏）→ 落到独立模块 `TurnDeltaAuditModule`，同 `CharacterPoolModule` 范式；⚠️ 读端点返回体**带** `{ code: 0, data }` 外壳（本仓唯一例外，前端对接勿套到别的端点））✅ → [`completed/phase2/engine-wp58-turn-delta-audit-implementation-2026-11-06.md`](completed/phase2/engine-wp58-turn-delta-audit-implementation-2026-11-06.md)
> - WP44（成长档案体系 · **对练数据入雷达**（快评 + 督导六维 → 能力雷达 5 个子指标，**统一聚合器**让 MCQ 刷题与对练写同一行不互相覆盖）+ **总览卡片 + 趋势曲线**两个端点 · 跨层零新表零新列（信号全从既有 JSON 列现读现算）· **engine-core 零改动**；⚠️ 端点最终路径 `GET /counselor/growth/archive-overview` + `GET /counselor/growth/trend`（任务单写的 `/counselor/profile/overview` 已被"我的 Tab"占用））✅ → [`completed/phase2/engine-wp44-growth-archive-basic-implementation-2026-11-06.md`](completed/phase2/engine-wp44-growth-archive-basic-implementation-2026-11-06.md)
> - WP43（评估引擎基础版 · 规则引擎快速评分 · **会话结束立刻出分**（毫秒级、零 LLM 成本）· 技术维度 9 项 eventTags 计数 + BDI 变化 4 维首末差值 + 伦理维度（crisis 次数 / 安全评级）· 总分 技术 60% + BDI 20% + 伦理 20% · 落新表 `session_evaluations`（一场会话一份，重算覆盖）· **跨层走 voice 层 @Global 插槽**（engine ↔ counselor 不反向依赖）· 数据源是**内核出参**（不依赖留痕开关，prod 必须能跑）· **engine-core 零改动**；⚠️ 接口最终路径 `GET /counselor/training-sessions/:id/evaluation` + `GET /counselor/evaluations`（任务单写的 `/counselor/sessions/*` 与 `/counselor/users/me/*` 在本仓无范式，已按仓库惯例落地））✅ → [`completed/phase2/engine-wp43-evaluation-engine-basic-implementation-2026-11-06.md`](completed/phase2/engine-wp43-evaluation-engine-basic-implementation-2026-11-06.md)
> - WP38（角色版本 semver · **主版本进行中锁定** + 历史版本可回溯 + 会话绑定版本；**并入 WP69 登记的后续单 D**（调试 trace 接引擎事件标签 —— 内核加只读出口 `EngineTurnOutput.events`，适配层透传，调试面板拿 `eventTags` + 后端权威中文标签，覆盖内核全部 11 类）｜engine-core **改 2 个文件**（预批准例外，纯加只读观测字段，决策与数值逐字不变）；**审核后补做：调试会话恢复能力** —— 内核状态快照（BDI + 记忆 + 轨迹）每轮落进会话文件，新增 `POST /admin/api/debug/session/:id/resume`，后端重启后可从最后一轮继续聊（本单内核 **0 行**改动））✅ → [`completed/phase2/engine-wp38-character-semver-and-debug-event-tags-implementation-2026-11-06.md`](completed/phase2/engine-wp38-character-semver-and-debug-event-tags-implementation-2026-11-06.md)
>
> 进度 33/42（WP 清单与总览口径一致，WP27–WP69；2026-11-05 新增 WP63–WP68 混合式 BDI PoC 组 —— **该组 6 条已全部交付**）。
> **注**：上面那条 Admin Dashboard 四合一任务单**不是编号 WP**，不计入 42 条进度。
>
> ✅ **WP65 两半都销了**（2026-11-06 补齐后半段）：「队列化」+「per-session mutex + 快照版本号」都已落地 —— 同一会话同时只跑一个审议（Redis SETNX），审议入参带 `baseRevision` 记进 trace。**但审议结果仍不生效**（影子模式不变），切灰度还要补"过期判定与丢弃"+"约束校验层"。
>
> ⚠️ **WP67 只销了「熔断器」那一半**：母版三档里的「超时跳过」与「切回规则算子」在影子模式下**天然成立**（审议结果从不生效）；**`degraded: true` 会话打标仍未做**。
>
> ⚠️ **WP68 只销了「基础版」**：母版里的**触发事件白名单**（提前解锁）**未做** —— PoC 阶段不做（NLP 级判断）。
>
> ⚠️ **WP58 只销了「后端三接口」那一半**：母版里的**"触发了什么事件"**与 **delta cap 砍幅报告**仍未做（内核不对外逐轮明细）。**前端接线已由前端 AI 补上**（`views/DebugChat.vue` + `views/debug/SessionList.vue`，随 WP31 提交 `8b9fa6f` 一起入库，已无 TODO / mock 残留）；但那份接线有 **5 处 vue-tsc 类型报错**未清（`sessionId` / `messages` 当普通变量、`beliefActivation` 空值、`RenderSpecSummary` 缺 `promptFull`）—— **不是本单的锅**，要清归前端。
>
> ⚠️ **2026-11-05 更新（Admin Dashboard 四合一任务单）**：调试会话已**由纯内存改成落 JSON 文件**（`data/debug-sessions/{id}.json`，每轮追加写 → 崩溃不丢数据，按创建时间保留最近 50 个，第 3 轮后 LLM 自动命名并支持人工改名不被覆盖）。WP58 原话"纯内存不落库"已扩为**"落文件不落库"**（仍**不写** `training_sessions` / `turn_debug_trace`）—— 这是纪律的**扩展**不是推翻，见交付记录偏差表 B1。
>
> ⚠️ **WP30 只销了「两个页面切真 API」那一半**：`CharacterDetail` + `SessionDetail` 已切真（后端补 4 个 `/admin/api/*` 端点 + 前端去 mock 标识）。**其余页面的 mock 已全部销掉** —— `CostBoard` 由 WP31 销，`Dashboard` / `MemoryBrowser` / `PsyGuardMonitor` 由 2026-11-05 四合一任务单销；**现在 Dashboard 的 6 个页面全是真数据**。但仍有三处"接的是真数据、值不一定有"：① **本场记忆恒空**（`training_sessions` 无 memories 列）；② **剧本轨迹只对新会话有效**（留痕契约本轮才补 `trajectoryTrace`，老会话返 `null`）；③ **token / 轮次 / 成本受留痕开关约束**（生产缺省关留痕 → 恒 0，场次数仍准确）。
>
> ⚠️ **2026-11-05 四合一任务单仍有 5 个缺口**（真没做，别当已完成）：G1 **PsyGUARD 真指标未采集**（延迟 / 请求数 / 类别计数 → 面板显示"指标未采集"而非假数）/ G2 **工作与短时记忆列不出**（内核 `MemoryStore` 端口无 list-all，engine-core 红线不可破 → 只列长时）/ G3 **调试会话不含"本场记忆"**（引擎召回结果没进留痕契约）/ G4 **调试会话标题不参与检索**（会话多了只能肉眼找）/ G5 **删除历史无后端审计**。逐条见交付记录 §七。
>
> ⚠️ **WP31 只销了「看板」那一半**：成本看板已切真，但**超阈值告警规则仍未做**（阈值配置 / 告警通道 / 通知策略）。**成本数据来自引擎调试留痕，生产缺省关留痕 → 生产的 token / 成本恒 0**（场次数仍准确）；要让生产看板有数，得给 `training_sessions.tech_stats` 补 token 统计（缺口 G1）。
>
> ⚠️ **WP48 只销了「守卫」那一半** —— 但 **WP69 已把 WP48 挖出的 14 个生效区盲区键清完了**：6 个挪进预留区（`SMS_*` 5 + `METRICS_PATH`）+ 7 个 `EMBEDDING_*` 死遗产直接删 + `CONSENT_CURRENT_VERSION` **修路径治本**（它不再被挪进预留区 —— 修好后**真的有人消费**了）。另 `CONSENT_CURRENT_VERSION` 那个**路径错误型** bug（`consent.service.ts:41` 读平铺 `consentCurrentVersion`，正确路径 `consent.currentVersion`）**已在 WP69 修好** —— 配 `v2.0` 现在真会强制客户端重弹同意 dialog。

---

## 1. 当前有什么活（自己扫目录）

**第一步：`ls pending/` 看里面有几个 .md 文件。**

- 有文件 = 每个文件就是一个完整任务，从文件名排第一的开始做
- 没有文件 = 没有新活，不要自己找事做，等用户派新任务单

每个任务单文件里写了完整的：目标、改动点、验收标准、不做什么。**读全文再开工。**

---

## 2. 红线与交付格式

> 完整规范在 [`../team/conventions.md`](../team/conventions.md)，这里只列最关键的三条：

1. **engine-core 纯层边界**（分阶段，详见 [`../team/conventions.md`](../team/conventions.md) §1.1）—— PoC 影子期默认 `git diff --stat HEAD -- src/engine-core` 为空；永久红线是"零 NestJS / 零网络 / 零 prompt"，`boundary.spec.ts` 11 条断言永远要过
2. **不写前端代码**（不碰 admin-dashboard / Flutter）
3. **不跑前端命令**（flutter / dart / pub 一律不跑）

交付格式详见 [`../team/conventions.md`](../team/conventions.md) §二。

---

## 3. 已交付速查（避免重复做）

**Phase1 全部交付在 `completed/phase1/` 下，共 26 个 WP + 2 轮封版审查。** 需要参考 Phase1 的某个设计决策时，直接翻对应目录的交付记录：

| 你要查什么 | 去哪找 |
|---|---|
| 引擎核心逻辑（BDI / 记忆 / 轨迹 / 伦理） | `completed/phase1/wp0-wp5-core/` |
| LLM 渲染 / WS 流式 / 角色池 / PsyGUARD / resume 接线 | `completed/phase1/wp6-wp12-wiring/` |
| 风险处置 / delta cap / 幂等 / 报告 / 限流 / 重连 / P2 全修 | `completed/phase1/wp14-wp24-augment/` |
| 认证密码 | `completed/phase1/auth-and-password/` |
| 早期杂项（历史列表 / 来访者池） | `completed/phase1/early-misc/` |
| Phase1 整体状态 / WP 清单 / 依赖关系 | `completed/phase1/phase1-backlog-archived-2026-11-03.md` |
| 封版审查发现了哪些问题、怎么修的 | `audits/wp25-phase1-audit-report-2026-11-03.md` |

**什么时候该翻 Phase1 文档：**
- 任务单里提到某个 WP 的编号（如"WP15 的 cap 逻辑要扩展"）→ 翻对应目录的交付记录
- 拿不准某个设计决策的原因 → 翻对应交付记录的 §4「关键设计决策」
- 改 engine-core 前 → 先翻 `completed/phase1/wp0-wp5-core/` 确认边界
- 改 WS 协议前 → 翻 `wp23` 交付记录（断连重连追平逻辑）

**Phase1 关键红线（已由机器断言守住）：**
- `src/engine-core/**` 零 `process.env`、零 `globalThis`、零 NestJS（`boundary.spec.ts` 11 条断言）
- delta cap 参数走注入（`DeltaCapConfig` 端口），不由内核读 env
- 轨迹 delta 也走 cap（本轮总 delta = 事件 + 剧本，统一过一次）
- WS 握手 JWT 走 `handshake.auth.token`（Socket.IO 标准），不走 URL query

---

## 4. 目录结构

```
docs/worklog/
├── README.md          ← 你现在读的这个文件
├── pending/          ← 待开工任务单（Phase2 的总览与 WP 清单常驻这里）
├── completed/         ← 已交付（按阶段分）
│   ├── phase1/       ← Phase1 全部交付（26 WP + 2 轮审查）
│   │   ├── wp0-wp5-core/
│   │   ├── wp6-wp12-wiring/
│   │   ├── wp14-wp24-augment/
│   │   ├── auth-and-password/
│   │   ├── early-misc/
│   │   └── phase1-backlog-archived-2026-11-03.md
│   └── phase2/       ← Phase2 交付（WP28 ✅ PsyGUARD 正式值 / WP32 ✅ BDI 状态持久化（内存 → Redis，内核零改动）/ WP34 ✅ P1 人格调节算子 / WP35 ✅ 渲染四手法（语气疏离度 / 情绪表现 / 轻量随机 / 非语言）/ WP36 ✅ 跨会话间隔自然衰减 / WP37 ✅ 记忆会话级摘要压缩（滚动摘要）/ WP41 ✅ 表达风格渲染接入（话量基线 / 叙事风格 / 语态倾向）/ WP42 ✅ 咨询同盟三维 / WP49 ✅ 角色大五人格字段落地（内核零改动，宜人性算子通路打通）/ WP50 ✅ 渲染层接入同盟三维（safety/bond）/ WP51 ✅ 角色种子同盟三维基线（safety/bond）/ WP52 ✅ 剧本偏移接入同盟三维（safety/bond）/ WP53 ✅ 人格调节算子扩展到同盟三维（safety/bond）/ WP54 ✅ 破裂态阻抗反升（跨会话衰减补完）/ WP55 ✅ 会话摘要补齐来访者侧（两侧纪要）/ WP56 ✅ 长期记忆召回进渲染上下文 / WP57 ✅ BDI 信念层深度扩展（核心信念激活 + 短期信念置信度衰减）/ WP58 ✅ 引擎调试面板（/debug-chat 后端三接口：调试会话**落 JSON 文件**（仍不写正式表），每轮返回 BDI 快照 / delta / 意图 / 渲染规格 / prompt 全文 / 审议 trace）/ WP59 ✅ 记忆召回策略配置端口统一（半衰期/阈值可配置，判定只有一份）/ WP61 ✅ 会话摘要层次化（核心议题 / 关键事件 / 情绪转折点）/ WP30 ✅ Admin Dashboard 切真 API（角色详情 / 角色会话 / 剧本轨迹 / 本场记忆四端点 + 前端两页去 mock）/ WP31 ✅ 成本看板切真 API（成本趋势 / 会话成本两端点 + 前端去 mock；**仅看板那一半**，超阈值告警仍待补）/ WP63 ✅ 审议输出 Schema 与可解释性设计（维度/标签枚举 + 输出契约 + 双模式 prompt 模板）/ WP64 ✅ LLM 审议层 PoC（影子模式 · 旁路观察，结果只写 Redis trace 表，不写状态）/ WP65 ✅ 审议影子模式 BullMQ 队列化（入队异步跑 + Worker 并发闸门）+ 后半段 ✅ per-session mutex（Redis SETNX 锁）与快照版本号传递（`EngineTurnOutput.revision` → 审议入参 `baseRevision` → trace；**两半都销了**，审议结果仍不生效）/ WP66 ✅ 审议输出格式校验与重试（按错误类型分流 + 先写 trace 再抛）/ WP67 ✅ 审议熔断与降级策略（会话级熔断器：连续失败 3 次暂停，冷却后半开探一个；**仅熔断器那一半**，`degraded` 会话打标仍待补）/ WP68 ✅ 意图锁定机制（基础版：审议输出加可选 `intentionShift` + 影子期旁路模拟锁定 N 轮；**仅基础版**，触发事件白名单仍待补）/ 2026-11-05 四合一任务单 ✅ Admin Dashboard 剩余页面切真 API + 调试会话持久化（Dashboard / MemoryBrowser / PsyGuardMonitor 三页切真 + 调试会话落 JSON 文件 + 3 轮后 LLM 自动命名，内核零改动）/ WP45 ✅ P3 技术债 8 条清理（**挖出一个线上一直在犯的 Qdrant SDK 契约 bug**：WP12 的冲突消解标记从未真正落库 → 同主题矛盾记忆一起被召回；内核零改动））
├── audits/           ← 审查报告（WP25 等）
└── archive/          ← 老文档
```

---

## 5. 参考资料（按需查，不要一上来全读）

**不要开工前把这些全读了——context 会爆。** 遇到口径歧义、拿不准边界时，再翻对应文档。

| 文档 | 什么时候读 |
|---|---|
| `docs/architecture/engine-endstate-blueprint-v1.0.md` | 拿不准方向对不对、想知道最终要做成什么样时——北极星参考，不是任务单 |
| `docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md` | 做 WP63–WP68 混合式 BDI PoC 前必读——方向校准、12 个边界问题、三层分离架构 |
| `docs/architecture/ai-engine-roadmap-v1.1.md` | 任务单里没写清楚"为什么这么做"、或者你拿不准某个设计决策的上游依据时 |
| `docs/reference/ai-simulation-blueprint-v1.1.md` | 蓝图原始愿景，roadmap 冲突时以 roadmap 为准 |
| `docs/reference/bdi-cognitive-engine-principles-v1.0.md` | 改 BDI 算子/记忆/轨迹相关逻辑时，确认设计原则 |
| `docs/reference/architecture-blindspot-fill-v1.0.md` | 改伦理/安全/兜底相关逻辑时，确认盲区补全口径 |
| `docs/architecture/microservices-evolution-plan.md` | 写新功能前看一眼 §2 的 5 条边界规则——现在不拆微服务，但代码要保持将来好拆 |

**原则：README + 当前任务单 = 99% 够用。** 上面这些是"字典"，遇到生字才翻。

---

## 6. 开工前自检清单

```
□ 我读完了 pending/ 里的任务单全文
□ 我确认 engine-core 一行不动（或任务单有明确例外批准）
□ 我知道交付记录要写什么格式（见 team/conventions.md）
□ 我知道交付后要移文件
```
全勾了再动手。
