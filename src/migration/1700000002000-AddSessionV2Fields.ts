import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2 增强 — Session 实体新增字段 + 索引.
 *
 * 新增:
 *   - user_agent_raw: 原始 UA (列表展示)
 *   - device_type: 设备类型 (mobile/desktop/tablet/unknown)
 *   - location: 登录地点 (V3 接入 IP 地理位置)
 *   - last_active_at: 最后活跃时间
 *   - revoked_reason: 撤销原因
 */
export class AddSessionV2Fields1700000002000 implements MigrationInterface {
  name = 'AddSessionV2Fields1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`user_sessions\`
      ADD COLUMN \`user_agent_raw\` varchar(512) NULL AFTER \`device_info\`,
      ADD COLUMN \`device_type\` varchar(32) NOT NULL DEFAULT 'unknown' AFTER \`user_agent_raw\`,
      ADD COLUMN \`location\` varchar(128) NULL AFTER \`ip_address\`,
      ADD COLUMN \`last_active_at\` datetime(6) NULL AFTER \`location\`,
      ADD COLUMN \`revoked_reason\` varchar(64) NULL AFTER \`is_revoked\`;
    `);

    // 复合索引: 查"某用户的活跃 session" (多端管理 UI 用)
    await queryRunner.query(`
      ALTER TABLE \`user_sessions\`
      ADD INDEX \`IDX_user_sessions_user_active\` (\`user_id\`, \`is_revoked\`);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`user_sessions\`
      DROP INDEX \`IDX_user_sessions_user_active\`,
      DROP COLUMN \`revoked_reason\`,
      DROP COLUMN \`last_active_at\`,
      DROP COLUMN \`location\`,
      DROP COLUMN \`device_type\`,
      DROP COLUMN \`user_agent_raw\`;
    `);
  }
}
