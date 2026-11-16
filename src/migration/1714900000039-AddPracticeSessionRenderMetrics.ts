// V2026-11-10 治本 (Phase2.5 WP-H 第二波 · 改动 5 / 改动 6 — ap_practice_sessions 加渲染降级率指标列):
//   原因: 第一波把 LLM 拉回来了, 但"这一批数据能不能用"仍然看不出来 ——
//     库里没有任何字段能区分"LLM 挂了"和"内容质量差". 三批无效数据就是这么
//     静默流进分析的 (整场 total_tokens=0 的场次, 此前仍被当成 completed 计入统计).
//   列定义:
//     counselor_degraded_turns INT NOT NULL DEFAULT 0   ← 咨询师侧降级轮数 (每轮最多 +1)
//     visitor_degraded_turns   INT NOT NULL DEFAULT 0   ← 来访者侧降级轮数 (每轮最多 +1)
//     render_fallback_turns     INT NOT NULL DEFAULT 0   ← 来访者侧走渲染兜底的总次数
//     llm_call_turns            INT NOT NULL DEFAULT 0   ← 来访者侧真实发起调用的轮数
//     render_fallback_ratio     DECIMAL(5,4) NULL        ← render_fallback_turns / turn_count
//
//   ⚠️ 历史场次**不可反推** (迁移注释按大炮要求写死):
//     四个 INT 列一律回填 0 —— 语义是"没测过", 不是"当时没问题":
//       - 旧 degraded_turns 是两侧混装的, 拆成 50/50 没有信息量, 不伪造;
//       - 兜底率 / 调用轮数当时**根本没统计**, 任何回填都是在编数据.
//     render_fallback_ratio 保持 NULL (= 未知), 不写成 0 ——
//       0 的含义是"测过, 当时兜底率确实为 0", 跟"没测过"是两回事.
//     ⚠️ 所以"历史场次"不能参与改动 9 的批次门禁判定 (valid 只对新增批次有结论).
//
//   ⚠️ 旧列 degraded_turns **保留不动**: 写入时取 max(counselor, visitor) 维持旧语义可读性
//      (原任务单改动 5 第 3 条口径), 新的质量指标一律读 render_fallback_ratio.
//
//   反双胞胎 (跟 0033 / 0034 / 0037 同款守卫):
//     - 手写 DDL, 不用 migration:generate (bin/ormconfig.ts entities glob 扫不到 counselor entity).
//     - 幂等: 先查 INFORMATION_SCHEMA, 缺才加.
//     - 不加索引 (这些列只在结算时写一次 / 批次聚合时整批扫, 不按列查).
//     - 不改存量行 (新列都有 DEFAULT 0 / NULL, 存量行 = 没测过).
//     - down 干净删列, 可回滚.
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

export class AddPracticeSessionRenderMetrics1714900000039 implements MigrationInterface {
  name = 'AddPracticeSessionRenderMetrics1714900000039';

  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    // AFTER 锚点: degraded_turns 由 0034 建; 万一它不在 (极端手工库), 退回"追加到表尾",
    // 免得 ALTER 因为锚点缺失直接失败 —— 加列本身才是这笔记迁移要干的事.
    const anchor = present.has('degraded_turns') ? ' AFTER degraded_turns' : '';

    if (!present.has('counselor_degraded_turns')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN counselor_degraded_turns INT NOT NULL DEFAULT 0${anchor};`);
    }
    if (!present.has('visitor_degraded_turns')) {
      await qr.query(
        `ALTER TABLE ap_practice_sessions ADD COLUMN visitor_degraded_turns INT NOT NULL DEFAULT 0 AFTER counselor_degraded_turns;`,
      );
    }
    if (!present.has('render_fallback_turns')) {
      await qr.query(
        `ALTER TABLE ap_practice_sessions ADD COLUMN render_fallback_turns INT NOT NULL DEFAULT 0 AFTER visitor_degraded_turns;`,
      );
    }
    if (!present.has('llm_call_turns')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN llm_call_turns INT NOT NULL DEFAULT 0 AFTER render_fallback_turns;`);
    }
    if (!present.has('render_fallback_ratio')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN render_fallback_ratio DECIMAL(5,4) NULL AFTER llm_call_turns;`);
    }
    // 回填说明: 四个 INT 列由 DB DEFAULT 自动填 0, render_fallback_ratio 留 NULL.
    // 历史场次不可反推 (见文件头注释) —— 这里刻意不写 UPDATE, 不伪造历史数据.
  }

  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    for (const column of [
      'render_fallback_ratio',
      'llm_call_turns',
      'render_fallback_turns',
      'visitor_degraded_turns',
      'counselor_degraded_turns',
    ]) {
      if (present.has(column)) {
        await qr.query(`ALTER TABLE ap_practice_sessions DROP COLUMN ${column};`);
      }
    }
  }
}
