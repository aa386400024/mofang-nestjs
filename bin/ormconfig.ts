/// <reference types="../typings/global" />
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { configuration } from '../src/config';

// V2 迁移: 显式列出 (而不是 glob 扫描, 避免 ts-node dev 时序问题)
import { InitUser1700000000000 } from '../src/migration/1700000000000-InitUser';
import { AddUserV2Fields1700000001000 } from '../src/migration/1700000001000-AddUserV2Fields';
import { AddSessionV2Fields1700000002000 } from '../src/migration/1700000002000-AddSessionV2Fields';
import { AddPasswordHistory1700000003000 } from '../src/migration/1700000003000-AddPasswordHistory';
import { AddOAuthIdentity1700000004000 } from '../src/migration/1700000004000-AddOAuthIdentity';
import { AddUserEmailIndex1700000005000 } from '../src/migration/1700000005000-AddUserEmailIndex';
import { AddUserConsent1700000006000 } from '../src/migration/1700000006000-AddUserConsent';

// V3 Profile 模块迁移 (心塑「我的」Tab 二级页)
import { AddUserProfile1700000007000 } from '../src/migration/1700000007000-AddUserProfile';
import { AddNotificationSettings1700000007001 } from '../src/migration/1700000007001-AddNotificationSettings';
import { AddMemberships1700000007002 } from '../src/migration/1700000007002-AddMemberships';
import { AddCertifications1700000007003 } from '../src/migration/1700000007003-AddCertifications';
import { AddCompanionRecords1700000007004 } from '../src/migration/1700000007004-AddCompanionRecords';
import { AddCompanionBindings1700000007005 } from '../src/migration/1700000007005-AddCompanionBindings';
import { AddSelfcareRecords1700000007006 } from '../src/migration/1700000007006-AddSelfcareRecords';
import { AddBurnoutSettings1700000007007 } from '../src/migration/1700000007007-AddBurnoutSettings';
import { AddConsentSignatures1700000007008 } from '../src/migration/1700000007008-AddConsentSignatures';
// V2026-08-28 — 「我的」Tab V2.0 新增 (ai-conversations / dashboard / life-map / embodied)
import { AddEmbodiedDevices1700000007009 } from '../src/migration/1700000007009-AddEmbodiedDevices';
import { AddEmbodiedPermissions1700000007010 } from '../src/migration/1700000007010-AddEmbodiedPermissions';
import { AddAiChatSessions1700000007011 } from '../src/migration/1700000007011-AddAiChatSessions';
import { AddPrivacyAuthorizations1700000007012 } from '../src/migration/1700000007012-AddPrivacyAuthorizations';
// V2026-10-12 (Phase 8.2 — Admin RBAC + 多租户, spec §0 / §3 A9 / §12.4):
//   users 表加 tenant_id (V0.x = uid 一人一租户) + admin_role (NULL = 无权限,
//   'editor' / 'reviewer' / 'admin' 跟客户端 7.8 PermissionResolver 3 角色严格对齐).
// V2026-10-12 (Phase 8.1 — KB 模块初始化, spec §12.1):
//   3 张表 (knowledge_items / knowledge_versions / workflow_events) + 5 复合
//   index 一次建完, 跟 entity @Index 注解严格对应.
// V2026-10-12 (Phase 8.3 — Analytics 模块初始化, spec §12.5):
//   analytics_events 表 + 2 复合 index, 跟 entity @Index 注解严格对应.
// V2026-10-12 (Phase 8.5 — Dev seed):
//   3 admin 账户 (editor / reviewer / admin, 密码 "dev") + 5 KB 样例, 跟客户端
//   7.8 V0.x dev fallback 对齐, dev 跑通 RBAC 矩阵 + 列表 + 5 工作流 action + Analytics 4 KPI 验证.

