import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — user_notification_settings 表 (心塑「我的」Tab 通知设置).
 *
 * 设计:
 *   - PK = uid (1:1 with users)
 *   - 默认值在 column DEFAULT 声明 (新用户注册时自动套默认值)
 *   - 4 个开关 + 免打扰时段 + 提醒强度
 *   - quiet_start / quiet_end 用 varchar(5) 存 HH:mm 字符串 (跨时区友好, 客户端处理时区)
 */
export class AddNotificationSettings1700000007001 implements MigrationInterface {
  name = 'AddNotificationSettings1700000007001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user_notification_settings\` (
        \`uid\` char(36) NOT NULL,
        \`practice_reminder\` tinyint(1) NOT NULL DEFAULT 1,
        \`status_update\` tinyint(1) NOT NULL DEFAULT 1,
        \`companion_message\` tinyint(1) NOT NULL DEFAULT 1,
        \`quiet_start\` varchar(5) NOT NULL DEFAULT '22:00',
        \`quiet_end\` varchar(5) NOT NULL DEFAULT '08:00',
        \`reminder_intensity\` varchar(16) NOT NULL DEFAULT 'low',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        CONSTRAINT \`FK_user_notification_settings_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`user_notification_settings\`;`);
  }
}
