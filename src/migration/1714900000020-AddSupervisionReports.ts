// V2026-10-26 治本 (V1.x 督导报告落库 — supervision_reports 表):
//   原因: vpt 全真语音会话增强 (spec 任务 6) 要求「结束督导生成的结构化报告**持久化**到该
//     training_sessions 记录」, 但现状是**纯内存** (`SupervisionReportRepositoryMemory`):
//       · 进程一重启, 复盘报告就没了 —— 而复盘报告恰恰是"训练完之后才看"的东西
//       · 换实例 / 多实例部署就查不到
//       · 报告查询出口 (GET /counselor/supervision/report/:sessionId) 无从谈起
//     实体 `SupervisionReportEntity` 早就按 TypeORM 装饰器写好 (原注释: "V0.x 内存 mock,
//     entity 仍按 TypeORM 装饰器写, V1.x 一键切 DB"), 本迁移就是那"一键"配套的建表.
//   设计 (跟 AddSupervisionSchools / AddKnowledgeChunks 同款手写 DDL 风格):
//     - 列: id / tenant_id / session_id / user_id / persona_id / persona_name / difficulty
//           / status / overall_score / dimensions / annotations / error_patterns
//           / growth_suggestions / raw_response / created_at (16 列)
//     - 索引: PRIMARY + UNIQUE idx_supervision_tenant_session (tenant_id, session_id)
//           + idx_supervision_status_created (status, created_at) = 3 索引
//     - **UNIQUE (tenant_id, session_id)** 是"一个 session 一份报告"这条不变量的结构级保证:
//       内存实现靠 Map 覆盖, 真库实现靠唯一键; 没有它, BullMQ 重试 (attempts: 3) 会在
//       同一 session 下堆出多份报告, 查询只能"排序取最新"—— 那等于把"覆盖"降级成"挑一份",
//       语义漂移.
//     - 不落软删列: 督导报告写完即终态, 不可改写 (跟 entity 声明一致, 不加 deleted_at)
//     - 不落 session_type: 报告按 session_id 关联, 类型由 training_sessions 行决定
//       (vpt / 单次训练同表, 报告结构一致)
//   反双胞胎:
//     - 不用 synchronize: true 自动建表: ADR-0003 已禁, 一切 schema 变更走 migration
//     - 不新建 `vpt_reports` 表: 督导报告跨场景共用 (vpt / 单次训练 / 长程同一套结构),
//       另开 vpt 专用表 = 两份报告结构 + 两套查询, 必然漂移
//     - 不加 DB-level FK 到 training_sessions: 跟仓库其余表一致 (软删兼容, 应用层校验)
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'supervision_reports'; # 1 张表
//     2. DESCRIBE supervision_reports; # 16 列
//     3. SHOW INDEX FROM supervision_reports; # 3 索引 (PRIMARY + UNIQUE + 普通)
//     4. SELECT * FROM supervision_reports LIMIT 0; # 空表
//   时间戳: 2026-10-26

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupervisionReports1714900000020 implements MigrationInterface {
  name = 'AddSupervisionReports1714900000020';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS supervision_reports (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
        session_id VARCHAR(128) NOT NULL,
        user_id VARCHAR(128) NOT NULL,
        persona_id VARCHAR(64) NOT NULL,
        persona_name VARCHAR(80) NOT NULL,
        difficulty VARCHAR(8) NOT NULL,
        status VARCHAR(16) NOT NULL,
        overall_score INT NOT NULL,
        dimensions JSON NOT NULL,
        annotations JSON NOT NULL,
        error_patterns JSON NOT NULL,
        growth_suggestions JSON NOT NULL,
        raw_response TEXT NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX idx_supervision_tenant_session (tenant_id, session_id),
        INDEX idx_supervision_status_created (status, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS supervision_reports;`);
  }
}
