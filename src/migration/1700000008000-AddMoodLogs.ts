import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-08-31 — mood_logs 表 (心塑首页情绪打卡).
 *
 * 设计:
 *   - PK = id (uuid)
 *   - uid FK → users.uid
 *   - level: 4 档枚举 (great / okay / low / crisis)
 *   - note: 用户备注, nullable, ≤ 280 字
 *   - triggered_micro_intervention_id: 触发的微干预 id, nullable
 *   - created_at: 自动创建时间戳
 *   - 索引: (uid, created_at) — 首页「今日记录」查询 + 历史曲线
 */
export class AddMoodLogs1700000008000 implements MigrationInterface {
  name = 'AddMoodLogs1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`mood_logs\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`level\` varchar(16) NOT NULL,
        \`note\` varchar(280) NULL,
        \`triggered_micro_intervention_id\` varchar(64) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_mood_logs_uid_created_at\` (\`uid\`, \`created_at\`),
        CONSTRAINT \`FK_mood_logs_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`mood_logs\`;`);
  }
}
