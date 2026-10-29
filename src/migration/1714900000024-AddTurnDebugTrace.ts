// V2026-10-29 治本 (WP19 — training_sessions 加 turn_debug_trace JSON 列):
//   原因: 调试器 SPA 需要看每轮 BDI 快照 / LLM usage / 危机检测结果.
//     加一个 JSON 列存数组, 不加新表 (任务单拍板).
//
//   反双胞胎:
//     - 不加新表: trace 跟 session 是 1:1, 不需要独立表.
//     - 不拆列: trace 是观测数据, 字段会随引擎迭代增补, JSON 灵活.
//
//   时间戳: 2026-10-29
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurnDebugTrace1714900000024 implements MigrationInterface {
  name = 'AddTurnDebugTrace1714900000024';

  public async up(qr: QueryRunner): Promise<void> {
    // 幂等: 列已存在则跳过
    const cols = (await qr.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'training_sessions' AND COLUMN_NAME = 'turn_debug_trace'`,
    )) as Record<string, unknown>[];
    if (cols.length > 0) return;

    await qr.query(`ALTER TABLE training_sessions ADD COLUMN turn_debug_trace JSON NULL AFTER tech_stats`);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE training_sessions DROP COLUMN turn_debug_trace`);
  }
}
