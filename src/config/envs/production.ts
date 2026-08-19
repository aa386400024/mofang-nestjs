// V2-temp: 当前生产是单 MySQL 实例 (master + slave 占位符 slaveHost 不存在).
// 退化为简单连接 (跟 development 一致), 后续要主从读写分离再拆 replication.
// V3 计划: 主库 + N 个从库时, 恢复 replication 结构 + 在 env 加 DB_SLAVE_HOSTS.

export const config = {
  db: {
    type: process.env.DB_TYPE ?? 'mysql',
    synchronize: false,
    logging: false, // 生产关闭 SQL 日志, 改用 Prometheus DB metrics
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    username: process.env.DB_USER ?? 'username',
    password: process.env.DB_PASSWORD ?? 'password',
    database: process.env.DB_NAME ?? 'dbname',
    extra: {
      connectionLimit: 30, // 生产比 dev 大 (默认 10)
    },
    autoLoadEntities: true,
    // migrations 路径已通过 bin/ormconfig.ts 注入, 此处不再声明
    // migrationsRun: false (默认) — 手动执行 npm run migration:run
  },
  graphql: {
    debug: false,
    playground: false,
  },
  foo: 'pro-bar',
};
