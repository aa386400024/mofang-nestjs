import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 会员体系 v2 — 账号列扩展 + 配额账本 + 预扣记录 + 订单 + 活动兑换。
 *
 * 前置：1714900000008 已加 tier_v2 / quota_period / quota_text_fallback；
 * 本迁移不重复加这三列，只补 v2 订阅状态机与账本所需列。
 *
 * 设计约束：
 *   - 手写 DDL（ADR-0003 禁用 synchronize），不建 DB 外键；
 *   - 所有金额 INT 分，所有分钟 INT；
 *   - 配额 lot 的 expires_at 必填，套餐/活动/加包各自独立过期。
 */
export class AddMembershipV2Tables1714900000049 implements MigrationInterface {
  name = 'AddMembershipV2Tables1714900000049';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE \`user_memberships\`
        ADD COLUMN \`period_start\` DATETIME(6) NULL AFTER \`tier_v2\`,
        ADD COLUMN \`period_end\` DATETIME(6) NULL AFTER \`period_start\`,
        ADD COLUMN \`auto_renew\` TINYINT(1) NOT NULL DEFAULT 0 AFTER \`period_end\`,
        ADD COLUMN \`source\` VARCHAR(16) NOT NULL DEFAULT 'system' AFTER \`auto_renew\`,
        ADD COLUMN \`legacy_tier\` VARCHAR(16) NULL AFTER \`source\`,
        ADD COLUMN \`last_order_id\` CHAR(36) NULL AFTER \`legacy_tier\`;
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`membership_quota_lots\` (
        \`id\` CHAR(36) NOT NULL PRIMARY KEY,
        \`uid\` CHAR(36) NOT NULL,
        \`source\` VARCHAR(16) NOT NULL,
        \`minutes_total\` INT NOT NULL,
        \`minutes_remaining\` INT NOT NULL,
        \`expires_at\` DATETIME(6) NOT NULL,
        \`order_id\` CHAR(36) NULL,
        \`campaign_id\` VARCHAR(64) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`idx_mql_uid_expires\` (\`uid\`, \`expires_at\`),
        INDEX \`idx_mql_source\` (\`source\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`membership_quota_reservations\` (
        \`id\` CHAR(36) NOT NULL PRIMARY KEY,
        \`uid\` CHAR(36) NOT NULL,
        \`session_id\` VARCHAR(64) NOT NULL,
        \`allocations\` JSON NOT NULL,
        \`reserved_minutes\` INT NOT NULL,
        \`settled_minutes\` INT NOT NULL DEFAULT 0,
        \`shortfall_minutes\` INT NOT NULL DEFAULT 0,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'held',
        \`expires_at\` DATETIME(6) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`uniq_mqr_session\` (\`session_id\`),
        INDEX \`idx_mqr_uid_status\` (\`uid\`, \`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`membership_orders\` (
        \`id\` CHAR(36) NOT NULL PRIMARY KEY,
        \`uid\` CHAR(36) NOT NULL,
        \`plan_id\` VARCHAR(32) NOT NULL,
        \`order_type\` VARCHAR(16) NOT NULL,
        \`billing_period\` VARCHAR(16) NOT NULL,
        \`list_amount_cents\` INT NOT NULL,
        \`discount_cents\` INT NOT NULL DEFAULT 0,
        \`amount_cents\` INT NOT NULL,
        \`gift_minutes\` INT NOT NULL DEFAULT 0,
        \`currency\` VARCHAR(8) NOT NULL DEFAULT 'CNY',
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'pending',
        \`payment_channel\` VARCHAR(16) NOT NULL DEFAULT 'reserved',
        \`idempotency_key\` VARCHAR(128) NULL,
        \`promotion_id\` VARCHAR(64) NULL,
        \`coupon_code\` VARCHAR(64) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`paid_at\` DATETIME(6) NULL,
        \`expires_at\` DATETIME(6) NULL,
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`uniq_mo_uid_idem\` (\`uid\`, \`idempotency_key\`),
        INDEX \`idx_mo_uid_created\` (\`uid\`, \`created_at\`),
        INDEX \`idx_mo_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`membership_promotion_redemptions\` (
        \`id\` CHAR(36) NOT NULL PRIMARY KEY,
        \`uid\` CHAR(36) NOT NULL,
        \`promotion_id\` VARCHAR(64) NOT NULL,
        \`order_id\` CHAR(36) NOT NULL,
        \`discount_cents\` INT NOT NULL,
        \`granted_minutes\` INT NOT NULL DEFAULT 0,
        \`revoked_at\` DATETIME(6) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`uniq_mpr_uid_promo_order\` (\`uid\`, \`promotion_id\`, \`order_id\`),
        INDEX \`idx_mpr_promo_created\` (\`promotion_id\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS \`membership_promotion_redemptions\`;`);
    await qr.query(`DROP TABLE IF EXISTS \`membership_orders\`;`);
    await qr.query(`DROP TABLE IF EXISTS \`membership_quota_reservations\`;`);
    await qr.query(`DROP TABLE IF EXISTS \`membership_quota_lots\`;`);
    await qr.query(`
      ALTER TABLE \`user_memberships\`
        DROP COLUMN \`last_order_id\`,
        DROP COLUMN \`legacy_tier\`,
        DROP COLUMN \`source\`,
        DROP COLUMN \`auto_renew\`,
        DROP COLUMN \`period_end\`,
        DROP COLUMN \`period_start\`;
    `);
  }
}
