// V2026-10-22 治本 (V1.3 §2 — practice_scenarios + practice_attempts 2 张新表):
//   原因: counselor-practice-engine-v1.3-freeform.md §2 拍板 2 张新表:
//     §2.1 practice_scenarios —— 场景变体库 (60 条内容, seed 灌入)
//     §2.2 practice_attempts  —— 自由作答练习记录 (零压无分)
//     §4「反双胞胎对账」明确: training_exercises / training_exercise_attempts
//     **一行不改** (继续服务备考频道的 MCQ 模拟答题), 自由作答另立表.
//   设计 (跟 1714900000011-AddTrainingExerciseAttempts V0.5 治本风格一致):
//     - practice_scenarios: 1 张表, 20 列 (id + 16 字段 + created_at/updated_at/
//       deleted_at) + 4 索引 (PRIMARY + uniq_ps_scenario_key + idx_ps_mode_enabled
//       + idx_ps_user)
//     - practice_attempts: 1 张表, 12 列 (id + 9 字段 + created_at/deleted_at)
//       + 3 索引 (PRIMARY + idx_pa_user_scenario + idx_pa_user_created)
//     - 全部软删 (deleted_at) + tenant_id + user_id (spec §6.4 硬约束)
//     - 无 DB-level FK (跟 ADR-0003 一致, 跨表引用应用层校验)
//     - **内容不进 migration** (spec §6.3): 60 条场景由独立脚本
//       bin/seed-practice-scenarios.ts 按 scenario_key 幂等 upsert
//
//   反双胞胎:
//     - 不用 ENUM 列类型: 跟 V0.x/V1.x 一致, varchar + 应用层 enum 校验
//     - 不给 practice_attempts 加 score / is_correct 列: spec §6.2 明令不下发分数;
//       列都不存在 = 物理上不可能下发分数
//     - 不加 expected_turns 之外的会话表: P2 多轮用 practice_attempts.turn +
//       feedback.visitorReaction 还原转写, 不另立 practice_session 表
//     - 不用 synchronize: schema 只走 migration (ADR-0003)
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'practice_scenarios'; # 1 张表
//     2. SHOW TABLES LIKE 'practice_attempts'; # 1 张表
//     3. SHOW INDEX FROM practice_scenarios; # 4 索引
//     4. SHOW INDEX FROM practice_attempts; # 3 索引
//     5. DESCRIBE practice_attempts; # 12 列, 无 score 列
//     6. npm run seed:practice → 60 行; 连跑两次行数不变
//
//   时间戳: 2026-10-22
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPracticeScenarios1714900000015 implements MigrationInterface {
  name = 'AddPracticeScenarios1714900000015';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── practice_scenarios (V1.3 §2.1 拍板 场景变体库, 20 列 + 4 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS practice_scenarios (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NULL,
        exercise_mode VARCHAR(50) NOT NULL,
        scenario_key VARCHAR(80) NOT NULL,
        difficulty INT NOT NULL,
        is_ai_generated TINYINT NOT NULL DEFAULT 0,
        persona JSON NOT NULL,
        opening_line TEXT NOT NULL,
        task_prompt TEXT NOT NULL,
        botched_utterance TEXT NULL,
        voice_script TEXT NULL,
        reference_response TEXT NOT NULL,
        common_pitfalls JSON NOT NULL,
        rubric JSON NOT NULL,
        expected_turns INT NOT NULL DEFAULT 1,
        enabled TINYINT NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE KEY uniq_ps_scenario_key (scenario_key),
        INDEX idx_ps_mode_enabled (exercise_mode, enabled),
        INDEX idx_ps_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── practice_attempts (V1.3 §2.2 拍板 自由作答练习记录, 12 列 + 3 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS practice_attempts (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        scenario_id CHAR(36) NOT NULL,
        submitted_text TEXT NOT NULL,
        record_seconds INT NULL,
        speech_rate_wpm FLOAT NULL,
        feedback JSON NOT NULL,
        duration_seconds INT NOT NULL DEFAULT 0,
        turn INT NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_pa_user_scenario (user_id, scenario_id),
        INDEX idx_pa_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 先删从表再删主表 (无 FK, 但保持语义顺序, 便于人工回滚时阅读).
    await qr.query(`DROP TABLE IF EXISTS practice_attempts;`);
    await qr.query(`DROP TABLE IF EXISTS practice_scenarios;`);
  }
}
