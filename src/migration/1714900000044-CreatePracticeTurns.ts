// V2026-11-10 治本 (WP-J P1e Phase2 — 自动对练 · 来访者语义落库表):
//   原因: P1e 第一批把"语义解析层 + MiniMax 适配层"写成了纯工具类, 但**没有落点**
//     —— 批量对练产出的来访者回复 (result.reply) 只是一段带标记的裸文本,
//     事后没人知道它拆成 displayText / ttsText 之后长什么样, 也没法判断
//     "这一批的语音自然度是不是因为解析降级掉了".
//   本次建 ap_practice_turns 表 (轮次级): 一行 = 一场里的一轮, 5 个 visitor_ 列:
//     visitor_display_text    TEXT        NULL   纯文本 (无标记)
//     visitor_tts_text        TEXT        NULL   TTS 文本 (带 MiniMax 标记)
//     visitor_semantic_json   LONGTEXT    NULL   语义中间表示 JSON
//     visitor_semantic_level  TINYINT     NULL   降级级别 0/1/2
//     visitor_semantic_version VARCHAR(16) NULL   语义层版本 (semantic-v1)
//
// ── 为什么建**新表**而不是给 ap_practice_sessions 加列 ──────────────────────
//   ① 落点事实: 逐字稿在 data/debug-sessions/*.json (文件), DB 里的
//      ap_practice_sessions 是**场次级**表 (一场一行, 12~25 轮).
//      加列 → 每一列得存"按 turnIndex 排的 JSON 数组" → 每轮读-改-写整行,
//      行体积随轮数线性膨胀 (任务单明确警告过).
//   ② turn 表能直接查"第 7 轮有没有停顿标记 / 哪几轮降级了";
//      session 级 JSON 数组只能全量取回再在应用层过滤.
//   ③ 唯一键 (practice_session_id, turn_index) → upsert 天然幂等.
//
//   ⚠️ 历史行**不可反推, 不回填**: 老场次跑的时候压根没解析过 ——
//     回填 = 编数据. 老行在这张表里**根本不存在** (表是新建的).
//
//   反双胞胎 (与 quality_annotation / gate_decisions 同款):
//     - 手写 DDL, 不用 migration:generate (仓库 60+ 条 migration 历来手写);
//     - 幂等: 表存在就只补列 (缺才加) —— 重复跑 up 不报错, 手工建过表也不炸;
//     - 不加 DB-level FK (跨表引用应用层校验, ADR-0003);
//     - 不做软删 (语义落库是"当时那轮长什么样"的证据).
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE ap_practice_turns;
//     2. 连跑两次 migration:run → 第二次不报错 (幂等)
//
//   时间戳: 2026-11-10 GMT+8

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 查表是否已存在.
 *
 * @param qr 查询运行器
 * @param table 表名
 * @returns 存在 → true
 */
async function tableExists(qr: QueryRunner, table: string): Promise<boolean> {
  const rows = (await qr.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [
    table,
  ])) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * 查列是否已存在.
 *
 * @param qr 查询运行器
 * @param table 表名
 * @param column 列名
 * @returns 存在 → true
 */
async function columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
  const rows = (await qr.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  )) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * ap_practice_turns 新表 (轮次级来访者语义落库).
 */
export class CreatePracticeTurns1714900000044 implements MigrationInterface {
  name = 'CreatePracticeTurns1714900000044';

  /**
   * 建表 + 补列 (幂等).
   *
   * @param qr 查询运行器
   */
  public async up(qr: QueryRunner): Promise<void> {
    if (!(await tableExists(qr, 'ap_practice_turns'))) {
      await qr.query(
        'CREATE TABLE IF NOT EXISTS ap_practice_turns (' +
          'id CHAR(36) NOT NULL,' +
          "practice_session_id VARCHAR(64) NOT NULL COMMENT '所属场次 id (ap_practice_sessions.id)'," +
          "turn_index INT NOT NULL COMMENT '轮次序号 (从 1 起)'," +
          "visitor_display_text TEXT NULL COMMENT '来访者纯文本 (无标记)'," +
          "visitor_tts_text TEXT NULL COMMENT '来访者 TTS 文本 (带 MiniMax 标记)'," +
          "visitor_semantic_json LONGTEXT NULL COMMENT '语义中间表示 JSON (SemanticTurn)'," +
          "visitor_semantic_level TINYINT NULL COMMENT '解析降级级别 (0 干净 / 1 轻度 / 2 重度)'," +
          "visitor_semantic_version VARCHAR(16) NULL COMMENT '语义层版本 (semantic-v1)'," +
          'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
          'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
          'PRIMARY KEY (id),' +
          'UNIQUE KEY uk_ap_turns_session_turn (practice_session_id, turn_index),' +
          'KEY idx_ap_turns_session (practice_session_id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
      );
    }

    // 幂等补列 (手工建过表 / 上一版 DDL 不全时也能补齐).
    const columns: readonly [string, string][] = [
      ['visitor_display_text', 'TEXT NULL'],
      ['visitor_tts_text', 'TEXT NULL'],
      ['visitor_semantic_json', 'LONGTEXT NULL'],
      ['visitor_semantic_level', 'TINYINT NULL'],
      ['visitor_semantic_version', 'VARCHAR(16) NULL'],
    ];
    for (const [column, definition] of columns) {
      if (!(await columnExists(qr, 'ap_practice_turns', column))) {
        await qr.query(`ALTER TABLE ap_practice_turns ADD COLUMN ${column} ${definition};`);
      }
    }
    // 历史行**刻意不 INSERT** (见文件头): 老场次没解析过, 造行 = 编数据.
  }

  /**
   * 回滚: 删表.
   *
   * @param qr 查询运行器
   */
  public async down(qr: QueryRunner): Promise<void> {
    if (await tableExists(qr, 'ap_practice_turns')) {
      await qr.query('DROP TABLE IF EXISTS ap_practice_turns;');
    }
  }
}
