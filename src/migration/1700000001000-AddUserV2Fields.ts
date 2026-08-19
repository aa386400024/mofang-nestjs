import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2 增强 — User 实体新增字段.
 *
 * 新增:
 *   - email_verified_at: 邮箱验证时间
 *   - phone_verified_at: 手机号验证时间
 *   - failed_login_count: 连续失败登录次数
 *   - locked_until: 账号锁定到期时间
 *   - password_changed_at: 最后改密时间
 *   - must_change_password: 强制要求改密
 */
export class AddUserV2Fields1700000001000 implements MigrationInterface {
  name = 'AddUserV2Fields1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD COLUMN \`email_verified_at\` datetime(6) NULL AFTER \`last_login_at\`,
      ADD COLUMN \`phone_verified_at\` datetime(6) NULL AFTER \`email_verified_at\`,
      ADD COLUMN \`failed_login_count\` int NOT NULL DEFAULT 0 AFTER \`phone_verified_at\`,
      ADD COLUMN \`locked_until\` datetime(6) NULL AFTER \`failed_login_count\`,
      ADD COLUMN \`password_changed_at\` datetime(6) NULL AFTER \`locked_until\`,
      ADD COLUMN \`must_change_password\` tinyint(1) NOT NULL DEFAULT 0 AFTER \`password_changed_at\`;
    `);

    // 索引: 查"密码到期需强制改密"用户
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD INDEX \`IDX_users_password_changed_at\` (\`password_changed_at\`),
      ADD INDEX \`IDX_users_locked_until\` (\`locked_until\`);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
      DROP INDEX \`IDX_users_password_changed_at\`,
      DROP INDEX \`IDX_users_locked_until\`,
      DROP COLUMN \`must_change_password\`,
      DROP COLUMN \`password_changed_at\`,
      DROP COLUMN \`locked_until\`,
      DROP COLUMN \`failed_login_count\`,
      DROP COLUMN \`phone_verified_at\`,
      DROP COLUMN \`email_verified_at\`;
    `);
  }
}