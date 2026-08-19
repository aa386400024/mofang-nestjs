import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial migration — User / Session / AuditLog 三张基础表.
 *
 * 设计:
 *   - 包含 V1 已有的所有字段 + 索引
 *   - UUID 主键 (用 char(36) 节省空间)
 *   - 软删 (deleted_at) 用 datetime(6) 而不是 timestamp (跨时区友好)
 *   - 所有时间字段 datetime(6) 精度 (ms + μs)
 *   - 引擎: InnoDB (事务 + FK)
 *   - 字符集: utf8mb4_unicode_ci (支持 emoji + 多语言)
 *
 * 注意:
 *   - 这是 V2 起点迁移, 假定 V1 表不存在 (全新部署)
 *   - 如果已有 V1 表, 改用后续 V2_* 增量迁移
 */
export class InitUser1700000000000 implements MigrationInterface {
  name = 'InitUser1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ====== users 表 ======
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`uid\` char(36) NOT NULL,
        \`phone\` varchar(20) NULL,
        \`email\` varchar(255) NULL,
        \`password_hash\` varchar(255) NOT NULL,
        \`state\` varchar(32) NOT NULL DEFAULT 'active',
        \`last_login_at\` datetime(6) NULL,
        \`deleted_at\` datetime(6) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_users_phone\` (\`phone\`),
        INDEX \`IDX_users_email\` (\`email\`),
        INDEX \`IDX_users_deleted_at\` (\`deleted_at\`),
        INDEX \`IDX_users_state\` (\`state\`),
        UNIQUE INDEX \`UQ_users_phone\` (\`phone\`),
        UNIQUE INDEX \`UQ_users_email\` (\`email\`),
        PRIMARY KEY (\`uid\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ====== user_sessions 表 ======
    await queryRunner.query(`
      CREATE TABLE \`user_sessions\` (
        \`sid\` char(36) NOT NULL,
        \`user_id\` char(36) NOT NULL,
        \`jti\` varchar(64) NOT NULL,
        \`device_info\` varchar(255) NULL,
        \`ip_address\` varchar(64) NULL,
        \`expires_at\` datetime(6) NOT NULL,
        \`is_revoked\` tinyint(1) NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_user_sessions_user_id\` (\`user_id\`),
        INDEX \`IDX_user_sessions_jti\` (\`jti\`),
        PRIMARY KEY (\`sid\`),
        UNIQUE INDEX \`UQ_user_sessions_jti\` (\`jti\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // FK: user_sessions.user_id → users.uid
    await queryRunner.query(`
      ALTER TABLE \`user_sessions\`
      ADD CONSTRAINT \`FK_user_sessions_user\`
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`uid\`)
      ON DELETE CASCADE ON UPDATE NO ACTION;
    `);

    // ====== user_audit_logs 表 ======
    await queryRunner.query(`
      CREATE TABLE \`user_audit_logs\` (
        \`id\` char(36) NOT NULL,
        \`user_id\` char(36) NULL,
        \`event\` varchar(64) NOT NULL,
        \`ip_address\` varchar(64) NULL,
        \`user_agent\` varchar(512) NULL,
        \`metadata\` text NULL,
        \`is_success\` tinyint(1) NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_audit_user_id\` (\`user_id\`),
        INDEX \`IDX_audit_event_created\` (\`event\`, \`created_at\`),
        INDEX \`IDX_audit_created_at\` (\`created_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`user_audit_logs\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`user_sessions\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`users\`;`);
  }
}