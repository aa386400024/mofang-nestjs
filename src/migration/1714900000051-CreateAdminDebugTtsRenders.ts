// AF-395 (2026-11-24): 调试页三模型 TTS 历史音频缓存表.
// 手写 DDL；唯一键保证同一会话/轮次/provider/请求指纹只生成一次。
import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'admin_debug_tts_renders';

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS admin_debug_tts_renders (
  id CHAR(36) NOT NULL COMMENT '记录 id',
  source_type VARCHAR(16) NOT NULL COMMENT 'auto_practice / debug_session',
  source_id VARCHAR(128) NOT NULL COMMENT '自动对练 practiceSessionId / 手动调试 debugSessionId',
  turn_index INT NOT NULL COMMENT '轮次，从 1 开始',
  provider VARCHAR(32) NOT NULL COMMENT 'minimax-hd / minimax-turbo / doubao-seed-tts-2.0',
  request_hash CHAR(64) NOT NULL COMMENT 'provider + 音色 + 文本 + 情绪 + 参数指纹',
  voice_id VARCHAR(128) NOT NULL COMMENT '实际音色 id',
  audio_format VARCHAR(8) NOT NULL DEFAULT 'mp3' COMMENT '音频格式',
  sample_rate INT NOT NULL DEFAULT 24000 COMMENT '采样率',
  duration_ms INT NULL COMMENT '时长（上游可提供时记录）',
  text_chars INT NOT NULL COMMENT '合成文本字符数',
  usage_json TEXT NULL COMMENT '上游计量信息（脱敏 JSON）',
  audio MEDIUMBLOB NOT NULL COMMENT '音频二进制（调试回放，不入日志）',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '生成时刻',
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_debug_tts_render (source_type, source_id, turn_index, provider, request_hash),
  KEY idx_admin_debug_tts_source (source_type, source_id, turn_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='引擎调试页三模型 TTS 历史音频 (AF-395; 不含 key)'
`;

/** 建表. */
export class CreateAdminDebugTtsRenders1714900000051 implements MigrationInterface {
  name = 'CreateAdminDebugTtsRenders1714900000051';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TABLE)) return;
    await queryRunner.query(CREATE_TABLE);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    await queryRunner.query(`DROP TABLE ${TABLE}`);
  }
}
