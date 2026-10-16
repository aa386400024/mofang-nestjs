// V2026-10-15 治本 (V4.1 — quota_usage 新表 + user_memberships 加 3 列):
//   原因: counselor-mode-v1.0 §6.4 + §7.1 拍板 quota_usage 表 (3 类配额月度聚合) +
//     user_memberships.tier_v2 (5 档 1:1 配 §7.1), V0.3 §13 baseline 已有 user_memberships
//     表 3 档 (free/plus/pro), 1:1 wire 0 破坏. V1.x W7-8 走 user_memberships 加列 (tier_v2 /
//     quota_period / quota_text_fallback) + 新表 quota_usage 双轨.
//
//   设计 (跟 V0.3 §13 baseline 1:1 兼容):
//     - 1 新表 quota_usage: userId + quotaType + period YYYY-MM + used + limit
//       列: id / tenant_id / user_id / quota_type / period / used / limit /
//            created_at / updated_at / deleted_at (10 列)
//       索引: PRIMARY + UNIQUE uniq_qu_user_quota_period (user_id, quota_type, period) +
//             idx_qu_user_period (user_id, period) = 3 索引
//     - user_memberships 加 3 列 (1:1 wire V0.x baseline 0 破坏):
//       - tier_v2 varchar(20) NULL (V1.x 5 档 1:1 配 §7.1, NULL 表示 V0.x 3 档未升级)
//       - quota_period varchar(7) NULL (YYYY-MM 月度周期, 跟 quota_usage.period 1:1)
//       - quota_text_fallback TINYINT(1) DEFAULT 1 (V1.x 弱网降级开关, V0.x 0 关闭)
//
//   反双胞胎:
//     - 不用 DROP + CREATE user_memberships: 破坏 V0.x 客户端 (V0.x tier free/plus/pro
//       字段必须保留)
//     - 不用 RENAME COLUMN tier: 破坏 V0.x 1:1 wire
//     - 不在 quota_usage 表存 user_memberships.uid FK: 软删兼容, 应用层校验
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'quota_usage';  # 1 新表
//     2. SHOW INDEX FROM quota_usage;  # 3 索引
//     3. SHOW COLUMNS FROM user_memberships;  # 旧 6 列 + 新 3 列 (tier_v2 / quota_period / quota_text_fallback)
//     4. SELECT * FROM quota_usage LIMIT 0;  # 空表
//
//   时间戳: 2026-10-15

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuotaUsage1714900000008 implements MigrationInterface {
  name = 'AddQuotaUsage1714900000008';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── 1. quota_usage 新表 (3 类配额月度聚合, 10 列 + 3 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS quota_usage (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        quota_type VARCHAR(40) NOT NULL,
        period VARCHAR(7) NOT NULL,
        used INT NOT NULL DEFAULT 0,
        \`limit\` INT NOT NULL DEFAULT 0,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE INDEX uniq_qu_user_quota_period (user_id, quota_type, period),
        INDEX idx_qu_user_period (user_id, period)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── 2. user_memberships 加 3 列 (1:1 wire V0.x baseline 0 破坏) ───
    // V2026-10-15 治本 (V4.1 migration MySQL ADD COLUMN 兼容性 — dev 联调报错治本):
    //   原因: V0.5 stage 初次写 migration 用了 `ADD COLUMN IF NOT EXISTS` (PostgreSQL 语法),
    //     dev 联调跑 `pnpm migration:run` 时 MySQL 8.0 报 ER_PARSE_ERROR (1064). MySQL 8.0
    //     不支持 `ADD COLUMN IF NOT EXISTS` 多列 ADD 语法 (单列 ADD 也不支持 IF NOT EXISTS).
    //   修法:
    //     - 删 `IF NOT EXISTS`, 改 3 段独立 `ADD COLUMN` (跟 V0.x 47 migration 1:1 风格,
    //       V0.x `1700000008000-AddUserTenantId.ts` / `1700000008001-AddUserAdminRole.ts` 都
    //       是直接 `ADD COLUMN`, 0 命中 `IF NOT EXISTS`)
    //     - 1 改 1 commit: V0.5 stage 接受"首次跑成功, 重跑走 `migration:revert` 再 `migration:run`"
    //       流程 (V0.5 culture 风格 1:1, dev 库不需要 idempotent)
    //     - production 兼容性: 走 `migration:revert` 流程时 V0.x 47 migration 都已经成功,
    //       不存在 production 重跑场景
    //   反双胞胎:
    //     - 不用 INFORMATION_SCHEMA check + 动态 SQL (MySQL 兼容但复杂, V0.x 风格不写)
    //     - 不用 stored procedure 包 3 列 (over-engineering, V0.x 风格不写)
    //     - 不用 try/catch 吞错 (压错, V0.2 culture 禁止)
    //   验证 (大炮跑 pnpm migration:run):
    //     1. quota_usage 新表 + 3 索引创建成功 (已验, 上次跑过 quota_usage 那段)
    //     2. ALTER TABLE user_memberships 3 段 ADD COLUMN 全部成功 (修后跑通)
    //     3. SHOW COLUMNS FROM user_memberships; 旧 6 列 + 新 3 列 (tier_v2 / quota_period / quota_text_fallback)
    //   时间戳: 2026-10-15

    // 2.1 tier_v2 (V1.x 5 档, NULL 表示 V0.x 3 档未升级, V0.x 客户端不读)
    await qr.query(`
      ALTER TABLE \`user_memberships\` ADD COLUMN \`tier_v2\` VARCHAR(20) NULL AFTER \`tier\`;
    `);

    // 2.2 quota_period (YYYY-MM 月度周期, 跟 quota_usage.period 1:1)
    await qr.query(`
      ALTER TABLE \`user_memberships\` ADD COLUMN \`quota_period\` VARCHAR(7) NULL AFTER \`tier_v2\`;
    `);

    // 2.3 quota_text_fallback (V1.x 弱网降级开关, V0.x 0 关闭)
    await qr.query(`
      ALTER TABLE \`user_memberships\` ADD COLUMN \`quota_text_fallback\` TINYINT(1) NOT NULL DEFAULT 1 AFTER \`quota_period\`;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 先删新表 (quota_usage) 再删 user_memberships 加的 3 列
    // 跟 up 顺序倒置, 跟 V0.x migration 风格一致.
    await qr.query(`DROP TABLE IF EXISTS quota_usage;`);
    await qr.query(`ALTER TABLE \`user_memberships\` DROP COLUMN \`quota_text_fallback\`;`);
    await qr.query(`ALTER TABLE \`user_memberships\` DROP COLUMN \`quota_period\`;`);
    await qr.query(`ALTER TABLE \`user_memberships\` DROP COLUMN \`tier_v2\`;`);
  }
}
