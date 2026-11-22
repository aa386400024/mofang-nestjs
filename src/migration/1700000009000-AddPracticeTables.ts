import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V2026-09-01 — 心塑「练习」Tab 5 张表 (mofang-nestjs practice module).
 *
 * 设计:
 *   - practice_tools: 工具元数据 (工具静态库, V2 占位 + V3 LLM 个性化)
 *   - practice_sessions: 练习会话生命周期 (start → in_progress → completed)
 *   - practice_records: 训练记录 (dashboard 模块聚合的源数据)
 *   - gym_current_plans: 1:1 with users, 心理健身房当前计划快照
 *   - targeted_reshapes: 1:1 with users, 靶向重塑状态 (V3.0 渐进解锁)
 *
 * 反双胞胎 (重要):
 *   - 不重复 dashboard 模块的 weekly/modules / milestones 聚合表 — 同源 practice_records 表
 *   - 不重复 embodied 模块的 devices / permissions — 已在 1700000007009/1700007010
 *   - JSON 字段全部 nullable, V2.0 占位为 null, V3 由 service 写入
 *
 * 大厂做法:
 *   - 所有日期字段 datetime(6) 精度 (跟时间戳统一)
 *   - 1:N 字段 (uid) 加 INDEX, 复合索引覆盖常见查询 pattern
 *   - 1:1 字段 (uid) 直接走 PRIMARY KEY (uid), 无需额外索引
 */
export class AddPracticeTables1700000009000 implements MigrationInterface {
  name = 'AddPracticeTables1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. practice_tools — 工具元数据 (静态库, V2.0 不写, V3 接 LLM 个性化推荐时写)
    await queryRunner.query(`
      CREATE TABLE \`practice_tools\` (
        \`id\` char(36) NOT NULL,
        \`tool_key\` varchar(64) NOT NULL,
        \`category_id\` varchar(32) NOT NULL,
        \`title\` varchar(80) NOT NULL,
        \`subtitle\` varchar(200) NULL,
        \`description\` text NOT NULL,
        \`icon_key\` varchar(64) NOT NULL,
        \`duration_minutes\` tinyint NOT NULL,
        \`difficulty\` tinyint NOT NULL,
        \`evidence_level\` varchar(32) NOT NULL,
        \`route_path\` varchar(200) NOT NULL,
        \`tags\` json NULL,
        \`has_fun_mode\` tinyint(1) NOT NULL DEFAULT 0,
        \`unlock_hint\` varchar(200) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_practice_tools_category\` (\`category_id\`),
        INDEX \`idx_practice_tools_tool_key\` (\`tool_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. practice_sessions — 练习会话生命周期
    await queryRunner.query(`
      CREATE TABLE \`practice_sessions\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`tool_key\` varchar(64) NOT NULL,
        \`target_duration_minutes\` tinyint NOT NULL,
        \`actual_duration_seconds\` int NOT NULL DEFAULT 0,
        \`status\` varchar(16) NOT NULL DEFAULT 'in_progress',
        \`feedback_snapshot\` json NULL,
        \`started_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`completed_at\` datetime(6) NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_practice_sessions_uid_status\` (\`uid\`, \`status\`),
        INDEX \`idx_practice_sessions_uid_tool_completed\` (\`uid\`, \`tool_key\`, \`completed_at\`),
        CONSTRAINT \`FK_practice_sessions_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. practice_records — 训练记录 (dashboard 模块聚合源)
    await queryRunner.query(`
      CREATE TABLE \`practice_records\` (
        \`id\` char(36) NOT NULL,
        \`uid\` char(36) NOT NULL,
        \`tool_key\` varchar(64) NOT NULL,
        \`tool_title\` varchar(80) NOT NULL,
        \`module\` varchar(32) NOT NULL,
        \`duration_minutes\` int NOT NULL,
        \`completed_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_practice_records_uid_completed\` (\`uid\`, \`completed_at\`),
        INDEX \`idx_practice_records_uid_module_completed\` (\`uid\`, \`module\`, \`completed_at\`),
        CONSTRAINT \`FK_practice_records_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. gym_current_plans — 1:1 with users, 心理健身房当前计划快照
    await queryRunner.query(`
      CREATE TABLE \`gym_current_plans\` (
        \`uid\` char(36) NOT NULL,
        \`stage\` varchar(16) NOT NULL DEFAULT 'foundation',
        \`completed_this_week\` int NOT NULL DEFAULT 0,
        \`weekly_target\` int NOT NULL DEFAULT 5,
        \`weekly_plans\` json NOT NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        INDEX \`idx_gym_current_plans_uid_stage\` (\`uid\`, \`stage\`),
        CONSTRAINT \`FK_gym_current_plans_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. targeted_reshapes — 1:1 with users, 靶向重塑状态 (V3.0 渐进解锁)
    await queryRunner.query(`
      CREATE TABLE \`targeted_reshapes\` (
        \`uid\` char(36) NOT NULL,
        \`stuck_points\` json NOT NULL,
        \`weekly_tasks\` json NOT NULL,
        \`completed_week_count\` int NOT NULL DEFAULT 0,
        \`looseness_score\` float NOT NULL DEFAULT 0,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`uid\`),
        INDEX \`idx_targeted_reshapes_uid\` (\`uid\`),
        CONSTRAINT \`FK_targeted_reshapes_uid\`
          FOREIGN KEY (\`uid\`) REFERENCES \`users\` (\`uid\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`targeted_reshapes\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`gym_current_plans\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`practice_records\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`practice_sessions\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`practice_tools\`;`);
  }
}
