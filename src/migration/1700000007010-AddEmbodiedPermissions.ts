import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-08-28 — embodied_permissions 表 (心塑具身数据权限 1:1).
 *
 * 设计:
 *   - PK = uid (1:1 with users, 跟 membership / notification_settings 模式一致)
 *   - 4 列权限开关 + 1 列总闸 (默认全 true)
 *   - 不拆 4 行 table: 一致性更好, 单行 update 即可
 *   - 总闸 master_sensor_enabled 默认 true, 关掉降级手动模式
 */
export class AddEmbodiedPermissions1700000007010 implements MigrationInterface {
  name = 'AddEmbodiedPermissions1700000007010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`embodied_permissions\` (
        \`uid\` char(36) NOT NULL,
        \`practice_realtime_guide\` tinyint(1) NOT NULL DEFAULT 1,
        \`fitness_analytics\` tinyint(1) NOT NULL DEFAULT 1,
        \`emotion_passive_recognition\` tinyint(1) NOT NULL DEFAULT 0,
        \`anonymous_trend_share\` tinyint(1) NOT NULL DEFAULT 0,
        \`master_sensor_enabled\` tinyint(1) NOT NULL DEFAULT 1,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        CONSTRAINT \`FK_embodied_permissions_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`embodied_permissions\`;`);
  }
}
