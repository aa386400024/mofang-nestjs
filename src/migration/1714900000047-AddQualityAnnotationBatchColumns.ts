// V2026-11-11 治本 (WP-N · 标注台批次化 — quality_annotation 加归属/版本/轮级列):
//   原因: 标注台只能标一份写死的 30 场锚点 CSV, 表里**没有批次维度** ——
//     · 新跑的批次进不了标注台;
//     · 一致率把所有已标场次扔进同一个分母, 跨引擎版本混算;
//     · 逐字稿被 MAX_DEBUG_SESSIONS=500 淘汰后, 标注还在但台词读不出来.
//   本迁移给标注表补 9 列 + 1 索引, 让每条人工结论能回答"这条对应哪批、哪版引擎、哪几轮不对".
//
//   9 列:
//     batch_id          VARCHAR(64) NULL — 归属批次 (NULL = 无法归属的历史单场, **不编造**)
//     counselor_mode_id VARCHAR(32) NULL — 该场咨询师模式 (批次内切片用)
//     turn_count        INT NULL         — 该场轮数快照 (派生时的快照值)
//     engine_version    VARCHAR(64) NULL — 该场 git describe --dirty (版本锁)
//     prompt_version    VARCHAR(64) NULL — prompt 模板指纹 (16 位 hex)
//     character_version VARCHAR(32) NULL — 该场角色版本
//     first_bad_turn    INT NULL         — 轮级最小集: 从第几轮开始不对
//     bad_turns         VARCHAR(64) NULL — 轮级最小集: 有问题的轮次清单 (逗号分隔, ≤10, 升序去重)
//     turn_note         TEXT NULL        — 轮级说明 (事实描述, **禁评分/等级语义**)
//
//   存量回填 (一条 UPDATE):
//     按 ap_practice_sessions 反查 batch_id —— 查不到的**保持 NULL**.
//     真实库实测: 30 行里 23 行命中 (20 + 3), 7 行查不到 (batch_id 为 NULL 的历史单场).
//     ⚠️ 用 MAX(batch_id) + GROUP BY 收敛到一行: 同一个 debug_session_id 在场次表里
//        可能有多行 (重跑), 取哪个都是"编造", 所以取批次名排序最后的那个并在此登记口径.
//
//   反双胞胎 (与 0041 / 0045 同纪律):
//     - 手写 DDL, 不用 migration:generate;
//     - 幂等: INFORMATION_SCHEMA 查列, 缺才加; 重复跑不报错;
//     - 历史行**只回填 batch_id**, 其余版本列保持 NULL ("当时没记"是事实, 不补假值);
//     - 不加 DB-level FK / 不做软删 / 不落对话原文;
//     - 轮级三列**不参与** done 判定 (done 仍只认 dominant_label, 保持前端进度条合同不变).

import { MigrationInterface, QueryRunner } from 'typeorm';

/** 表名. */
const TABLE = 'quality_annotation';

/** 列名 → DDL 片段 (幂等补列用). */
const COLUMN_DDL: Readonly<Record<string, string>> = {
  batch_id: "batch_id VARCHAR(64) NULL COMMENT '归属批次 (NULL = 无法归属的历史单场)'",
  counselor_mode_id: "counselor_mode_id VARCHAR(32) NULL COMMENT '该场咨询师模式'",
  turn_count: "turn_count INT NULL COMMENT '该场轮数快照'",
  engine_version: "engine_version VARCHAR(64) NULL COMMENT '该场引擎版本 (git describe)'",
  prompt_version: "prompt_version VARCHAR(64) NULL COMMENT '该场 prompt 模板指纹'",
  character_version: "character_version VARCHAR(32) NULL COMMENT '该场角色版本'",
  first_bad_turn: "first_bad_turn INT NULL COMMENT '轮级: 从第几轮开始不对'",
  bad_turns: "bad_turns VARCHAR(64) NULL COMMENT '轮级: 有问题的轮次清单 (逗号分隔)'",
  turn_note: "turn_note TEXT NULL COMMENT '轮级说明 (事实描述, 禁评分/等级)'",
};

/** 索引名 → 列. */
const INDEX_DDL: readonly { readonly name: string; readonly column: string }[] = [
  { name: 'idx_quality_annotation_batch', column: 'batch_id' },
];

/**
 * 查表已有列.
 *
 * @param qr 查询运行器
 * @param table 表名
 * @returns 列名集合
 */
async function existingColumns(qr: QueryRunner, table: string): Promise<Set<string>> {
  const rows = (await qr.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [
    table,
  ])) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

/**
 * 查索引是否已存在.
 *
 * @param qr 查询运行器
 * @param table 表名
 * @param index 索引名
 * @returns 存在 → true
 */
async function indexExists(qr: QueryRunner, table: string, index: string): Promise<boolean> {
  const rows = (await qr.query(
    'SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [table, index],
  )) as unknown[];
  return rows.length > 0;
}

/**
 * WP-N · 标注表加批次维度 / 版本锁 / 轮级最小集.
 */
export class AddQualityAnnotationBatchColumns1714900000047 implements MigrationInterface {
  name = 'AddQualityAnnotationBatchColumns1714900000047';

  /**
   * 补 9 列 + 1 索引 + 回填存量 batch_id.
   *
   * @param qr 查询运行器
   */
  public async up(qr: QueryRunner): Promise<void> {
    const columns = await existingColumns(qr, TABLE);
    for (const [column, ddl] of Object.entries(COLUMN_DDL)) {
      if (!columns.has(column)) {
        await qr.query(`ALTER TABLE ${TABLE} ADD COLUMN ${ddl};`);
      }
    }

    for (const index of INDEX_DDL) {
      if (!(await indexExists(qr, TABLE, index.name))) {
        await qr.query(`CREATE INDEX ${index.name} ON ${TABLE} (${index.column});`);
      }
    }

    // 存量回填: 按 ap_practice_sessions 反查 batch_id —— 查不到的保持 NULL (不编造).
    await qr.query(
      'UPDATE quality_annotation qa ' +
        'JOIN (SELECT debug_session_id, MAX(batch_id) AS batch_id FROM ap_practice_sessions ' +
        'WHERE batch_id IS NOT NULL GROUP BY debug_session_id) s ' +
        'ON s.debug_session_id = qa.debug_session_id ' +
        'SET qa.batch_id = s.batch_id ' +
        'WHERE qa.batch_id IS NULL;',
    );
  }

  /**
   * 回滚: 删索引 + 删列 (回填的 batch_id 一并随列消失).
   *
   * @param qr 查询运行器
   */
  public async down(qr: QueryRunner): Promise<void> {
    for (const index of INDEX_DDL) {
      if (await indexExists(qr, TABLE, index.name)) {
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