// V2026-08-31 — 「首页」Tab V2.0 模块 (心塑首页 + 陪伴者首页, 4 张表)
import { AddMoodLogs1700000008000 } from '../src/migration/1700000008000-AddMoodLogs';
import { AddUserTenantId1700000008000 } from '../src/migration/1700000008000-AddUserTenantId';
import { InitInnerWorld1700000008000 } from '../src/migration/1700000008000-InitInnerWorld';
// V2026-10-12 (Phase 8.2 — Admin RBAC + 多租户, spec §0 / §3 A9 / §12.4):
//   users 表加 tenant_id (V0.x = uid 一人一租户) + admin_role (NULL = 无权限,
//   'editor' / 'reviewer' / 'admin' 跟客户端 7.8 PermissionResolver 3 角色严格对齐).
import { AddMicroInterventionConfigs1700000008001 } from '../src/migration/1700000008001-AddMicroInterventionConfigs';
import { AddUserAdminRole1700000008001 } from '../src/migration/1700000008001-AddUserAdminRole';
import { AddMicroInterventionHistory1700000008002 } from '../src/migration/1700000008002-AddMicroInterventionHistory';
// V2026-10-12 (Phase 8.2 — Admin RBAC + 多租户, spec §0 / §3 A9 / §12.4): adminRole 枚举加列
import { AddHomeMessages1700000008003 } from '../src/migration/1700000008003-AddHomeMessages';
// V2026-10-12 (Phase 8.1 — KB 模块初始化, spec §12.1):
//   3 张表 (knowledge_items / knowledge_versions / workflow_events) + 5 复合
//   index 一次建完, 跟 entity @Index 注解严格对应.
import { InitKnowledge1700000008010 } from '../src/migration/1700000008010-InitKnowledge';
// V2026-10-12 (Phase 8.3 — Analytics 模块初始化, spec §12.5):
//   analytics_events 表 + 2 复合 index, 跟 entity @Index 注解严格对应.
import { InitAnalytics1700000008020 } from '../src/migration/1700000008020-InitAnalytics';

// V2026-09-03 — 心塑「内心世界」Tab 模块 (V4.0 §3 游戏化核心层, 6 张表)

// V2026-09-01 — 「练习」Tab V2.0 模块 (心塑成长用户端 Tab2, 5 张表)
import { AddPracticeTables1700000009000 } from '../src/migration/1700000009000-AddPracticeTables';
// V2026-10-12 (Phase 8.5 — Dev seed):
//   3 admin 账户 (editor / reviewer / admin, 密码 "dev") + 5 KB 样例, 跟客户端
//   7.8 V0.x dev fallback 对齐, dev 跑通 RBAC 矩阵 + 列表 + 5 工作流 action + Analytics 4 KPI 验证.
import { SeedDevData1700000009000 } from '../src/migration/1700000009000-SeedDevData';

// V2026-09-01 — 「陪伴」Tab V2.0 模块 (心塑陪伴者端 Tab2, 5 张表 + 扩展 companion_records)
import { AddCompanionTables1700000010000 } from '../src/migration/1700000010000-AddCompanionTables';
import { ExtendCompanionRecord1700000010001 } from '../src/migration/1700000010001-ExtendCompanionRecord';

