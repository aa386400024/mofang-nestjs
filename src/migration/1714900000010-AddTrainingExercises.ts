// V2026-10-19 治本 (V1.1 §5.2 企业级 — training_exercises 表 + 5 索引, 1:1 wire §5.2 + §6.5 拍板):
//   原因: counselor-mode-v1.1 §5.2 拍板专项技能 10 训练项 (倾听共情 3 + 提问技术
//     4 + 语音微训练 3), V0.5 stage 简化版 0 落地 1:1 阻断 §5.2 1:1 wire. 跟
//     V0.5 training_sessions 1:1 wire 拍板风格 (V2026-10-19 治本续 V8.3 落地):
//     training_exercises 1 张表 + 5 索引 (PRIMARY + 4 复合) + 19 列 (id + 14
//     字段 + createdAt/updatedAt/deletedAt + 5 索引覆盖列) + 3 enum varchar 字段
//     (type/mode/difficulty 1:1 wire V0.5 client 1:1 wire 拍板).
//   设计 (跟 1700000010007-AddLongTermCases + 1714900000009-AddTrainingSessions
//   V0.5 治本续 V8.3 1:1 wire 风格):
//     - training_exercises: 1 张表, 19 列 (id + 14 字段 + createdAt/updatedAt/
//       deletedAt + 5 索引覆盖列)
//     - 5 索引: PRIMARY + idx_te_type_mode (type, mode) + idx_te_difficulty +
//       idx_te_type_diff (type, difficulty) + idx_te_enabled
//     - 3 enum 字段 (type/mode/difficulty) 走 varchar + 应用层 enum 校验
//       (跟 V0.5 治本 V2026-10-12 1:1 wire 一致, 避免 DB schema 跟 enum 字符串 drift)
//     - options / rubric 走 json 字段 (跟 V0.5 training_session.transcript 1:1 wire
//       拍板风格, V1.x JSON 足够, V2.x RAG 升级再切)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不用 ENUM 类型 (跟 V0.5 training_sessions 1:1 wire, varchar + 应用层 enum
//       校验, V0.5 V2026-10-12 治本一致)
//     - 不加 DB-level FK (跟 V0.5 supervision_feedback 1:1 wire, V0.x 风格应用层
//       校验, 软删兼容)
//     - 不存 vector 字段 (V1.x JSON 足够, V2.x RAG 升级再切)
//     - 不写 user_memberships 加列 (V0.5 阶段 quota 表单独, V1.x W9-10 续做 billing
//       时改, 跟 V0.5 治本 V2026-10-19 1:1 wire style, 单独 migration 不牵动
//       user_memberships)
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'training_exercises'; # 1 张表
//     2. SHOW INDEX FROM training_exercises; # 5 索引 (PRIMARY + 4 复合)
//     3. DESCRIBE training_exercises; # 19 列
//     4. SELECT * FROM training_exercises LIMIT 0; # 空表 (Phase 2 seed 后填数据)
//
//   时间戳: 2026-10-19
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrainingExercises1714900000010 implements MigrationInterface {
  name = 'AddTrainingExercises1714900000010';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── training_exercises (V1.1 §5.2 拍板 10 训练项, 19 列 + 5 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS training_exercises (
        id CHAR(36) NOT NULL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        mode VARCHAR(50) NOT NULL,
        difficulty VARCHAR(20) NOT NULL,
        scenario_context TEXT NOT NULL,
        options JSON NOT NULL,
        correct_option_index INT NOT NULL,
        rubric JSON NOT NULL,
        expert_feedback TEXT NOT NULL,
        duration_minutes INT NOT NULL,
        persona_name VARCHAR(100) NOT NULL,
        persona_background TEXT NOT NULL,
        real_time_correction_enabled TINYINT NOT NULL DEFAULT 0,
        enabled TINYINT NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_te_type_mode (type, mode),
        INDEX idx_te_difficulty (difficulty),
        INDEX idx_te_type_diff (type, difficulty),
        INDEX idx_te_enabled (enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 单表 migration, 直接 DROP 即可.
    await qr.query(`DROP TABLE IF EXISTS training_exercises;`);
  }
}
