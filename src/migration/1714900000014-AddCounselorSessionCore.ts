// V2026-10-21 治本 (V1.2 VS-C — M2 知情同意 + M3 会谈核心: 3 张新表 + 5 处 ALTER):
//   原因: v1.2 spec §5.4 (知情同意 3 列) / §6.1 (live_supervision_hints) /
//     §6.2 (transcript_bookmarks) / §6.4 (transference_resistance_marks) /
//     §6.3 + §12.2 (tech_stats 落 training_sessions + long_term_case_sessions).
//     合计: 3 张新表 + 5 个增量列.
//   修法: 1 个 migration 做完 (同属"会谈核心"一个切片, 一起建一起回滚):
//     - ALTER training_sessions        + informed_consent_required / informed_consent_passed
//                                     + informed_consent_transcript / tech_stats
//     - ALTER long_term_case_sessions  + tech_stats
//     - CREATE live_supervision_hints / transcript_bookmarks / transference_resistance_marks
//   反双胞胎:
//     - ALTER 不写 `IF NOT EXISTS`: **MySQL 不支持** ALTER TABLE ADD COLUMN IF NOT EXISTS
//       (那是 MariaDB 语法). 仓库既有写法 (1700000001000-AddUserV2Fields.ts) 是
//       "反引号包名 + AFTER <col> 排序", 本 migration 严格照抄 —— 加了 IF NOT EXISTS
//       在 MySQL 上直接语法错, 整条 migration 挂掉
//     - 不用 `synchronize: true` 生成: ADR-0003 已禁; 且 bin/ormconfig.ts 的 entities glob
//       扫不到 counselor 系 entity, generate 出来是空壳
//     - 新表列全 NOT NULL / DEFAULT 齐: 3 张新表的每列都给 DEFAULT 或显式 NOT NULL,
//       避免"加列后老行是 NULL"导致后续查询漏过滤
//     - 不加 DB-level FK: 跟仓库既有 pattern 一致 (软删兼容)
//   验证:
//     1. 大炮跑 pnpm migration:run → 0 错
//     2. SHOW COLUMNS FROM training_sessions → 4 个新列 (informed_consent_* ×2 + informed_consent_transcript + tech_stats)
//     3. SHOW COLUMNS FROM long_term_case_sessions → tech_stats
//     4. SHOW TABLES LIKE 'live_supervision_hints' / 'transcript_bookmarks' / 'transference_resistance_marks' → 各 1 行
//   时间戳: 2026-10-21
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCounselorSessionCore1714900000014 implements MigrationInterface {
  name = 'AddCounselorSessionCore1714900000014';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── 1. training_sessions: 知情同意 3 列 + 技术统计 1 列 ───
    await qr.query(`
      ALTER TABLE \`training_sessions\`
      ADD COLUMN \`informed_consent_required\` tinyint(1) NOT NULL DEFAULT 1 AFTER \`transcript\`,
      ADD COLUMN \`informed_consent_passed\` tinyint(1) NOT NULL DEFAULT 0 AFTER \`informed_consent_required\`,
      ADD COLUMN \`informed_consent_transcript\` JSON NULL AFTER \`informed_consent_passed\`,
      ADD COLUMN \`tech_stats\` JSON NULL AFTER \`informed_consent_transcript\`;
    `);

    // ─── 2. long_term_case_sessions: 技术统计 1 列 (跟单次训练侧对称) ───
    await qr.query(`
      ALTER TABLE \`long_term_case_sessions\`
      ADD COLUMN \`tech_stats\` JSON NULL AFTER \`overall_score\`;
    `);

    // ─── 3. live_supervision_hints: 实时督导轻提示 ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS live_supervision_hints (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        session_id CHAR(36) NOT NULL,
        turn_index INT NOT NULL,
        category VARCHAR(50) NOT NULL,
        hint_text VARCHAR(500) NOT NULL,
        tier VARCHAR(20) NOT NULL DEFAULT 'light',
        bookmark_id CHAR(36) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_lsh_session_turn (session_id, turn_index),
        INDEX idx_lsh_session_category (session_id, category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── 4. transcript_bookmarks: 逐字稿打点标记 ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS transcript_bookmarks (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        session_id CHAR(36) NOT NULL,
        turn_index INT NOT NULL,
        offset_ms FLOAT NOT NULL,
        mark_type VARCHAR(20) NOT NULL,
        note TEXT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_tbm_session_turn (session_id, turn_index),
        INDEX idx_tbm_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── 5. transference_resistance_marks: 双向移情/阻抗标记 ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS transference_resistance_marks (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        session_id CHAR(36) NOT NULL,
        turn_index INT NOT NULL,
        direction VARCHAR(20) NOT NULL,
        mark_type VARCHAR(30) NOT NULL,
        note TEXT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_trrm_session_turn (session_id, turn_index),
        INDEX idx_trrm_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS transference_resistance_marks;`);
    await qr.query(`DROP TABLE IF EXISTS transcript_bookmarks;`);
    await qr.query(`DROP TABLE IF EXISTS live_supervision_hints;`);

    await qr.query(`
      ALTER TABLE \`long_term_case_sessions\`
      DROP COLUMN \`tech_stats\`;
    `);

    await qr.query(`
      ALTER TABLE \`training_sessions\`
      DROP COLUMN \`tech_stats\`,
      DROP COLUMN \`informed_consent_transcript\`,
      DROP COLUMN \`informed_consent_passed\`,
      DROP COLUMN \`informed_consent_required\`;
    `);
  }
}
