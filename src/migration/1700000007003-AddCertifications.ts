import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — user_c_certifications 表 (陪伴者实名认证).
 *
 * 设计:
 *   - PK = uid (1:1 with users)
 *   - 不存完整身份证号, 只存 last4 (PII 最小化合规)
 *   - real_name 加密 (V3 接 RsaKeyService, V2.0 占位)
 *   - 4 状态: unverified / pending / verified / rejected
 *   - submitted_at / reviewed_at 审计取证
 */
export class AddCertifications1700000007003 implements MigrationInterface {
  name = 'AddCertifications1700000007003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user_c_certifications\` (
        \`uid\` char(36) NOT NULL,
        \`status\` varchar(16) NOT NULL DEFAULT 'unverified',
        \`real_name\` varchar(64) NULL,
        \`id_card_last4\` char(4) NULL,
        \`face_verified_at\` datetime(6) NULL,
        \`submitted_at\` datetime(6) NULL,
        \`reviewed_at\` datetime(6) NULL,
        \`reject_reason\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        CONSTRAINT \`FK_user_c_certifications_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`user_c_certifications\`;`);
  }
}
