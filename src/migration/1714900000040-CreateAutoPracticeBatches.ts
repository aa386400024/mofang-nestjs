// V2026-11-10 治本 (Phase2.5 WP-H 第三波 · 改动 9 — ap_practice_batches 新表):
//   原因: 改动 9 要"把批次状态写为 INVALID", 而 ap_practice_sessions 是**场次**表 ——
//     没有批次级状态位, 批次结论无处安放. 本表专门存"这一批能不能用"的判定结果.
//   表结构 (13 列, 无索引 —— 主键 batch_id 之外全是聚合快照, 不按列查):
//     batch_id VARCHAR(64) PK / total_sessions INT / total_turns INT /
//     render_fallback_turns INT / llm_call_turns INT /
//     llm_call_ratio DECIMAL(5,4) NULL / fallback_ratio DECIMAL(5,4) NULL /
//     counter_consistent TINYINT / valid TINYINT / validity_flags VARCHAR(255) NULL /
//     engine_version VARCHAR(64) NULL / created_at DATETIME / updated_at DATETIME
//
//   ⚠️ 历史批次**不回填**: 改动 9 的门禁是"读时算"—— 判定依据 (render_fallback_turns /
//     llm_call_turns) 在 WP-H 之前根本没统计, 回填任何值都是编造.
//     历史批次被查询时会被算成 valid=0 (llm_call_ratio=0) —— 这是**安全方向**:
//     宁可标成"不可用", 也不许让它混进分析里冒充合格数据.
//
//   反双胞胎 (跟 0033 / 0036 / 0038 同款守卫):
//     - 手写 DDL, 不用 migration:generate (bin/ormconfig.ts entities glob 扫不到 counselor entity).
//     - 幂等: 先查 INFORMATION_SCHEMA, 表不存在才建.
//     - 不做软删 (批次结论是审计数据).
//     - 不加 DB FK (batch_id 是应用层 nanoid; ADR-0003).
//     - 零对话原文 (只有计数 / 比例 / 枚举标签).
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutoPracticeBatches1714900000040 implements MigrationInterface {
  name = 'CreateAutoPracticeBatches1714900000040';

  public async up(qr: QueryRunner): Promise<void> {
    const rows = (await qr.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_practice_batches'`,
    )) as Record<string, unknown>[];
    const exists = rows.some((row) => row['TABLE_NAME'] === 'ap_practice_batches');
    if (exists) return;

    await qr.query(`
      CREATE TABLE ap_practice_batches (
        batch_id VARCHAR(64) NOT NULL COMMENT '批次 id (nanoid)',
        total_sessions INT NOT NULL DEFAULT 0 COMMENT '本批场次数',
        total_turns INT NOT NULL DEFAULT 0 COMMENT '本批总轮数',
        render_fallback_turns INT NOT NULL DEFAULT 0 COMMENT '渲染兜底轮数合计',
        llm_call_turns INT NOT NULL DEFAULT 0 COMMENT '真实 LLM 调用轮数合计',
        llm_call_ratio DECIMAL(5,4) NULL COMMENT '有真实调用的场次占比 (合格线 >= 0.9)',
        fallback_ratio DECIMAL(5,4) NULL COMMENT '渲染兜底率批次均值 (合格线 < 0.05); NULL = 没测过',
        counter_consistent TINYINT NOT NULL DEFAULT 1 COMMENT 'degraded_turns <= turn_count 是否全场满足',
        valid TINYINT NOT NULL DEFAULT 1 COMMENT '批次是否通过有效性门禁 (0 = INVALID)',
        validity_flags VARCHAR(255) NULL COMMENT '不达标原因 (逗号分隔枚举标签)',
        engine_version VARCHAR(64) NULL COMMENT '跑批时的引擎版本 (git describe --dirty)',
        created_at DATETIME NOT NULL COMMENT '首次判定时刻',
        updated_at DATETIME NOT NULL COMMENT '最近一次刷新时刻',
        PRIMARY KEY (batch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='自动对练批次有效性门禁结论 (WP-H 改动 9)';
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    const rows = (await qr.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_practice_batches'`,
    )) as Record<string, unknown>[];
    const exists = rows.some((row) => row['TABLE_NAME'] === 'ap_practice_batches');
    if (!exists) return;
    await qr.query('DROP TABLE ap_practice_batches;');
  }
}
