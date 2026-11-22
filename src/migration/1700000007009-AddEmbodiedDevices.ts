import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-08-28 — embodied_devices 表 (心塑具身数据).
 *
 * 设计:
 *   - PK = id (uuid)
 *   - uid FK → users.uid (1:N, 一个用户可绑多设备)
 *   - device_type 枚举: heart_rate_band / hrv_monitor / smartwatch / breath_sensor
 *   - status 枚举: connected / unstable / disconnected (V2.0 软删走 disconnected)
 *   - battery_pct 0-100 (TINYINT)
 *   - 索引: (uid) 单查 + (uid, status) 多条件
 */
export class AddEmbodiedDevices1700000007009 implements MigrationInterface {
  name = 'AddEmbodiedDevices1700000007009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`embodied_devices\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`device_type\` varchar(32) NOT NULL,
        \`device_name\` varchar(80) NOT NULL,
        \`status\` varchar(32) NOT NULL DEFAULT 'connected',
        \`battery_pct\` tinyint NOT NULL DEFAULT 100,
        \`paired_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_embodied_devices_uid\` (\`uid\`),
        INDEX \`idx_embodied_devices_uid_status\` (\`uid\`, \`status\`),
        CONSTRAINT \`FK_embodied_devices_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`embodied_devices\`;`);
  }
}
