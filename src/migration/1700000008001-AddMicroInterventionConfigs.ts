import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-08-31 — micro_intervention_configs 表 (心塑场景化微干预配置).
 *
 * 设计:
 *   - PK = uid (1:1 with users) — 用 uid 而非自增 PK, 跟 UserProfile 模式一致
 *   - master_enabled: 总开关
 *   - sensitivity: low / medium / high
 *   - enabled_triggers: JSON 数组
 *   - quiet_start / quiet_end: HH:mm 静默时段
 *   - created_at / updated_at: 自动维护
 */
export class AddMicroInterventionConfigs1700000008001 implements MigrationInterface {
  name = 'AddMicroInterventionConfigs1700000008001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`micro_intervention_configs\` (
        \`uid\` char(36) NOT NULL,
        \`master_enabled\` tinyint(1) NOT NULL DEFAULT 1,
        \`sensitivity\` varchar(16) NOT NULL DEFAULT 'medium',
        \`enabled_triggers\` json NULL,
        \`quiet_start\` varchar(5) NOT NULL DEFAULT '22:00',
        \`quiet_end\` varchar(5) NOT NULL DEFAULT '08:00',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        CONSTRAINT \`FK_mi_configs_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`micro_intervention_configs\`;`);
  }
}
