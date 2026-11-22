import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — user_memberships 表 (心塑会员中心).
 *
 * 设计:
 *   - PK = uid (1:1 with users)
 *   - 状态机列: inactive / active / expired / trial
 *   - 等级列: free / plus / pro
 *   - expires_at 可空 (inactive / free 用户无过期时间)
 *   - 状态 / expires_at 加索引, V3 跑批找"即将过期"用户推送
 */
export class AddMemberships1700000007002 implements MigrationInterface {
  name = 'AddMemberships1700000007002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`user_memberships\` (
        \`uid\` char(36) NOT NULL,
        \`status\` varchar(16) NOT NULL DEFAULT 'inactive',
        \`tier\` varchar(16) NOT NULL DEFAULT 'free',
        \`expires_at\` datetime(6) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        INDEX \`idx_memberships_status\` (\`status\`),
        INDEX \`idx_memberships_expires_at\` (\`expires_at\`),
        CONSTRAINT \`FK_user_memberships_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`user_memberships\`;`);
  }
}
