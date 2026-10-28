// V2026-10-22 治本 (微技能场景内容库 seed 执行入口 — 最小 DataSource 方案):
//
//   用法: npm run seed:practice   (连跑两次, 第二次应「未变 60」)
//
//   ── 方案要点 (与 bin/seed-training-exercises.ts 同 pattern) ──
//   连接参数取自 application 的 configuration() (与应用同源), 实体**显式声明**.
//   不 import bin/ormconfig: 其 entities glob 指向 ../src/entity/**, 匹配不到本模块
//   的实体; 且本项目实体靠各模块 TypeOrmModule.forFeature 注册, 独立 DataSource
//   天生拿不到元数据.
//   不 bootstrap AppModule: 其含 ScheduleModule.forRoot(), 跑 seed 会启动全部 cron.
//
//   ── 为什么内容不进 migration ──
//   spec §6.3 硬约束: 内容库 seed 走独立脚本按 scenario_key upsert, 不进 migration.
//   场景内容是会持续演进的**内容**而非结构变更, 灌进 migration 会让迁移历史被
//   业务文案淹没, 且 migration 只跑一次, 内容无法幂等重灌.
//
//   ── 失败语义 ──
//   内容库自检不通过 → 脚本直接失败且**不写库**: 内容错了要在灌库之前炸掉,
//   而不是灌进库再让线上用户碰到.
//
//   时间戳: 2026-10-22
import 'reflect-metadata';

// 必须自行加载 .env — 否则连本机库失败.
//   本项目的 DB 配置全部来自环境变量 (见 src/config/envs/development.ts), 而 .env
//   是由 Nest 启动时的 ConfigModule.forRoot() 注入 process.env 的 —— 本脚本不经过
//   Nest, 直接调 configuration(), 于是 process.env 为空, 所有字段落回默认值
//   127.0.0.1, 表现为 ECONNREFUSED 127.0.0.1:3306, 看起来像"配置错了", 实则是"没加载".
import { config as loadEnvFile } from 'dotenv';

import { DataSource, type DataSourceOptions } from 'typeorm';

import { configuration } from '../src/config/configuration';
import { PracticeScenario } from '../src/counselor/entities/practice-scenario.entity';
import { seedPracticeScenarios } from '../src/counselor/seeds/practice-scenarios.seed';

type DbConfig = DataSourceOptions & { autoLoadEntities?: boolean };

async function main(): Promise<void> {
  // 与 Nest ConfigModule 同源: 从项目根 .env 加载到 process.env
  const envResult = loadEnvFile();
  if (envResult.error) {
    throw new Error(
      `加载 .env 失败: ${envResult.error.message}。` +
        '若目标数据库不在本机, 请确认项目根目录存在 .env, 且含 ' +
        'DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME 五个键。',
    );
  }

  // 显式断言: 防止 .env 存在但缺 DB_HOST 时静默落回 127.0.0.1 默认值.
  // 只回显 host/port/database 这类非敏感定位信息, 不打印密码.
  if (!process.env.DB_HOST) {
    throw new Error(
      '.env 中缺少 DB_HOST, 将无法确定目标数据库位置。' + '请补齐 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME 后重试。',
    );
  }
  process.stdout.write(
    `[seed:practice] 目标库 ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}` + ` / schema ${process.env.DB_NAME}\n`,
  );

  // Config = Default & Production, 而 default.ts 的 db 是空对象字面量 (字段全被注释),
  // 因此 Config['db'] 推不出 `type` 等字段. 此处一次性把 configuration() 的返回值
  // 断言成具体形状, 避免逐字段做 Record 中转丢类型.
  const config = (await configuration()) as { db: DbConfig };

  // autoLoadEntities 是 TypeOrmModule 的选项, 不是 TypeORM DataSource 的选项, 剔除以免传入多余键.
  const { autoLoadEntities: _ignored, ...dbOptions } = config.db;

  const dataSource = new DataSource({
    ...dbOptions,
    // 治本: 实体必须显式列出 —— 本项目 db 配置不含 entities glob, 实体靠
    //   forFeature 注册, 独立 DataSource 不会自动带上.
    entities: [PracticeScenario],
    migrations: [],
    // development.ts 里为 true, 会把每条 SQL 打进日志淹没 seed 结果.
    logging: false,
    // ADR-0003: schema 只走 migration, 任何情况下不开 synchronize.
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const result = await seedPracticeScenarios(dataSource);
    const total = result.inserted + result.updated + result.unchanged;
    process.stdout.write(
      '[seed:practice] 新增 ' + result.inserted + ' / 更新 ' + result.updated + ' / 未变 ' + result.unchanged + '（合计 ' + total + '）\n',
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write('[seed:practice] 失败: ' + detail + '\n');
  process.exitCode = 1;
});
