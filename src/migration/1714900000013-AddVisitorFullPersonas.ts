// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设: visitor_full_personas + case_profile_entries 建表):
//   原因: v1.2 spec §4 要求 M1 分层人设引擎的落库: §4.1 AI 底层全量人设 + §4.2 动态解锁档案.
//     gap 扫描 (2026-10-21) 确认这 2 张表 0 落地, 且现有 long_term_cases.visitor_persona
//     (8 字段浅层) 承载不了成长时间线 / 内在工作模型, v1.2 §4.1「信息暴露节奏」无从谈起.
//   修法: 1 个 migration 建 2 张表 (同属 M1 人设体系, 一起建一起回滚):
//     - visitor_full_personas: 7 大块各占 1 个 JSON 列 + trust_level + case_id (可空, UNIQUE)
//     - case_profile_entries: 动态解锁档案 (case_id / session_id 可空 / layer / anchor_key / content)
//   反双胞胎:
//     - 不用 typeorm migration:generate 自动生成: bin/ormconfig.ts:140 的 entities glob 只覆盖
//       src/entity/** 里的 sampledb, **扫不到 counselor 系 entity** → generate 出来是空壳.
//       counselor 系 migration 历来手写 DDL (1714900000009/0010/0011/0012 全部手写), 保持一致
//     - 不加 DB-level FK: 跟仓库既有 pattern 一致 (knowledge_chunks.itemId /
//       long_term_case_sessions.caseId 都是应用层校验, 软删兼容)
//     - 不加 trust_level 的时间序列表: 历史轨迹由 case_profile_entries.sessionId 承载
//     - 不把 7 大块塞进 1 个 json 列: 无法对单块做 SQL 过滤/统计
//   验证:
//     1. 大炮跑 pnpm migration:run
//     2. SHOW CREATE TABLE visitor_full_personas → 7 个 JSON 列 + 3 索引
//     3. SHOW CREATE TABLE case_profile_entries → 3 索引
//     4. SHOW INDEX FROM visitor_full_personas → uniq_vfp_case 存在
//   时间戳: 2026-10-21
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVisitorFullPersonas1714900000013 implements MigrationInterface {
  name = 'AddVisitorFullPersonas1714900000013';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS visitor_full_personas (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        case_id CHAR(36) NULL,
        display_name VARCHAR(100) NOT NULL,
        basics JSON NOT NULL,
        developmental_timeline JSON NOT NULL,
        inner_working_model JSON NOT NULL,
        social_map JSON NOT NULL,
        coping JSON NOT NULL,
        therapy_expectation JSON NOT NULL,
        presenting_issue JSON NOT NULL,
        trust_level FLOAT NOT NULL DEFAULT 0.2,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_vfp_tenant_user (tenant_id, user_id),
        UNIQUE INDEX uniq_vfp_case (case_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS case_profile_entries (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        case_id CHAR(36) NOT NULL,
        session_id CHAR(36) NULL,
        layer VARCHAR(20) NOT NULL,
        anchor_key VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_cpe_case (case_id),
        INDEX idx_cpe_case_session (case_id, session_id),
        INDEX idx_cpe_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS case_profile_entries;`);
    await qr.query(`DROP TABLE IF EXISTS visitor_full_personas;`);
  }
}
