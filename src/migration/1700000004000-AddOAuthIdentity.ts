import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2 新表 — user_oauth_identities.
 *
 * 设计:
 *   - 一个用户可绑多个 provider (微信/Google/Apple)
 *   - 同一 provider 只能绑一个用户 (provider + providerUserId 联合唯一)
 *   - 软删用户 cascade 删绑定
 *
 * 索引:
 *   - idx_provider_user: (provider, provider_user_id) 唯一 — 第三方用户 ↔ 本地用户
 *   - idx_user_provider: (user_id, provider) 唯一 — 同一用户不能重复绑同 provider
 */

export class AddOAuthIdentity1700000004000 implements MigrationInterface {
  name = 'AddOAuthIdentity1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user_oauth_identities\` (
        \`id\` char(36) NOT NULL,
        \`user_id\` char(36) NOT NULL,
        \`provider\` varchar(32) NOT NULL,
        \`provider_user_id\` varchar(255) NOT NULL,
        \`provider_data\` text NULL,
        \`access_token\` text NULL,
        \`refresh_token\` text NULL,
        \`expires_at\` datetime(6) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_oauth_user_provider\` (\`user_id\`, \`provider\`),
        UNIQUE INDEX \`UQ_oauth_provider_user\` (\`provider\`, \`provider_user_id\`),
        UNIQUE INDEX \`UQ_oauth_user_provider\` (\`user_id\`, \`provider\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      ALTER TABLE \`user_oauth_identities\`
      ADD CONSTRAINT \`FK_oauth_user\`
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`uid\`)
      ON DELETE CASCADE ON UPDATE NO ACTION;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`user_oauth_identities\`;`);
  }
}
