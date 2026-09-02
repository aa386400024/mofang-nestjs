import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2 增强 — 性能/兼容性索引.
 *
 * 1. 邮箱哈希索引 (V3 接 HIBP 时用)
 * 2. Session 表 last_active_at 索引 (查"最近活跃 session"用)
 * 3. User 表 phone_verified_at 索引 (V3 加手机号登录验证时用)
 */
export class AddUserEmailIndex1700000005000 implements MigrationInterface {
  name = 'AddUserEmailIndex1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // session 最后活跃索引 (多端 UI "最近活跃" 排序)
    await queryRunner.query(`
      ALTER TABLE \`user_sessions\`
      ADD INDEX \`IDX_user_sessions_last_active\` (\`last_active_at\`);
    `);

    // session 过期索引 (cron 清理过期 session)
    await queryRunner.query(`
      ALTER TABLE \`user_sessions\`
      ADD INDEX \`IDX_user_sessions_expires\` (\`expires_at\`, \`is_revoked\`);
    `);

    // user 状态 + 删除时间复合索引 (cron 跑"软删过期"用)
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD INDEX \`IDX_users_state_deleted\` (\`state\`, \`deleted_at\`);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\` DROP INDEX \`IDX_users_state_deleted\`;
      ALTER TABLE \`user_sessions\` DROP INDEX \`IDX_user_sessions_expires\`;
      ALTER TABLE \`user_sessions\` DROP INDEX \`IDX_user_sessions_last_active\`;
    `);
  }
}
