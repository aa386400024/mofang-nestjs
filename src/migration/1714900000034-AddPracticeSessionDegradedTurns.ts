// V2026-11-09 治本 (P1-3 — ap_practice_sessions 加 degraded_turns 列):
//   原因: 上游 429 / 超时 / 空回复时 counselor-agent 回 FALLBACK_REPLY,
//     之前场次仍标 completed, 评测数据里混着"嗯我在听"这种兜底轮.
//     加一列累计降级轮数, 退出时按比例打 exitReason 后缀.
//
//   列定义:
//     degraded_turns INT NOT NULL DEFAULT 0
//
//   存量数据: ADD COLUMN ... NOT NULL DEFAULT 0 自动填 0 (= 无降级), 零回归.
//
//   反双胞胎 (跟 0032 AddSessionDegradedFlag 同款守卫):
//     - 手写 DDL, 不用 migration:generate (bin/ormconfig.ts entities glob 扫不到 counselor entity).
//     - 幂等: 先查 INFORMATION_SCHEMA, 缺才加.
//     - 不加索引 (本列只在退出时写一次, 不单独查询).
import { MigrationInterface, QueryRunner } from 'typeorm';

async function existingColumns(qr: QueryRunner): Promise<Set<string>> {
  const rows = (await qr.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ap_practice_sessions'`,
  )) as Record<string, unknown>[];
  return new Set(rows.map((row) => (typeof row['COLUMN_NAME'] === 'string' ? row['COLUMN_NAME'] : '')));
}

export class AddPracticeSessionDegradedTurns1714900000034 implements MigrationInterface {
  name = 'AddPracticeSessionDegradedTurns1714900000034';

  public async up(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (!present.has('degraded_turns')) {
      await qr.query(`ALTER TABLE ap_practice_sessions ADD COLUMN degraded_turns INT NOT NULL DEFAULT 0 AFTER total_cost;`);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    const present = await existingColumns(qr);
    if (present.has('degraded_turns')) {
      await qr.query(`ALTER TABLE ap_practice_sessions DROP COLUMN degraded_turns;`);
    }
  }
}
