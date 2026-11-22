// V2026-10-19 治本 (V1.1 §5.2 企业级 — training_exercise_attempts 表 + 4 索引, 1:1 wire §5.2 + §6.5 拍板):
//   原因: counselor-mode-v1.1 §5.2 拍板专项技能 训练题模式 (选择题 + AI 评分 +
//     即时反馈), 跟 V0.5 stage 简化版 0 落地 1:1 阻断 §5.2 1:1 wire. 答题记录
//     表 1:1 wire V0.5 supervision_feedback 1:1 wire 拍板风格 (V0.3 §13 baseline
//     0 破坏): 17 列 (id + 13 字段 + createdAt/updatedAt/deletedAt) + 4 索引
//     (PRIMARY + 3 复合) + 1 enum varchar 字段 (status 5 档 1:1 wire §5.2 拍板).
//   设计 (跟 1700000010007-AddLongTermCases + 1714900000009-AddTrainingSessions
//   V0.5 治本续 V8.3 1:1 wire 风格):
//     - training_exercise_attempts: 1 张表, 17 列 (id + 13 字段 + createdAt/
//       updated_at/deleted_at + 4 索引覆盖列)
//     - 4 索引: PRIMARY + idx_tea_user (userId) + idx_tea_exercise (exerciseId) +
//       idx_tea_status (status)
//     - 1 enum 字段 (status) 走 varchar + 应用层 enum 校验 (跟 V0.5 治本 V2026-10-12
//       1:1 wire 一致)
//     - dimension_scores 走 json 字段 (跟 V0.5 training_session.transcript 1:1 wire
//       拍板风格)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不用 ENUM 类型 (跟 V0.5 training_sessions 1:1 wire, varchar + 应用层 enum
//       校验, V0.5 V2026-10-12 治本一致)
//     - 不加 DB-level FK (跟 V0.5 supervision_feedback 1:1 wire, V0.x 风格应用层
//       校验, 软删兼容)
//     - 不存 vector 字段 (V1.x JSON 足够, V2.x RAG 升级再切)
//     - 不写 user_memberships 加列 (V0.5 阶段 quota 表单独, V1.x W9-10 续做 billing
//       时改, 跟 V0.5 治本 V2026-10-19 1:1 wire style)
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'training_exercise_attempts'; # 1 张表
//     2. SHOW INDEX FROM training_exercise_attempts; # 4 索引 (PRIMARY + 3 复合)
//     3. DESCRIBE training_exercise_attempts; # 17 列
//     4. SELECT * FROM training_exercise_attempts LIMIT 0; # 空表 (Phase 2 seed
//        后用户首次答题填数据)
//
//   时间戳: 2026-10-19
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrainingExerciseAttempts1714900000011 implements MigrationInterface {
  name = 'AddTrainingExerciseAttempts1714900000011';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── training_exercise_attempts (V1.1 §5.2 拍板 答题记录, 17 列 + 4 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS training_exercise_attempts (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        exercise_id CHAR(36) NOT NULL,
        selected_option_index INT NOT NULL,
        is_correct TINYINT NOT NULL,
        score INT NOT NULL,
        dimension_scores JSON NOT NULL,
        ai_feedback TEXT NOT NULL,
        attempt_duration_seconds INT NOT NULL DEFAULT 0,
        real_time_correction_used TINYINT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL,
        completed_at DATETIME(6) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_tea_user (user_id),
        INDEX idx_tea_exercise (exercise_id),
        INDEX idx_tea_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 单表 migration, 直接 DROP 即可.
    await qr.query(`DROP TABLE IF EXISTS training_exercise_attempts;`);
  }
}
