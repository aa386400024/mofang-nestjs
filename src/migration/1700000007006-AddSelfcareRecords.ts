import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — selfcare_records 表 (陪伴者自我关怀记录).
 *
 * 设计:
 *   - UUID 主键
 *   - 1:N (uid FK)
 *   - type: mood / relax / rest  (V2.0 §Tab4 三个快入口)
 *   - 复合索引 (uid, date) — 时间倒序
 *   - note 可空 (V2.0 UI 不让填 note, V3 可扩展)
 */
export class AddSelfcareRecords1700000007006 implements MigrationInterface {
  name = 'AddSelfcareRecords1700000007006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`selfcare_records\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`type\` varchar(16) NOT NULL,
        \`date\` date NOT NULL,
        \`note\` varchar(512) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_selfcare_uid_date\` (\`uid\`, \`date\`),
        CONSTRAINT \`FK_selfcare_records_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`selfcare_records\`;`);
  }
}
