// V2026-11-09 治本 (Phase2.5 WP-B — 场次版本列):
//   原因: ap_practice_sessions 加 3 列 (character_version / deliberation_mode / engine_version),
//     让每场自动对练的推理环境可追溯 —— 出问题能定位是哪个模型/角色/代码版本导致的.
//
//   三列都是 nullable: 存量行自动 NULL, 新场次才填值.

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPracticeSessionVersionColumns1714900000035 implements MigrationInterface {
  name = 'AddPracticeSessionVersionColumns1714900000035';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE ap_practice_sessions
        ADD COLUMN character_version VARCHAR(32) NULL AFTER seed_value,
        ADD COLUMN deliberation_mode VARCHAR(16) NULL AFTER character_version,
        ADD COLUMN engine_version VARCHAR(64) NULL AFTER deliberation_mode;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE ap_practice_sessions
        DROP COLUMN engine_version,
        DROP COLUMN deliberation_mode,
        DROP COLUMN character_version;
    `);
  }
}
