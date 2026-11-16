// V2026-11-10 治本 (Phase2.5 WP-B — prompt 模板版本列):
//   原因: `ap_practice_sessions` / `ap_practice_batches` 只记了 engine_version
//     (哪份代码), 没记 prompt 模板版本 —— 批次对比时看不出"prompt 文案是不是
//     同一版". P1d 刚改过 INFO_INCREMENT_INSTRUCTION (信息增量深度约束) 与
//     ATTACHMENT_BEHAVIOR_INSTRUCTION 的接线, 正是这种场景.
//   列定义:
//     ap_practice_sessions.prompt_version VARCHAR(64) NULL AFTER engine_version
//     ap_practice_batches.prompt_version VARCHAR(64) NULL AFTER engine_version
//
//   ⚠️ 历史行**不回填**:
//     老场次跑的时候压根没算过 prompt 指纹 —— 任何回填都是在编数据.
//     保持 NULL = "不知道", 不是"和现在一样".
//     ⚠️ 因此老批次不能参与"prompt 版本一致性"的对比 (对比时按 NULL 跳过).
//
//   反双胞胎 (跟 0035 / 0039 同款守卫):
//     - 手写 DDL, 不用 migration:generate (bin/ormconfig.ts 的 entities glob 扫不到
//       这两个 entity).
//     - 幂等: 先查 INFORMATION_SCHEMA, 缺才加.
//     - 不加索引 (这两列只写一次 / 整批读, 不按列查).
//     - down 干净删列, 可回滚.
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 查表现有列 (幂等守卫).
 *
 * @param qr 查询器
 * @param table 表名
 * @returns 列名集合
 */
async function existingColumns(qr: QueryRunner, table: string): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddPromptVersionColumns1714900000043 implements MigrationInterface {
  name = 'AddPromptVersionColumns1714900000043';

  public async up(qr: QueryRunner): Promise<void> {
    // 场次表
    const sessionColumns = await existingColumns(qr, 'ap_practice_sessions');
    if (!sessionColumns.has('prompt_version')) {
      // AFTER 锚点: engine_version 由 0035 建; 万一它不在 (极端手工库), 退回表尾.
      const anchor = sessionColumns.has('engine_version') ? ' AFTER engine_version' : '';
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN prompt_version VARCHAR(64) NULL${anchor};`);
    }

    // 批次表
    const batchColumns = await existingColumns(qr, 'ap_practice_batches');
    if (!batchColumns.has('prompt_version')) {
      const anchor = batchColumns.has('engine_version') ? ' AFTER engine_version' : '';
      await qr.query(`ALTER TABLE ap_practice_batches ADD COLUMN prompt_version VARCHAR(64) NULL${anchor};`);
    }
    // 历史行**刻意不 UPDATE** (见文件头): 指纹当时没算过, 回填 = 编数据.
  }

  public async down(qr: QueryRunner): Promise<void> {
    for (const table of ['ap_practice_sessions', 'ap_practice_batches']) {
      const present = await existingColumns(qr, table);
      if (present.has('prompt_version')) {
        await qr.query(`ALTER TABLE ${table} DROP COLUMN prompt_version;`);
      }
    }
  }
}
