// V2026-10-15 治本 (V2.1 — supervision_schools + supervision_feedback 2 表 + 5 索引):
//   原因: counselor-mode-v1.0 §6.2 拍板 2 张表 (supervision_schools 4 流派配置 +
//     supervision_feedback polymorphic 反馈记录), V0.3 §13 baseline 0 督导持久化
//     (V0.x 督导落 V0.x supervisionReport json 字段), 1:1 wire 0 破坏. W1-2 长程 sessions
//     entity 已留 supervision_feedback json nullable, W3-4 4 流派叠加走独立表, 不污染 W1-2.
//
//   设计 (跟 knowledge-base/ 1700000010006-AddKnowledgeChunks V0.x 风格一致):
//     - supervision_schools: 4 流派配置 (code/name/focusAreas/exampleFeedback/promptTemplate)
//       列: id / code / name / focus_areas / example_feedback / prompt_template /
//            is_active / created_at / updated_at / deleted_at (10 列)
//       索引: PRIMARY + UNIQUE uniq_ss_code (code) + idx_ss_active (is_active) = 3 索引
//     - supervision_feedback: N 条反馈记录 (polymorphic sessionId + 4 流派 schoolId)
//       列: id / tenant_id / user_id / session_id / session_type / school_id / feedback /
//            created_at / updated_at / deleted_at (11 列)
//       索引: PRIMARY + UNIQUE uniq_sf_session_school (session_id, session_type, school_id)
//             + idx_sf_user (user_id) = 3 索引
//     - 4 流派走 seed migration (INSERT 4 行到 supervision_schools), 跟 V0.x SeedDevData
//       pattern 一致; prompt_template 字段 V0.5 mock 阶段填 TS 模板字符串, V1.x 真接
//       LLM 时改 provider 注入
//     - polymorphic FK (sessionId + sessionType): 软删兼容, 应用层校验, 走对应 Repository
//
//   反双胞胎:
//     - 不复用 V0.x supervisionReport json 字段加流派维度: 破坏 1:1 wire, 1:1 wire 0 破坏
//       V0.3 baseline
//     - 不在 W1-2 LongTermCaseSession.supervisionFeedback json 字段塞 4 流派: 那是
//       session 完成时的"默认流派"反馈, W3-4 4 流派叠加走独立表
//     - 不写 DB-level FK (schoolId → supervision_schools.id): 软删兼容, 应用层校验
//     - 不引 vector store: V0.x 阶段不接 RAG, V2.x 升级再切
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'supervision_%';  # 2 张表
//     2. SHOW INDEX FROM supervision_schools; # 3 索引
//     3. SHOW INDEX FROM supervision_feedback; # 3 索引
//     4. SELECT * FROM supervision_schools;  # 4 行 (seed)
//     5. SELECT * FROM supervision_feedback LIMIT 0;  # 空表
//
//   时间戳: 2026-10-15

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupervisionSchools1714900000006 implements MigrationInterface {
  name = 'AddSupervisionSchools1714900000006';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── 1. supervision_schools (4 流派配置, 10 列 + 3 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS supervision_schools (
        id CHAR(36) NOT NULL PRIMARY KEY,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(200) NOT NULL,
        focus_areas JSON NOT NULL,
        example_feedback JSON NOT NULL,
        prompt_template TEXT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE INDEX uniq_ss_code (code),
        INDEX idx_ss_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── 2. supervision_feedback (polymorphic 反馈记录, 11 列 + 3 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS supervision_feedback (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        session_id CHAR(36) NOT NULL,
        session_type VARCHAR(40) NOT NULL,
        school_id CHAR(36) NOT NULL,
        feedback JSON NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE INDEX uniq_sf_session_school (session_id, session_type, school_id),
        INDEX idx_sf_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 先删从表 (supervision_feedback) 再删主表 (supervision_schools),
    // 跟 up 顺序倒置, 跟 V0.x migration 风格一致.
    await qr.query(`DROP TABLE IF EXISTS supervision_feedback;`);
    await qr.query(`DROP TABLE IF EXISTS supervision_schools;`);
  }
}
