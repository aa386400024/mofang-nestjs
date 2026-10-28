export { InitUser1700000000000 } from './1700000000000-InitUser';
export { AddUserV2Fields1700000001000 } from './1700000001000-AddUserV2Fields';
export { AddSessionV2Fields1700000002000 } from './1700000002000-AddSessionV2Fields';
export { AddPasswordHistory1700000003000 } from './1700000003000-AddPasswordHistory';
export { AddOAuthIdentity1700000004000 } from './1700000004000-AddOAuthIdentity';
export { AddUserEmailIndex1700000005000 } from './1700000005000-AddUserEmailIndex';
export { AddUserConsent1700000006000 } from './1700000006000-AddUserConsent';

// V3 — Profile 模块 (心塑「我的」Tab 二级页)
export { AddUserProfile1700000007000 } from './1700000007000-AddUserProfile';
export { AddNotificationSettings1700000007001 } from './1700000007001-AddNotificationSettings';
export { AddMemberships1700000007002 } from './1700000007002-AddMemberships';
export { AddCertifications1700000007003 } from './1700000007003-AddCertifications';
export { AddCompanionRecords1700000007004 } from './1700000007004-AddCompanionRecords';
export { AddCompanionBindings1700000007005 } from './1700000007005-AddCompanionBindings';
export { AddSelfcareRecords1700000007006 } from './1700000007006-AddSelfcareRecords';
export { AddBurnoutSettings1700000007007 } from './1700000007007-AddBurnoutSettings';
export { AddConsentSignatures1700000007008 } from './1700000007008-AddConsentSignatures';

// V2026-08-28 — 「我的」Tab V2.0 4 个新页面 (ai-conversations / dashboard / life-map / embodied)
export { AddEmbodiedDevices1700000007009 } from './1700000007009-AddEmbodiedDevices';
export { AddEmbodiedPermissions1700000007010 } from './1700000007010-AddEmbodiedPermissions';
export { AddAiChatSessions1700000007011 } from './1700000007011-AddAiChatSessions';
export { AddPrivacyAuthorizations1700000007012 } from './1700000007012-AddPrivacyAuthorizations';

// V2026-08-31 — 「首页」Tab V2.0 模块 (心塑首页 + 陪伴者首页, 4 张表)
export { AddMoodLogs1700000008000 } from './1700000008000-AddMoodLogs';
export { AddMicroInterventionConfigs1700000008001 } from './1700000008001-AddMicroInterventionConfigs';
export { AddMicroInterventionHistory1700000008002 } from './1700000008002-AddMicroInterventionHistory';
export { AddHomeMessages1700000008003 } from './1700000008003-AddHomeMessages';

// V2026-09-04 — 心塑 V6.0 §3 AI 引擎 5 张表 + §4.2 急救会话表 + §6 Inner World 游戏化解锁表 (audit P0-1/P0-3)
export { AddAIEngineTables1714900000000 } from './1714900000000-AddAIEngineTables';
export { AddEmergencySessions1714900000001 } from './1714900000001-AddEmergencySessions';
export { AddGameUnlockProgress1714900000002 } from './1714900000002-AddGameUnlockProgress';
// V2026-10-14 治本 (VS-life-merge) — 跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏建
export { AddDriftBottles1700000010005 } from './1700000010005-AddDriftBottles';
// V2026-10-14 治本 (VS-3c) — knowledge_chunks 表注册, 跟 bin/ormconfig.ts 严格 1:1
export { AddKnowledgeChunks1700000010006 } from './1700000010006-AddKnowledgeChunks';
// V2026-10-15 治本 (V1.x counselor-mode W1-2 — long-term-case 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   long_term_cases + long_term_case_sessions 2 张表 + 6 索引, counselor-mode-v1.0 §6.1 1:1 wire.
export { AddLongTermCases1700000010007 } from './1700000010007-AddLongTermCases';
// V2026-10-15 治本 (V1.x counselor-mode W3-4 — supervision-schools 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   supervision_schools + supervision_feedback 2 张表 + 5 索引, counselor-mode-v1.0 §6.2 1:1 wire.
export { AddSupervisionSchools1714900000006 } from './1714900000006-AddSupervisionSchools';
// V2026-10-15 治本 (V1.x counselor-mode W5-6 — ability-dimensions 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   ability_dimensions + ability_scores 2 张表 + 5 索引, counselor-mode-v1.0 §6.3 1:1 wire.
export { AddAbilityDimensions1714900000007 } from './1714900000007-AddAbilityDimensions';
// V2026-10-15 治本 (V1.x counselor-mode W7-8 — quota_usage 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   quota_usage 新表 + user_memberships 加 3 列 (tier_v2 / quota_period / quota_text_fallback),
//   counselor-mode-v1.0 §6.4 + §7.1 1:1 wire.
export { AddQuotaUsage1714900000008 } from './1714900000008-AddQuotaUsage';

