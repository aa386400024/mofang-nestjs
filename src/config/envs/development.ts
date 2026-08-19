export const config = {
  db: {
    type: process.env.DB_TYPE ?? 'mysql',
    synchronize: false,
    logging: true,
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
