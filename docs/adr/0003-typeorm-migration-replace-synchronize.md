# ADR-0003: 用 TypeORM Migration 替代 synchronize

> **Status**: ✅ Accepted (2026-08-19)
> **Deciders**: 大炮 + AI

## Context

V1 用 `synchronize: true` 让 TypeORM 自动建表 / 改 schema。

## Decision

**V2 全部走 TypeORM Migration**：
- `bin/ormconfig.ts` 显式列出所有 migration
- `npm run migration:generate / run / revert / show` 一套命令
- `synchronize: false`（生产强制）

## Reasons

### synchronize 的风险

```ts
// V1
synchronize: true
```

**生产事故场景**：

| 情况 | synchronize 行为 | 后果 |
|---|---|---|
| 加 NOT NULL 列 | 自动 `ALTER TABLE` 加列，但旧数据 NULL | 业务查询失败 |
| 删字段 | 自动 DROP COLUMN | 数据丢失 |
| 改列类型 | 自动 ALTER，可能锁表 | 线上事故 |
| 多实例同时启动 | 多个实例同时 ALTER | schema 冲突，库崩 |

**真实案例**：GitLab 2017 误删数据库事件，部分原因就是 schema auto-migration 触发的连锁反应。

### Migration 的优势

1. **版本管理** — schema 变更可追溯（migration 文件命名按时间戳）
2. **可回滚** — `migration:revert` 一键回退
3. **可审核** — PR review 时看到 schema 变更
4. **生产安全** — 必须显式 `migration:run`，DB 不会自动改
5. **CI 友好** — 可以跟代码一起 review + 在 CI 跑（保证不丢 migration）

## Consequences

### 正面
- 生产 schema 变更可预测、可回滚
- 多开发者协作 schema 不冲突
- CI 自动验证 migration

### 负面
- 开发时多一步（`migration:generate` 写文件）
- 初学者门槛（要懂 up / down）
- 必须顺序执行（migration 序号不能跳）

## Implementation

### 流程

```
1. 改 entity
2. npm run migration:generate -- src/migration/MigrationName
   → TypeORM 自动生成 up() + down()
3. 检查生成的 SQL (确认无破坏性变更)
4. git commit
5. CI 跑 migration:show 验证
6. 部署时手动 npm run migration:run
```

### V2 已建迁移

1. `1700000000000-InitUser` — users / sessions / audit_logs 三表
2. `1700000001000-AddUserV2Fields` — user 加 V2 字段
3. `1700000002000-AddSessionV2Fields` — session 加 V2 字段
4. `1700000003000-AddPasswordHistory` — 新表 password_history
5. `1700000004000-AddOAuthIdentity` — 新表 oauth_identities
6. `1700000005000-AddUserEmailIndex` — 性能索引

### bin/ormconfig.ts

```ts
return new DataSource({
  ...config.db,
  entities: [path.join(__dirname, '../src/entity/**/*.{js,ts}')],
  migrations: [
    InitUser1700000000000,
    AddUserV2Fields1700000001000,
    // ...
  ],
  synchronize: false, // 强制走 migration
});
```

### package.json scripts

```json
{
  "migration:generate": "typeorm-ts-node-commonjs -d bin/ormconfig.ts migration:generate",
  "migration:create": "typeorm-ts-node-commonjs migration:create",
  "migration:run": "typeorm-ts-node-commonjs -d bin/ormconfig.ts migration:run",
  "migration:revert": "typeorm-ts-node-commonjs -d bin/ormconfig.ts migration:revert",
  "migration:show": "typeorm-ts-node-commonjs -d bin/ormconfig.ts migration:show"
}
```

## Migration 安全规范

1. **不删字段** — 加 `deprecated_at` 软标记，V3 再删
2. **不直接改类型** — 加新列 + 数据迁移 + 删旧列
3. **加 NOT NULL 必须有 DEFAULT** — 兼容旧数据
4. **大表 ALTER 加锁** — 用 `pt-online-schema-change` 或 gh-ost
5. **每个 migration 必须有 down** — 紧急回滚用

## References

- [TypeORM Migrations](https://typeorm.io/migrations)
- [GitLab.com Database Incident](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)
- [Flyway Migration Patterns](https://flywaydb.org/documentation/concepts/migrations)