// V2026-09-01 — 「人生地图」Tab V3.0 模块 (心塑成长用户端 Tab3, 3 张表)
import { AddLifeStageProgress1700000010002 } from '../src/migration/1700000010002-AddLifeStageProgress';
import { AddKeyEvents1700000010003 } from '../src/migration/1700000010003-AddKeyEvents';
import { AddGenomeDimensions1700000010004 } from '../src/migration/1700000010004-AddGenomeDimensions';
// V2026-10-14 治本 (VS-3c — 注册 knowledge_chunks migration, 跟前序 3 张 V3.0 life-map 表同段):
import { AddDriftBottles1700000010005 } from '../src/migration/1700000010005-AddDriftBottles';
import { AddKnowledgeChunks1700000010006 } from '../src/migration/1700000010006-AddKnowledgeChunks';
// V2026-10-15 治本 (V1.x counselor-mode W1-2 — long-term-case migration, 跟 src/migration/index.ts 1:1):
//   long_term_cases + long_term_case_sessions 2 张表 + 6 索引, counselor-mode-v1.0 §6.1 1:1 wire.
import { AddLongTermCases1700000010007 } from '../src/migration/1700000010007-AddLongTermCases';
// V2026-10-15 治本 (V1.x counselor-mode W3-4 — supervision-schools migration, 跟 src/migration/index.ts 1:1):
//   supervision_schools + supervision_feedback 2 张表 + 5 索引, counselor-mode-v1.0 §6.2 1:1 wire.
import { AddAIEngineTables1714900000000 } from '../src/migration/1714900000000-AddAIEngineTables';
import { AddEmergencySessions1714900000001 } from '../src/migration/1714900000001-AddEmergencySessions';
import { AddGameUnlockProgress1714900000002 } from '../src/migration/1714900000002-AddGameUnlockProgress';
import { AddGoodStateDiary1714900000003 } from '../src/migration/1714900000003-AddGoodStateDiary';
import { AddMicroInterventionScenarios1714900000004 } from '../src/migration/1714900000004-AddMicroInterventionScenarios';
import { AddSupervisionSchools1714900000006 } from '../src/migration/1714900000006-AddSupervisionSchools';
// V2026-10-15 治本 (V1.x counselor-mode W5-6 — ability-dimensions migration, 跟 src/migration/index.ts 1:1):
//   ability_dimensions + ability_scores 2 张表 + 5 索引, counselor-mode-v1.0 §6.3 1:1 wire.
import { AddAbilityDimensions1714900000007 } from '../src/migration/1714900000007-AddAbilityDimensions';
// V2026-10-15 治本 (V1.x counselor-mode W7-8 — quota_usage migration, 跟 src/migration/index.ts 1:1):
//   quota_usage 新表 + user_memberships 加 3 列, counselor-mode-v1.0 §6.4 + §7.1 1:1 wire.
import { AddQuotaUsage1714900000008 } from '../src/migration/1714900000008-AddQuotaUsage';
// V2026-10-19 治本 (V1.1 §6.5 — training_sessions migration, 跟 src/migration/index.ts 1:1):
//   training_sessions 新表 + 5 索引 (PRIMARY + 4 复合), counselor-mode-v1.1 §6.5 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingSession entity 1:1 (9 场景单次训练 session 持久化).
import { AddTrainingSessions1714900000009 } from '../src/migration/1714900000009-AddTrainingSessions';
// V2026-10-19 治本 (V1.1 §5.2 — training_exercises migration, 跟 src/migration/index.ts 1:1):
//   training_exercises 新表 + 5 索引 (PRIMARY + 4 复合), counselor-mode-v1.1 §5.2 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingExercise entity 1:1 (10 训练项 + AI 评分标准 + 专家反馈).
import { AddTrainingExercises1714900000010 } from '../src/migration/1714900000010-AddTrainingExercises';
// V2026-10-19 治本 (V1.1 §5.2 — training_exercise_attempts migration, 跟 src/migration/index.ts 1:1):
//   training_exercise_attempts 新表 + 4 索引 (PRIMARY + 3 复合), counselor-mode-v1.1 §5.2 1:1 wire,
//   跟 xin_su_app V0.5 client TrainingExerciseAttempt entity 1:1 (答题记录 + 5 状态机 + 维度分).
import { AddTrainingExerciseAttempts1714900000011 } from '../src/migration/1714900000011-AddTrainingExerciseAttempts';
// V2026-10-20 治本 (专项技能 Hero 显示偏好 — counselor_ui_preferences 新表):
//   治本: 本文件的 migrations 是**显式数组**(非 glob), 只在 src/migration/index.ts
//   导出是不够的 —— migration:run 只认这里列出的类. 漏登记的表现极具迷惑性:
//   命令输出 "No migrations are pending"(看起来像"都跑完了"), 实际是它压根没被看见,
//   表不建 → 运行时偏好接口 500. 与本文件 V2026-10-12 注释记录的同类问题同源.
import { AddCounselorUiPreferences1714900000012 } from '../src/migration/1714900000012-AddCounselorUiPreferences';
// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 张表, 跟前序 counselor_ui_preferences 同段):
//   visitor_full_personas (AI 底层全量人设 7 大块 json) + case_profile_entries (动态解锁档案),
//   跟 src/migration/index.ts 严格 1:1 对应.
import { AddVisitorFullPersonas1714900000013 } from '../src/migration/1714900000013-AddVisitorFullPersonas';
// V2026-10-21 治本 (V1.2 VS-C — M2 知情同意 + M3 会谈核心 3 张新表 + 5 处 ALTER, 跟前一 migration 同段):
//   live_supervision_hints / transcript_bookmarks / transference_resistance_marks
//   + training_sessions (知情同意 3 列 + tech_stats) + long_term_case_sessions (tech_stats).
import { AddCounselorSessionCore1714900000014 } from '../src/migration/1714900000014-AddCounselorSessionCore';
// V2026-10-22 治本 (V1.3 §2 — 微技能自由练习引擎 2 张新表, 跟前序 counselor_session_core 同段):
//   practice_scenarios (场景变体库) + practice_attempts (自由作答练习记录),
//   counselor-practice-engine-v1.3-freeform.md §2 拍板. 内容走独立 seed 脚本
//   (bin/seed-practice-scenarios.ts), 不进 migration (spec §6.3).
import { AddPracticeScenarios1714900000015 } from '../src/migration/1714900000015-AddPracticeScenarios';
// V2026-10-22 治本 (V1.3 §7.5 — 用户私有场景表, 跟前序 practice_scenarios 同段):
//   practice_custom_scenarios (用户私有场景, 与共享题库物理隔离)
//   + practice_attempts.scenario_source 列 + quota_usage.period 放宽到 VARCHAR(10).
import { AddPracticeCustomScenarios1714900000016 } from '../src/migration/1714900000016-AddPracticeCustomScenarios';
// V2026-10-22 治本 (首页金句 · 每日一句 — 2 张新表, 跟前序 practice_custom_scenarios 同段):
//   quotes (金句内容库) + user_quote_favorites (收藏关系). 内容走独立 seed 脚本
//   (bin/seed-quotes.ts), 不进 migration.
import { AddQuotes1714900000017 } from '../src/migration/1714900000017-AddQuotes';
// V2026-10-23 治本 (AI 模拟来访池 — 2 张新表 + 1 列 ALTER, 跟前序 quotes 同段):
//   visitor_pool_templates (公共只读模板: 表层卡片 + 7 大块剧本快照)
//   + visitor_pool_favorites (收藏关系, 唯一键 (user_id, template_id))
//   + visitor_full_personas.source_template_id (标注私有副本的来源模板).
//   内容不进 migration (spec §6): 6 个官方人物由 bin/seed-visitor-pool-templates.ts
//   按稳定 id 幂等 upsert, 运行时增补走 §3.5 内部 AI 生成端点.
import { AddVisitorPoolTemplates1714900000018 } from '../src/migration/1714900000018-AddVisitorPoolTemplates';
// V2026-10-23 治本 (AI 模拟来访池 — 3 个 id 列放宽到 VARCHAR(64), 跟前序同段):
//   模板 id 是内容 slug (最长 37 字符), 而 0018 建表时按 UUID 用了 CHAR(36)
//   → seed 报 "Data too long for column 'id'". 本迁移把 3 个相关列一起放宽
//   (与 quotes.id varchar(64) 对齐). 0018 已在 dev 库执行, 不改已执行的迁移.
import { WidenVisitorPoolIdColumns1714900000019 } from '../src/migration/1714900000019-WidenVisitorPoolIdColumns';
// V2026-10-14 治本 (VS-life-merge P0-治本 — life_map_drift_bottles migration 缺失):
//   DriftBottleEntry entity 早声明 (@Entity('life_map_drift_bottles')), 但 V3.0 dash
//   版 module 写完后 migration 漏写. 跟前序 3 张 V3.0 表 (life_stage_progress +
//   key_events + genome_dimensions) 模式一致, 漏写第 4 张. 即便现在挂上 life-map/
//   module, 6 endpoint 一调就 TypeORM TableNotFoundError. 治本: 创表 + 3 索引 + down 段.

