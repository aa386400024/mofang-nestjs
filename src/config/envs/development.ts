import { DB_SLOW_QUERY_THRESHOLD_MS, resolveDbLoggingLevels } from './db-logging.js';

export const config = {
  db: {
    type: process.env.DB_TYPE ?? 'mysql',
    synchronize: false,
    // V2026-11-10 (WP-H 新增 10): 缺省**关** query 日志 (跑批期噪音是主要痛点),
    //   error / warn / migration 永远保留 —— 慢查询仍按 warn 落.
    //   需要排查 SQL 时临时设 DB_QUERY_LOGGING=true.
    logging: resolveDbLoggingLevels(process.env.DB_QUERY_LOGGING),
    // 慢查询阈值 (ms): 超时的 SQL 按 warn 级别落日志 (跟上面的 warn 保留配套).
    maxQueryExecutionTime: DB_SLOW_QUERY_THRESHOLD_MS,
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    username: process.env.DB_USER ?? 'username',
    password: process.env.DB_PASSWORD ?? 'password',
    database: process.env.DB_NAME ?? 'dbname',
    extra: {
      connectionLimit: 10,
    },
    autoLoadEntities: true,
    // migrations 路径已通过 bin/ormconfig.ts 注入, 此处不再声明
    // migrationsRun: false (默认) — 手动执行 npm run migration:run
  },
  foo: 'dev-bar',
};
