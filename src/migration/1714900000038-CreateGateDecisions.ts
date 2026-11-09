// V2026-11-09 治本 (Phase2.5 闸门 trace 查询接口 — gate_decisions 新表):
//   原因: 闸门决策只写 Redis (WP-C) → 7 天 TTL + LRU 淘汰后数据没了 (复盘最需要它),
//         而且 Redis 里"每轮一个 key"没法全局列表 (只能 SCAN 全库, 生产阻塞命令).
//         于是新建这张表当**真相源**, Redis 只做热缓存 + 写时预聚合计数.
//
//   表结构 (任务单 §3.1 + 三处有据可查的偏差):
//     id / session_id / db_session_id / turn_index / mode / decision / reason /
//     threshold_used / delta_summary / elapsed_ms / recorded_at / created_at
//   另加 2 列 (有意为之, 已写进交付记录 §偏差):
//     · user_id      —— 学员隔离的落点 (任务单 DDL 没有, 但硬约束要求隔离;
//                       没有归属列就只能 join training_sessions, 那是另一套口径);
//     · recorded_day —— 上海日键 (DATETIME 没有时区, 按天筛选若靠"日界换算 + 驱动按
//                       进程时区序列化", 同一批数据在不同环境会落进不同的天).
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: 仓库 60+ 条 migration 历来手写 DDL.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: 表存在就只补列 (缺才加) —— 重复跑 up 不报错, 手工建过表也不炸.
//     - **不加 DB-level FK**: 跨表引用应用层校验 (ADR-0003).
//     - **不做软删**: 闸门决策是审计数据, 删了就等于让"当时为什么没跑"永远查不到.
//     - **不落对话原文**: 只有枚举 / 数值 / 阈值 / 耗时 / id (隐私红线 AGENTS.md §5.4).
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE gate_decisions;
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//
//   时间戳: 2026-11-09

import { MigrationInterface, QueryRunner } from 'typeorm';

/** 查表是否已存在. */
async function tableExists(qr: QueryRunner, table: string): Promise<boolean> {
  const rows = (await qr.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [
    table,
  ])) as Record<string, unknown>[];
  return rows.length > 0;
}

/** 查列是否已存在. */
async function columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
  const rows = (await qr.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  )) as Record<string, unknown>[];
  return rows.length > 0;
}

export class CreateGateDecisions1714900000038 implements MigrationInterface {
  name = 'CreateGateDecisions1714900000038';

  /**
   * 建表 + 补列 (幂等).
   *
   * @param qr 查询运行器
   */
  public async up(qr: QueryRunner): Promise<void> {
    if (!(await tableExists(qr, 'gate_decisions'))) {
      await qr.query(
        'CREATE TABLE IF NOT EXISTS gate_decisions (' +
          'id BIGINT NOT NULL AUTO_INCREMENT,' +
          "session_id VARCHAR(128) NOT NULL COMMENT '引擎侧 session id'," +
          "db_session_id VARCHAR(36) NULL COMMENT 'training_sessions.id (uuid char(36))'," +
          "user_id VARCHAR(36) NULL COMMENT '学员账号 id (学员隔离用; NULL = 无归属)'," +
          'turn_index INT NOT NULL,' +
          "mode VARCHAR(16) NOT NULL COMMENT 'shadow | effect'," +
          "decision VARCHAR(16) NOT NULL COMMENT 'run | skip'," +
          "reason VARCHAR(64) NOT NULL COMMENT '决策理由 (枚举)'," +
          "threshold_used JSON NOT NULL COMMENT '{ alliance, resistance, calm }'," +
          'delta_summary JSON NULL,' +
          'elapsed_ms INT NOT NULL,' +
          'recorded_at DATETIME(3) NOT NULL,' +
          "recorded_day VARCHAR(10) NOT NULL COMMENT '上海日键 YYYY-MM-DD (写时算好, 与日计数器对齐)'," +
          'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
          'PRIMARY KEY (id),' +
          'KEY idx_gate_decision_recorded_at (recorded_at),' +
          'KEY idx_gate_decision_recorded_day (recorded_day),' +
          'KEY idx_gate_decision_session_turn (session_id, turn_index),' +
          'KEY idx_gate_decision_db_session (db_session_id),' +
          'KEY idx_gate_decision_mode_reason (mode, reason),' +
          'KEY idx_gate_decision_user (user_id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
      );
      return;
    }

    // 表已存在 (手工建过 / 上一版 DDL) → 逐列补齐, 缺才加 (幂等).
    await this.ensureColumn(qr, 'user_id', "VARCHAR(36) NULL COMMENT '学员账号 id (学员隔离用; NULL = 无归属)'");
    await this.ensureColumn(qr, 'recorded_day', "VARCHAR(10) NOT NULL DEFAULT '' COMMENT '上海日键 YYYY-MM-DD'");
  }

  /**
   * 补一列 (已存在则跳过).
   *
   * @param qr 查询运行器
   * @param column 列名
   * @param definition 列定义
   */
  private async ensureColumn(qr: QueryRunner, column: string, definition: string): Promise<void> {
    if (await columnExists(qr, 'gate_decisions', column)) return;
    await qr.query(`ALTER TABLE gate_decisions ADD COLUMN ${column} ${definition};`);
  }

  /**
   * 删表.
   *
   * @param qr 查询运行器
   */
  public async down(qr: QueryRunner): Promise<void> {
    await qr.query('DROP TABLE IF EXISTS gate_decisions;');
  }
}
