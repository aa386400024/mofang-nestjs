import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V3 新增 — companion_bindings 表 (陪伴关系绑定).
 *
 * 设计:
 *   - UUID 主键
 *   - 双 owner / companion 双向 1:1 引用 users
 *   - UNIQUE (owner_uid, companion_uid) 防止重复绑定
 *   - 状态机: pending / active / terminated
 *   - permission_level: L1 / L2 / L3
 *   - invite_code 6 位数字 (索引, 查找快速)
 *   - terminated_at 审计取证
 *   - V3 加"双向确认": 7 天宽限期 (待 V3 业务流接)
 */
export class AddCompanionBindings1700000007005 implements MigrationInterface {
  name = 'AddCompanionBindings1700000007005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`companion_bindings\` (
        \`id\` char(36) NOT NULL,
        \`owner_uid\` char(36) NOT NULL,
        \`companion_uid\` char(36) NULL,
        \`invite_code\` varchar(16) NULL,
        \`invite_code_expires_at\` datetime(6) NULL,
        \`status\` varchar(16) NOT NULL DEFAULT 'pending',
        \`permission_level\` varchar(8) NOT NULL DEFAULT 'L1',
        \`bound_at\` datetime(6) NULL,
        \`terminated_at\` datetime(6) NULL,
        \`terminate_reason\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_bindings_owner_companion\` (\`owner_uid\`, \`companion_uid\`),
        INDEX \`idx_bindings_owner\` (\`owner_uid\`),
        INDEX \`idx_bindings_companion\` (\`companion_uid\`),
        INDEX \`idx_bindings_invite_code\` (\`invite_code\`),
        CONSTRAINT \`FK_bindings_owner_uid\`
          FOREIGN KEY (\`owner_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_bindings_companion_uid\`
          FOREIGN KEY (\`companion_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`companion_bindings\`;`);
  }
}
