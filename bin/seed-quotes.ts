// V2026-10-22 治本 (首页金句内容库 seed 执行入口 — 最小 DataSource 方案):
//
//   用法: npm run seed:quotes   (连跑两次, 第二次应「未变 16」)
//
//   ── 方案要点 (与 bin/seed-training-exercises.ts 保持一致) ──
//   连接参数取自 application 的 configuration() (与应用同源), 实体**显式声明**.
//   不 import bin/ormconfig: 其 entities glob 指向 ../src/entity/**, 匹配不到
//   本仓实体; 且本项目实体靠各模块 TypeOrmModule.forFeature 注册, 独立 DataSource
//   天生拿不到元数据.
//   不 bootstrap AppModule: 其含 ScheduleModule.forRoot(), 跑 seed 会启动全部 cron.
//
//   ── 背景图 CDN base ──
//   背景图完整地址 = base + 文件名. base 走 env `QUOTE_CDN_BASE_URL` (缺省
//   https://cdn.xinsu.app/quote/). 换 CDN 供应商时改 env 后**重跑本脚本**即可
//   (seed 是 upsert, 会把 background_url 刷成新 base 下的地址).
//
//   ── 内容库为空的兜底 ──
//   `quotes` 表为空时, 首页金句端点返回 404, 前端回退本地种子 (spec §4
//   「远端不可达时前端回退本地种子, 不得白屏或报错」). 故 seed 未跑不会白屏.
//
//   ── 踩坑记录 (沿用 seed-training-exercises 的 3 条, 此处不重复) ──
//   1. configuration() 是 async, 不能当 DataSourceOptions 用
//   2. 中转 as Record<string, unknown> 会洗掉 db 类型信息
//   3. 模板字符串里的 ${ 必须不转义
//
//   时间戳: 2026-10-22
import 'reflect-metadata';

// 必须自行加载 .env (与 seed-training-exercises.ts 同理): DB 配置全来自环境变量,
// 而 .env 是 Nest 启动时的 ConfigModule 注入的; 本脚本不经过 Nest, 直接调
// configuration() 时 process.env 为空, 所有字段会落回 127.0.0.1 默认值.
import { config as loadEnvFile } from 'dotenv';

import { DataSource, type DataSourceOptions } from 'typeorm';

import { configuration } from '../src/config/configuration';
import {
  QUOTE_CDN_BASE_URL_DEFAULT,
  QUOTE_CDN_BASE_URL_ENV_KEY,
  QUOTE_SEEDS,
  validateQuoteSeeds,
} from '../src/counselor/config/quote-seeds';
import { Quote } from '../src/counselor/entities/quote.entity';
import { seedQuotes } from '../src/counselor/seeds/quotes.seed';

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
  process.stdout.write(`[seed:quotes] 目标库 ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}` + ` / schema ${process.env.DB_NAME}\n`);

  // 内容基线自检: 内容库一旦有结构性错误 (id 撞号/署名无出处), 应该**在这里**就炸,
  // 而不是等到线上发现某条金句署名对不上.
  const seedError = validateQuoteSeeds(QUOTE_SEEDS);
  if (seedError) {
    throw new Error(`金句内容基线自检失败: ${seedError}`);
  }

  const config = (await configuration()) as { db: DbConfig };

  // autoLoadEntities 是 TypeOrmModule 的选项, 不是 TypeORM DataSource 的选项,
  // 剔除以免传入多余键.
  // (不用解构 + 弃用变量: 弃用变量会同时撞 naming-convention 与 no-unused-vars 两条规则;
  //  这里改成拷贝后 delete, 语义一样且无残留变量.)
  const dbOptions: DbConfig = { ...config.db };
  delete dbOptions.autoLoadEntities;

  const dataSource = new DataSource({
    ...dbOptions,
    entities: [Quote],
    migrations: [],
    logging: false,
    // ADR-0003: schema 只走 migration, 任何情况下不开 synchronize.
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const baseUrl = (process.env[QUOTE_CDN_BASE_URL_ENV_KEY] ?? QUOTE_CDN_BASE_URL_DEFAULT).trim();
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    process.stdout.write(`[seed:quotes] 背景图 CDN base ${normalizedBase}\n`);

    const result = await seedQuotes(dataSource, (assetFileName) => `${normalizedBase}${assetFileName}`);
    const total = result.inserted + result.updated + result.unchanged;
    process.stdout.write(
      '[seed:quotes] 新增 ' + result.inserted + ' / 更新 ' + result.updated + ' / 未变 ' + result.unchanged + '（合计 ' + total + '）\n',
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write('[seed:quotes] 失败: ' + detail + '\n');
  process.exitCode = 1;
});
