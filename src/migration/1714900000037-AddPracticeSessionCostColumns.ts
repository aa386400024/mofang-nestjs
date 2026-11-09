// V2026-11-09 治本 (Phase2.5 WP-F · Step 0 — ap_practice_sessions 补 token / 成本列):
//   原因: 成本看板 (GET /admin/api/cost/*) 要合并"正式训练 + 自动对练"两个数据源.
//     正式训练的 token / 成本从留痕快照 (`turn_debug_trace[].llmUsage`) 现算;
//     自动对练**没有留痕 JSON 列** —— token 与成本不落库, 看板这边永远是 0,
//     于是"合并看板"合并了个寂寞.
//   列定义:
//     prompt_tokens     INT NOT NULL DEFAULT 0
//     completion_tokens INT NOT NULL DEFAULT 0
//     reasoning_tokens  INT NOT NULL DEFAULT 0
//     total_tokens      INT NOT NULL DEFAULT 0
//     total_cost_cny    DECIMAL(12,6) NULL   ← 人民币**元**
//     cost_basis        VARCHAR(16) NULL     ← full | output_only
//
//   ⚠️ 旧列 `total_cost` 的语义变更 (任务单 §9 偏差 1):
//     它原本声明"美元", 但**全仓零写入点, 恒 NULL**, 而且口径本身是错的
//     (标美元实际是元). 本迁移把它的 DB 注释改成"已废弃", 成本统一读
//     `total_cost_cny` (元). **不 DROP 这一列** —— schema 的不可逆变更留给大炮
//     在维护窗口自己决定, 本单只保证"没人再拿它算钱".
//
//   反双胞胎 (跟 0033 / 0034 同款守卫):
//     - 手写 DDL, 不用 migration:generate (bin/ormconfig.ts entities glob 扫不到 counselor entity).
//     - 幂等: 先查 INFORMATION_SCHEMA, 缺才加.
//     - 不加索引 (这些列只在结算时写一次 / 看板全表扫时读, 不按列查).
//     - 不改存量行 (新列都有 DEFAULT 0 / NULL, 存量行 = 0 token / 无成本记录 →
//       看板把这些行标成 `estimated` 口径, 而不是假装它们成本为 0 且有背书).
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 查 ap_practice_sessions 现有列 (幂等守卫).
 */
async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_practice_sessions'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddPracticeSessionCostColumns1714900000037 implements MigrationInterface {
  name = 'AddPracticeSessionCostColumns1714900000037';

  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (!present.has('prompt_tokens')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN prompt_tokens INT NOT NULL DEFAULT 0 AFTER total_cost;`);
    }
    if (!present.has('completion_tokens')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN completion_tokens INT NOT NULL DEFAULT 0 AFTER prompt_tokens;`);
    }
    if (!present.has('reasoning_tokens')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN reasoning_tokens INT NOT NULL DEFAULT 0 AFTER completion_tokens;`);
    }
    if (!present.has('total_tokens')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN total_tokens INT NOT NULL DEFAULT 0 AFTER reasoning_tokens;`);
    }
    if (!present.has('total_cost_cny')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN total_cost_cny DECIMAL(12,6) NULL AFTER total_tokens;`);
    }
    if (!present.has('cost_basis')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN cost_basis VARCHAR(16) NULL AFTER total_cost_cny;`);
    }
    // 旧列语义变更: 注释从"美元"改成"已废弃" (幂等: 重复执行只是重设同一个注释).
    await qr.query(
      `ALTER TABLE ap_practice_sessions MODIFY COLUMN total_cost DECIMAL(10,4) NULL
       COMMENT '已废弃: 恒 NULL; 成本统一读 total_cost_cny (人民币元)'`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    for (const column of ['cost_basis', 'total_cost_cny', 'total_tokens', 'reasoning_tokens', 'completion_tokens', 'prompt_tokens']) {
      if (present.has(column)) {
        await qr.query(`ALTER TABLE ap_practice_sessions DROP COLUMN ${column};`);
      }
    }
    await qr.query(`ALTER TABLE ap_practice_sessions MODIFY COLUMN total_cost DECIMAL(10,4) NULL COMMENT '美元'`);
  }
}