// V2026-09-04 — 心塑 V6.0 §3 AI 引擎 5 张表 + §4.2 急救会话表 + §6 Inner World 游戏化解锁表 (audit P0-1/P0-3)

// V2026-09-11 — 心塑 V4.0 §6「好状态日记」1 张表 (good_state_diary_entries)

// V2026-09-11 — 心塑首页「微干预场景化元数据」表 (7 trigger 元数据 + V2 完整 stats 实现)

try {
  loadEnvFile();
} catch {}

const ormconfig = async (): Promise<DataSource> => {
  const config = <{ db: DataSourceOptions }>await configuration();

  return new DataSource({
    ...config.db,
    entities: [path.join(__dirname, '../src/entity/**/*.{js,ts}')],
    // V2: 显式列出迁移 (避免 glob 扫描 + ts-node 时序坑)
    migrations: [
      InitUser1700000000000,
      AddUserV2Fields1700000001000,
      AddSessionV2Fields1700000002000,
      AddPasswordHistory1700000003000,
      AddOAuthIdentity1700000004000,
      AddUserEmailIndex1700000005000,
      AddUserConsent1700000006000,
      // V3 Profile 模块迁移 (心塑「我的」Tab 二级页)
      AddUserProfile1700000007000,
      AddNotificationSettings1700000007001,
      AddMemberships1700000007002,
      AddCertifications1700000007003,
      AddCompanionRecords1700000007004,
      AddCompanionBindings1700000007005,
      AddSelfcareRecords1700000007006,
      AddBurnoutSettings1700000007007,
      AddConsentSignatures1700000007008,
      // V2026-08-28 — 「我的」Tab V2.0 新增表 (ai-conversations / dashboard / life-map / embodied / privacy)
      AddEmbodiedDevices1700000007009,
      AddEmbodiedPermissions1700000007010,
      AddAiChatSessions1700000007011,
      AddPrivacyAuthorizations1700000007012,
      // V2026-08-31 — 首页模块 (心塑 + 陪伴者首页, 4 张表)
      AddMoodLogs1700000008000,
      AddMicroInterventionConfigs1700000008001,
      AddMicroInterventionHistory1700000008002,
      AddHomeMessages1700000008003,
      // V2026-09-03 — 内心世界模块 (V4.0 §3 游戏化核心层, 6 张表)
      // 治本: 之前文件 1700000008000-InitInnerWorld.ts 存在但 ormconfig.ts 没 import 它,
      // migration:run 看不到这个 migration → 永远 "No migrations are pending" → 表不建 → bootstrap 500.
      InitInnerWorld1700000008000,
      // V2026-09-01 — 练习 Tab 模块 (心塑成长用户端 Tab2, 5 张表)
      AddPracticeTables1700000009000,
      // V2026-09-01 — 陪伴 Tab 模块 (心塑陪伴者端 Tab2, 5 张表 + 扩展 companion_records)
      AddCompanionTables1700000010000,
      ExtendCompanionRecord1700000010001,
      // V2026-09-01 — 人生地图 Tab 模块 (心塑成长用户端 Tab3, 3 张表)
      AddLifeStageProgress1700000010002,
      AddKeyEvents1700000010003,
      AddGenomeDimensions1700000010004,
      // V2026-10-14 治本 (VS-3c — 创 knowledge_chunks 表, 跟前序 3 张 V3.0 表同段):
      AddKnowledgeChunks1700000010006,
      // V2026-10-15 治本 (V1.x counselor-mode W1-2 — 创 long_term_cases + long_term_case_sessions
      //   2 张表 + 6 索引, 跟前序 knowledge_chunks 表同段, 跟 src/migration/index.ts 严格 1:1):
      AddLongTermCases1700000010007,
      // V2026-10-15 治本 (V1.x counselor-mode W3-4 — 创 supervision_schools + supervision_feedback
      //   2 张表 + 5 索引, 跟前序 long_term_cases 表同段, 跟 src/migration/index.ts 严格 1:1):
      AddSupervisionSchools1714900000006,
      // V2026-10-15 治本 (V1.x counselor-mode W5-6 — 创 ability_dimensions + ability_scores
      //   2 张表 + 5 索引, 跟前序 supervision_schools 表同段, 跟 src/migration/index.ts 严格 1:1):
      AddAbilityDimensions1714900000007,
      // V2026-10-15 治本 (V1.x counselor-mode W7-8 — 创 quota_usage 新表 + user_memberships 加
      //   3 列, 跟前序 ability_dimensions 表同段, 跟 src/migration/index.ts 严格 1:1):
      AddQuotaUsage1714900000008,
      // V2026-10-19 治本 (V1.1 §6.5 — training_sessions 新表 + 5 索引, 跟前序 quota_usage
      //   表同段, 跟 src/migration/index.ts 严格 1:1):
      AddTrainingSessions1714900000009,
      // V2026-10-19 治本 (V1.1 §5.2 — training_exercises 新表 + 5 索引, 跟前序 training_sessions
      //   表同段, 跟 src/migration/index.ts 严格 1:1):
      AddTrainingExercises1714900000010,
      // V2026-10-19 治本 (V1.1 §5.2 — training_exercise_attempts 新表 + 4 索引, 跟前序
      //   training_exercises 表同段, 跟 src/migration/index.ts 严格 1:1):
      AddTrainingExerciseAttempts1714900000011,
      // V2026-10-20 治本 (专项技能 Hero 显示偏好 — counselor_ui_preferences 新表 + 1 唯一索引,
      //   跟前序 training_exercise_attempts 表同段, 跟 src/migration/index.ts 严格 1:1):
      AddCounselorUiPreferences1714900000012,
      // V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 张表 + 6 索引, 跟前序 counselor_ui_preferences
      //   表同段, 跟 src/migration/index.ts 严格 1:1):
      AddVisitorFullPersonas1714900000013,
      // V2026-10-21 治本 (V1.2 VS-C — M2 知情同意 + M3 会谈核心 3 张新表 + 5 处 ALTER,
      //   跟前序 visitor_full_personas 同段, 跟 src/migration/index.ts 严格 1:1):
      AddCounselorSessionCore1714900000014,
      // V2026-10-22 治本 (V1.3 §2 — 微技能自由练习引擎 2 张新表 + 6 索引,
      //   跟前序 counselor_session_core 表同段, 跟 src/migration/index.ts 严格 1:1):
      AddPracticeScenarios1714900000015,
      // V2026-10-22 治本 (V1.3 §7.5 — 用户私有场景表 + practice_attempts.scenario_source
      //   列 + quota_usage.period 放宽, 跟前序 practice_scenarios 同段,
      //   跟 src/migration/index.ts 严格 1:1):
      AddPracticeCustomScenarios1714900000016,
      // V2026-10-22 治本 (首页金句 · 每日一句 — 2 张新表 + 5 索引,
      //   跟前序 practice_custom_scenarios 同段, 跟 src/migration/index.ts 严格 1:1):
      AddQuotes1714900000017,
      // V2026-10-23 治本 (AI 模拟来访池 — 2 张新表 + visitor_full_personas.source_template_id,
      //   跟前序 quotes 同段, 跟 src/migration/index.ts 严格 1:1):
      AddVisitorPoolTemplates1714900000018,
      // V2026-10-23 治本 (AI 模拟来访池 — 3 个 id 列放宽到 VARCHAR(64),
      //   跟前序 visitor_pool_templates 同段, 跟 src/migration/index.ts 严格 1:1):
      WidenVisitorPoolIdColumns1714900000019,
      // V2026-10-14 治本 (VS-life-merge) — 创 life_map_drift_bottles 表 + 3 索引, 跟前序 3 张 V3.0 表同段
      AddDriftBottles1700000010005,
      // V2026-09-04 — V6.0 AI 引擎 (§3) + 急救闭环 (§4.2) + Inner World 游戏化解锁 (§6)
      AddAIEngineTables1714900000000,
      AddEmergencySessions1714900000001,
      AddGameUnlockProgress1714900000002,
      // V2026-09-11 — 好状态日记 (good_state_diary_entries)
      AddGoodStateDiary1714900000003,
      // V2026-09-11 — 首页微干预场景化元数据 (7 trigger + 完整 stats 支撑)
      AddMicroInterventionScenarios1714900000004,
      // V2026-10-12 (Phase 8.x — 5 个新 migration):
      //   8.2 RBAC + tenantId (2 张表加列 + backfill) / 8.1 KB 模块 3 张表
      //   / 8.3 Analytics 1 张表 / 8.5 dev seed (3 admin 账户 + 5 KB 样例).
      //   治本: 显式列入 (跟 1714900000004 同段), 跟 bin/ormconfig.ts 顶部 import
      //   严格 1:1 对应, 防 migration:run "No migrations are pending" 漏建.
      AddUserTenantId1700000008000,
      AddUserAdminRole1700000008001,
      InitKnowledge1700000008010,
      InitAnalytics1700000008020,
      SeedDevData1700000009000,
    ],
    // migrationsRun: false (默认) — 手动 npm run migration:run
    // synchronize: false — 已禁, 强制走 migration
  });
};

// eslint-disable-next-line import/no-default-export
export default ormconfig();
