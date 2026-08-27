import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — companion_records 表 (陪伴者陪伴记录).
 *
 * 设计:
 *   - UUID 主键
 *   - 1:N (companion_uid 索引)
 *   - 复合索引 (companion_uid, date) — 按时间倒序查
 *   - companion_to_uid 关联方 (被陪伴者)
 *   - 不引用 users 外键 (用 application 层校验, V3 加 FK)
 *     V2 简化: 软删由 users cascade 清掉的话 FK 也要 cascade, 提前加上
 */
export class AddCompanionRecords1700000007004 implements MigrationInterface {
  name = 'AddCompanionRecords1700000007004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`companion_records\` (
        \`id\` char(36) NOT NULL,
        \`companion_uid\` char(36) NOT NULL,
        \`companion_to_uid\` char(36) NOT NULL,
        \`date\` date NOT NULL,
        \`title\` varchar(128) NOT NULL,
        \`summary\` varchar(512) NOT NULL,
        \`tag\` varchar(32) NOT NULL DEFAULT '已完成',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_companion_uid_date\` (\`companion_uid\`, \`date\`),
        INDEX \`idx_companion_uid_tag\` (\`companion_uid\`, \`tag\`),
        CONSTRAINT \`FK_companion_records_companion_uid\`
          FOREIGN KEY (\`companion_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_companion_records_companion_to_uid\`
          FOREIGN KEY (\`companion_to_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`companion_records\`;`);
  }
}