// V2026-10-19 治本 (V1.1 §6.5 — training_sessions 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   training_sessions 新表 + 5 索引 (PRIMARY + 4 复合), counselor-mode-v1.1 §6.5 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingSession entity 1:1 (9 场景单次训练 session 持久化).
export { AddTrainingSessions1714900000009 } from './1714900000009-AddTrainingSessions';
// V2026-10-19 治本 (V1.1 §5.2 — training_exercises 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   training_exercises 新表 + 5 索引 (PRIMARY + 4 复合), counselor-mode-v1.1 §5.2 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingExercise entity 1:1 (10 训练项 + AI 评分标准 + 专家反馈).
export { AddTrainingExercises1714900000010 } from './1714900000010-AddTrainingExercises';
// V2026-10-19 治本 (V1.1 §5.2 — training_exercise_attempts 表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   training_exercise_attempts 新表 + 4 索引 (PRIMARY + 3 复合), counselor-mode-v1.1 §5.2 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingExerciseAttempt entity 1:1 (答题记录 + 5 状态机 + 维度分).
export { AddTrainingExerciseAttempts1714900000011 } from './1714900000011-AddTrainingExerciseAttempts';
export { AddCounselorUiPreferences1714900000012 } from './1714900000012-AddCounselorUiPreferences';
// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 张表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   visitor_full_personas (AI 底层全量人设, 7 大块 json + trust_level) +
//   case_profile_entries (动态解锁档案), 跟 counselor-mode-v1.2 §4 1:1 wire.
export { AddVisitorFullPersonas1714900000013 } from './1714900000013-AddVisitorFullPersonas';
// V2026-10-21 治本 (V1.2 VS-C — M2 知情同意 + M3 会谈核心 3 张新表 + 5 处 ALTER, 跟 bin/ormconfig.ts 严格 1:1):
//   live_supervision_hints / transcript_bookmarks / transference_resistance_marks
//   + training_sessions (知情同意 3 列 + tech_stats) + long_term_case_sessions (tech_stats).
export { AddCounselorSessionCore1714900000014 } from './1714900000014-AddCounselorSessionCore';
// V2026-10-22 治本 (V1.3 §2 — 微技能自由练习引擎 2 张新表, 跟 bin/ormconfig.ts 严格 1:1):
//   practice_scenarios (场景变体库 20 列 + 4 索引) + practice_attempts (自由作答记录
//   12 列 + 3 索引), counselor-practice-engine-v1.3-freeform.md §2 拍板.
//   内容不进 migration (spec §6.3): 60 条场景由 bin/seed-practice-scenarios.ts
//   按 scenario_key 幂等 upsert.
export { AddPracticeScenarios1714900000015 } from './1714900000015-AddPracticeScenarios';
// V2026-10-22 治本 (V1.3 §7.5 — 用户私有场景表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   practice_custom_scenarios (用户私有场景 13 列 + 3 索引)
//   + practice_attempts.scenario_source 列 (seed / custom, 默认 seed)
//   + quota_usage.period 放宽到 VARCHAR(10) (支持 §7.4 的「每天 5 次」日粒度计数).
export { AddPracticeCustomScenarios1714900000016 } from './1714900000016-AddPracticeCustomScenarios';
// V2026-10-22 治本 (首页金句 · 每日一句 — 2 张新表注册, 跟 bin/ormconfig.ts 严格 1:1):
//   quotes (金句内容库 11 列 + 2 索引) + user_quote_favorites (收藏关系 5 列 + 3 索引).
//   内容不进 migration (spec §1 内容由独立 seed 脚本灌: bin/seed-quotes.ts).
export { AddQuotes1714900000017 } from './1714900000017-AddQuotes';
// V2026-10-23 治本 (AI 模拟来访池 — 2 张新表 + 1 列 ALTER, 跟前序 quotes 同段):
//   visitor_pool_templates (公共只读模板: 表层卡片 + 7 大块剧本快照)
//   + visitor_pool_favorites (收藏关系, 唯一键 (user_id, template_id))
//   + visitor_full_personas.source_template_id (标注私有副本的来源模板).
//   内容不进 migration (spec §6): 6 个官方人物由 bin/seed-visitor-pool-templates.ts
//   按稳定 id 幂等 upsert, 运行时增补走 §3.5 内部 AI 生成端点.
export { AddVisitorPoolTemplates1714900000018 } from './1714900000018-AddVisitorPoolTemplates';
// V2026-10-23 治本 (AI 模拟来访池 — 3 个 id 列放宽到 VARCHAR(64), 跟前序同段):
//   模板 id 是内容 slug (最长 37 字符, 未来组合可达 40), 而 0018 建表时按 UUID 用了
//   CHAR(36) → seed 报 "Data too long for column 'id'". 本迁移把
//   visitor_pool_templates.id / visitor_pool_favorites.template_id /
//   visitor_full_personas.source_template_id 一起放宽 (与 quotes.id varchar(64) 对齐).
//   0018 已在 dev 库执行, **不改已执行的迁移** —— 迁移只增不改.
export { WidenVisitorPoolIdColumns1714900000019 } from './1714900000019-WidenVisitorPoolIdColumns';
// V2026-10-26 治本 (vpt 全真语音会话增强 — 督导报告落库, spec 任务 6):
//   supervision_reports 新表 (16 列 + 3 索引, 其中 (tenant_id, session_id) 唯一),
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏建.
//   表由手写 DDL 建 (ADR-0003 禁用 synchronize) —— 督导报告写完即终态, 不落软删列.
export { AddSupervisionReports1714900000020 } from './1714900000020-AddSupervisionReports';
// V2026-10-26 治本 (4 督导流派幂等播种 — supervision_schools):
//   006 建表但漏播种, 导致流派 job 报「督导流派 cbt 不存在」+ tech_stats 永远为空.
//   内容直接 import SUPERVISION_SCHOOL_PRESETS, ON DUPLICATE KEY UPDATE 幂等 upsert.
export { SeedSupervisionSchools1714900000021 } from './1714900000021-SeedSupervisionSchools';
// V2026-10-27 治本 (来访池 — 公共人物绑定系统音色):
//   visitor_pool_templates 加 1 个可空列 voice_id (未绑定 = 回退 env 默认, 旧行零影响).
//   跟 bin/ormconfig.ts 严格 1:1, 防 migration:run "No migrations are pending" 漏执行.
export { AddVisitorPoolTemplateVoiceId1714900000022 } from './1714900000022-AddVisitorPoolTemplateVoiceId';

// V3 migration 列表直接加到 bin/ormconfig.ts (V2 pattern, 显式列出避免 glob 扫描时序坑).
