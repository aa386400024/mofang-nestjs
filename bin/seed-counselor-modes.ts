// V2026-11-08 治本 (Phase2.5 WP-D · 咨询师模式 seed 执行入口):
//
//   用法: npm run seed:counselor-modes   (连跑两次, 第二次应「未变 7」)
//
//   方案与 bin/seed-visitor-pool-templates.ts 一致:
//     连接参数取自 configuration(), 实体显式声明, 不 bootstrap AppModule.

import 'reflect-metadata';

import { config as loadEnvFile } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { CounselorMode } from '../src/auto-practice/entities/counselor-mode.entity.js';
import { seedCounselorModes } from '../src/auto-practice/seeds/counselor-modes.seed-runner.js';
import { configuration } from '../src/config/configuration.js';

type DbConfig = DataSourceOptions & { autoLoadEntities?: boolean };

async function main(): Promise<void> {
  const envResult = loadEnvFile();
  if (envResult.error) {
    throw new Error(`加载 .env 失败: ${envResult.error.message}`);
  }
  if (!process.env.DB_HOST) {
    throw new Error('.env 中缺少 DB_HOST, 请补齐 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME');
  }
  process.stdout.write(`[seed:counselor-modes] 目标库 ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}\n`);

  const config = (await configuration()) as { db: DbConfig };
  const dbOptions: DbConfig = { ...config.db };
  delete dbOptions.autoLoadEntities;

  const dataSource = new DataSource({
    ...dbOptions,
    entities: [CounselorMode],
    migrations: [],
    logging: false,
    synchronize: false,
  });
  await dataSource.initialize();

  try {
    const result = await seedCounselorModes(dataSource);
    process.stdout.write(`[seed:counselor-modes] 新增 ${result.inserted} / 更新 ${result.updated} / 未变 ${result.unchanged}\n`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write('[seed:counselor-modes] 失败: ' + detail + '\n');
  process.exitCode = 1;
});
