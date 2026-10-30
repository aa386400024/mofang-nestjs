// V2026-10-20 治本 (训练题 DB mock seed 执行入口 — 最小 DataSource 方案):
//
//   用法: npm run seed:training   (连跑两次, 第二次应「未变 10」)
//
//   ── 方案要点 ──
//   连接参数取自 application 的 configuration() (与应用同源), 实体**显式声明**.
//   不 import bin/ormconfig: 其 entities glob 指向 ../src/entity/**, 而该目录只有
//   sampledb1/sampledb2 两个测试库文件, 匹配不到任何实体; 且本项目实体靠各模块
//   TypeOrmModule.forFeature 注册, 独立 DataSource 天生拿不到元数据.
//   不 bootstrap AppModule: 其含 ScheduleModule.forRoot(), 跑 seed 会启动全部 cron.
//
//   ── 三次踩坑记录 (均由 ts-node 静态检查暴露, 已全部修复) ──
//   1. TS2345: `new DataSource(ormconfig)` —— ormconfig 是 async, 默认导出是
//      Promise<DataSource>, 不能当 DataSourceOptions 用.
//   2. TS2352: 中转 `as Record<string, unknown>` 把 dbOptions 类型信息洗掉, 导致
//      断言回 DataSourceOptions 时丢失必需的 `type` 字段.
//      修法: 直接把 configuration() 的返回值断言成含 db 的具体形状, 不用中间
//      Record 中转, 类型信息全程保留.
//   3. TS6133: 生成代码时把 ${ 误转义成 \${ , 在 TS 模板字符串里 $ 被转义为
//      字面量, 表达式不再求值 → result / error 变成「未使用」变量.
//      修法: 落盘文本必须是未转义的 ${ 才能作为模板插值.
//
//   时间戳: 2026-10-20
import 'reflect-metadata';

// V2026-10-20 治本 (必须自行加载 .env — 否则连本机库失败):
//   原因: 本项目的 DB 配置全部来自环境变量 (见 src/config/envs/development.ts:
//     host: process.env.DB_HOST ?? '127.0.0.1' 等). 而 .env 是由 Nest 启动时的
//     ConfigModule.forRoot() 注入 process.env 的 —— 本脚本不经过 Nest, 直接调
//     configuration(), 于是 process.env 为空, 所有字段落回默认值 127.0.0.1,
//     表现为 ECONNREFUSED 127.0.0.1:3306, 看起来像"配置错了", 实则是"没加载".
//   反双胞胎:
//     - 不硬编码远程库地址/账号 (凭据只该来自 .env, 不进代码库)
//     - 加载失败不静默继续 (静默会退回本机默认值, 复现同一个难查的连接错误)
//   验证: 加载后显式断言 DB_HOST 存在, 缺失则直接报错并说明检查方向.
import { config as loadEnvFile } from 'dotenv';

import { DataSource, type DataSourceOptions } from 'typeorm';

import { configuration } from '../src/config/configuration';
import { CounselorUiPreference } from '../src/counselor/entities/counselor-ui-preference.entity';
import { TrainingExercise } from '../src/counselor/entities/training-exercise.entity';
import { seedTrainingExercises } from '../src/counselor/seeds/training-exercises.seed';

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
    `[seed:training] 目标库 ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}` + ` / schema ${process.env.DB_NAME}\n`,
  );

  // V2026-10-20 修: Config = Default & Production, 而 default.ts 的 db 是空对象字面量
  //   (字段全被注释), 因此 Config['db'] 推不出 `type` 等字段. 此处一次性把
  //   configuration() 的返回值断言成具体形状, 避免逐字段做 Record 中转丢类型.
  const config = (await configuration()) as { db: DbConfig };

  // autoLoadEntities 是 TypeOrmModule 的选项, 不是 TypeORM DataSource 的选项,
  // 剔除以免传入多余键.

  const { autoLoadEntities: _ignored, ...dbOptions } = config.db;

  const dataSource = new DataSource({
    ...dbOptions,
    // 治本: 实体必须显式列出 —— 本项目 db 配置不含 entities glob, 实体靠
    //   forFeature 注册, 独立 DataSource 不会自动带上.
    entities: [TrainingExercise, CounselorUiPreference],
    migrations: [],
    // development.ts 里为 true, 会把每条 SQL 打进日志淹没 seed 结果.
    logging: false,
    // ADR-0003: schema 只走 migration, 任何情况下不开 synchronize.
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const result = await seedTrainingExercises(dataSource);
    const total = result.inserted + result.updated + result.unchanged;
    process.stdout.write(
      '[seed:training] 新增 ' + result.inserted + ' / 更新 ' + result.updated + ' / 未变 ' + result.unchanged + '（合计 ' + total + '）\n',
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write('[seed:training] 失败: ' + detail + '\n');
  process.exitCode = 1;
});
