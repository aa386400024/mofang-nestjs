// V2026-10-12 (Phase 8.3 — Analytics 模块初始化 / SPEC §12.5):
//   analytics_events 表 + 2 复合 index, 跟 entity @Index 注解严格对应.
//
//   治本:
//     - 不放 denormalized 聚合表 (V0.x 实时聚合 SQL, V1.x 接 ClickHouse /
//       物化视图再切, 跟 client 7.8 AnalyticsOverview.fromJson 字段一致).
//     - metadata 用 json (V0.x 简单, 后续可加 chunk 关联, RAG 来源等).

import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAnalytics1700000008020 implements MigrationInterface {
  name = 'InitAnalytics1700000008020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`analytics_events\` (
        \`id\` char(36) NOT NULL,
        \`tenant_id\` char(36) NOT NULL,
        \`event_type\` enum(
          'KB_PUBLISHED',
          'DRAFT_SUBMITTED',
          'REVIEW_APPROVED',
          'KB_ARCHIVED',
          'KB_RESTORED',
          'KB_SCHEDULED',
          'KB_SCHEDULE_FIRED'
        ) NOT NULL,
        \`item_id\` char(36) NULL,
        \`user_id\` char(36) NULL,
        \`metadata\` json NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_analytics_tenant_event_created\` (\`tenant_id\`, \`event_type\`, \`created_at\`),
        INDEX \`idx_analytics_tenant_item\` (\`tenant_id\`, \`item_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`analytics_events\`;`);
  }
}
