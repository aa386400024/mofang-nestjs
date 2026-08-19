import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2 新表 — user_password_history.
 *
 * 设计:
 *   - 每次改密保留旧 hash, 防密码复用
 *   - 软删用户 cascade 删历史 (GDPR)
 *   - 索引 user_id 加速查
 *   - 复合索引 user_id+created_at 加速 trimOldHistory
 */
export class AddPasswordHistory1700000003000 implements MigrationInterface {
  name = 'AddPasswordHistory1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user_password_history\` (
        \`id\` char(36) NOT NULL,
        \`user_id\` char(36) NOT NULL,
        \`password_hash\` varchar(255) NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_user_pwd_history_user_id\` (\`user_id\`),
        INDEX \`IDX_user_pwd_history_user_created\` (\`user_id\`, \`created_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      ALTER TABLE \`user_password_history\`
      ADD CONSTRAINT \`FK_user_pwd_history_user\`
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`uid\`)
      ON DELETE CASCADE ON UPDATE NO ACTION;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`user_password_history\`;`);
  }
}