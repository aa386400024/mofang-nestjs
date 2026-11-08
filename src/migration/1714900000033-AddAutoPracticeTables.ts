// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练两张表):
//   原因: AI 咨询师 + AI 来访者双向自动跑, 需要两张新表:
//     · ap_counselor_modes —— 7 种咨询师人设 (system prompt 落库, 不写死);
//     · ap_practice_sessions —— 批量对练场次元数据 (谁跟谁/跑了几轮/为什么停/花了多少钱).
//
//   表结构:
//     ap_counselor_modes: id / name / system_prompt(text) / description / enabled / sort_order / created_at / updated_at
//     ap_practice_sessions: id / debug_session_id / character_slug / counselor_mode_id / status /
//       max_turns / turn_count / crisis_ended / exit_reason / batch_id / model_version /
//       seed_value / total_cost / error_message / started_at / finished_at / created_at / updated_at
//
//   反双胞胎:
//     - **不用 typeorm migration:generate**: 仓库 60+ 条 migration 历来手写 DDL.
//     - **不用 synchronize**: schema 只走 migration (ADR-0003).
//     - **幂等**: INFORMATION_SCHEMA 守卫 (缺才建/缺才补索引) —— 重复跑 up 不报错.
//     - **不加 DB-level FK**: 跨表引用应用层校验 (ADR-0003).
//     - **ap_practice_sessions 不做软删**: 场次是审计数据, 删了等于让批量统计凭空少一场.
//     - **不落对话原文**: 逐字稿在 debug-session JSON 文件里, 这两张表只存元数据.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'ap_%';  → 2 张表
//     2. DESCRIBE ap_counselor_modes; DESCRIBE ap_practice_sessions;
//     3. 连跑两次 migration:run → 第二次不报错 (幂等)
//
//   时间戳: 2026-11-08

import { MigrationInterface, QueryRunner } from 'typeorm';

/** 查表是否已存在. */
async function tableExists(qr: QueryRunner, table: string): Promise<boolean> {
  const rows = (await qr.query(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  )) as Record<string, unknown>[];
  return rows.length > 0;
}

export class AddAutoPracticeTables1714900000033 implements MigrationInterface {
  name = 'AddAutoPracticeTables1714900000033';

  /**
   * 建两张表 + 补索引 (幂等).
   */
  public async up(qr: QueryRunner): Promise<void> {
    // ① ap_counselor_modes
    if (!(await tableExists(qr, 'ap_counselor_modes'))) {
      await qr.query(
        'CREATE TABLE IF NOT EXISTS ap_counselor_modes (' +
          'id VARCHAR(64) NOT NULL,' +
          'name VARCHAR(128) NOT NULL,' +
          'system_prompt TEXT NOT NULL,' +
          'description VARCHAR(512) NOT NULL DEFAULT \'\',' +
          'enabled TINYINT NOT NULL DEFAULT 1,' +
          'sort_order INT NOT NULL DEFAULT 0,' +
          'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
          'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
          'PRIMARY KEY (id),' +
          'KEY idx_ap_modes_enabled_sort (enabled, sort_order)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
      );
    }

    // ② ap_practice_sessions
    if (!(await tableExists(qr, 'ap_practice_sessions'))) {
      await qr.query(
        'CREATE TABLE IF NOT EXISTS ap_practice_sessions (' +
          'id VARCHAR(64) NOT NULL,' +
          'debug_session_id VARCHAR(128) NOT NULL,' +
          'character_slug VARCHAR(128) NOT NULL,' +
          'counselor_mode_id VARCHAR(64) NOT NULL,' +
          'status VARCHAR(32) NOT NULL DEFAULT \'running\',' +
          'max_turns INT NOT NULL DEFAULT 15,' +
          'turn_count INT NOT NULL DEFAULT 0,' +
          'crisis_ended TINYINT NOT NULL DEFAULT 0,' +
          'exit_reason VARCHAR(64) NULL,' +
          'batch_id VARCHAR(64) NULL,' +
          'model_version VARCHAR(128) NULL,' +
          'seed_value VARCHAR(128) NULL,' +
          'total_cost DECIMAL(10,4) NULL,' +
          'error_message TEXT NULL,' +
          'started_at DATETIME NOT NULL,' +
          'finished_at DATETIME NULL,' +
          'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
          'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
          'PRIMARY KEY (id),' +
          'KEY idx_ap_sessions_batch (batch_id),' +
          'KEY idx_ap_sessions_status (status),' +
          'KEY idx_ap_sessions_character_mode (character_slug, counselor_mode_id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
      );
    }
  }

  /** 回滚 (删两张表). */
  public async down(qr: QueryRunner): Promise<void> {
    await qr.query('DROP TABLE IF EXISTS ap_practice_sessions;');
    await qr.query('DROP TABLE IF EXISTS ap_counselor_modes;');
  }
}
