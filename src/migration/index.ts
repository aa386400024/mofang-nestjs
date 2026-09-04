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

// V3 migration 列表直接加到 bin/ormconfig.ts (V2 pattern, 显式列出避免 glob 扫描时序坑).
