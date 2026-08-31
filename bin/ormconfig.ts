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

// V2026-08-31 — 「首页」Tab V2.0 模块 (心塑首页 + 陪伴者首页, 4 张表)
import { AddMoodLogs1700000008000 } from '../src/migration/1700000008000-AddMoodLogs';
import { AddMicroInterventionConfigs1700000008001 } from '../src/migration/1700000008001-AddMicroInterventionConfigs';
import { AddMicroInterventionHistory1700000008002 } from '../src/migration/1700000008002-AddMicroInterventionHistory';
import { AddHomeMessages1700000008003 } from '../src/migration/1700000008003-AddHomeMessages';

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
    ],
    // migrationsRun: false (默认) — 手动 npm run migration:run
    // synchronize: false — 已禁, 强制走 migration
  });
};

// eslint-disable-next-line import/no-default-export
export default ormconfig();
