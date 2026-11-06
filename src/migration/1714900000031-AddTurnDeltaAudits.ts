// V2026-11-06 治本 (WP58 — turn_delta_audits 事件 + delta 审计观测表):
//   原因: 现在"这一轮触发了什么事件 / 改了多少分"只有两处痕迹 ——
//     ① cap 砍幅的 warning 日志 (只在**被砍**时才有, 没被砍的轮次完全无痕);
//     ② 调试会话的完整 delta 明细 (只在 HTTP 响应里, 不落库, 只对调试会话有效).
//     正式训练会话出了问题, 没法按 sessionId 检索 —— 切灰度后排错 / 督导报告 /
//     成长档案都缺这个数据底座.
//
//   表结构: 8 列 (id / tenant_id / session_id / turn_index / event_kinds JSON /
//     event_details JSON / raw_delta JSON / created_at) + 3 索引.
//
//   ⚠️ **(tenant_id, session_id, turn_index) 唯一**: 一场会话一轮一条 ——
//     BullMQ 重试不会堆出多行 (重试覆盖同一行). 没有它, 排障时看到同一轮三行,
//     根本分不清哪行是真的.
//   ⚠️ **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//   ⚠️ **不做软删**: 审计是"某场聊完留下的事实", 删掉它等于让排障凭空消失.
//   ⚠️ **不落咨询师原话**: 只有事件类型 + 命中词 + delta 数值 —— 心理内容不进普通表.
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: 仓库 60+ 条 migration 历来手写 DDL.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: INFORMATION_SCHEMA 守卫 (缺才建 / 缺才补索引) —— 重复跑 up 不报错,
//       半途中断后重跑能补齐.
//     - **不改已执行的迁移**: 0030 及以前的一行不动 —— 迁移只增不改.
//
//   部署顺序:
//     entity 加了表 → 运行时写入前 **必须先 migration:run**, 否则写库报
//     "Table 'turn_delta_audits' doesn't exist".
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE turn_delta_audits;   # 8 列 + 3 索引
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
  const rows = (await qr.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [
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
  const rows = (await qr.query('SHOW INDEX FROM ' + table + ';')) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['Key_name'] === 'string' ? row['Key_name'] : '')));
}

/**
 * 建 turn_delta_audits 表 (事件 + delta 审计观测).
 */
export class AddTurnDeltaAudits1714900000031 implements MigrationInterface {
  name = 'AddTurnDeltaAudits1714900000031';

  /**
   * 建表 + 补索引 (幂等).
   *
   * @param qr 查询执行器
   */
  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 表不存在才建 (CREATE TABLE IF NOT EXISTS 兜底半途中断).
    if (!(await tableExists(qr, 'turn_delta_audits'))) {
      await qr.query(
        'CREATE TABLE IF NOT EXISTS turn_delta_audits (' +
          'id VARCHAR(36) NOT NULL,' +
          "tenant_id VARCHAR(64) NOT NULL DEFAULT 'default'," +
          'session_id VARCHAR(128) NOT NULL,' +
          'turn_index INT NOT NULL,' +
          'event_kinds JSON NOT NULL,' +
          'event_details JSON NOT NULL,' +
          'raw_delta JSON NOT NULL,' +
          'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
          'PRIMARY KEY (id),' +
          'UNIQUE KEY idx_turn_delta_audit_turn (tenant_id, session_id, turn_index),' +
          'KEY idx_turn_delta_audit_session (tenant_id, session_id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
      );
      return;
    }

    // 幂等守卫: 表已存在时 (上一轮跑过 / 半途中断), 补齐缺失的索引.
    const indexes = await existingIndexes(qr, 'turn_delta_audits');
    if (!indexes.has('idx_turn_delta_audit_turn')) {
      await qr.query('ALTER TABLE turn_delta_audits ADD UNIQUE KEY idx_turn_delta_audit_turn (tenant_id, session_id, turn_index);');
    }
    if (!indexes.has('idx_turn_delta_audit_session')) {
      await qr.query('ALTER TABLE turn_delta_audits ADD KEY idx_turn_delta_audit_session (tenant_id, session_id);');
    }
  }

  /**
   * 回滚 (删表即净回滚: 本迁移只建了这 1 张表, 不残留列 / 不残留索引).
   *
   * @param qr 查询执行器
   */
  public async down(qr: QueryRunner): Promise<void> {
    await qr.query('DROP TABLE IF EXISTS turn_delta_audits;');
  }
}
