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
    ],
    // migrationsRun: false (默认) — 手动 npm run migration:run
    // synchronize: false — 已禁, 强制走 migration
  });
};

// eslint-disable-next-line import/no-default-export
export default ormconfig();
