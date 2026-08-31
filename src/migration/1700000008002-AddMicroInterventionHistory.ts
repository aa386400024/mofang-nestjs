import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-08-31 — micro_intervention_history 表 (心塑场景化微干预执行历史).
 *
 * 设计:
 *   - PK = id (uuid)
 *   - uid FK → users.uid
 *   - intervention_id: 业务 id (e.g. mi-night-anchor)
 *   - status: started / completed / dismissed
 *   - duration_seconds: 实际执行时长
 *   - started_at / completed_at / dismissed_at: 时间戳
 *   - created_at: 自动创建时间
 *   - 索引: (uid, created_at) — 用户最近触发流
 */
export class AddMicroInterventionHistory1700000008002 implements MigrationInterface {
  name = 'AddMicroInterventionHistory1700000008002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`micro_intervention_history\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`intervention_id\` varchar(64) NOT NULL,
        \`status\` varchar(32) NOT NULL DEFAULT 'started',
        \`duration_seconds\` int NULL,
        \`started_at\` datetime NULL,
        \`completed_at\` datetime NULL,
        \`dismissed_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_mi_history_uid_created_at\` (\`uid\`, \`created_at\`),
        CONSTRAINT \`FK_mi_history_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`micro_intervention_history\`;`);
  }
}
