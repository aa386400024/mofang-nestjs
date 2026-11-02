// V2026-10-12 (Phase 8.1 — KB 模块初始化 / SPEC §12.1):
//   3 张表 + 5 复合 index 一次建完, 跟 entity @Index 注解严格对应.
//
//   治本:
//     - 不拆 3 migration (knowledge_items / knowledge_versions / workflow_events),
//       紧耦合的表一次建, 减少 migration:run 步骤.
//     - 不放 authorName / reviewerName 冗余列, server-side join users.email 拿.
//     - 不放 tenantId nullable (V0.x 强制 = uid, spec §0 + §3 A9 + §8.3).
//     - 复合 index 跟 @Entity @Index 注解完全一致, TypeORM 自动同步, 这里显式
//       写一遍是给数据库 inspect 看 (防 drift).

import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitKnowledge1700000008010 implements MigrationInterface {
  name = 'InitKnowledge1700000008010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. knowledge_items 主表 ───
    await queryRunner.query(`
      CREATE TABLE \`knowledge_items\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`type\` enum('case', 'standard', 'knowledge', 'enterprise', 'report') NOT NULL,
        \`title\` varchar(500) NOT NULL,
        \`content\` json NOT NULL,
        \`metadata\` json NOT NULL,
        \`status\` enum('draft', 'review', 'published', 'archived') NOT NULL DEFAULT 'draft',
        \`version\` int NOT NULL DEFAULT 1,
        \`author_id\` char(36) NOT NULL,
        \`reviewer_id\` char(36) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`published_at\` datetime(6) NULL,
        \`scheduled_publish_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_kb_tenant_status\` (\`tenant_id\`, \`status\`),
        INDEX \`idx_kb_tenant_type\` (\`tenant_id\`, \`type\`),
        INDEX \`idx_kb_tenant_author\` (\`tenant_id\`, \`author_id\`, \`created_at\`),
        INDEX \`idx_kb_tenant_review\` (\`tenant_id\`, \`reviewer_id\`),
        INDEX \`idx_kb_tenant_scheduled\` (\`tenant_id\`, \`scheduled_publish_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── 2. knowledge_versions 表 ───
    await queryRunner.query(`
      CREATE TABLE \`knowledge_versions\` (
        \`id\` char(36) NOT NULL,
        \`item_id\` char(36) NOT NULL,
        \`version\` int NOT NULL,
        \`snapshot\` json NOT NULL,
        \`author_id\` char(36) NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`diff\` json NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_kb_version_item_version\` (\`item_id\`, \`version\`),
        CONSTRAINT \`FK_kb_version_item\`
          FOREIGN KEY (\`item_id\`) REFERENCES \`knowledge_items\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── 3. workflow_events 表 ───
    await queryRunner.query(`
      CREATE TABLE \`workflow_events\` (
        \`id\` char(36) NOT NULL,
        \`item_id\` char(36) NOT NULL,
        \`from_status\` enum('draft', 'review', 'published', 'archived') NOT NULL,
        \`to_status\` enum('draft', 'review', 'published', 'archived') NOT NULL,
        \`user_id\` char(36) NOT NULL,
        \`timestamp\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`comment\` text NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_kb_event_item_timestamp\` (\`item_id\`, \`timestamp\`),
        CONSTRAINT \`FK_kb_event_item\`
          FOREIGN KEY (\`item_id\`) REFERENCES \`knowledge_items\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`workflow_events\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`knowledge_versions\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`knowledge_items\`;`);
  }
}
