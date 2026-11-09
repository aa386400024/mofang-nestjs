export { InitUser1700000000000 } from './1700000000000-InitUser.js';
export { AddUserV2Fields1700000001000 } from './1700000001000-AddUserV2Fields.js';
export { AddSessionV2Fields1700000002000 } from './1700000002000-AddSessionV2Fields.js';
export { AddPasswordHistory1700000003000 } from './1700000003000-AddPasswordHistory.js';
export { AddOAuthIdentity1700000004000 } from './1700000004000-AddOAuthIdentity.js';
export { AddUserEmailIndex1700000005000 } from './1700000005000-AddUserEmailIndex.js';
export { AddUserConsent1700000006000 } from './1700000006000-AddUserConsent.js';

// V3 — Profile 模块 (心塑「我的」Tab 二级页)
export { AddUserProfile1700000007000 } from './1700000007000-AddUserProfile.js';
export { AddNotificationSettings1700000007001 } from './1700000007001-AddNotificationSettings.js';
export { AddMemberships1700000007002 } from './1700000007002-AddMemberships.js';
export { AddCertifications1700000007003 } from './1700000007003-AddCertifications.js';
export { AddCompanionRecords1700000007004 } from './1700000007004-AddCompanionRecords.js';
export { AddCompanionBindings1700000007005 } from './1700000007005-AddCompanionBindings.js';
export { AddSelfcareRecords1700000007006 } from './1700000007006-AddSelfcareRecords.js';
export { AddBurnoutSettings1700000007007 } from './1700000007007-AddBurnoutSettings.js';
export { AddConsentSignatures1700000007008 } from './1700000007008-AddConsentSignatures.js';

// V2026-08-28 — 「我的」Tab V2.0 4 个新页面 (ai-conversations / dashboard / life-map / embodied)
export { AddEmbodiedDevices1700000007009 } from './1700000007009-AddEmbodiedDevices.js';
export { AddEmbodiedPermissions1700000007010 } from './1700000007010-AddEmbodiedPermissions.js';
export { AddAiChatSessions1700000007011 } from './1700000007011-AddAiChatSessions.js';
export { AddPrivacyAuthorizations1700000007012 } from './1700000007012-AddPrivacyAuthorizations.js';

// V2026-08-31 — 「首页」Tab V2.0 模块 (心塑首页 + 陪伴者首页, 4 张表)
export { AddMoodLogs1700000008000 } from './1700000008000-AddMoodLogs.js';
export { AddMicroInterventionConfigs1700000008001 } from './1700000008001-AddMicroInterventionConfigs.js';
export { AddMicroInterventionHistory1700000008002 } from './1700000008002-AddMicroInterventionHistory.js';
export { AddHomeMessages1700000008003 } from './1700000008003-AddHomeMessages.js';

// V2026-09-04 — 心塑 V6.0 §3 AI 引擎 5 张表 + §4.2 急救会话表 + §6 Inner World 游戏化解锁表 (audit P0-1/P0-3)
export { AddAIEngineTables1714900000000 } from './1714900000000-AddAIEngineTables.js';
export { AddEmergencySessions1714900000001 } from './1714900000001-AddEmergencySessions.js';
export { AddGameUnlockProgress1714900000002 } from './1714900000002-AddGameUnlockProgress.js';
// V2026-10-14 治本 (VS-life-merge) — 跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏建
export { AddDriftBottles1700000010005 } from './1700000010005-AddDriftBottles.js';
// V2026-10-14 治本 (VS-3c) — knowledge_chunks 表注册, 跟 bin/ormconfig.ts 严格 1:1
export { AddKnowledgeChunks1700000010006 } from './1700000010006-AddKnowledgeChunks.js';
// V2026-10-15 治本 (V1.x counselor-mode W1-2 — long-term-case 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   long_term_cases + long_term_case_sessions 2 张表 + 6 索引, counselor-mode-v1.0 §6.1 1:1 wire.
export { AddLongTermCases1700000010007 } from './1700000010007-AddLongTermCases.js';
// V2026-10-15 治本 (V1.x counselor-mode W3-4 — supervision-schools 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   supervision_schools + supervision_feedback 2 张表 + 5 索引, counselor-mode-v1.0 §6.2 1:1 wire.
export { AddSupervisionSchools1714900000006 } from './1714900000006-AddSupervisionSchools.js';
// V2026-10-15 治本 (V1.x counselor-mode W5-6 — ability-dimensions 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   ability_dimensions + ability_scores 2 张表 + 5 索引, counselor-mode-v1.0 §6.3 1:1 wire.
export { AddAbilityDimensions1714900000007 } from './1714900000007-AddAbilityDimensions.js';
// V2026-10-15 治本 (V1.x counselor-mode W7-8 — quota_usage 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   quota_usage 新表 + user_memberships 加 3 列 (tier_v2 / quota_period / quota_text_fallback),
//   counselor-mode-v1.0 §6.4 + §7.1 1:1 wire.
export { AddQuotaUsage1714900000008 } from './1714900000008-AddQuotaUsage.js';

