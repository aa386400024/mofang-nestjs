// V2026-11-10 治本 (Phase2.5 WP-J P1b — ap_practice_sessions 加危机练习窗指标列):
//   原因: WP-J P1a 把「危机披露后继续练应对」写进了引擎, 但 6 个危机指标只活在内存里 ——
//     run() 返回了 metrics, updateSessionResult() 却只写旧的 crisis_ended.
//     跑完几十场自动对练, "危机窗后有没有真练到 / 练了几轮 / 峰值多高 / 有没有升级"
//     全丢了 —— 没法回答「危机应对协议到底有没有用」.
//
//   列定义 (6 列):
//     crisis_practiced  TINYINT NOT NULL DEFAULT 0   ← 是否进过危机后置练习窗 (0/1)
//     crisis_first_turn INT NULL                    ← 危机首次披露轮次
//     crisis_post_turns INT NOT NULL DEFAULT 0      ← 危机窗内实际完成的练习轮数
//     crisis_peak_level INT NOT NULL DEFAULT 0      ← 危机强度峰值档 0~3 (规则自动判)
//     crisis_category   VARCHAR(64) NULL            ← 危机类别 (内核枚举值, 非自由文本)
//     crisis_escalated  TINYINT NOT NULL DEFAULT 0   ← 是否发生强度上升型二次升级
//
//   ⚠️ **老数据不回填** (与 0039 / 0037 同款纪律):
//     历史场次这 6 列 = 默认值 (0 / NULL), 语义是"**没这数据**" ——
//     P1a 上线前跑的场次, 当时引擎根本没统计这些.
//     老行 `crisis_practiced = 0` **不等于"没练过危机"**, 只等于"P1a 之前, 没这个数据".
//     任何"回填"都是替历史编数据 —— 这里刻意不写 UPDATE.
//
//   ⚠️ **crisis_ended (旧列) 不动**:
//     它 = "因危机**终止**", 新列 crisis_practiced = "进过危机后置练习窗".
//     两者独立, 四种组合都合法:
//       0/0 = 没危机 · 0/1 = 进了窗正常收尾 · 1/1 = 进了窗仍终止 · 1/0 = P1a 前老数据.
//     ⇒ 写 WHERE crisis_ended=1 AND crisis_practiced=0 时别把老数据当新 bug.
//
//   ⚠️ **不加索引**: 低基数 tinyint (0/1) 加索引意义不大; 真要按 crisis_practiced
//     过滤时再补 (任务单 §4.4). **不改 ap_practice_batches**: 批次聚合后续用
//     GROUP BY 算, 不冗余落库.
//
//   反双胞胎 (跟 0039 / 0037 同款守卫):
//     - 手写 DDL, 不用 migration:generate (bin/ormconfig.ts entities glob 扫不到 counselor entity).
//     - **幂等**: MySQL 5.7 不支持 ADD COLUMN IF NOT EXISTS —— 先查 INFORMATION_SCHEMA,
//       缺才加 (重复跑 up 不报错).
//     - 不加 DB FK / 不做软删 / 不改存量行.
//     - down 干净删这 6 列 (crisis_ended 不动), 不写 DROP TABLE 这种破坏性回滚.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW COLUMNS FROM ap_practice_sessions LIKE 'crisis_%';   -- 应返回 7 列
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//
//   时间戳: 2026-11-10
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 查 ap_practice_sessions 现有列 (幂等守卫).
 *
 * @param qr 查询运行器
 * @returns 列名集合
 */
async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_practice_sessions'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

/**
 * ap_practice_sessions 加危机练习窗指标列 (WP-J P1b).
 */
export class AddCrisisMetricsToPracticeSessions1714900000042 implements MigrationInterface {
  name = 'AddCrisisMetricsToPracticeSessions1714900000042';

  /**
   * 逐列加 (幂等: 缺才加).
   *
   * @param qr 查询运行器
   */
  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    // AFTER 锚点: crisis_ended 由 0033 建. 万一它不在 (极端手工库), 退回"追加到表尾",
    // 免得 ALTER 因为锚点缺失直接失败 —— 加列本身才是这笔记迁移要干的事.
    const anchor = present.has('crisis_ended') ? ' AFTER crisis_ended' : '';

    if (!present.has('crisis_practiced')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN crisis_practiced TINYINT NOT NULL DEFAULT 0${anchor};`);
    }
    if (!present.has('crisis_first_turn')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN crisis_first_turn INT NULL AFTER crisis_practiced;`);
    }
    if (!present.has('crisis_post_turns')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN crisis_post_turns INT NOT NULL DEFAULT 0 AFTER crisis_first_turn;`);
    }
    if (!present.has('crisis_peak_level')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN crisis_peak_level INT NOT NULL DEFAULT 0 AFTER crisis_post_turns;`);
    }
    if (!present.has('crisis_category')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN crisis_category VARCHAR(64) NULL AFTER crisis_peak_level;`);
    }
    if (!present.has('crisis_escalated')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN crisis_escalated TINYINT NOT NULL DEFAULT 0 AFTER crisis_category;`);
    }
    // 回填说明: 5 个非空列由 DB DEFAULT 自动填 0, crisis_first_turn / crisis_category 留 NULL.
    // 历史场次不可反推 (见文件头) —— 这里刻意不写 UPDATE.
  }

  /**
   * 删掉这 6 列 (crisis_ended 旧列不动).
   *
   * @param qr 查询运行器
   */
  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    for (const column of [
      'crisis_escalated',
      'crisis_category',
      'crisis_peak_level',
      'crisis_post_turns',
      'crisis_first_turn',
      'crisis_practiced',
    ]) {
      if (present.has(column)) {
        await qr.query(`ALTER TABLE ap_practice_sessions DROP COLUMN ${column};`);
      }
    }
  }
}
