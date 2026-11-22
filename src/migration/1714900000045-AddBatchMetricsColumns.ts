// V2026-11-11 WP-K (批次回归追踪 · ap_practice_batches 加指标列):
//   原因: 批次表只存管道健康, 临床指标与配置指纹从未落库, 跑完即丢, 无法跨批对比.
//
//   8 列 (全部 NULL, 老行不受影响):
//     config_fingerprint        VARCHAR(64)  — combined 指纹, 列表页快速比对
//     config_fingerprint_json   TEXT         — 7 段明细, 归因用
//     metrics_json              TEXT         — 完整快照 v1
//     note                      VARCHAR(255) — 人写的一句话变更说明
//     exploration_rate          DECIMAL(5,4) — 冗余标量, 可直接 SQL 排序/过滤
//     depth_delta_avg           DECIMAL(7,6)
//     safety_delta_avg          DECIMAL(7,6)
//     positive_event_rate       DECIMAL(5,4)
//
//   为什么要冗余标量列 (JSON 已能保真):
//     列表页要按 exploration_rate 排序、按 depth_delta_avg 过滤, 不能让每次请求都
//     解析 JSON. JSON 保真、列加速, 职责不同.
//
//   反双胞胎 (与 0043 同纪律):
//     - 手写 DDL, 不用 migration:generate;
//     - 幂等: INFORMATION_SCHEMA 查列, 缺才加;
//     - 历史行**不回填** (当时没算过, 回填 = 编数据);
//     - down 干净删列 + 索引, 可回滚.

import { MigrationInterface, QueryRunner } from 'typeorm';

async function existingColumns(qr: QueryRunner, table: string): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

const TABLE = 'ap_practice_batches';

/** 列名 → DDL 片段. */
const COLUMN_DDL: Readonly<Record<string, string>> = {
  config_fingerprint: 'config_fingerprint VARCHAR(64) NULL',
  config_fingerprint_json: 'config_fingerprint_json TEXT NULL',
  metrics_json: 'metrics_json TEXT NULL',
  note: 'note VARCHAR(255) NULL',
  exploration_rate: 'exploration_rate DECIMAL(5,4) NULL',
  depth_delta_avg: 'depth_delta_avg DECIMAL(7,6) NULL',
  safety_delta_avg: 'safety_delta_avg DECIMAL(7,6) NULL',
  positive_event_rate: 'positive_event_rate DECIMAL(5,4) NULL',
};

/** 索引名 → 列. */
const INDEX_DDL: readonly { readonly name: string; readonly column: string }[] = [
  { name: 'idx_ap_batches_config_fingerprint', column: 'config_fingerprint' },
  { name: 'idx_ap_batches_exploration_rate', column: 'exploration_rate' },
];

export class AddBatchMetricsColumns1714900000045 implements MigrationInterface {
  name = 'AddBatchMetricsColumns1714900000045';

  public async up(qr: QueryRunner): Promise<void> {
    const columns = await existingColumns(qr, TABLE);
    for (const [column, ddl] of Object.entries(COLUMN_DDL)) {
      if (!columns.has(column)) {
        await qr.query(`ALTER TABLE ${TABLE} ADD COLUMN ${ddl};`);
      }
    }
    for (const index of INDEX_DDL) {
      const exists = (await qr.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [TABLE, index.name],
      )) as unknown[];
      if (exists.length === 0) {
        await qr.query(`CREATE INDEX ${index.name} ON ${TABLE} (${index.column});`);
      }
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    for (const index of INDEX_DDL) {
      const exists = (await qr.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [TABLE, index.name],
      )) as unknown[];
      if (exists.length > 0) {
        await qr.query(`DROP INDEX ${index.name} ON ${TABLE};`);
      }
    }
    const columns = await existingColumns(qr, TABLE);
    for (const column of Object.keys(COLUMN_DDL)) {
      if (columns.has(column)) {
        await qr.query(`ALTER TABLE ${TABLE} DROP COLUMN ${column};`);
      }
    }
  }
}