// V2026-10-19 治本 (V1.1 §6.5 — training_sessions 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   training_sessions 新表 + 5 索引 (PRIMARY + 4 复合), counselor-mode-v1.1 §6.5 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingSession entity 1:1 (9 场景单次训练 session 持久化).
export { AddTrainingSessions1714900000009 } from './1714900000009-AddTrainingSessions.js';
// V2026-10-19 治本 (V1.1 §5.2 — training_exercises 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   training_exercises 新表 + 5 索引 (PRIMARY + 4 复合), counselor-mode-v1.1 §5.2 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingExercise entity 1:1 (10 训练项 + AI 评分标准 + 专家反馈).
export { AddTrainingExercises1714900000010 } from './1714900000010-AddTrainingExercises.js';
// V2026-10-19 治本 (V1.1 §5.2 — training_exercise_attempts 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   training_exercise_attempts 新表 + 4 索引 (PRIMARY + 3 复合), counselor-mode-v1.1 §5.2 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingExerciseAttempt entity 1:1 (答题记录 + 5 状态机 + 维度分).
export { AddTrainingExerciseAttempts1714900000011 } from './1714900000011-AddTrainingExerciseAttempts.js';
export { AddCounselorUiPreferences1714900000012 } from './1714900000012-AddCounselorUiPreferences.js';
// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 张表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   visitor_full_personas (AI 底层全量人设, 7 大块 json + trust_level) +
//   case_profile_entries (动态解锁档案), 跟 counselor-mode-v1.2 §4 1:1 wire.
export { AddVisitorFullPersonas1714900000013 } from './1714900000013-AddVisitorFullPersonas.js';
// V2026-10-21 治本 (V1.2 VS-C — M2 知情同意 + M3 会谈核心 3 张新表 + 5 处 ALTER, 跟 bin/ormconfig.ts 严格 1:1):
//   live_supervision_hints / transcript_bookmarks / transference_resistance_marks
//   + training_sessions (知情同意 3 列 + tech_stats) + long_term_case_sessions (tech_stats).
export { AddCounselorSessionCore1714900000014 } from './1714900000014-AddCounselorSessionCore.js';
// V2026-10-22 治本 (V1.3 §2 — 微技能自由练习引擎 2 张新表, 跟 bin/ormconfig.ts 严格 1:1):
//   practice_scenarios (场景变体库 20 列 + 4 索引) + practice_attempts (自由作答记录
//   12 列 + 3 索引), counselor-practice-engine-v1.3-freeform.md §2 拍板.
//   内容不进 migration (spec §6.3): 60 条场景由 bin/seed-practice-scenarios.ts
//   按 scenario_key 幂等 upsert.
export { AddPracticeScenarios1714900000015 } from './1714900000015-AddPracticeScenarios.js';
// V2026-10-22 治本 (V1.3 §7.5 — 用户私有场景表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   practice_custom_scenarios (用户私有场景 13 列 + 3 索引)
//   + practice_attempts.scenario_source 列 (seed / custom, 默认 seed)
//   + quota_usage.period 放宽到 VARCHAR(10) (支持 §7.4 的「每天 5 次」日粒度计数).
export { AddPracticeCustomScenarios1714900000016 } from './1714900000016-AddPracticeCustomScenarios.js';
// V2026-10-22 治本 (首页金句 · 每日一句 — 2 张新表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   quotes (金句内容库 11 列 + 2 索引) + user_quote_favorites (收藏关系 5 列 + 3 索引).
//   内容不进 migration (spec §1 内容由独立 seed 脚本灌: bin/seed-quotes.ts).
export { AddQuotes1714900000017 } from './1714900000017-AddQuotes.js';
// V2026-10-23 治本 (AI 模拟来访池 — 2 张新表 + 1 列 ALTER, 跟前序 quotes 同段):
//   visitor_pool_templates (公共只读模板: 表层卡片 + 7 大块剧本快照)
//   + visitor_pool_favorites (收藏关系, 唯一键 (user_id, template_id))
//   + visitor_full_personas.source_template_id (标注私有副本的来源模板).
//   内容不进 migration (spec §6): 6 个官方人物由 bin/seed-visitor-pool-templates.ts
//   按稳定 id 幂等 upsert, 运行时增补走 §3.5 内部 AI 生成端点.
export { AddVisitorPoolTemplates1714900000018 } from './1714900000018-AddVisitorPoolTemplates.js';
// V2026-10-23 治本 (AI 模拟来访池 — 3 个 id 列放宽到 VARCHAR(64), 跟前序同段):
//   模板 id 是内容 slug (最长 37 字符, 未来组合可达 40), 而 0018 建表时按 UUID 用了
//   CHAR(36) → seed 报 "Data too long for column 'id'". 本迁移把
//   visitor_pool_templates.id / visitor_pool_favorites.template_id /
//   visitor_full_personas.source_template_id 一起放宽 (与 quotes.id varchar(64) 对齐).
//   0018 已在 dev 库执行, **不改已执行的迁移** —— 迁移只增不改.
export { WidenVisitorPoolIdColumns1714900000019 } from './1714900000019-WidenVisitorPoolIdColumns.js';
// V2026-10-26 治本 (vpt 全真语音会话增强 — 督导报告落库, spec 任务 6):
//   supervision_reports 新表 (16 列 + 3 索引, 其中 (tenant_id, session_id) 唯一),
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏建.
//   表由手写 DDL 建 (ADR-0003 禁用 synchronize) —— 督导报告写完即终态, 不落软删列.
export { AddSupervisionReports1714900000020 } from './1714900000020-AddSupervisionReports.js';
// V2026-10-26 治本 (4 督导流派幂等播种 — supervision_schools):
//   006 建表但漏播种, 导致流派 job 报「督导流派 cbt 不存在」+ tech_stats 永远为空.
//   内容直接 import SUPERVISION_SCHOOL_PRESETS, ON DUPLICATE KEY UPDATE 幂等 upsert.
export { SeedSupervisionSchools1714900000021 } from './1714900000021-SeedSupervisionSchools.js';
// V2026-10-27 治本 (来访池 — 公共人物绑定系统音色):
//   visitor_pool_templates 加 1 个可空列 voice_id (未绑定 = 回退 env 默认, 旧行零影响).
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏执行.
export { AddVisitorPoolTemplateVoiceId1714900000022 } from './1714900000022-AddVisitorPoolTemplateVoiceId.js';
// V2026-10-29 治本 (WP9-B — character_profiles 角色资产池新表):
//   character_profiles (system 级: 5Ps 专业长文 + 内核基线数值 + 结构化心理要素
//   + 审核/上下架状态, 21 列 + 2 索引), 逻辑外键 template_id → visitor_pool_templates.id
//   (不加 DB FK, ADR-0003). 内容不进 migration: 首批 4 个角色走独立 seed 脚本
//   (bin/seed-character-profiles.ts) 按稳定 template_id 幂等 upsert.
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏建.
export { AddCharacterProfiles1714900000023 } from './1714900000023-AddCharacterProfiles.js';
// V2026-10-29 治本 (WP19 — training_sessions 加 turn_debug_trace JSON 列):
//   每轮 BDI 调试快照数组, 会话关闭时 flush. 调试器 SPA 只读.
export { AddTurnDebugTrace1714900000024 } from './1714900000024-AddTurnDebugTrace.js';
// V2026-10-30 治本 (WP10A — character_profiles 加 3 列表达风格基线字段):
//   speech_volume_baseline (FLOAT, 默认 0.5) + narrative_style (VARCHAR(20), 默认 'mixed')
//   + expression_tone (VARCHAR(20), 默认 'restrained').
//   纯预留: 不进内核 / 不进 RenderSpec / 不暴露前端; 存量行由 DEFAULT 自动填充, 无需 UPDATE.
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏执行.
export { AddCharacterProfileExpressionFields1714900000025 } from './1714900000025-AddCharacterProfileExpressionFields.js';
// V2026-11-02 治本 (WP14 — student_risk_events 学员心理风险事件审计表):
//   append-only 审计表 (13 列 + 2 索引), **故意没有** updated_at / deleted_at ——
//   审计表的价值在于不可篡改. 唯一允许 update 的是 user_choice (学员点弹窗后的选择).
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏建.
export { AddStudentRiskEvents1714900000026 } from './1714900000026-AddStudentRiskEvents.js';
// V2026-11-04 治本 (WP51 — character_profiles 加 2 列同盟三维基线):
//   baseline_safety (FLOAT, 默认 0.5) + baseline_bond (FLOAT, 默认 0).
//   角色种子按依恋风格给**开场**的安全感 / 联结感; 存量行由 DEFAULT 自动填充,
//   数值补齐靠幂等 seed 重跑 (内容不进 migration).
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏执行.
export { AddCharacterProfileAllianceBaseline1714900000027 } from './1714900000027-AddCharacterProfileAllianceBaseline.js';
// V2026-11-04 治本 (WP49 — character_profiles 加 1 列大五人格):
//   personality_traits (JSON, 可空, **无 DEFAULT**).
//   角色的 OCEAN 五维数值终于有地方存 —— 内核 PersonalityTraits 早就有 (WP34),
//   但适配层一直没传数据, 宜人性调节算子在生产上是休眠的.
//   NULL = 没表态 = 内核不做特质调节; 存量行加列后仍是 NULL (零回归).
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏执行.
export { AddCharacterProfilePersonalityTraits1714900000028 } from './1714900000028-AddCharacterProfilePersonalityTraits.js';
// V2026-11-06 治本 (WP38 — 角色版本 semver + 会话绑定版本, 跟 bin/ormconfig.ts 严格 1:1):
//   character_profiles 加 3 列 (version_major/minor/patch) + character_profile_versions 新表
//   + training_sessions 加 2 列 (character_template_id / character_version).
export { AddCharacterVersionSemver1714900000029 } from './1714900000029-AddCharacterVersionSemver.js';
// V2026-11-06 治本 (WP43 — session_evaluations 单场规则快评表, 跟 bin/ormconfig.ts 严格 1:1):
//   session_evaluations 新表 (9 列 + 3 索引, 其中 session_id 唯一) —— 规则引擎快评的落库表.
//   一场会话一份评估 (重算覆盖, 不堆行); 不加 DB FK / 不做软删 (ADR-0003).
export { CreateSessionEvaluations1714900000030 } from './1714900000030-CreateSessionEvaluations.js';
// V2026-11-06 治本 (WP58 — turn_delta_audits 事件 + delta 审计观测表, 跟 bin/ormconfig.ts 严格 1:1):
//   turn_delta_audits 新表 (8 列 + 3 索引, 其中 (tenant_id, session_id, turn_index) 唯一)
//   —— 每轮事件类型 + 命中词 + 原始 delta 的落库表. 表由手写 DDL 建 (ADR-0003 禁用 synchronize).
export { AddTurnDeltaAudits1714900000031 } from './1714900000031-AddTurnDeltaAudits.js';
// V2026-11-07 治本 (degraded 会话打标 — training_sessions 加 2 列, 跟 bin/ormconfig.ts 严格 1:1):
//   degraded (TINYINT NOT NULL DEFAULT 0) + degraded_reason (VARCHAR(50) NULL).
//   会话结束时一次性判定打标; 考核 / 统计接口按它过滤. 存量行 = 0 (零回归).
export { AddSessionDegradedFlag1714900000032 } from './1714900000032-AddSessionDegradedFlag.js';
// V2026-11-08 治本 (Phase2.5 WP-D — 自动对练 2 张表, 跟 bin/ormconfig.ts 严格 1:1):
//   ap_counselor_modes (咨询师人设 system prompt) + ap_practice_sessions (批量场次元数据).
export { AddAutoPracticeTables1714900000033 } from './1714900000033-AddAutoPracticeTables.js';
// V2026-11-09 治本 (P1-3 — ap_practice_sessions 加 degraded_turns 列):
//   上游 429/超时导致咨询师回兜底句时累计计数, 退出时按比例打 exitReason 后缀.
export { AddPracticeSessionDegradedTurns1714900000034 } from './1714900000034-AddPracticeSessionDegradedTurns.js';
// V2026-11-09 治本 (Phase2.5 WP-B — ap_practice_sessions 加版本列):
//   character_version / deliberation_mode / engine_version 三列, 推理环境可追溯.
export { AddPracticeSessionVersionColumns1714900000035 } from './1714900000035-AddPracticeSessionVersionColumns.js';
// V2026-11-09 治本 (Phase2.5 WP-E — eval_reports 新表, 跟 bin/ormconfig.ts 严格 1:1):
//   评测报告落库表 (指标 / 数据质量 / 配置快照 / 整份报告 JSON), 历史可查、跨版本可对比.
export { CreateEvalReports1714900000036 } from './1714900000036-CreateEvalReports.js';

// V3 migration 列表直接加到 bin/ormconfig.ts (V2 pattern, 显式列出避免 glob 扫描时序坑).
