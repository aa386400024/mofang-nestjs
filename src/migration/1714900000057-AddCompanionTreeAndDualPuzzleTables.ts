import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AF-537 P0-3 — 补齐 5 张在线业务表的建表 migration.
 *
 * 审计基线 `8745f764` 下，以下实体已注册进 `CompanionModule`，但 96 份 migration
 * 中 0 命中，生产库只能靠 `schema:sync` 建表：
 *   - companion_trees
 *   - companion_tree_water_logs
 *   - companion_dual_puzzle_sets
 *   - companion_dual_puzzle_questions
 *   - companion_dual_puzzle_answers（原 entity 表名首字母大写，本单统一小写）
 *
 * 说明：
 *   - 用 `IF NOT EXISTS`，兼容已由 dev schema sync 建过的本地库；生产空库会完整建表。
 *   - 表结构逐列对齐 entity（列名 / 类型 / 可空 / 默认值 / 索引）。
 *   - 不引入 FK：`owner_a_id/owner_b_id` 是业务参与者，不是 users.uid 的强单主键；
 *     与 entity 现有 `@ManyToOne`/无 FK 声明保持一致。
 */
export class AddCompanionTreeAndDualPuzzleTables1714900000057 implements MigrationInterface {
  name = 'AddCompanionTreeAndDualPuzzleTables1714900000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`companion_trees\` (
        \`id\` char(36) NOT NULL,
        \`owner_a_id\` varchar(64) NOT NULL,
        \`owner_b_id\` varchar(64) NULL,
        \`water_count\` int NOT NULL DEFAULT 0,
        \`milestones_triggered\` json NOT NULL,
        \`last_water_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_companion_trees_owner_a\` (\`owner_a_id\`),
        INDEX \`idx_companion_trees_owner_b\` (\`owner_b_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`companion_tree_water_logs\` (
        \`id\` char(36) NOT NULL,
        \`tree_id\` varchar(64) NOT NULL,
        \`actor_user_id\` varchar(64) NOT NULL,
        \`action\` enum('water','fertilize','prune') NOT NULL,
        \`actor_anonymous_name\` varchar(64) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_tree_water_logs_tree_created\` (\`tree_id\`, \`created_at\`),
        CONSTRAINT \`FK_tree_water_logs_tree\`
          FOREIGN KEY (\`tree_id\`) REFERENCES \`companion_trees\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`companion_dual_puzzle_sets\` (
        \`id\` char(36) NOT NULL,
        \`title\` varchar(80) NOT NULL,
        \`subtitle\` varchar(200) NULL,
        \`question_ids\` json NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_dual_puzzle_sets_created\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`companion_dual_puzzle_questions\` (
        \`id\` char(36) NOT NULL,
        \`prompt\` varchar(200) NOT NULL,
        \`options\` json NOT NULL,
        \`category\` enum('emotion_recognition','core_values','daily_habits','boundaries') NOT NULL,
        \`context_hint\` varchar(200) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_dual_puzzle_questions_category\` (\`category\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`companion_dual_puzzle_answers\` (
        \`id\` char(36) NOT NULL,
        \`set_id\` varchar(64) NOT NULL,
        \`user_id\` varchar(64) NOT NULL,
        \`choice_by_question_id\` json NOT NULL,
        \`completed_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`idx_dual_puzzle_answers_set_user\` (\`set_id\`, \`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_dual_puzzle_answers\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_dual_puzzle_questions\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_dual_puzzle_sets\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_tree_water_logs\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`companion_trees\`;`);
  }
}
