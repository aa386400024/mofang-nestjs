import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-01 — 心塑「陪伴」Tab 5 张表 (mofang-nestjs companion module).
 *
 * 设计:
 *   - companion_soothing_cards: 安抚卡片 (1:N with users, 陪伴者 ↔ 成长用户双向)
 *   - companion_sync_practices: 同步练习 (静态配置表, V3 接 LLM 个性化时改 uid 关联)
 *   - companion_dual_exercises: 双人协同练习库 (静态配置 + V3 接 LLM 个性化)
 *   - companion_dual_sessions: 双人会话生命周期 (V3 接 WS, V2 占位)
 *   - companion_rehab_items: 康复协同项 (仅 L3 权限可见)
 *
 * 反双胞胎 (重要):
 *   - 关系管理复用 profile/CompanionBinding 表 (1700000007005), 不重复建 binding 表
 *   - 陪伴记录复用 profile/CompanionRecord 表 (1700000007004), 不重复建 records 表
 *   - 这里 5 张表都是 companion Tab2 独有的业务资源
 *
 * 大厂做法:
 *   - JSON 字段全部 nullable (V3 接 LLM / 事件总线时由 service 写入)
 *   - 软删由 users.deleted_at cascade, 不另加 deleted_at 字段
 *   - 索引覆盖核心查询 pattern (from/to/recent)
 */
export class AddCompanionTables1700000010000 implements MigrationInterface {
  name = 'AddCompanionTables1700000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. companion_soothing_cards — 安抚卡片 (陪伴者 ↔ 成长用户双向)
    await queryRunner.query(`
      CREATE TABLE \`companion_soothing_cards\` (
        \`id\` char(36) NOT NULL,
        \`from_uid\` char(36) NOT NULL,
        \`to_uid\` char(36) NOT NULL,
        \`template_key\` varchar(32) NOT NULL,
        \`title\` varchar(80) NOT NULL,
        \`body\` text NOT NULL,
        \`accent_color_token\` varchar(32) NOT NULL DEFAULT 'primary',
        \`direction\` varchar(16) NOT NULL DEFAULT 'sent',
        \`sent_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`read_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_soothing_cards_from_to_sent\` (\`from_uid\`, \`to_uid\`, \`sent_at\`),
        INDEX \`idx_soothing_cards_to_direction\` (\`to_uid\`, \`direction\`, \`read_at\`),
        CONSTRAINT \`FK_companion_soothing_cards_from_uid\`
          FOREIGN KEY (\`from_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_companion_soothing_cards_to_uid\`
          FOREIGN KEY (\`to_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. companion_sync_practices — 同步练习 (静态配置表)
    await queryRunner.query(`
      CREATE TABLE \`companion_sync_practices\` (
        \`id\` char(36) NOT NULL,
        \`title\` varchar(80) NOT NULL,
        \`subtitle\` varchar(200) NULL,
        \`duration_minutes\` tinyint NOT NULL,
        \`relation\` varchar(16) NOT NULL,
        \`accent_color_token\` varchar(32) NOT NULL DEFAULT 'mintCyan',
        \`steps\` json NOT NULL,
        \`icon_key\` varchar(64) NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_sync_practices_relation\` (\`relation\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. companion_dual_exercises — 双人协同练习库 (V3.0 新增)
    await queryRunner.query(`
      CREATE TABLE \`companion_dual_exercises\` (
        \`id\` char(36) NOT NULL,
        \`title\` varchar(80) NOT NULL,
        \`subtitle\` varchar(200) NULL,
        \`relation_scopes\` json NOT NULL,
        \`modality\` varchar(32) NOT NULL,
        \`estimated_minutes\` tinyint NOT NULL,
        \`steps\` json NOT NULL,
        \`guardrails\` json NOT NULL,
        \`accent_color_token\` varchar(32) NOT NULL DEFAULT 'mistyPink',
        \`icon_key\` varchar(64) NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. companion_dual_sessions — 双人会话生命周期 (V3 接 WS)
    await queryRunner.query(`
      CREATE TABLE \`companion_dual_sessions\` (
        \`id\` char(36) NOT NULL,
        \`companion_uid\` char(36) NOT NULL,
        \`owner_uid\` char(36) NOT NULL,
        \`exercise_id\` varchar(64) NOT NULL,
        \`status\` varchar(32) NOT NULL DEFAULT 'invited',
        \`completed_steps\` json NULL,
        \`notes\` text NULL,
        \`started_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`completed_at\` datetime(6) NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_dual_sessions_companion_status\` (\`companion_uid\`, \`status\`),
        INDEX \`idx_dual_sessions_owner_exercise\` (\`owner_uid\`, \`exercise_id\`),
        CONSTRAINT \`FK_companion_dual_sessions_companion_uid\`
          FOREIGN KEY (\`companion_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_companion_dual_sessions_owner_uid\`
          FOREIGN KEY (\`owner_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. companion_rehab_items — 康复协同项 (仅 L3 权限可见)
    await queryRunner.query(`
      CREATE TABLE \`companion_rehab_items\` (
        \`id\` char(36) NOT NULL,
        \`owner_uid\` char(36) NOT NULL,
        \`companion_uid\` char(36) NOT NULL,
        \`title\` varchar(200) NOT NULL,
        \`kind\` varchar(32) NOT NULL,
        \`due_at\` datetime(6) NOT NULL,
        \`note\` varchar(255) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`completed_at\` datetime(6) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_rehab_items_companion_due\` (\`companion_uid\`, \`due_at\`),
        INDEX \`idx_rehab_items_owner_due\` (\`owner_uid\`, \`due_at\`),
        CONSTRAINT \`FK_companion_rehab_items_owner_uid\`
          FOREIGN KEY (\`owner_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_companion_rehab_items_companion_uid\`
          FOREIGN KEY (\`companion_uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_rehab_items\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_dual_sessions\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_dual_exercises\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_sync_practices\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_soothing_cards\`;`);
  }
}
