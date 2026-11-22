// V2026-11-22 (AF-313 · 调试会话远端持久化):
//   专用表 `admin_debug_sessions` —— 调试会话的跨机器系统记录.
//
//   为什么单独建表 (不复用正式训练表):
//     · 调试数据不污染 `training_sessions` / `turn_debug_trace`;
//     · 记录形状是调试快照 (messages + traces + kernelState), 与训练事实不同构;
//     · 列表投影列单独存, 列表页只读小字段, 不解析/传输大 JSON.
//
//   隐私: record_json 含心理对话原文, 禁止进日志; 表只允许 admin 调试/标注读路径访问.

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** 表名. */
export const ADMIN_DEBUG_SESSION_TABLE = 'admin_debug_sessions';

/** 当前记录 JSON 的 schema 版本. */
export const ADMIN_DEBUG_SESSION_SCHEMA_VERSION = 1;

/**
 * 调试会话远端记录.
 */
@Entity(ADMIN_DEBUG_SESSION_TABLE)
@Index('idx_admin_debug_sessions_created_at', ['createdAt'])
@Index('idx_admin_debug_sessions_updated_at', ['updatedAt'])
export class AdminDebugSessionEntity {
  /** 会话 id (= 内核 sessionId). */
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  /** 标题 (列表投影). */
  @Column({ type: 'varchar', length: 255, default: '' })
  title!: string;

  /** 标题来源: fallback / llm / manual. */
  @Column({ type: 'varchar', length: 16, name: 'title_source', default: 'fallback' })
  titleSource!: string;

  /** 角色代号. */
  @Column({ type: 'varchar', length: 128, name: 'character_slug', default: '' })
  characterSlug!: string;

  /** 角色展示名. */
  @Column({ type: 'varchar', length: 255, name: 'character_label', default: '' })
  characterLabel!: string;

  /** 状态: active / completed. */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: string;

  /** 已跑轮数. */
  @Column({ type: 'int', name: 'turn_count', default: 0 })
  turnCount!: number;

  /** 是否有内核状态快照 (列表判 resumable, 不解析大 JSON). */
  @Column({ type: 'tinyint', name: 'has_kernel_state', default: 0 })
  hasKernelState!: number;

  /** 完整会话记录 JSON (DebugSessionRecord). */
  @Column({ type: 'longtext', name: 'record_json' })
  recordJson!: string;

  /** 记录 JSON 的 SHA-256 (审计/幂等比对; 不反向参与业务判定). */
  @Column({ type: 'char', length: 64, name: 'content_sha256' })
  contentSha256!: string;

  /** 记录 JSON 字节数 (容量观测). */
  @Column({ type: 'int', name: 'record_bytes', default: 0 })
  recordBytes!: number;

  /** 记录 schema 版本. */
  @Column({ type: 'smallint', name: 'schema_version', default: ADMIN_DEBUG_SESSION_SCHEMA_VERSION })
  schemaVersion!: number;

  /** 创建时刻. */
  @Column({ type: 'datetime', precision: 3, name: 'created_at' })
  createdAt!: Date;

  /** 最后更新时刻. */
  @Column({ type: 'datetime', precision: 3, name: 'updated_at' })
  updatedAt!: Date;
}
