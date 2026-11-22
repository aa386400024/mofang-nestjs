// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 — 锚点清单导入执行入口):
//
//   用法: pnpm seed:quality-annotations   (连跑两次, 第二次应「未变 30」)
//
//   ── 方案要点 (与 bin/seed-character-profiles.ts / bin/seed-quotes.ts 保持一致) ──
//   连接参数取自 application 的 configuration() (与应用同源), 实体**显式声明**.
//   不 import bin/ormconfig: 其 entities glob 指向 ../src/entity/**, 匹配不到
//   本仓实体; 且本项目实体靠各模块 TypeOrmModule.forFeature 注册.
//   不 bootstrap AppModule: 其含 ScheduleModule.forRoot(), 跑 seed 会启动全部 cron.
//
//   ── 本脚本**只导身份三列** (会话 id / 角色代号 / 依恋风格) ──
//   CSV 后三列是自动口径值, 导进来会破坏双盲 (见 src/quality/quality-annotation.seed.ts).
//
//   时间戳: 2026-11-10 GMT+8
import 'reflect-metadata';

// 必须自行加载 .env (与 seed-character-profiles.ts 同理): DB 配置全来自环境变量,
// 而 .env 是 Nest 启动时的 ConfigModule 注入的; 本脚本不经过 Nest.
import { config as loadEnvFile } from 'dotenv';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DataSource, type DataSourceOptions } from 'typeorm';

import { configuration } from '../src/config/configuration.js';
import { QualityAnnotationEntity } from '../src/quality/quality-annotation.entity.js';
import { parseAnchorCsv, seedQualityAnnotations } from '../src/quality/quality-annotation.seed.js';

type DbConfig = DataSourceOptions & { autoLoadEntities?: boolean };

/** 锚点清单路径 (相对进程工作目录). */
const ANCHOR_CSV_PATH = resolve(process.cwd(), 'data/quality/anchor-sample-30.csv');

async function main(): Promise<void> {
  const envResult = loadEnvFile();
  if (envResult.error) {
    throw new Error(
      `加载 .env 失败: ${envResult.error.message}。` +
        '若目标数据库不在本机, 请确认项目根目录存在 .env, 且含 ' +
        'DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME 五个键。',
    );
  }

  if (!process.env.DB_HOST) {
    throw new Error(
      '.env 中缺少 DB_HOST, 将无法确定目标数据库位置。' + '请补齐 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME 后重试。',
    );
  }
  process.stdout.write(
    `[seed:quality-annotations] 目标库 ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}` + ` / schema ${process.env.DB_NAME}\n`,
  );

  const rows = parseAnchorCsv(await readFile(ANCHOR_CSV_PATH, 'utf8'));
  process.stdout.write(`[seed:quality-annotations] 锚点清单 ${rows.length} 行 (只导身份三列, 标注列留空)\n`);

  const config = (await configuration()) as { db: DbConfig };

  // autoLoadEntities 是 TypeOrmModule 的选项, 不是 TypeORM DataSource 的选项,
  // 剔除以免传入多余键.
  const dbOptions: DbConfig = { ...config.db };
  delete dbOptions.autoLoadEntities;

  const dataSource = new DataSource({
    ...dbOptions,
    entities: [QualityAnnotationEntity],
    migrations: [],
    logging: false,
    // ADR-0003: schema 只走 migration, 任何情况下不开 synchronize.
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const result = await seedQualityAnnotations(dataSource.getRepository(QualityAnnotationEntity), rows);
    process.stdout.write(
      '[seed:quality-annotations] 新增 ' +
        result.inserted +
        ' / 更新 ' +
        result.updated +
        ' / 未变 ' +
        result.unchanged +
        '（合计 ' +
        (result.inserted + result.updated + result.unchanged) +
        '）\n',
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write('[seed:quality-annotations] 失败: ' + detail + '\n');
  process.exitCode = 1;
});
