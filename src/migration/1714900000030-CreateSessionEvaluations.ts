// V2026-11-06 治本 (WP43 — session_evaluations 单场规则快评表):
//   原因: 任务单 `docs/worklog/pending/wp43-evaluation-engine-basic-2026-11-06.md`
//     要求"会话结束后立刻出分" —— 但评估算出来之后**无处可放**. 督导报告表
//     (supervision_reports) 是 LLM 深度版 (30-120s), 能力雷达表 (ability_scores)
//     是跨会话累计画像, 两者都不是"单场快评"这个形状 —— 不另起一套只会更乱.
//
//   表结构: 9 列 (id / session_id / user_id / overall_score / 3 个维度 JSON +
//     raw_stats JSON + created_at) + 3 索引 (PRIMARY + 学员维度复合 + session_id 唯一).
//
//   ⚠️ **session_id 唯一**: 一场会话只该有一份评估 —— 会话被重开/续接时会重算,
//     **覆盖**旧的 (新的是全量), 而不是堆出第二行 (列表里两行同一场 = 用户看不懂).
//
//   ⚠️ **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//   ⚠️ **不做软删**: 评估是"某场聊完算出来的事实", 删掉它等于让复盘凭空消失.
//   ⚠️ **不落对话原文**: raw_stats 只有计数与首末关键值 —— 心理内容不进普通表.
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: 仓库 60+ 条 migration 历来手写 DDL.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: INFORMATION_SCHEMA 守卫 (缺才建 / 缺才补索引) —— 重复跑 up 不报错,
//       半途中断后重跑能补齐.
//     - **不改已执行的迁移**: 0029 及以前的一行不动 —— 迁移只增不改.
//
//   部署顺序:
//     entity 加了表 → 运行时写入前 **必须先 migration:run**, 否则写库报
//     "Table 'session_evaluations' doesn't exist".
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE session_evaluations;   # 9 列 + 3 索引 (session_id 唯一)
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//     3. pnpm migration:revert → 表消失; 再 migration:run → 表回来
//
//   时间戳: 2026-11-06
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 查表是否已存在 (INFORMATION_SCHEMA; 走 DATABASE() = 当前连接的库).
 *
 * @param qr 查询执行器
 * @param table 表名
 * @returns 存在则 true
 */
async function tableExists(qr: QueryRunner, table: string): Promise<boolean> {
  const rows = (await qr.query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [
    table,
  ])) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * 查表里已有的索引名 (SHOW INDEX).
 *
 * @param qr 查询执行器
 * @param table 表名
 * @returns 已存在的索引名集合
 */
async function existingIndexes(qr: QueryRunner, table: string): Promise<Set<string>> {
  const rows = (await qr.query(`SHOW INDEX FROM ${table};`)) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['Key_name'] === 'string' ? row['Key_name'] : '')));
}

/**
 * 建 `session_evaluations` 表 (规则引擎单场快评).
 */
export class CreateSessionEvaluations1714900000030 implements MigrationInterface {
  name = 'CreateSessionEvaluations1714900000030';

  /**
   * 建表 + 补索引 (幂等).
   *
   * @param qr 查询执行器
   */
  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 表不存在才建 (CREATE TABLE IF NOT EXISTS 兜底半途中断).
    if (!(await tableExists(qr, 'session_evaluations'))) {
      await qr.query(`
        CREATE TABLE IF NOT EXISTS session_evaluations (
          id CHAR(36) NOT NULL,
          session_id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          overall_score FLOAT NOT NULL,
          technical_scores JSON NOT NULL,
          bdi_delta_scores JSON NOT NULL,
          ethics_scores JSON NOT NULL,
          raw_stats JSON NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_se_session (session_id),
          INDEX idx_se_user_created (user_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      return;
    }

    // 幂等守卫: 表已存在时 (上一轮跑过 / 半途中断), 补齐缺失的索引.
    const indexes = await existingIndexes(qr, 'session_evaluations');
    if (!indexes.has('uq_se_session')) {
      await qr.query(`ALTER TABLE session_evaluations ADD UNIQUE KEY uq_se_session (session_id);`);
    }
    if (!indexes.has('idx_se_user_created')) {
      await qr.query(`ALTER TABLE session_evaluations ADD INDEX idx_se_user_created (user_id, created_at);`);
    }
  }

  /**
   * 回滚 (删表即净回滚: 本迁移只建了这 1 张表, 不残留列 / 不残留索引).
   *
   * @param qr 查询执行器
   */
  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS session_evaluations;`);
  }
}
