// V2026-10-12 (Phase 8.2 — Admin RBAC + 多租户):
//   spec §0 / §3 A9 / §8.3 — User entity 加 tenantId 字段, V0.x 默认 tenantId = uid
//   (每人自营, 等同无多租户), V1.x 接 Tenant 实体支持 B 端组织.
//
//   设计:
//     - tenant_id char(36) NOT NULL DEFAULT '' (空字符串占位, V0.x 后端
//       写时强制设成 uid, V1.x 改成 nullable 走 Tenant 实体).
//     - 索引 idx_users_tenant (tenantId), V0.x 不走 (因为全表同 uid),
//       V1.x 多租户 B 端组织接入后变高选择性, 提速隔离查询.
//     - backfill: 现有 users 行 tenantId = uid (一人一租户, 跟 V0.x 行为对齐).
//
//   治本:
//     - 不拆 2 migration (tenantId + adminRole), 跟 spec §8.3 横切关注点
//       "Auth + Tenant" 紧耦合, 一次 schema 迁移更安全.
//     - 不加 tenantId nullable: V0.x 后端强制设 uid, server-side 兜底防漏.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTenantId1700000008000 implements MigrationInterface {
  name = 'AddUserTenantId1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 加列 + 默认值 (空字符串, 避免 NOT NULL 违例).
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD COLUMN \`tenant_id\` char(36) NOT NULL DEFAULT '' AFTER \`uid\`;
    `);

    // 2. backfill: 现有 user 的 tenantId = uid (一人一租户, V0.x 行为对齐).
    await queryRunner.query(`
      UPDATE \`users\` SET \`tenant_id\` = \`uid\` WHERE \`tenant_id\` = '';
    `);

    // 3. 加索引 (V0.x 全表同 uid 不走, V1.x 多租户变高选择性, 治本: 仍加索引
    //    让 V1.x 上线无需二次 migration).
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD INDEX \`idx_users_tenant\` (\`tenant_id\`);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` DROP INDEX \`idx_users_tenant\`;`);
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`tenant_id\`;`);
  }
}
