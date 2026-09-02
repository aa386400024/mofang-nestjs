import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — user_b_burnout_settings 表 (陪伴者耗竭预警设置).
 *
 * 设计:
 *   - PK = uid (1:1 with users)
 *   - 4 配置字段 (enable_warning / weekly_report / auto_rest / daily_limit)
 *   - daily_limit 用 TINYINT 0-255, 实际只 1-10
 *   - 默认值: 全开 + limit=5 (V2.0 §Tab4 默认)
 */
export class AddBurnoutSettings1700000007007 implements MigrationInterface {
  name = 'AddBurnoutSettings1700000007007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user_b_burnout_settings\` (
        \`uid\` char(36) NOT NULL,
        \`enable_warning\` tinyint(1) NOT NULL DEFAULT 1,
        \`enable_weekly_report\` tinyint(1) NOT NULL DEFAULT 1,
        \`auto_rest_reminder\` tinyint(1) NOT NULL DEFAULT 1,
        \`daily_limit\` tinyint NOT NULL DEFAULT 5,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        CONSTRAINT \`FK_user_b_burnout_settings_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`user_b_burnout_settings\`;`);
  }
}
