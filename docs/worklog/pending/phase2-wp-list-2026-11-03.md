# Phase2 工作包清单（WP27–WP62）

> **路径**：`docs/worklog/pending/phase2-wp-list-2026-11-03.md`
> **配套**：[`phase2-overview-2026-11-03.md`](phase2-overview-2026-11-03.md)（总览文档，含依赖关系与验收标准）
> **北极星**：[`docs/architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md)（引擎终局形态白皮书 —— 我们最终要做成什么样）
> **编号规则**：接 Phase1 WP26 之后，从 WP27 开始

---

## 第一批（并行开工，互不依赖）

| WP | 名称 | 优先级 | 一句话描述 | 预估 | 状态 |
|---|---|---|---|---|---|
| **WP27** | billing 接真支付 | 🔴 P0 | 微信支付 V2 + 支付宝当面付接入，订单落库，回调验签，替换现有内存 mock | 中 | 📋 |
| **WP28** ✅ | WP11 回改正式值 | 🔴 P0 | PsyGUARD 超时 500ms→150ms、token 窗口 256→28，内测前改回生产值 | 小 | ✅ [交付记录](../completed/phase2/engine-wp28-psyguard-production-values-implementation-2026-11-03.md) |
| **WP29** | 数据分级留存与销毁 | 🔴 P0 | 用户删除权（对话+记忆+账号）、导出权、数据分级策略落地 | 中 | 📋 |
| **WP30** ✅ | Admin Dashboard 切真 API | 🔴 P0 | CharacterDetail + SessionDetail 接 `/admin/api/*` 真数据，去掉 mock 标识 | 中 | ✅ [交付记录](../completed/phase2/engine-wp30-admin-dashboard-real-api-implementation-2026-11-05.md) |
| **WP31** ✅ | 成本看板与告警 | 🔴 P0 | 成本看板展示 token 消耗/用户/会话，超阈值告警规则接入 | 小 | ✅ [交付记录](../completed/phase2/engine-wp31-cost-board-alert-implementation-2026-11-05.md) |
| **WP32** ✅ | BDI 状态持久化 | 🟡 P1 | 内存态 → Redis/DB，进程重启后可恢复 BDI 快照 | 中 | ✅ [交付记录](../completed/phase2/engine-wp32-bdi-state-persistence-implementation-2026-11-05.md) |

---

## 第二批（第一批完成后，并行）

| WP | 名称 | 优先级 | 一句话描述 | 依赖 |
|---|---|---|---|---|
| **WP33** | 会员分层 TTS | 🔴 P0 | tier→model 可扩展配置表（env 或 DB），会话启动时查一次 tier 并缓存 | WP27 |
| **WP34** ✅ | P1 人格调节算子 | 🟡 P1 | 依恋调节 + 人格特质调节信任增量，安全型快、回避型慢（[交付记录](../completed/phase2/engine-wp34-personality-modulator-operators-implementation-2026-11-03.md)） | WP1 |
| **WP35** ✅ | 渲染四手法 | 🟡 P1 | 阻抗-表达映射、口语化/非语言、表达层轻量随机、情绪粒度细化；话量三档判定口径未改，语气疏离度依赖同盟维度（缺省不渲染）（[交付记录](../completed/phase2/engine-wp35-rendering-four-techniques-implementation-2026-11-04.md)） | WP7 |
| **WP36** ✅ | 跨会话间隔自然衰减 | 🟡 P1 | resume 前按间隔对**情绪 / 阻抗 / 同盟**做差异化半衰期回落（信念 / 欲望 / 移情不衰减）；⚠️「破裂态阻抗反升」本期**未做** —— 缺破裂态阈值定义（不发明临床数字），待后续校准轮（[交付记录](../completed/phase2/engine-wp36-cross-session-decay-implementation-2026-11-03.md)） | WP12 |
| **WP37** ✅ | 记忆会话级摘要压缩 | 🟡 P1 | 工作窗口（最近 8 轮）挤出旧轮次时**攒批异步压成滚动摘要**，存 SHORT_TERM/SUMMARY 记忆并进渲染上下文；会话结束的最终摘要走 WP12 既有的收尾路径（不重复实现）（[交付记录](../completed/phase2/engine-wp37-rolling-session-summary-implementation-2026-11-03.md)） | WP2 |
| **WP38** ✅ | 角色版本 semver | 🟡 P1 | 主版本进行中锁定 / 次版本平滑 / 修订实时，历史版本可回溯。⚠️ 实际落地：`character_profiles` 加 `version_major/minor/patch` 三列（默认 1/0/0）+ **新表 `character_profile_versions`**（每次改版留一份完整快照，可回溯）+ `training_sessions` 加 `character_template_id` / `character_version` 两列（会话创建时绑定当时的版本）；管理端 `PATCH` 新增 `versionBump`（major/minor/patch，缺省 patch），**有活跃会话时改 major 返回 409**（新增 `BizCode.CharacterVersionLocked`，仓库原本没有 Conflict 码）；历史回溯 2 个端点（列表 + 单版快照）；跨层走 **voice 层 @Global 插槽**（engine ↔ counselor 反向依赖禁令，同 `StudentRiskAuditRegistry` 范式）。⚠️ 任务单 §3.1 假设的 `training_sessions.character_template_id` **当时并不存在** —— 本单补齐（否则锁定无从判定）；⚠️ §1.1 的「旧会话突然变味」在现架构下**不成立**（resolver 只在 openSession 解析一次）→ 锁定属**防御性**；⚠️ 回溯只做**读取**，未做「一键回滚写回」；**审核后补做：调试会话恢复能力**（内核状态快照每轮落进会话文件 + `POST /admin/api/debug/session/:id/resume`，后端重启后从最后一轮继续；engine-core 零改动，见交付记录 §九）（[交付记录](../completed/phase2/engine-wp38-character-semver-and-debug-event-tags-implementation-2026-11-06.md)） | WP9 |

---

## 第三批（第二批完成后，并行）

| WP | 名称 | 优先级 | 一句话描述 | 依赖 |
|---|---|---|---|---|
| **WP39** | TTS emotion 映射 | 🔴 P0 | BDI valence/arousal → voice_setting.emotion 映射表，真机听感校准 | WP33 |
| **WP40** | TTS 内联语气词标签 | 🔴 P0 | prompt 注入 `(sighs)` `(pant)` `(breath)` 等标签，TTS 真发声 | WP33 |
| **WP41** ✅ | 表达风格渲染接入 | 🟡 P1 | WP10A 预留 3 列（话量基线/叙事风格/语态倾向）接入 spec-assembler。⚠️ 实际落地：内核 `CharacterProfile` + `RenderSpec` 各加 3 个**可选**字段（**恰好 2 个内核文件**，预批准内；两个联合类型**不进 barrel**，适配层用**派生**避开边界断言 ⑥ 的白名单）+ 适配层 **7 个**文件接上（DB 行 → 种子 → 角色基线 → 会话归属 → 规格 → prompt）+ **话量基线修正**（判据未改，只把"话量阻抗"按基线平移档位阶梯；中位 0.5 = 修正量 0）+ 叙事/语态**单独成块**渲染「你说话一贯的样子」；⚠️ **生产 DB 角色每轮多 2 行**（三列是 NOT NULL DEFAULT，当前跑的是未标定默认档 'mixed'/'restrained' —— 话量基线默认 0.5 无副作用）（[交付记录](../completed/phase2/engine-wp41-expression-style-rendering-implementation-2026-11-04.md)） | WP35 |
| **WP42** ✅ | 咨询同盟三维 | 🟡 P1 | trust/safety/bond 独立建模，建立/破裂/修复算子，调节阻抗下降速率（[交付记录](../completed/phase2/engine-wp42-counseling-alliance-three-dimensions-implementation-2026-11-03.md)） | WP34 |
| **WP43** ✅ | 评估引擎基础版 | 🟡 P1 | 规则引擎快速评分（毫秒级、零 LLM）：技术维度 9 项 eventTags 计数 + BDI 变化 4 维首末差值 + 伦理维度（crisis 次数 / safe·warning·danger 评级），总分 技术 60% + BDI 20% + 伦理 20%；落新表 `session_evaluations`（一场会话一份，重算覆盖）；**跨层走 voice 层 @Global 插槽**（engine ↔ counselor 不反向依赖）；数据源=**内核出参**（不依赖留痕开关）；⚠️ 最终路径 `GET /counselor/training-sessions/:id/evaluation` + `GET /counselor/evaluations`（任务单写的两条路径本仓无范式）；**engine-core 零改动**（[交付记录](../completed/phase2/engine-wp43-evaluation-engine-basic-implementation-2026-11-06.md)） | WP8-B |
| **WP44** ✅ | 成长档案体系 | 🟡 P1 | 对练数据入雷达 + 总览接口：写入侧把 WP43 快评 + supervision_reports 督导六维映射到 ability_scores 的 5 个子指标（共情精准度 / 倾听准确率 / 提问开放度 / 边界意识 / 伦理规范掌握度），**统一聚合器**（刷题 attempt 信号 + 快评 + 督导三来源合并取均值）让 MCQ 刷题与对练写同一行不互相覆盖；读取侧 `GET /counselor/growth/archive-overview`（总览卡片）+ `GET /counselor/growth/trend`（按天趋势）；零新表零新列；**engine-core 零改动**（[交付记录](../completed/phase2/engine-wp44-growth-archive-basic-implementation-2026-11-06.md)） | WP43 |

---

## 技术债清理（随时穿插，不排批次）

| WP | 名称 | 优先级 | 一句话描述 |
|---|---|---|---|
| **WP45** ✅ | P3 技术债 8 条 | 🟢 P2 | Qdrant `client: any`、`TemplateParameter = any[]`、死配置、cancelled 状态只写不读、状态衰减/边际递减/饱和、Prometheus 告警规则、QdrantMemoryStore 默认值耦合。⚠️ **实际落地**：8 条**逐条核实**（不是照单全收）—— ① `client: any` 换真 SDK 类型 + **挖出一个线上一直在犯的 bug**（`setPayload` 按 v0.x 三参形状调，真 SDK v1.19 是两参 → **WP12 的冲突消解标记从未真正落库** → 同主题新旧矛盾记忆一起被召回；已修 + 新增打到 HTTP 层的契约回归测试 4 例）；② `TemplateParameter` 收窄成 `unknown[]`；③ `cancelled` **只写不读属实但"删掉"会坏打断语义**（删了状态停在 `processing` → 下次 `user_speaking` 重复打断）→ **保留 + 补注释**；④ Prometheus **指标早就有**，真问题是规则三类缺陷（3 条引用未部署的 exporter 指标 → 永不触发；4 处模板语法错；3 处 rate/count 口径错）→ 已修；⑤ 死配置**已被 WP28 处理完**，本单全量扫描无新发现；⑥ 衰减/饱和**早已做**（WP36+WP54 / clamp01），**边际递减真没做但属临床建模决策** → 登记建议另开单；⑦ 衰减/召回配置**早已 env 化**，真耦合只有"实现内部选实现" → `fallback` 改必填；⑧ 另修 P3-9（boundary 断言⑦ 补双向）；P3-10 早已修、P3-7 需内核批准 → 登记建议。**engine-core 零改动**（[交付记录](../completed/phase2/engine-wp45-p3-tech-debt-8-items-implementation-2026-11-05.md)） |
| **WP46** ✅ | Sentry 通道脱敏 | 🟢 P2 | 本地日志已脱敏，Sentry 还是原样上报，补一层脱敏中间件。⚠️ 实际落地：**任务单 §一 的前提在实测 SDK 版本上不成立** —— `@sentry/node@11.10.0` **已删除 `sendDefaultPii` 选项**，且 `dataCollection.httpBodies` **默认采集入站请求体**（原始 body 字符串进 `event.request.data`）→ 这不是"防御性加固"，是**在堵正在流血的洞**（每次 5xx 都把日记正文/危机备注/对话原文送进 Sentry）。落法：**两道防线** —— ① 源头 `dataCollection` 严格档（`httpBodies: []` / `cookies: false` / `userInfo: false` / `stackFrameVariables: false` / `databaseQueryData: false` / `genAI` / `graphQL` 全关）；② 兜底 `beforeSend` 事件级递归脱敏（`request.data` / `query_string` / `url` / `headers` / `user` / `extra` / `breadcrumbs` / `exception` 全覆盖）。另：脱敏逻辑从 `biz-exception.filter.ts` 私有副本抽成 **`pii-redactor.ts` 唯一实现**（本地日志与 Sentry 共用，反双胞胎）；两个 ExceptionFilter 的 extra 换脱敏口径；顺手修 **7 处**打原文日志（含 TTS 另 2 处 `slice(0, 120)`）；单测 49 例 + **e2e 出血测试 5 例**（真起 Nest + 真跑 SDK，故意把采集口径改宽验证心理原文仍出不去）；**engine-core 零改动**（[交付记录](../completed/phase2/engine-wp46-sentry-redaction-implementation-2026-11-06.md)） |
| **WP47** ✅ | supervisor 督导报告切真 DB | 🟢 P2 | V0.x 内存 mock → TypeORM 落库。⚠️ 实际落地（2026-10-26 完成，清单回写补登）：仓储从 `SupervisionReportRepositoryMemory` 切到 `SupervisionReportRepositoryTypeorm`；内存实现保留给单测用；手写 migration 建表（16 列 + 3 索引，UNIQUE (tenant_id, session_id) 守住"一场一份报告"不变量）；BullMQ 重试不再堆多份报告。**engine-core 零改动** |
| **WP48** ✅ | env 守卫盲区：分不出「读进 config」与「真被消费」 | 🟢 P2 | `wp25-env-example-coverage.spec.ts` 的 AST 只知道「代码里读没读这个键」，**分不出读进 config 命名空间与真被消费** —— 这类键能一路绿灯过断言①。已在 `.env.example` 底部「预留键（读得到但未消费）」区出现两个实例（`QDRANT_COLLECTION` / `VOICE_SESSION_IDLE_TIMEOUT_MS`）。修法：让守卫顺着 `process.env.X` → `config.get('命名空间.x')` 追一层消费点，把「读得到但无人消费」单列成一类（与「未接线」区分），并守住新区语义。⚠️ **实际落地**：① `default.ts` 给「读了但没人消费」的字段加 `// @unused-read` 标记；② 守卫加**用例⑤**（AST `getLeadingCommentRanges` 扫标记 → 断言该 env 键**在 `.env.example` 预留区** + **确实无人消费** + **预留区 ↔ 标记双向不漂移** + **正对照断言**（拿仓库里确实有人消费的字段当对照）—— 防「守卫永远绿」）；③ `.env.example` 预留区那段过期说明换成守卫注释。🔴 **核心发现：盲区比任务单预估的大 7 倍** —— 全量扫 `default.ts` 101 处 env 读取后确认盲区实际有 **16 个**键（不是 2 个），其中 **14 个躺在 `.env.example` 的【生效区】**（`SMS_*` 5 / `EMBEDDING_*` 7 / `METRICS_PATH` / `CONSENT_CURRENT_VERSION`）→ 运维照抄模板就会配上，配了不生效。⚠️ **本单只销「守卫」那一半**：14 个键按任务单 §五.3 **没挪进预留区**（挪 = 改部署契约 = 产品决策），`CONSENT_CURRENT_VERSION` 的**路径错误型** bug（`consent.service.ts:41` 读平铺 `consentCurrentVersion`，正确路径 `consent.currentVersion`）同样按范围留给后续单 —— **后续单 A 做完后用例⑤ 会自动覆盖这 14 个键，守卫不用改**；**engine-core 零改动**（[交付记录](../completed/phase2/engine-wp48-env-guard-blind-spot-implementation-2026-11-06.md)） |
| **WP49** ✅ | 角色大五人格字段落地 | 🟢 P2 | WP34 已交付人格调节算子，但**大五人格没有数据源** —— DB 的 `character_profiles.five_ps` 是临床 5Ps（易感/维持/诱发/保护/持续），与大五人格不是一回事 → 宜人性调节在生产上休眠（契约与端口已就位，规则永不触发）。另一项：依恋类型 → 基线阻抗的缺省映射缺统一规则（角色种子已按档位给基线，但缺通用取值口径）。~~附带的 `.env.example` 18 个 `ENGINE_CAP_*` 数值清理（改留空继承内核种子）已于 2026-11-03 完成~~ ⚠️ 实际落地：**内核零改动**（`PersonalityTraits` 类型早就有，本期只补数据）—— 适配层 3 文件接上（`BuiltinCharacterSeed` 加 `personalityTraits?` + 两个内置种子按依恋风格给 OCEAN 五维值 + `buildCharacterProfile` **条件展开**传递；entity 加 `personality_traits` 列；`toCharacterSeed` 读该列）+ 手写 migration 加**一列 `personality_traits JSON NULL`（无 DEFAULT**）;⚠️ DB 列是 **NULL 不是 DEFAULT** —— "没表态"与"正好 0.5"必须在数据源上分得开（与 WP51 的 `baseline_safety` / `baseline_bond` 口径**相反**）；⚠️ **留档**：任务单指定的宜人性值（回避型 0.45 / 焦虑型 0.6）都 **低于** WP34 默认阈值 0.7 → 算子**通路已通**（值不再是 undefined）但 **×1.1 增益当前不触发**，属待校准项（测试里注入阈值验证通路 + 显式断言"当前不触发"）（[交付记录](../completed/phase2/engine-wp49-character-five-factor-personality-implementation-2026-11-04.md)） |
| **WP50** ✅ | 渲染层接入同盟三维 | 🟡 P1 | WP42 已交付 trust/safety/bond 独立建模，但**渲染层（RenderSpec / prompt 组装）仍只看 trust** —— safety 低时 AI 措辞应该更谨慎、更简短，但现在没接。要把 safety/bond 接入 spec-assembler，让渲染层能根据三维状态调整措辞策略。⚠️ 实际落地：内核 `RenderSpec` 加 `safety?` / `bond?` 两个**可选**字段（缺省 = 不传 = 行为与 WP5 逐字一致）+ 适配层 `spec-assembler` **无条件**传 `snapshot.safety` / `snapshot.bond`（`BdiSnapshot` 三维必填，生产一定带）+ `buildVisitorSystemPrompt` **只在提供时**追加两行；本期**只加数据不调策略**（`resolveTurnVerbosity` 一字未改，用例钉死）。⚠️ 生产 prompt **每轮多两行**（[交付记录](../completed/phase2/engine-wp50-render-spec-alliance-three-dimensions-implementation-2026-11-04.md)） | WP42 |
| **WP51** ✅ | 角色种子同盟三维基线 | 🟡 P1 | WP42 所有角色开场都是 safety=0.5 / bond=0，**回避型和安全型开场安全感一样** —— 人格差异没落地。要给角色种子加 safety/bond 基线（回避型 safety 低、安全型 safety 中高），并接适配层注入。⚠️ 实际落地：内核 `CharacterProfile.baseline` 加 `safety?` / `bond?` + `bootstrap.ts` 从 `profile.baseline` 读（**回退口径只留内核一处**）；适配层 6 个文件接上 + 手写 migration 加 `baseline_safety`（默认 0.5）/ `baseline_bond`（默认 0）两列；数值**抄 WP9-A 同风格内置种子的档位**（anxious 0.4/0.5、avoidant 0.25/0.05，工程种子值非临床标定）。⚠️ 生产默认走 **db** 数据源 → DB 侧 4 个角色**本期必须表态**，否则本 WP 在生产空转；**部署顺序**：migration 先、seed 后（[交付记录](../completed/phase2/engine-wp51-character-seed-alliance-baseline-implementation-2026-11-04.md)） | WP42 |
| **WP52** ✅ | 剧本偏移接入同盟三维 | 🟢 P2 | WP42 剧本（trajectory）的 `SnapshotDelta` 不带 safety/bond —— 剧本写"来访敞开心扉谈童年创伤"只涨 trust 不涨 safety/bond，剧本叙事推不动同盟发展。要给 `SnapshotDelta` 补两项并过同一把 cap。✅ 实际落地：`SnapshotDelta` 加 `safety?` / `bond?` 两个**可选**字段（缺省 = 0，存量剧本逐字不受影响）；`toDeltaVector` 接上；**cap 位置不用改** —— 管道已是「事件 delta + 剧本 delta → 合并 → 统一过 cap → 落快照」，safety/bond 自动被同一把尺子约束（与 trust / resistance 完全一致）（[交付记录](../completed/phase2/engine-wp52-trajectory-snapshot-delta-alliance-implementation-2026-11-04.md)） | WP42 |
| **WP53** ✅ | 人格调节算子扩展到 safety/bond | 🟢 P2 | WP34 依恋系数只调 trust，**焦虑型涨 bond 不快、回避型涨 safety 不快** —— 人格调节算子只做了一半。内测有反馈后，把依恋系数扩展到 safety/bond 两维。⚠️ 实际落地：`AttachmentModulation` 从 2 列扩到 4 列（trust / resistance / **safety / bond**），env 键 10 → 18 个；口径与 trustScale **完全同范式**（只调**增益**方向，受损方向不调 = 不发明临床数字）；`AllianceConfig.deltas` 是**事件级**覆写、`safetyScale/bondScale` 是**角色级**调节，顺序固定为「先覆写 → 再调节 → 再 cap」（[交付记录](../completed/phase2/engine-wp53-personality-modulator-alliance-extension-implementation-2026-11-04.md)） | WP34 |
| **WP54** ✅ | 破裂态阻抗反升（跨会话衰减补完） | 🟢 P2 | WP36 已交付「情绪 / 阻抗 / 同盟差异化半衰期回落」，但蓝图 §4.5 里的**「破裂态阻抗反升」没做** —— 缺"破裂"的阈值定义（属临床数字，仓库纪律是不发明）。落法建议：复用内核**既有**的抗拒门槛（`trust < 0.4 \|\| safety < 0.3`，见 `AllianceConfig.thresholds`）作破裂态定义，在 `SessionDecayConfig` 上加一个可配的"破裂态阻抗下限"，而不是新造阈值。⚠️ 实际落地：`SessionDecayConfig` 加 `ruptureResistanceFloor?`（**可选**，缺省 0 = 禁用）+ `applySessionDecay` 加第 4 参 `allianceThresholds?`（**不传 = 不启用破裂态判断**）；口径是**衰减下限不是"反升"**（`Math.max`，已高于 floor 的值不抬升）；门槛**复用** `AllianceConfig.thresholds`（校验也走 `resolveAllianceThresholds`，不新造门槛）；`DEFAULT_SESSION_DECAY_CONFIG` **不动**（3 字段，适配层 `toEqual` 断言会红）。⚠️ 本期**不接 env** → 生产上该下限**暂不生效**（[交付记录](../completed/phase2/engine-wp54-rupture-resistance-floor-implementation-2026-11-04.md)） | WP36 |
| **WP55** ✅ | 会话摘要补齐来访者侧 | 🟡 P1 | WP37 已交付滚动摘要（工作窗口溢出 → 攒批异步压摘要 → 进渲染上下文），但**内核的溢出回调只有咨询师原话**（内核不渲染，拿不到来访者的话）—— 摘要因此是"咨询侧纪要"，不是逐字稿摘要。落法：适配层把**门面历史缓冲**（`MAX_HISTORY_TURNS = WORKING_MEMORY_WINDOW_TURNS * 2`，两侧都有）里的来访者文本一并交给生成器，提示词口径随之从"只写咨询师谈了什么"改成两侧纪要（仍禁替来访者编造）。⚠️ 实际落地走**「轮次记录」单队列**（两侧绑成一个不可拆的对象）而不是双队列 min 配对 —— 后者在"某轮没有来访者发言"时会错位一格、产出**假问答对**（[交付记录](../completed/phase2/engine-wp55-rolling-summary-both-sides-implementation-2026-11-04.md)） | WP37 |
| **WP56** ✅ | 长期记忆召回（`spec.recall`）进渲染上下文 | 🟡 P1 | WP37 盘查时**全 `src/` 树 grep 核实**：`spec.recall` 填的是 WP2 的 `openingContext`（记忆命中），但**渲染层一处都没读**（`buildVisitorSystemPrompt` 不消费它）—— WP2 的记忆命中**从来没进过 prompt**，三级记忆里"长时召回"这一环在语言生成侧是断的。落法：仿 WP37 的 `sessionSummary` **独立字段**做法（别混进 `recall`），先定"召不召回 / 召回 Top-N / 以什么措辞注入 / 过期与冲突怎么过滤"，再接。⚠️ 实际落地：**只改适配层 1 个文件**（内核 diff 为空）—— `buildVisitorSystemPrompt` 加 recall 条件渲染（`recall.length > 0` 才显示，空数组 = prompt 逐字不变）+ 只取 **Top3**（内核召回上限实为 5）+ 放在 sessionSummary 之后（两块"背景"连成一段，受"不要说出口"约束，与 WP37 同款语义）；召回策略本身仍归 WP59（[交付记录](../completed/phase2/engine-wp56-recall-into-render-context-implementation-2026-11-04.md)） | WP2 |
| **WP61** ✅ | 会话摘要层次化（核心议题 / 关键事件 / 情绪转折点） | 🟡 P1 | WP55 已交付**两侧**纪要，但摘要仍是"一段 ≤120 字的流水摘要" —— 终局蓝图 §4「记忆系统层」要的是**三层结构**（核心议题 / 关键事件 / 情绪转折点），不是一坨文字。落法：滚动摘要的输出改成结构化三段（prompt 侧按三段渲染，记忆条目存结构化摘要）；⚠️ WP12 的**最终摘要**那条路径是否同步分层，另行确认（那是另一条写入路径，别两边分叉）。⚠️ 实际落地：**内核零改动**（`RenderSpec.sessionSummary` 仍是 string，渲染层与内核一字未改）—— 结构化在**服务层内部消化**，对外仍吐一段字符串（渲染后的三行文本）；生成器返回类型 `string` → `RollingSummaryResult`（三段必填），`previousSummary` **同步**结构化（合并是**逐段合并**，不是把两坨文字搅一起）；⚠️ 多改了 1 个源文件（WP12 的 `session-summary.generator.ts`，**纯增**导出共享 JSON 解析原语 —— 三段 JSON 用现有 `parseSummaryResponse` 取不到，另写一份就是仓库明令禁止的**双胞胎解析器**）；提示词**保留**了 WP37 的"不要做临床诊断"护栏（任务单草图漏了）并新增"某段没内容就给空串、不要编内容填满"；段长上限（60 字 / 180 字）是**工程种子值非临床标定**（[交付记录](../completed/phase2/engine-wp61-session-summary-hierarchical-implementation-2026-11-04.md)） | WP55 |
| **WP69** ✅ | env 盲区扩面 + consent 路径修复 + 调试面板小改进 | 🟡 P1 | WP48 挖出 16 个「配了不生效」的 env 键（**14 个躺在生效区**）—— 本单清掉 **14 个**：① **6 个挪进 `.env.example` 预留区**（`SMS_*` 5 + `METRICS_PATH`，加 `@unused-read` 标记，**WP48 用例⑤ 自动覆盖**，守卫零改动）；② **7 个 `EMBEDDING_*` 死遗产直接删**（bge 自托管 / chatanywhere 老方案，2026-10-14 大炮拍板 B 方案已废）；③ `CONSENT_CURRENT_VERSION` **修路径治本**（原读平铺键 `consentCurrentVersion`，实际在 `config.consent` 命名空间下 → 恒 undefined → **配了不生效**；修好后配 `v2.0` 真会强制客户端重弹同意 dialog —— ⚠️ 故它**不再**被挪进预留区：修好后它真的有人消费了）。另修一个**线上静默失效**的 config 路径 bug（`profile/providers/consent.service.ts` 原硬编码 `'v1.0'`，注释写着「V3 走 config」但从没走过）+ 调试面板会话列表加 `active: boolean`（本进程内存里还有内核句柄 → 可继续聊；⚠️ 与落盘 `status` **不是一回事**，进程重启后 status 仍是 active 但 active 已是 false）。⚠️ **§2.5 trace 加 `eventTags` 本单不做** —— 引擎把事件分类锁在 `turn()` 内部，取真值须动内核（破「engine-core 零改动」红线）→ 登记后续单（交付记录 §九）；**engine-core 零改动**（[交付记录](../completed/phase2/engine-wp69-env-blindspot-expansion-and-debug-panel-fixes-implementation-2026-11-06.md)） |

### 📈 架构深度补完（2026-11-04 引擎评审后新增）

> 来源：BDI 引擎架构评审（2026-11-04）。现有架构纪律（纯层分离 / 决策渲染分离 / 值语义可复现）已达标，但"可以更好的地方"属于 Phase2 后期或 Phase3 方向，先登记进 backlog，不阻塞当前批次。

| WP | 名称 | 优先级 | 一句话描述 | 依赖 |
|---|---|---|---|---|
| **WP57** ✅ | BDI 信念层深度扩展 | 🟡 P1 | 现在信念有三层结构（核心/短期/记忆），但算子主要在阻抗/情绪/关系层，**信念本身还没怎么动**——核心信念没有激活规则、短期信念置信度不衰减、没有"信念被干预后改变"的算子。落法：先补最基础的（短期信念置信度随轮次衰减、核心信念的激活条件），不追求完整 BDI 推理循环（那是 Phase3+）。⚠️ 实际落地加了**核心信念激活强度**（新增 `coreBeliefActivation` 快照字段：咨询师原文命中 `activationTags` → 激活上升，逐轮乘性衰减）；**匹配源用咨询师原文而非事件 `matchedTerms`**（两组词表独立，按事件匹配会让机制永远是死的）；**落库路径单独接一次算子**（落库走 `applyDeltaVector` 不走 `transitionState`，只接后者 = 机制空转）。⚠️ 跨会话时激活强度**不衰减**（本单 §5.2 登记的缺口，后续 WP 补）（[交付记录](../completed/phase2/engine-wp57-belief-layer-deep-expansion-implementation-2026-11-04.md)） | WP1 |
| **WP58** ✅ | 引擎调试面板 / BDI 状态 trace | 🟡 P1 | 内测调参刚需：每轮对话展开后，能看到这一轮 BDI 状态变了多少（trust +0.02 / safety -0.05…）、触发了什么事件、prompt 长什么样、delta cap 砍了多少。Admin Dashboard 里加一个"会话调试视图"，数据从现有日志/指标里抽，不新增采集链路。✅ 已完成参数校准页（ParamCalibrator）热力图布局优化：调整 grid/visualMap 间距避免滑块贴边，加放大弹窗预览。⚠️ **本单只交付后端三接口**（`POST /admin/api/debug/session` / `POST .../:id/turn` / `DELETE .../:id`）：调试会话**落 JSON 文件**（仍不写正式表），每轮返回 BDI 快照（含 safety/bond + 阻抗三维）/ delta（内核 11 维）/ 意图 / 渲染规格 / **prompt 全文** / 审议 trace（Redis，带有界等待）；装配上**避开模块循环依赖**（新增独立模块 `AdminDebugChatModule`，**不用 forwardRef**）；渲染链新增 **promptFull 按需通道**（只走内存，留痕契约仍只取 500 字预览 → **不落库**）。✅ **前端接线已补**（前端 AI 负责的 `DebugChat.vue` + `debug/SessionList.vue`，随 WP31 提交 `8b9fa6f` 入库）；**"触发了什么事件"（`deltaDetail.events`）与 delta cap 砍幅报告仍未做**（内核不对外这两项的逐轮明细）（[交付记录](../completed/phase2/engine-wp58-engine-debug-panel-implementation-2026-11-05.md)）。✅ **后半段已交付（2026-11-06）**：事件 + delta 审计观测 —— 新表 `turn_delta_audits`（每轮事件类型 + matchedTerms + raw delta）+ 读端点 `GET /admin/api/debug/sessions/:sessionId/delta-audit`；adapter 层自观测，env 开关 `TURN_DELTA_AUDIT_ENABLED` **缺省关**；⚠️ engine-core **改 1 个文件**（仅 barrel 导出 `RuleBasedClassifier`，任务单 §三 明确授权）；⚠️ delta cap 砍幅明细**仍未落库**（任务单 §八 明确不存）；⚠️ 前端面板**未做**（另开单）（[交付记录](../completed/phase2/engine-wp58-turn-delta-audit-implementation-2026-11-06.md)） | WP31 |
| **WP59** ✅ | 记忆召回策略配置端口统一 | 🟢 P2 | WP56 只是"把 recall 接进 prompt"，但召回本身的策略还很原始——没有 Top-N 截断、没有过期过滤、相似记忆没有冲突消解（两条矛盾的记忆都被召回来 = 模型混乱）。落法：先做最简单的 Top-K + 时间衰减加权，冲突消解放后面。⚠️ 实际落地：盘点发现 Top-N 已被 WP56 做完、过期过滤与冲突消解**内核早已有**，剩余真缺口只是"策略不可配置" → 本单做**配置端口统一**：内核 `evaluateRecallCandidate` 加**可选** `RecallPolicyOptions`（半衰期 + 阈值，缺省 = 内核默认值 = 零回归）+ 内存版加 `recallPolicy?` 端口；适配层 **Qdrant 版消除"双层判定"**（内核卡一道 + B 层再卡一道 = 取交集 → 配置值直接喂给内核，判定**只有一份**）；⚠️ **接受集合只会变宽不会变严**（旧条件是新条件的后件，数学恒成立；默认配置下两者完全相同）；装配层把同一份配置喂给内存版（纯内存部署此前**完全忽略** env 配置）；⚠️ 内核**只改 2 个文件**（预批准清单内），端口类型**不进 barrel**（边界断言 ⑪ + ⑥ 双重约束，B 层改用结构化类型）（[交付记录](../completed/phase2/engine-wp59-recall-policy-config-port-implementation-2026-11-04.md)） | WP56 |
| **WP60** | delta 规则表配置化 | 🟢 P2 | 现在事件→delta 映射硬编码在 `state-transition.ts` 里，改一个数字要发版。后期运营/心理咨询师要自定义规则时，抽成配置文件（JSON/YAML），内核还是纯函数读配置，env 还是适配层读。⚠️ **现在不急**——单人开发阶段硬编码反而是最快的，等真的需要自定义规则了再抽 | WP1 |
| **WP62** | 内核端口类型 barrel 收口 | 🟢 P2 | WP59 交付时发现：`RecallPolicyOptions` 等端口类型**没进 barrel** —— 适配层深路径 import 会被边界断言 ⑪ 拦下，加 barrel 导出要动 `index.ts` + 边界断言 ⑥ 的白名单 = 第三个内核文件，超预批准范围。B 层改用结构化类型（编译期仍受校验）。⚠️ **现在不急**——结构化类型够用，等攒到 3-5 个端口类型要补时，一起补进 barrel + 同步边界断言白名单，一次搞定（不要每个端口单独动一次） | WP59 |

---

### 🧪 混合式 BDI PoC 组（2026-11-05 新增，Coze 下线趋势校准）

> 来源：2026-11-05 架构评审（Coze/Dify 等静态工作流工具集体收缩）。方向校准：BDI 引擎从"规则驱动"演进为"LLM 审议 + 状态骨架"。详见 [`../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../architecture/hybrid-bdi-agent-blueprint-v1.0.md)。
>
> **这组 WP 是 PoC 验证，不是替换生产。** 影子模式并行跑，用数据证明这条路走得通。

| WP | 名称 | 优先级 | 一句话描述 | 依赖 |
|---|---|---|---|---|
| **WP63** ✅ | 审议输出 Schema 与可解释性设计 | 🟡 P1 | 定义 LLM 审议输出的 JSON schema（deltas + reason + operatorTags + intentionShift）；operatorTags 枚举表初版；理由字段进 trace 日志格式；**审议 prompt 模板设计**（系统 prompt：角色设定+临床约束+输出格式；用户 prompt：状态快照+本轮对话+记忆召回；双模式分离：考核锁温度 vs 自由练习有随机性；prompt 版本号管理）。**可解释性是实训平台命根子，没有 reason + operatorTags 的审议输出不允许上线**。⚠️ **实际落地**：本期**只定契约不接管道**（影子模式归 WP64）；`operatorTags` 由任务单的 12 个改 **13 个**——补回 `sensitive_touch`（内核 `DELTA_TABLE` 里它有真实非零 delta，漏掉则规则侧能打、审议侧不能打，那类 delta 永远匹配不上），`neutral` 不进枚举（内核是 `ZERO` 占位，不是成因）；输出取**数组形态**（每条 delta 自带标签 + 理由）而非北极星的对象 map；`intentionShift` 与 trace 表结构留给 WP64/WP68（[交付记录](../completed/phase2/engine-wp63-deliberation-schema-design-implementation-2026-11-05.md)） | 无 |
| **WP64** ✅ | LLM 审议层 PoC（影子模式） | 🟡 P1 | 新增 `engine-adapters/deliberation/llm-deliberation.service.ts`；影子模式运行：每轮对话后同步跑一次 LLM 审议，结果**不生效**（不写入状态）；对比 LLM 审议 delta vs 规则算子 delta，记录差异；**数据写入 Redis trace 表**（key=`deliberation_trace:{tenantId}:{sessionId}:{turnIndex}`，TTL 30 天）；**影子模式可观测指标**：耗时 P50/P95、token 消耗+成本折算、失败率、delta 差异分布、差异最大 Top10 场景、审议自我一致性测试；**调用时序**：影子阶段与渲染并行（fire-and-forget，不 await），切灰度后改串行；**PoC 验收标准**：成功率>95%、P95<3s、差异均值<0.01、Top10 场景临床合理、高安全零误触发；**env 配置**：`ENGINE_DELIBERATION_ENABLED` / `MODEL` / `TIMEOUT_MS` / `TEMPERATURE`。**高安全维度（自杀倾向/危机等级）不跑 LLM，只走规则**。⚠️ **实际落地**：旁路调用点接在**编排门面**（`turn-render-orchestrator.ts`，任务单说的 `src/counselor/` 零调用点）；`ruleDelta` 用**前后快照差**反推（适配层拿不到内核 cappedTotal，内核零改动）；起始快照由适配层自记 → **每场第一轮跳过**；`maxCompletionTokens` 从 512 提到 **2048**（thinking token 计入上限，512 会把正文截断）；`deltaDiff` 用**全量 11 维**（统计分母固定）；`CounselorLlmJsonClient` 加两个**可选**字段让 model/temperature 两个 env 键**真生效**；模式固定 `freeform`（引擎 turn 管道只服务零压域）（[交付记录](../completed/phase2/engine-wp64-llm-deliberation-poc-shadow-implementation-2026-11-05.md)） | WP63 |
| **WP65** ✅ | 会话级串行队列与状态一致性 | 🔴 P0 | 同一个 sessionId 的审议请求排队执行（per-session mutex）；状态快照版本号机制：审议输入用"最近已提交的快照版本"；防止并发写覆盖导致状态错乱。**上线前必须解决的硬约束**。⚠️ **实际落地**：本单先交付**队列化**这一半 —— 影子审议从 fire-and-forget 直接调改成 **BullMQ 入队异步跑**（新增 `DeliberationProcessor` = Queue + Worker + 端口实现；`LlmDeliberationService` 降级为执行器 `executeShadowMode`），三个问题一次解决：并发打爆上游（Worker 并发闸门，默认 3，env 可配）/ 进程重启丢任务（job 持久化在 Redis）/ 没有可观测性（队列长度 / 成功率 / 失败原因）；编排门面**零改动**（端口签名不变，对"内部改成入队"完全透明）；**jobId 带 turnIndex**（`removeOnComplete` 留 24h，不带会被 BullMQ 静默去重 → 审议只跑第一轮且零报错）；开关**入队前 + 执行时各判一次**（共用一个纯函数）。✅ **后半段（per-session mutex + 快照版本号）已交付**（2026-11-06）：**Redis SETNX 锁**（同一会话同时只跑一个审议；拿不到锁就**不入队**，省一次入队 + 一次 LLM 调用；Worker 跑完释放，30 秒 TTL 兜底）+ **快照版本号透传**（内核 `EngineTurnOutput.revision` → 门面 → 审议入参 `baseRevision` → 记进 Redis trace）。**仍只做观察** —— 审议结果照旧不写 BDI 快照，影子模式不变（[交付记录](../completed/phase2/engine-wp65-deliberation-mutex-revision-implementation-2026-11-06.md)） | WP64 |
| **WP66** ✅ | 审议输出格式校验与重试 | 🟡 P1 | JSON 解析 + zod schema 校验；格式不合法自动重试一次；重试仍失败 → 本轮 delta = 0，打告警日志，不阻断对话；强制 `response_format: json_object`。⚠️ **实际落地**：**智能重试** —— 区分错误类型，值得重试的才抛给 BullMQ（**形状类** `json_not_found` / `json_parse_failed` / `schema_validation_failed` / `parse_error` + **限流与 5xx** `http_429` / `http_5*`），不值得的（鉴权 4xx / 网络超时 `fetch_error` / `no_body` / 代码 bug）照旧吞掉；**先写 trace 再抛**（失败记录不丢）；重试次数 `ENGINE_DELIBERATION_MAX_RETRIES` 默认 **1**（总共跑 2 次，job 级 `attempts` 覆盖，**不动**全项目统一的 `defaultJobOptions`）；trace 加 `retryCount`（= `job.attemptsMade`）；⚠️ **zod schema 与 `response_format: json_object` 本期未做** —— 仓库的结构化输出只有一条链（`CounselorLlmJsonClient`），改它影响 6 个既有调用方，建议单独一单；WP64 的 `validateDeliberationOutput` 校验逻辑**一行未动**（[交付记录](../completed/phase2/engine-wp66-deliberation-format-retry-implementation-2026-11-05.md)） | WP63 |
| **WP67** ✅ | 三级降级策略 | 🟡 P1 | 降级 1：LLM 审议超时（>3s）→ 跳过审议，状态不变；降级 2：LLM 服务连续失败 → 切回纯规则算子模式；降级状态标记：会话打标 `degraded: true`，不能用于正式考核；降级事件写日志 + 告警。⚠️ **实际落地**：本单只交付**会话级熔断器**那一半 —— 同一个会话**连续**失败 3 次 → 熔断（这个会话的影子审议**不入队**，省一次入队 + 省一次 LLM 调用），冷却 10 分钟后半开放**一个**请求进去试（试成功就恢复，试失败就重新等满一个周期）；状态只存 `failureCount` + `openedAt`，三态（closed/open/half-open）是**算出来的**不是存出来的；熔断时写一条 `errorCode='circuit_open'` 的 trace（可观测）；阈值 / 冷却 env 可配（默认 3 次 / 600000ms，非法值回退默认不抛错）；熔断在 **Processor 层**做，Service 层只多了"返回结局"与"写一条熔断 trace"两个能力。⚠️ **母版三档里另两档天然成立但没做标记**：① 超时跳过 —— 超时是 `fetch_error`，不重试、记失败 trace 就结束（天然成立）；② 切回规则算子 —— 影子模式审议结果**从不生效**，主流程本来就永远走规则算子（天然成立，**无需动作**）；③ **`degraded: true` 会话打标未做** —— 需要会话级打标 + 对外查询入口，涉及会话状态模型，建议单独一单（本单的 `circuit_open` trace 已提供原始数据）（[交付记录](../completed/phase2/engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md)） | WP64 |
| **WP68** ✅ | 意图锁定机制（基础版） | 🟢 P2 | 当前意图加 `lockedUntilRound` 字段；锁定期间，审议输出的 intentionShift 被忽略（除非有明确触发事件）；触发事件白名单：咨询师直接提问了这个意图相关的话题；锁定轮数做成可配置参数（默认 3 轮，工程种子值待校准）。⚠️ **实际落地**：审议输出加**可选**的 `intentionShift`（LLM 建议切到哪个策略 + 理由，不需要就返回 null）；**影子期旁路模拟**锁定：锁定 N 轮内忽略 LLM 的切换建议，trace 里记下三方对比（规则算子选的 / LLM 建议的 / 锁定后实际生效的）；锁定轮数 `ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS` 默认 3（**工程种子值，非临床数字**），非法值回退默认不抛错，填 0 = 关掉锁定做对照实验。⚠️ **三处与任务单不同**：① 锁定逻辑与锁状态放 **service 层**（trace 是 service 写的，锁定结果要进 trace 就必须先算好；已与大炮确认）；② 锁状态拆成 `ruleStrategy` + `effectiveStrategy` **两个**字段（照抄任务单的单字段写法会在影子模式下让锁反复重上、永远不过期，把"拦住率"撑爆 → PoC 结论失真）；③ prompt 额外告诉模型"**当前行为策略**"（不知道现在用哪个策略就无从判断该不该换，WP68 想回答的问题就答不出来）。⚠️ **触发事件白名单未做**（任务单 D5 已明确 PoC 阶段不做 —— 那是 NLP 级判断）（[交付记录](../completed/phase2/engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md)） | 无 |

> **engine-core 边界**：这组 WP（WP63-WP68）PoC 影子期全部在适配层做，**内核零改动**。LLM 审议在 `src/engine-adapters/deliberation/`，engine-core 仍然是纯函数 + 纯数据结构，boundary.spec.ts 的 11 条断言一条都不用改。等灰度切换期（Phase3A）需要加 `deltaReport` 出口时，再单独写任务单动内核——那时候是"纯加返回字段"，不破纯层性质。

---

## 统计

| 层级 | 数量 | WP 编号 |
|---|---|---|
| 🔴 P0 商业化根基 | 8 条 | WP27, 28, 29, 30, 31, 33, 39, 40 |
| 🟡 P1 专业能力 | 21 条 | WP32, 34, 35, 36, 37, 38, 41, 42, 43, 44, 50, 51, 55, 56, 57, 58, 61, 63, 64, 66, 67 |
| 🟢 P2 技术债 | 13 条 | WP45, 46, 47, 48, 49, 52, 53, 54, 59, 60, 62, 68, **69** |
| **合计** | **42 条** | **WP27–WP69** |

**进度：36 / 42 完成**（WP28 ✅、WP30 ✅、WP31 ✅、WP32 ✅、WP34 ✅、WP35 ✅、WP36 ✅、WP37 ✅、WP38 ✅、WP41 ✅、WP42 ✅、WP43 ✅、WP44 ✅、WP45 ✅、WP46 ✅、WP47 ✅、WP48 ✅、WP49 ✅、WP50 ✅、WP51 ✅、WP52 ✅、WP53 ✅、WP54 ✅、WP55 ✅、WP56 ✅、WP57 ✅、WP58 ✅、WP59 ✅、WP61 ✅、WP63 ✅、WP64 ✅、WP65 ✅、WP66 ✅、WP67 ✅、WP68 ✅、WP69 ✅，2026-11-06）。

> ⚠️ **WP45 挖出来一个线上一直在犯的 bug**（比"清技术债"本身值钱）：`qdrant.service.ts` 的 `private client: any` 掩盖了 `setPayload` 按 **v0.x 三参**形状调（真 SDK v1.19 是**两参** `setPayload(collection, {payload, points})`）→ SDK 把第 2 参的**字符串 id** 解构成全 undefined、第 3 参被忽略 → **WP12 的冲突消解标记（`supersededBy`）从未真正落库** → 内核 `recall-policy` 排除"已被取代的记忆"那道判定永远不生效 → **同主题的新旧两条矛盾记忆会一起被召回**。已修 + 新增打到 HTTP 层的契约回归测试（4 例）。**别把这一行当成"只是清了 8 条样式债"。**

> ℹ️ **2026-11-05 四合一任务单**（**非编号 WP，不计入 42 条**）：Dashboard / MemoryBrowser / PsyGuardMonitor 三页切真 + 调试会话落 JSON 文件 → [交付记录](../completed/phase2/engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md)｜[任务单](../completed/phase2/admin-dashboard-mock-to-real-and-debug-session-persistence-2026-11-05.md)

> ⚠️ **WP31 只销了「看板」那一半**：成本看板已切真（后端补 `/cost/trend` + `/cost/sessions` 两端点，前端去 mock，顺带修掉"汇总卡片永远显示 0"的响应式 bug）；但**超阈值告警规则仍未做**（阈值配置 / 告警通道 / 通知策略）。另：**成本数据来自引擎调试留痕，生产缺省关留痕 → 生产的 token / 成本恒 0**（场次数仍准确），要让生产看板有数得给 `tech_stats` 补 token 统计（缺口 G1）。**别把这一行当成"告警已接入"。**

> ⚠️ **WP30 只销了「两个页面切真 API」那一半**：`CharacterDetail` + `SessionDetail` 两页已切真（后端补 4 个 `/admin/api/*` 端点 + 前端去 mock）。**其余页面的 mock 已全部销掉** —— `CostBoard` 由 WP31 销，`Dashboard` / `MemoryBrowser` / `PsyGuardMonitor` 由 **2026-11-05 四合一任务单**销（[交付记录](../completed/phase2/engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md)）；**现在 Dashboard 的 6 个页面全是真数据**。但仍有三处"接的是真数据、值不一定有"：① **本场记忆恒空**（`training_sessions` 无 memories 列）；② **剧本轨迹只对新会话有效**（留痕契约本轮才补 `trajectoryTrace`，老会话返 `null`）；③ **token / 轮次 / 成本受留痕开关约束**（生产缺省关留痕 → 恒 0，场次数仍准确）。**别把这一行当成"本场记忆与真指标也全有了"。**
>
> ⚠️ **WP30 的剧本轨迹端点只对新会话有效**：留痕契约里的 `trajectoryTrace` 字段是本轮才补的，老会话的留痕里没有它 → 轨迹端点返 `null`（要重新开一场对练才看得到）。

> ⚠️ **WP58 只销了「后端三接口」那一半**：母版描述里的**"触发了什么事件"**（逐事件明细）与 **delta cap 砍幅报告**也仍未做 —— 那两项内核不对外，需另开单。**（后半段已补上"触发了什么事件 + 原始 delta"的落库与查询 —— 见下条。）****前端接线已由前端 AI 补上**（`views/DebugChat.vue` + `views/debug/SessionList.vue`，随 WP31 提交 `8b9fa6f` 入库）。**别把这一行当成"调试面板已完整可用"。**
>
> ✅ **WP58 后半段（事件 + delta 审计观测）已交付**（2026-11-06）：新表 `turn_delta_audits` + 读端点 `GET /admin/api/debug/sessions/:sessionId/delta-audit`。**"触发了什么事件"这一项销掉了**（每轮事件类型 + 命中词 + 原始 delta 落库，按 sessionId 可查）；**"delta cap 砍幅报告"仍未销**（任务单 §八 明确不存 cap_entries —— 砍幅仍只有日志）；**生产缺省关**（`TURN_DELTA_AUDIT_ENABLED` 不开则一条数据都没有）；**前端面板未做**（另开单）。engine-core **改 1 个文件**（仅 barrel 导出 `RuleBasedClassifier`）。
>
> ⚠️ **WP58 的调试会话已由纯内存改成落 JSON 文件**（**2026-11-05 四合一任务单**）：`data/debug-sessions/{id}.json`，**每轮追加写**（崩溃 / 重启不丢数据）→ 按创建时间保留最近 50 个 → 第 3 轮后 LLM 自动命名（模型复用既有 env `MEMORY_SUMMARY_MODEL`；人工改名永不被覆盖）。⚠️ WP58 原话"纯内存不落库"已扩为**"落文件不落库"** —— **仍不写** `training_sessions` / `turn_debug_trace`，这是纪律的扩展不是推翻（[交付记录](../completed/phase2/engine-admin-dashboard-mock-to-real-and-debug-session-persistence-implementation-2026-11-05.md) 偏差表 B1）。另：`DELETE /debug/session/:id` 是**关会话**（历史还在），`DELETE /debug/sessions/:id` 是**删历史**（文件真删）—— 两者只差一个 s，别看串。

> ✅ **WP65 两半都销了** ——「队列化」（2026-11-05）+「per-session mutex + 快照版本号」（2026-11-06）：Redis SETNX 锁让同一会话**同时只跑一个**审议（拿不到锁就不入队，省 LLM 调用）；内核 `EngineTurnOutput.revision` 透传成审议入参的 `baseRevision`（记进 Redis trace），切灰度时拿它跟"回来时的当前版本"比就能判过期。**但别把这一行当成"审议结果已生效"** —— 影子期结果照旧不写 BDI 快照；切灰度还要补"过期判定与丢弃"+"审议输出的约束校验层"。

> ⚠️ **WP67 只销了「熔断器」那一半**：母版描述里的 **超时跳过**与**连续失败切回规则算子**在影子模式下**天然成立**（审议结果从不生效，主流程永远走规则算子）；**`degraded: true` 会话打标仍未做** —— 需会话级打标 + 对外查询入口，涉及会话状态模型，建议单独一单（本单的 `circuit_open` trace 已提供原始数据）。**别把这一行当成"降级标记已解决"。**

> ⚠️ **WP68 只销了「基础版」**：母版描述里的**触发事件白名单**（咨询师直接提问了意图相关话题 → 提前解锁）**未做** —— 那是 NLP 级判断，任务单 §2 D5 已明确 PoC 阶段不做。**别把这一行当成"提前解锁已实现"。**

> ✅ **混合式 BDI PoC 组（WP63–WP68）全部交付** —— 影子期的对比数据齐了：软状态 delta（WP64/66）、意图层（WP68）、熔断与降级（WP67）。**下一站是 Phase3A 切灰度**：WP65 的 per-session mutex + 快照版本号**已补齐**（2026-11-06），剩下的硬骨头是"**审议输出要过约束校验层**（delta cap + 临床合理性）才能落快照"+"过期判定与丢弃"。

> 🆕 **2026-11-05 新增 6 条 WP（WP63–WP68）**：混合式 BDI PoC 组，基于 Coze 下线趋势判断的架构方向校准。详见 [`../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../architecture/hybrid-bdi-agent-blueprint-v1.0.md)。

### 🚧 上线前必须一起做的真机项（WP28 遗留）

| # | 事项 | 归属 |
|---|---|---|
| 1 | 生产机 `/opt/mofang-nestjs/.env` 的 `PSYGUARD_TIMEOUT_MS` —— **删掉该行**（不设 = 继承内核常量 150）。⚠️ 若线上还留着旧的 `500`，它会盖掉内核常量 → 线上实际仍是 500ms | 运维 |
| 2 | 生产机 `mofang-psyguard` 容器重建/重启（`PSYG_MAX_LENGTH` 是环境变量，**不重启不生效**） | 运维 |
| 3 | `admin-dashboard` 的 `PsyGuardMonitor.vue` p90 告警阈值 500 → 150 + i18n 文案同步 | 前端 AI |

---

_每个 WP 开工前单独写任务单（按 `team/conventions.md` 的交付格式），本清单只做索引。_

---

## 开工前置条件与边界提醒

### ⛔ 被用户决策阻塞的 WP（开工前先确认）

| WP | 阻塞点 | 需要用户确认什么 |
|---|---|---|
| WP27 billing 接真支付 | 微信/支付宝商户号未申请 | 商户号申请状态、费率、回调域名 |
| WP29 数据分级留存 | 数据留存年限未确认 | 法务/等保确认后才能写死年限策略 |
| WP33 会员分层 TTS | 会员体系最终方案未定 | 5 档 DTO 已有，但具体几级、叫什么、对应哪个 TTS 模型 |

> 以上 WP 在用户拍板前不要开工。其他 WP 不依赖用户决策，可以直接派单。

### 🔴 engine-core 红线例外（预批准）

按 `team/conventions.md` §1.1，engine-core 默认一行不动。以下 WP **预批准**改 engine-core，但必须通过 `boundary.spec.ts` 的 11 条断言：

| WP | 改 engine-core 的什么 | 为什么必须改内核 |
|---|---|---|
| WP28 WP11 回改正式值 ✅ | `cognition/safety/assess-safety.ts` 的 `DEFAULT_PROBE_TIMEOUT_MS`（500 → 150） | **探测超时的权威值就住在这个常量里**，适配层与 env 都只是覆盖它；不改内核则 150ms 在咨询师输入面（不传 `timeoutMs` 的那条路径）根本不生效。授权来源：WP25 审查 §1.4 的回改 checklist A1 + 常量文件头自带的回改清单 + **用户 2026-11-03 当面拍板** |
| WP34 人格调节算子 ✅ | BDI 算子库（WP1 基础算子扩展） | 算子是决策层逻辑，放适配层破坏纯层 |
| WP36 跨会话衰减 ✅ | 新增 `cognition/session-decay.ts`（衰减纯函数 + 半衰期端口）+ `in-memory/in-memory-engine-session.ts` 的 resume 接线 + `index.ts` barrel | 衰减是**状态迁移规则**，必须落在纯层（适配层放它就破坏"内核零 env / 零状态"的边界） |
| WP37 滚动摘要 ✅ | `memory/working-window.ts`（溢出纯函数 `overflowedWorkingWindowLines`）+ `domain/engine-session.types.ts`（`WorkingWindowOverflowEvent`）+ `in-memory/in-memory-engine-session.ts`（`onWorkingWindowOverflow` 溢出钩子）+ `domain/rendering/render-types.ts`（`RenderSpec.sessionSummary`）+ `index.ts` barrel | **窗口裁剪是内核策略** —— 内核负责"什么时候该压缩"（"被挤出了哪几轮"是内核窗口的事实），适配层负责"怎么压缩"（调 LLM）。内核只交出文本，**零网络 / 零 prompt / 零 env** 边界不变 |
| WP42 咨询同盟三维 ✅ | BDI 状态模型（trust → trust/safety/bond） | 状态结构变化，必须在内核 |
| WP57 信念层深度扩展 ✅ | `domain/beliefs.ts`（`CoreBeliefActivation` 类型）+ `domain/bdi-snapshot.ts`（快照新增 `coreBeliefActivation` 字段）+ `domain/bootstrap.ts`（初始值）+ `cognition/state-transition.ts`（激活 / 衰减 / 组合三个纯函数 + `BeliefOperatorConfig` 端口 + 管道末端接线）+ `in-memory/in-memory-engine-session.ts`（**落库路径单独接算子**）+ `index.ts` barrel | 信念算子是**决策层逻辑**（状态迁移规则），必须落在纯层 —— 适配层放它就破坏"内核零 env / 零状态"的边界。⚠️ `in-memory-engine-session.ts` 不在任务单 §6.1 的预批准清单里，**已获用户 2026-11-04 当面批准**（落库走 `applyDeltaVector` 不走 `transitionState`，不单独接 = 机制空转） |
| WP53 人格调节扩展到同盟三维 ✅ | `cognition/personality-modulator.ts`（`AttachmentModulation` 加 safetyScale / bondScale 两列 + 种子值 + 校验 + 算子输出） | 依恋系数是**决策层逻辑**（算子本体），必须落在纯层 —— 适配层放它就破坏"内核零 env / 零状态"的边界。纯函数扩展 → **调用方一行不用改**（`state-transition.ts` / `in-memory-engine-session.ts` 都不动） |
| WP52 剧本偏移接入同盟三维 ✅ | `domain/trajectory/script.ts`（`SnapshotDelta` 加 `safety?` / `bond?`）+ `cognition/trajectory/trajectory-applier.ts`（`toDeltaVector` 接上） | 剧本契约是**数据形状**（adapter 从 DB 解析后注入的内核侧模型），必须落在纯层；转换点 `toDeltaVector` 是内核里**唯一**的"幕偏移 → delta 向量"转换处，不接上就等于剧本偏移永远是死的。字段**可选** → 存量剧本逐字不受影响，**调用方一行不用改** |
| WP54 破裂态阻抗衰减下限 ✅ | `cognition/session-decay.ts`（`SessionDecayConfig` 加 `ruptureResistanceFloor?` + `applySessionDecay` 加 `allianceThresholds?` + 破裂态下限分支） | 跨会话衰减是**状态迁移规则**（WP36 已在纯层），补一条破裂态分支**必须**跟它同处一个纯函数 —— 放适配层就等于把"要不要兜底"变成两处判定。门槛复用 `alliance-config.ts` 的既有真相源（不新造），配置走**端口注入**（`SessionDecayConfig` 可选字段，缺省 = 禁用 = 零回归）→ **调用方一行不用改**，适配层 env 接线留待后续 WP |
| WP50 渲染层接入同盟三维 ✅ | `domain/rendering/render-types.ts`（`RenderSpec` 加 `safety?` / `bond?`） | 同盟三维是**内核决策的产物**（内核算状态、渲染层据此调措辞），与既有的 `trust` 同性质 —— 必须落在**内核契约**里。放进适配层的 `AdaptiveRenderSpec` 等于让适配层自己读 snapshot，破坏"组装是纯函数"的分层（`spec-assembler.ts` 文件头）。字段**可选** → 别的生产者不必补，**调用方一行不用改** |
| WP51 角色种子同盟三维基线 ✅ | `domain/character-profile.ts`（`baseline` 加 `safety?` / `bond?`）+ `domain/bootstrap.ts`（从 `profile.baseline` 读） | 基线是**角色固有属性**（"这个人开场是什么状态"），与既有的 `trust` 同性质；`PersonalityModulator` 调的是**增量**不是基线 —— 两者是不同的事，基线平了则调节再准也差不了多少。回退口径**只留内核一处**（适配层不兜底）→ 配置走**端口注入**，别的生产者不必补，**调用方一行不用改** |
| WP59 召回策略配置端口统一 ✅ | `memory/recall-policy.ts`（`RecallPolicyOptions` + `evaluateRecallCandidate` 第 5 个**可选**参）+ `in-memory/in-memory-memory.store.ts`（`InMemoryMemoryStoreOptions.recallPolicy?` 端口） | 召回判定是**唯一真相源** —— Qdrant 版原先在 B 层"双层判定"（内核卡一道 + B 层再卡一道 = 取交集），两份判定迟早漂移。把配置参数加进内核纯函数，调用方传配置值，一份判定一处真相。纯函数扩展（可选参 + 缺省回落内核常量）→ **调用方一行不用改** = 零回归。⚠️ 只改 **2 个文件**（预批准清单内），端口类型**不进 barrel** —— 加导出要动 `index.ts` + 边界断言 ⑥ 的白名单 = 第三个内核文件，超预批准范围（留档给后续独立 WP） |

> 其他 WP 一律在 `engine-adapters/` 或业务层改，不碰 `src/engine-core/`。

### 🔗 需要前端联调的 WP（后端不写前端代码，但要出接口契约）

| WP | 前端要做什么 | 后端要交付什么 |
|---|---|---|
| WP30 Admin Dashboard ✅ | Vue3 页面切真 API（**已做**，前端与后端同单交付） | 后端出 `/admin/api/*` 接口文档（Swagger） |
| WP33 会员分层 TTS | Flutter 客户端展示会员等级 + TTS 质量差异 | 后端出 tier 字段 + TTS 模型映射接口 |
| WP39 TTS emotion | Flutter 客户端适配新的 TTS 音质 | 后端出 emotion 映射配置表 |
| WP40 TTS 语气词 | Flutter 客户端适配语气词标签 | 后端出 prompt 模板变更说明 |

### 🗄️ 需要 DB migration 的 WP

| WP | 新增表/字段 | 注意事项 |
|---|---|---|
| WP27 billing | orders / products / membership 表 | 手写 migration，禁 synchronize |
| WP29 数据分级 | data_retention_policies 表 | 按用户确认的年限写 |
| WP32 BDI 持久化 | Redis key 设计 + 可能的 DB 快照表 | Redis 为主，DB 兜底 |
| WP47 supervisor | supervision_reports 表 | 已有 entity，补 migration |

### ✅ 交付时必跑的闸门（每个 WP 都要）

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿（Phase1 1252 例 + 新增用例零回归）
git diff --stat HEAD -- src/engine-core   # → 空（或预批准例外）
```
