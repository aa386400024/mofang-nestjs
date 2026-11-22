// V2026-11-22 (AF-313 · 调试会话远端持久化):
//   `admin_debug_sessions` 专用表 —— 调试会话的跨机器系统记录.
//
//   为什么手写 DDL: 本仓迁移一律显式列出, 不用 migration:generate; 表结构简单,
//   手写可把列注释、索引与隐私边界一次写清.
//
//   幂等: 先 hasTable, 缺才建; 重复跑不报错.
//   不碰正式训练表: 不建 FK, 不写 training_sessions / turn_debug_trace.

import { MigrationInterface, QueryRunner } from 'typeorm';

/** 表名. */
const TABLE = 'admin_debug_sessions';

/** 建表 DDL. */
const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS admin_debug_sessions (
  id VARCHAR(128) NOT NULL COMMENT '调试会话 id (= 内核 sessionId)',
  title VARCHAR(255) NOT NULL DEFAULT '' COMMENT '标题',
  title_source VARCHAR(16) NOT NULL DEFAULT 'fallback' COMMENT '标题来源: fallback / llm / manual',
  character_slug VARCHAR(128) NOT NULL DEFAULT '' COMMENT '角色代号',
  character_label VARCHAR(255) NOT NULL DEFAULT '' COMMENT '角色展示名',
  status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态: active / completed',
  turn_count INT NOT NULL DEFAULT 0 COMMENT '已跑轮数',
  has_kernel_state TINYINT NOT NULL DEFAULT 0 COMMENT '是否有内核状态快照 (列表判 resumable)',
  record_json LONGTEXT NOT NULL COMMENT '完整 DebugSessionRecord JSON (含心理对话原文, 禁止日志输出)',
  content_sha256 CHAR(64) NOT NULL COMMENT 'record_json 的 SHA-256 (审计/幂等)',
  record_bytes INT NOT NULL DEFAULT 0 COMMENT 'record_json 字节数',
  schema_version SMALLINT NOT NULL DEFAULT 1 COMMENT '记录 schema 版本',
  created_at DATETIME(3) NOT NULL COMMENT '创建时刻',
  updated_at DATETIME(3) NOT NULL COMMENT '最后更新时刻',
  PRIMARY KEY (id),
  KEY idx_admin_debug_sessions_created_at (created_at),
  KEY idx_admin_debug_sessions_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='管理端调试会话远端记录 (AF-313; 心理内容, 禁止日志输出)'
`;

/**
 * 建 `admin_debug_sessions` 表.
 */
export class CreateAdminDebugSessions1714900000049 implements MigrationInterface {
  /** 迁移名 (TypeORM 以类名为准). */
  name = 'CreateAdminDebugSessions1714900000049';

  /**
   * 正向迁移.
   *
   * @param queryRunner 查询运行器
   */
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TABLE)) return;
    await queryRunner.query(CREATE_TABLE);
  }

  /**
   * 回滚: 删表.
   *
   * 文件缓存仍在, 回滚后切 `ADMIN_DEBUG_SESSION_REMOTE=off` 即回到纯文件模式.
   *
   * @param queryRunner 查询运行器
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    await queryRunner.query(`DROP TABLE ${TABLE}`);
  }
}
