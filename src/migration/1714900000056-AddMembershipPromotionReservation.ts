import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AF-517 — 会员非支付链企业级加固。
 *
 * 新增 membership_promotion_reservations：活动预算/限次预占表。
 * 下单占 held，支付确认 consumed，退款/超时释放 released；报价与统计把 held 计入，
 * 防止并发 pending 订单绕过预算和单用户限次。
 *
 * 手写 DDL（ADR-0003 禁用 synchronize），不加 DB 外键；金额 INT 分、分钟 INT。
 */
export class AddMembershipPromotionReservation1714900000056 implements MigrationInterface {
  name = 'AddMembershipPromotionReservation1714900000056';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS \`membership_promotion_reservations\` (
        \`id\` CHAR(36) NOT NULL PRIMARY KEY,
        \`uid\` CHAR(36) NOT NULL,
        \`promotion_id\` VARCHAR(64) NOT NULL,
        \`order_id\` CHAR(36) NOT NULL,
        \`discount_cents\` INT NOT NULL DEFAULT 0,
        \`gift_minutes\` INT NOT NULL DEFAULT 0,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'held',
        \`expires_at\` DATETIME(6) NOT NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`uniq_mprsv_order\` (\`order_id\`),
        INDEX \`idx_mprsv_promo_status\` (\`promotion_id\`, \`status\`, \`expires_at\`),
        INDEX \`idx_mprsv_status_expires\` (\`status\`, \`expires_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query('DROP TABLE IF EXISTS `membership_promotion_reservations`;');
  }
}
