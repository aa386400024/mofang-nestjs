// V2026-11-09 治本 (Phase2.5 WP-E — eval_reports 新表):
//   原因: 自动评测流水线每次跑完要落一份报告, 历史可查、跨版本可对比.
//
//   表结构 (任务单 §7.4):
//     id / report_id / config_json / metrics_json / data_quality_json / created_at
//   另加 4 列 (有意为之, 已写进交付记录):
//     · dataset_version —— 同一数据集版本内才有可比性, 回归对比按它取上一版;
//     · mode           —— offline / full, 看板要区分"读历史"与"重跑";
//     · report_json    —— 整份报告快照 (含告警 / 样本 id / 阈值), 只存汇总列无法复现当时的结论.
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: 仓库 60+ 条 migration 历来手写 DDL.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: INFORMATION_SCHEMA 守卫 (缺才建) —— 重复跑 up 不报错.
//     - **不加 DB-level FK**: 跨表引用应用层校验 (ADR-0003).
//     - **不落对话原文**: 报告里只有数值化的指标 / 枚举 / id.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE eval_reports;
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

export class CreateEvalReports1714900000036 implements MigrationInterface {
  name = 'CreateEvalReports1714900000036';

  /**
   * 建表 + 补索引 (幂等).
   */
  public async up(qr: QueryRunner): Promise<void> {
    if (!(await tableExists(qr, 'eval_reports'))) {
      await qr.query(
        'CREATE TABLE IF NOT EXISTS eval_reports (' +
          'id VARCHAR(64) NOT NULL,' +
          'report_id VARCHAR(128) NOT NULL,' +
          'dataset_version VARCHAR(128) NOT NULL,' +
          "mode VARCHAR(16) NOT NULL DEFAULT 'offline'," +
          'config_json JSON NOT NULL,' +
          'metrics_json JSON NOT NULL,' +
          'data_quality_json JSON NOT NULL,' +
          'report_json JSON NOT NULL,' +
          'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
          'PRIMARY KEY (id),' +
          'UNIQUE KEY uk_eval_report_report_id (report_id),' +
          'KEY idx_eval_report_created_at (created_at),' +
          'KEY idx_eval_report_dataset_version (dataset_version)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
      );
    }
  }

  /**
   * 删表.
   */
  public async down(qr: QueryRunner): Promise<void> {
    await qr.query('DROP TABLE IF EXISTS eval_reports;');
  }
}
