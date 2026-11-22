import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — consent_signatures 表 (陪伴者知情同意书签字记录).
 *
 * 设计:
 *   - UUID 主键
 *   - 1:N (uid FK)
 *   - 复合索引 (uid, signed_at DESC) — 查最新签字
 *   - document_version 强校验 (后端 config 当前 version 跟签字 version 不一致 → 提示重签)
 *   - scrolled_to_bottom 防跳过阅读 (前端传 boolean)
 *   - ip / user_agent 合规取证
 */
export class AddConsentSignatures1700000007008 implements MigrationInterface {
  name = 'AddConsentSignatures1700000007008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`consent_signatures\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`document_version\` varchar(32) NOT NULL,
        \`signed_at\` datetime(6) NOT NULL,
        \`scrolled_to_bottom\` tinyint(1) NOT NULL DEFAULT 1,
        \`ip_address\` varchar(64) NULL,
        \`user_agent\` varchar(512) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_consent_uid_signed\` (\`uid\`, \`signed_at\`),
        CONSTRAINT \`FK_consent_signatures_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`consent_signatures\`;`);
  }
}
