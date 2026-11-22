// V2026-10-15 治本 (V1.1 — long_term_cases + long_term_case_sessions 2 表 + 6 索引):
//   原因: counselor-mode-v1.0 §6.1 拍板 long_term_cases + long_term_case_sessions 2 张表,
//     V0.3 §13 baseline 0 长程, 1:1 wire 0 破坏. 长程 1:N 多次会话语义跟 V0.x TrainingSession
//     (单次模拟) 完全不同, 单独建表避免 1:1 wire 污染 V0.x baseline.
//
//   设计 (跟 life-map/ 1700000010004-AddGenomeDimensions + knowledge-base/ 1700000010006
//   -AddKnowledgeChunks V0.x 风格一致):
//     - long_term_cases: 1 个长程个案元数据
//       列: id / tenant_id / user_id / case_type / title / config / visitor_persona /
//            progress_curve / current_session / total_sessions / dropout_risk_score /
//            is_template / status / created_at / updated_at / deleted_at (16 列)
//       索引: PRIMARY + idx_ltc_tenant_user (tenant_id, user_id) + idx_ltc_status (status)
//             + idx_ltc_template (is_template, case_type) = 4 索引
//     - long_term_case_sessions: N 次会话
//       列: id / tenant_id / case_id / session_number / transcript / supervision_feedback /
//            overall_score / next_session_context / duration_seconds / created_at / updated_at /
//            deleted_at (12 列)
//       索引: PRIMARY + UNIQUE uniq_ltcs_case_session (case_id, session_number) +
//             idx_ltcs_tenant_case (tenant_id, case_id) = 3 索引
//     - is_template TINYINT(1): 5 预设个案 (workplace/relationship/parenting/grief/anxiety)
//       模板 (is_template=1) 跟用户实例 (is_template=0) 分离, 跟 KB isTemplate 同 pattern
//     - 软删 deletedAt: 跟 V3 其他模块一致
//     - JSON 字段: config / visitor_persona / transcript / supervision_feedback /
//                  next_session_context (5 个 JSON 字段, V0.x pattern 风格)
//
//   反双胞胎:
//     - 不在 V0.x TrainingSession 加 longTermCaseId 字段: 破坏 1:1 wire + PrivacyGuard
//       装饰器链 (VS-4 已上线 3 controller 30 endpoint)
//     - 不加 DB-level FK (case_id → long_term_cases.id): 软删兼容, 应用层校验, 跟
//       knowledge_chunks.itemId V0.x pattern 一致
//     - 不存 vector 字段: V1.x JSONB 足够 (5 字段结构化 memory), V2.x RAG 升级再切
//     - 不写 ENUM 类型 (caseType/status 走 varchar + 应用层 enum 校验): V0.x pattern 风格,
//       V0.5 V2026-10-12 治本一致, 避免 DB schema 跟 enum 字符串 drift
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'long_term_%';  # 2 张表
//     2. SHOW INDEX FROM long_term_cases; # 4 索引 (PRIMARY + 3 复合)
//     3. SHOW INDEX FROM long_term_case_sessions; # 3 索引 (PRIMARY + UNIQUE + 复合)
//     4. DESCRIBE long_term_cases; # 16 列
//     5. DESCRIBE long_term_case_sessions; # 12 列
//     6. SELECT * FROM long_term_cases LIMIT 0;  # 空表
//
//   时间戳: 2026-10-15

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLongTermCases1700000010007 implements MigrationInterface {
  name = 'AddLongTermCases1700000010007';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── 1. long_term_cases (长程个案元数据, 16 列 + 4 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS long_term_cases (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        case_type VARCHAR(40) NOT NULL,
        title VARCHAR(200) NOT NULL,
        config JSON NOT NULL,
        visitor_persona JSON NOT NULL,
        progress_curve VARCHAR(20) NOT NULL DEFAULT 'stable',
        current_session INT NOT NULL DEFAULT 1,
        total_sessions INT NOT NULL,
        dropout_risk_score FLOAT NOT NULL DEFAULT 0.0,
        is_template TINYINT(1) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_ltc_tenant_user (tenant_id, user_id),
        INDEX idx_ltc_status (status),
        INDEX idx_ltc_template (is_template, case_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── 2. long_term_case_sessions (1:N 次会话, 12 列 + 3 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS long_term_case_sessions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        case_id CHAR(36) NOT NULL,
        session_number INT NOT NULL,
        transcript JSON NOT NULL,
        supervision_feedback JSON NULL,
        overall_score INT NULL,
        next_session_context JSON NULL,
        duration_seconds INT NOT NULL DEFAULT 0,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE INDEX uniq_ltcs_case_session (case_id, session_number),
        INDEX idx_ltcs_tenant_case (tenant_id, case_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 先删从表 (long_term_case_sessions) 再删主表 (long_term_cases),
    // 跟 up 顺序倒置, 跟 V0.x migration 风格一致.
    await qr.query(`DROP TABLE IF EXISTS long_term_case_sessions;`);
    await qr.query(`DROP TABLE IF EXISTS long_term_cases;`);
  }
}
