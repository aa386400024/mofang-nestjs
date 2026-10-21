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

// V3 migration 列表直接加到 bin/ormconfig.ts (V2 pattern, 显式列出避免 glob 扫描时序坑).
