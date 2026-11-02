// V2026-10-19 治本 (V1.1 §6.5 — training_sessions 表 + 5 索引):
//   原因: counselor-mode-v1.1 §6.5 拍板 training_sessions 表 (9 场景单次训练 session
//     持久化), V0.3 §13 baseline 0 training_sessions 表 (V0.x TrainingSession 走
//     supervisionReport json 字段, 不是独立表), 1:1 wire 0 破坏. 跟 long-term-case-
//     session.entity.ts V1.1 1:1 wire (transcript shape 复用 §6.1 SessionTranscriptTurn
//     pattern + V0.5 client ChatMessage 5 字段增量).
//
//   设计 (跟 1700000010007-AddLongTermCases V1.1 风格一致):
//     - training_sessions: 1 张表, 25 列
//     - 5 索引: PRIMARY + idx_ts_tenant_user (tenant_id, user_id) +
//       idx_ts_scenario (scenario_id) + idx_ts_status (status) +
//       idx_ts_user_started (user_id, started_at)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//     - JSON 字段: transcript (ChatMessage[] 数组)
//     - enum 字段走 varchar + 应用层 enum 校验 (status / difficulty / visitorStyle /
//       mode / 3 variance 共 7 varchar 字段, 跟 V0.x pattern 风格一致, 避免 DB schema
//       跟 enum 字符串 drift)
//     - 6 enum (TrainingSessionStatus/VisitorStyle/VisitorMode/DimensionVariance/
//       TrainingDifficulty/ChatRole) 跟 xin_su_app V0.5 client 1:1 wire
//
//   反双胞胎:
//     - 不用 ENUM 类型 (status / mode / visitorStyle / 3 variance / difficulty 走 varchar
//       + 应用层 enum): V0.x pattern 风格, V0.5 V2026-10-12 治本一致, 避免 DB schema
//       跟 enum 字符串 drift
//     - 不加 DB-level FK (supervisionReportId → supervision_feedback.id): V0.5 mock 跳
//       固定 3 条, V1.x W3-4 接后改应用层校验 (跟 knowledge_chunks.itemId V0.x pattern
//       一致)
//     - 不在 transcript 字段加 emotion_score: 跟 V0.5 client ChatMessage 1:1 wire
//     - 不加 polymorphic sessionType 字段: V0.5 阶段只接 V0.5 client 一种, 跟 W1-2
//       long_term_case_session 区分 (不同表 + 不同 enum, 不走 polymorphic 1 表多 type)
//     - 不写 user_memberships 加列: V0.5 阶段 quota 表单独, V1.x W7-8 续做 billing
//       时改 (跟 1714900000008-AddQuotaUsage V0.x 风格一致, 单独 migration 不牵动
//       user_memberships)
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'training_sessions'; # 1 张表
//     2. SHOW INDEX FROM training_sessions; # 5 索引 (PRIMARY + 4 复合)
//     3. DESCRIBE training_sessions; # 25 列
//     4. SELECT * FROM training_sessions LIMIT 0; # 空表
//
//   时间戳: 2026-10-19

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrainingSessions1714900000009 implements MigrationInterface {
  name = 'AddTrainingSessions1714900000009';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── training_sessions (9 场景单次训练 session, 25 列 + 5 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS training_sessions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        scenario_id VARCHAR(50) NOT NULL,
        difficulty VARCHAR(20) NOT NULL,
        duration_minutes INT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'idle',
        persona_name VARCHAR(100) NOT NULL,
        persona_age INT NOT NULL,
        persona_occupation VARCHAR(200) NOT NULL,
        persona_complaint TEXT NOT NULL,
        persona_background TEXT NOT NULL,
        visitor_style VARCHAR(20) NOT NULL,
        emotion_baseline FLOAT NOT NULL,
        defense_level FLOAT NOT NULL,
        random_seed VARCHAR(50) NOT NULL,
        mode VARCHAR(20) NOT NULL,
        style_variance VARCHAR(10) NOT NULL,
        emotion_variance VARCHAR(10) NOT NULL,
        defense_variance VARCHAR(10) NOT NULL,
        transcript JSON NOT NULL,
        supervision_report_id CHAR(36) NULL,
        started_at DATETIME(6) NULL,
        ended_at DATETIME(6) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_ts_tenant_user (tenant_id, user_id),
        INDEX idx_ts_scenario (scenario_id),
        INDEX idx_ts_status (status),
        INDEX idx_ts_user_started (user_id, started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 单表 migration, 直接 DROP 即可.
    await qr.query(`DROP TABLE IF EXISTS training_sessions;`);
  }
}
