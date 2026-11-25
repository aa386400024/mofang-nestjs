import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AF-516 — 会员 v2 非支付闭环。
 *
 * 1. 新增 membership_promotions（运营可管理活动主数据），并播种两条既有首购活动。
 * 2. 新增 membership_plan_grant_terms（年付按月发放 term）。
 * 3. membership_quota_lots 加 reference_key（同订单多次发放的幂等子键）。
 *
 * 手写 DDL（ADR-0003 禁用 synchronize），不加 DB 外键；金额 INT 分、分钟 INT。
 */
export class AddMembershipPromotionAndPlanGrant1714900000055 implements MigrationInterface {
  name = 'AddMembershipPromotionAndPlanGrant1714900000055';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE \`membership_quota_lots\`
        ADD COLUMN \`reference_key\` VARCHAR(64) NULL AFTER \`order_id\`,
        ADD INDEX \`idx_mql_order_ref\` (\`order_id\`, \`reference_key\`);
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`membership_promotions\` (
        \`id\` CHAR(36) NOT NULL PRIMARY KEY,
        \`code\` VARCHAR(64) NOT NULL,
        \`name\` VARCHAR(128) NOT NULL,
        \`description\` VARCHAR(512) NOT NULL DEFAULT '',
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'draft',
        \`billing_period\` VARCHAR(16) NOT NULL,
        \`audience\` VARCHAR(16) NOT NULL DEFAULT 'first_purchase',
        \`auto_apply\` TINYINT(1) NOT NULL DEFAULT 1,
        \`starts_at\` DATETIME(6) NOT NULL,
        \`ends_at\` DATETIME(6) NOT NULL,
        \`prices\` JSON NOT NULL,
        \`floors\` JSON NULL,
        \`gift_minutes\` JSON NULL,
        \`budget_cents\` INT NULL,
        \`per_user_limit\` INT NOT NULL DEFAULT 1,
        \`priority\` INT NOT NULL DEFAULT 100,
        \`rule_version\` VARCHAR(64) NOT NULL DEFAULT 'membership-promotion-v1',
        \`created_by\` CHAR(36) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` DATETIME(6) NULL,
        UNIQUE INDEX \`uniq_mp_code\` (\`code\`),
        INDEX \`idx_mp_status_period\` (\`status\`, \`billing_period\`, \`starts_at\`, \`ends_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`membership_plan_grant_terms\` (
        \`id\` CHAR(36) NOT NULL PRIMARY KEY,
        \`uid\` CHAR(36) NOT NULL,
        \`order_id\` CHAR(36) NOT NULL,
        \`tier\` VARCHAR(16) NOT NULL,
        \`monthly_minutes\` INT NOT NULL,
        \`term_start\` DATETIME(6) NOT NULL,
        \`term_end\` DATETIME(6) NOT NULL,
        \`next_grant_at\` DATETIME(6) NULL,
        \`months_total\` INT NOT NULL,
        \`months_granted\` INT NOT NULL DEFAULT 0,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'active',
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`uniq_mpgt_order\` (\`order_id\`),
        INDEX \`idx_mpgt_status_next\` (\`status\`, \`next_grant_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await qr.query(`
      INSERT IGNORE INTO \`membership_promotions\`
        (\`id\`, \`code\`, \`name\`, \`description\`, \`status\`, \`billing_period\`, \`audience\`,
         \`auto_apply\`, \`starts_at\`, \`ends_at\`, \`prices\`, \`floors\`, \`gift_minutes\`,
         \`budget_cents\`, \`per_user_limit\`, \`priority\`, \`rule_version\`)
      VALUES
        ('campaign_first_monthly_2026', 'FIRST_MONTHLY', '新用户首期活动', '首购月付活动价，单用户限 1 次',
         'active', 'monthly', 'first_purchase', 1, '2026-11-01 00:00:00.000000', '2027-12-31 23:59:59.000000',
         '{"plus":6800,"pro":16800,"max":32800}', '{"plus":6800,"pro":16800,"max":32800}', '{}',
         5000000, 1, 100, 'membership-promotion-v1'),
        ('campaign_first_annual_2026', 'FIRST_ANNUAL', '首年限时年付', '首购年付活动价，单用户限 1 次',
         'active', 'annual', 'first_purchase', 1, '2026-11-01 00:00:00.000000', '2027-12-31 23:59:59.000000',
         '{"plus":68000,"pro":168000,"max":328000}', '{"plus":68000,"pro":168000,"max":328000}', '{}',
         10000000, 1, 100, 'membership-promotion-v1');
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS \`membership_plan_grant_terms\`;`);
    await qr.query(`DROP TABLE IF EXISTS \`membership_promotions\`;`);
    await qr.query(`
      ALTER TABLE \`membership_quota_lots\`
        DROP INDEX \`idx_mql_order_ref\`,
        DROP COLUMN \`reference_key\`;
    `);
  }
}
