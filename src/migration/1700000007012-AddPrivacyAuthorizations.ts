import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-08-28 — privacy_authorizations 表 (心塑授权管理).
 *
 * 设计:
 *   - PK = id (uuid)
 *   - uid FK → users.uid (1:N)
 *   - type: oauth_google / oauth_wechat / oauth_apple / device_camera / ...
 *   - status: active / revoked / expired
 *   - display_name: 展示用 (e.g. "Google · 张大炮")
 *   - provider_account_id: OAuth 撤销时反向调用
 *   - scope: 设备权限类授权的范围 (e.g. 'read_heart_rate')
 *   - expires_at: 过期时间 (OAuth token 通常 60 天)
 *   - 索引: (uid, type) + (uid, status)
 */
export class AddPrivacyAuthorizations1700000007012 implements MigrationInterface {
  name = 'AddPrivacyAuthorizations1700000007012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`privacy_authorizations\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`type\` varchar(64) NOT NULL,
        \`status\` varchar(32) NOT NULL DEFAULT 'active',
        \`display_name\` varchar(128) NOT NULL,
        \`provider_account_id\` varchar(128) NULL,
        \`scope\` varchar(256) NULL,
        \`granted_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`expires_at\` datetime(6) NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_privacy_auths_uid_type\` (\`uid\`, \`type\`),
        INDEX \`idx_privacy_auths_uid_status\` (\`uid\`, \`status\`),
        CONSTRAINT \`FK_privacy_authorizations_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`privacy_authorizations\`;`);
  }
}
