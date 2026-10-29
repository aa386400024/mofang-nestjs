// V2026-10-29 治本 (WP9-B — 角色资产池内容库 seed 执行入口 — 最小 DataSource 方案):
//
//   用法: npm run seed:character-profiles   (连跑两次, 第二次应「未变 4」)
//
//   ── 方案要点 (与 bin/seed-visitor-pool-templates.ts / bin/seed-quotes.ts 保持一致) ──
//   连接参数取自 application 的 configuration() (与应用同源), 实体**显式声明**.
//   不 import bin/ormconfig: 其 entities glob 指向 ../src/entity/**, 匹配不到
//   本仓实体; 且本项目实体靠各模块 TypeOrmModule.forFeature 注册, 独立 DataSource
//   天生拿不到元数据.
//   不 bootstrap AppModule: 其含 ScheduleModule.forRoot(), 跑 seed 会启动全部 cron.
//
//   ── 为什么角色内容要从**来访池内容**派生 ──
//   同一个公共人物 (例: 晚晴) 的核心信念必须只有一个真相 —— 引擎侧的
//   character_profiles 与速查卡侧的 visitor_pool_templates 讲的是同一个人.
//   所以这里的 coreBeliefs 不是手写的, 而是**从 visitor_pool_templates 的
//   script.innerWorkingModel.coreBeliefs 抽取**; 手写 = 第二份真相, 必然漂.
//
//   ── 内容基线自检 ──
//   内容一旦有结构性错误 (模板对不上 / 信念数量对不上 / 数值越界), 应该**在这里**
//   就炸, 而不是等线上发现"这个角色的引擎基线和速查卡对不上".
//
//   时间戳: 2026-10-29
import 'reflect-metadata';

// 必须自行加载 .env (与 seed-visitor-pool-templates.ts 同理): DB 配置全来自环境变量,
// 而 .env 是 Nest 启动时的 ConfigModule 注入的; 本脚本不经过 Nest, 直接调
// configuration() 时 process.env 为空, 所有字段会落回 127.0.0.1 默认值.
import { config as loadEnvFile } from 'dotenv';

import { DataSource, type DataSourceOptions } from 'typeorm';

import { configuration } from '../src/config/configuration';
import { VISITOR_POOL_TEMPLATE_SEEDS } from '../src/counselor/config/visitor-pool-seed';
import { CharacterProfileEntity } from '../src/engine-adapters/wiring/character/character-profile.entity';
import {
  buildCharacterProfileSeeds,
  seedCharacterProfiles,
  validateCharacterProfileSeedSpecs,
} from '../src/engine-adapters/wiring/character/character-profile.seed';

type DbConfig = DataSourceOptions & { autoLoadEntities?: boolean };

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
    `[seed:character-profiles] 目标库 ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}` + ` / schema ${process.env.DB_NAME}\n`,
  );

  // 内容基线自检: 结构/边界一旦有错, 在这里就炸, 不进库.
  const seedError = validateCharacterProfileSeedSpecs(VISITOR_POOL_TEMPLATE_SEEDS);
  if (seedError) {
    throw new Error(`角色内容基线自检失败: ${seedError}`);
  }
  process.stdout.write(`[seed:character-profiles] 内容基线自检通过, 共 ${VISITOR_POOL_TEMPLATE_SEEDS.length} 个公共模板可对齐\n`);

  const config = (await configuration()) as { db: DbConfig };

  // autoLoadEntities 是 TypeOrmModule 的选项, 不是 TypeORM DataSource 的选项,
  // 剔除以免传入多余键.
  const dbOptions: DbConfig = { ...config.db };
  delete dbOptions.autoLoadEntities;

  const dataSource = new DataSource({
    ...dbOptions,
    entities: [CharacterProfileEntity],
    migrations: [],
    logging: false,
    // ADR-0003: schema 只走 migration, 任何情况下不开 synchronize.
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const seeds = buildCharacterProfileSeeds(VISITOR_POOL_TEMPLATE_SEEDS);
    const result = await seedCharacterProfiles(dataSource, seeds);
    const total = result.inserted + result.updated + result.unchanged;
    process.stdout.write(
      '[seed:character-profiles] 新增 ' +
        result.inserted +
        ' / 更新 ' +
        result.updated +
        ' / 未变 ' +
        result.unchanged +
        '（合计 ' +
        total +
        '）\n',
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write('[seed:character-profiles] 失败: ' + detail + '\n');
  process.exitCode = 1;
});
