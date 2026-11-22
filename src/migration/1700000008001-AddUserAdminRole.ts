// V2026-10-12 (Phase 8.2 — Admin RBAC):
//   spec §12.4 — User entity 加 adminRole 字段, 跟客户端 7.8 PermissionResolver
//   3 角色 (editor / reviewer / admin) 严格对应.
//
//   设计:
//     - admin_role enum NULL (NULL = 非 admin 角色, 不允许进 /admin).
//     - V0.x dev fallback: 跟 client 7.8 PermissionResolver 同步, AuthService.jwtSign
//       检测 adminRole 为 NULL 时 fallback 'admin' (V0.x 内部 dev / 测试).
//     - V1.x 收紧: server-side 真值下发, fallback 删除, NULL 真正表示 "无权限".
//     - 索引 idx_users_admin_role 仅占位 (V0.x NULL 占 99%, V1.x 真值下发后变高选择性).
//
//   治本:
//     - adminRole 不放 users 表外 (e.g. user_admin_roles 关联表), 跟 client 7.8
//       AuthSession.roles: List<String> 单值匹配, V0.x 简化, V1.x 改多角色
//       时单独 PR.
//     - adminRole nullable, 不用 default 'editor' (强制 user 走 V0.x dev fallback
//       路径, 走 V1.x 时 NULL 才是合规默认, 跟客户端 PermissionResolver fallback
//       时序一致).

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAdminRole1700000008001 implements MigrationInterface {
  name = 'AddUserAdminRole1700000008001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 加 enum 列 (NULL = 非 admin 角色).
    //    MySQL 8.0 enum 字段 nullable, 不用 default (跟 nullable 冲突).
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD COLUMN \`admin_role\` enum('editor', 'reviewer', 'admin') NULL AFTER \`tenant_id\`;
    `);

    // 2. 加索引 (V0.x 占位, V1.x 真值下发后变高选择性, 不二次 migration).
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD INDEX \`idx_users_admin_role\` (\`admin_role\`);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` DROP INDEX \`idx_users_admin_role\`;`);
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`admin_role\`;`);
  }
}
