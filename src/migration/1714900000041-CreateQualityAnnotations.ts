// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 — quality_annotation 新表):
//   原因: 人工标注入库 —— 30 场锚点的标注结果要有落点, 才能算一致性能校准阈值.
//
//   表结构 (任务单 §2.1 + 两处有据可查的偏差):
//     id / debug_session_id (唯一) / character_slug / attachment_style /
//     first_exploration_turn / dominant_label / crisis_peak_level / should_end_turn /
//     annotator / notes / created_at / updated_at
//   另加 5 列 (有意为之, 已写进交付记录 §偏差):
//     · anchor_order     —— 锚点清单顺序 (CSV 行号). 标注台是**队列**, 不保留顺序
//                           的话每次刷新顺序都变, 标到第 12 场不知道上次标到哪.
//     · crisis_first_turn —— 危机首次出现轮次 (前端契约有这一列, 任务单 DDL 没有).
//     · needs_review     —— 存疑 / 待复审 (前端契约有这一列, 任务单 DDL 没有).
//     · duration_ms      —— 本场标注耗时 (前端打点, 用于评估标注工时).
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: 仓库 60+ 条 migration 历来手写 DDL.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: 表存在就只补列 (缺才加) —— 重复跑 up 不报错, 手工建过表也不炸.
//     - **不加 DB-level FK**: 跨表引用应用层校验 (ADR-0003).
//     - **不做软删**: 标注是校准依据, 删了就等于把"当时标成什么"永远查不到.
//     - **不落对话原文**: 只有枚举 / 数值 / id / 备注 (备注是标注员自己写的, 不是逐字稿).
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE quality_annotation;
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//
//   时间戳: 2026-11-10 GMT+8

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 查表是否已存在.
 *
 * @param qr 查询运行器
 * @param table 表名
 * @returns 存在 → true
 */
async function tableExists(qr: QueryRunner, table: string): Promise<boolean> {
  const rows = (await qr.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [
    table,
  ])) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * 查列是否已存在.
 *
 * @param qr 查询运行器
 * @param table 表名
 * @param column 列名
 * @returns 存在 → true
 */
async function columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
  const rows = (await qr.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  )) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * quality_annotation 新表 (人工标注落库).
 */
export class CreateQualityAnnotations1714900000041 implements MigrationInterface {
  name = 'CreateQualityAnnotations1714900000041';

  /**
   * 建表 + 补列 (幂等).
   *
   * @param qr 查询运行器
   */
  public async up(qr: QueryRunner): Promise<void> {
    if (!(await tableExists(qr, 'quality_annotation'))) {
      await qr.query(
        'CREATE TABLE IF NOT EXISTS quality_annotation (' +
          'id CHAR(36) NOT NULL,' +
          "debug_session_id VARCHAR(128) NOT NULL COMMENT '逐字稿会话 id (唯一)'," +
          "character_slug VARCHAR(64) NOT NULL COMMENT '角色代号'," +
          "attachment_style VARCHAR(32) NOT NULL COMMENT '依恋风格'," +
          'anchor_order INT NOT NULL DEFAULT 0,' +
          'first_exploration_turn INT NULL,' +
          "dominant_label VARCHAR(32) NULL COMMENT '人工主导标签 (NULL = 未标)'," +
          'crisis_peak_level INT NOT NULL DEFAULT 0,' +
          'crisis_first_turn INT NULL,' +
          'should_end_turn INT NULL,' +
          'needs_review TINYINT(1) NOT NULL DEFAULT 0,' +
          'duration_ms INT NOT NULL DEFAULT 0,' +
          "annotator VARCHAR(64) NULL COMMENT '标注人标识'," +
          'notes TEXT NULL,' +
          'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
          'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
          'PRIMARY KEY (id),' +
          'UNIQUE KEY uk_quality_annotation_debug_session (debug_session_id),' +
          'KEY idx_quality_annotation_anchor_order (anchor_order),' +
          'KEY idx_quality_annotation_dominant_label (dominant_label)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
      );
    }

    await this.ensureColumn(qr, 'anchor_order', 'INT NOT NULL DEFAULT 0');
    await this.ensureColumn(qr, 'crisis_first_turn', 'INT NULL');
    await this.ensureColumn(qr, 'should_end_turn', 'INT NULL');
    await this.ensureColumn(qr, 'needs_review', 'TINYINT(1) NOT NULL DEFAULT 0');
    await this.ensureColumn(qr, 'duration_ms', 'INT NOT NULL DEFAULT 0');
    await this.ensureColumn(qr, 'annotator', 'VARCHAR(64) NULL');
    await this.ensureColumn(qr, 'notes', 'TEXT NULL');
  }

  /**
   * 补一列 (缺才加).
   *
   * @param qr 查询运行器
   * @param column 列名
   * @param definition 列定义
   */
  private async ensureColumn(qr: QueryRunner, column: string, definition: string): Promise<void> {
    if (await columnExists(qr, 'quality_annotation', column)) return;
    await qr.query(`ALTER TABLE quality_annotation ADD COLUMN ${column} ${definition};`);
  }

  /**
   * 删表.
   *
   * @param qr 查询运行器
   */
  public async down(qr: QueryRunner): Promise<void> {
    await qr.query('DROP TABLE IF EXISTS quality_annotation;');
  }
}
