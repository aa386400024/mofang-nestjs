export const config = {
  db: {
    type: process.env.DB_TYPE ?? 'mysql',
    synchronize: false,
    logging: false,
    replication: {
      master: {
        host: process.env.DB_HOST ?? 'masterHost',
        port: Number(process.env.DB_PORT ?? 3306),
        username: process.env.DB_USER ?? 'username',
        password: process.env.DB_PASSWORD ?? 'password',
        database: process.env.DB_NAME ?? 'dbname',
      },
      slaves: [
        {
          // fix if necessary
          host: 'slaveHost',
          port: 3306,
          username: 'username',
          password: process.env.DB_PASSWORD ?? 'password',
          database: 'dbname',
        },
      ],
    },
    extra: {
      connectionLimit: 30,
    },
    autoLoadEntities: true,
    // 生产环境 migrationsRun: false — 部署时单独跑 migration:run (可控可回滚)
  },
  graphql: {
    debug: false,
    playground: false,
  },
  foo: 'pro-bar',
};