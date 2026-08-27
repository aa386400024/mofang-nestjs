import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — user_profiles 表 (心塑「我的」Tab 用户画像).
 *
 * 设计:
 *   - PK = uid (char(36) UUID), 跟 users.uid 1:1
 *   - FK ON DELETE CASCADE (真删时一并清)
 *   - 所有业务字段 nullable (V2.0 设计: 所有信息非必填)
 *   - currentRole 持久化 (下次启动默认进入上次激活的角色)
 *   - birth_date 用 DATE 不是 DATETIME (只需要到天)
 *   - 字符集 utf8mb4 (emoji + 多语言)
 */
export class AddUserProfile1700000007000 implements MigrationInterface {
  name = 'AddUserProfile1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user_profiles\` (
        \`uid\` char(36) NOT NULL,
        \`nickname\` varchar(20) NULL,
        \`avatar_url\` varchar(512) NULL,
        \`birth_date\` date NULL,
        \`gender\` varchar(16) NULL,
        \`occupation\` varchar(64) NULL,
        \`current_role\` varchar(32) NOT NULL DEFAULT 'growth_user',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        CONSTRAINT \`FK_user_profiles_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`user_profiles\`;`);
  }
}
