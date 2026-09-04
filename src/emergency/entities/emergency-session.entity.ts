// V2026-09-04 治本 (V6.0 §4.2 + audit P0-3):
//   急救会话上报表 — 5 工具 + 6 状态机 (§4.2 急救闭环).
//   原因: 前端 EmergencyRepositoryImpl 切 SQLCipher 本地持久化 (commit 14935e3
//         §C), 服务端需要镜像表做趋势分析 / 跨设备同步 / 服务端聚合
//         (§3.4 干预效果追踪 + §4.2 急救闭环).
//   修复: id 用 varchar(36) = 前端 UUID (跨设备 upsert 幂等);
//         started_at_ms / completed_at_ms 用 bigint 存前端毫秒时间戳
//         (前端 schema 一致, 服务端不二次转换);
//         notes 走 TEXT, SQLCipher at-rest 加密 (传输层 HTTPS);
//         (uid, started_at_ms) + (uid, tool_kind, started_at_ms) 索引支撑
//         趋势查询.
//   如何验证:
//     1. POST /emergency/sessions body 含前端 UUID id → upsert 幂等
//        (重复 POST 不新增行, 更新 phase + stages_completed).
//     2. GET /emergency/sessions?since=ms → 列出最近会话 (用于跨设备同步).
//     3. SELECT AVG(intensity_after - intensity_before) FROM emergency_sessions
//        WHERE tool_kind = 'grounding_54321' AND phase = 'completed' AND
//        uid = ? → 工具效果统计 (§3.4 闭环).

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import { EmergencyToolKind, SessionPhase } from '../enums/emergency.enums';

/**
 * 急救会话上报 — V6.0 §4.2 + audit P0-3.
 *
 * 字段最小化原则 (§11.1 隐私 + 合规):
 *   - 不记录 LLM 输入 / 输出原始内容 (走 SQLCipher + 服务端不持久化 LLM 上下文).
 *   - intensity_before / intensity_after 是 0..10 自评, 用户可跳过 (nullable).
 *   - notes 仅 thought_bubble 工具使用, 走 SQLCipher 加密.
 */
@Entity('emergency_sessions')
@Index('idx_emergency_uid_started', ['uid', 'startedAtMs'])
@Index('idx_emergency_uid_tool_started', ['uid', 'toolKind', 'startedAtMs'])
@Index('idx_emergency_phase', ['phase'])
export class EmergencySessionEntity {
  /** 前端 UUID (跨设备 upsert 幂等键). */
  @PrimaryColumn({ type: 'char', length: 36, name: 'id' })
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'enum', enum: EmergencyToolKind, name: 'tool_kind' })
  toolKind!: EmergencyToolKind;

  @Column({
    type: 'enum',
    enum: SessionPhase,
    name: 'phase',
    default: SessionPhase.IDLE,
  })
  phase!: SessionPhase;

  @Column({ type: 'tinyint', name: 'intensity_before', nullable: true })
  intensityBefore!: number | null;

  @Column({ type: 'tinyint', name: 'intensity_after', nullable: true })
  intensityAfter!: number | null;

  /** 已完成阶段数 — e.g. 5-4-3-2-1 共 5 阶段, 完成 3 = 60% (§4.2 进度). */
  @Column({ type: 'int', name: 'stages_completed', default: 0 })
  stagesCompleted!: number;

  /** 前端毫秒时间戳 — 与前端 EmergencySession.startedAtMs 字段对齐. */
  @Column({ type: 'bigint', name: 'started_at_ms' })
  startedAtMs!: string;

  @Column({ type: 'bigint', name: 'completed_at_ms', nullable: true })
  completedAtMs!: string | null;

  /** thought_bubble 工具专用 — 走 SQLCipher at-rest 加密. */
  @Column({ type: 'text', name: 'notes', nullable: true })
  notes!: string | null;

  /** 上下文透传 — 工具版本 / 客户端版本 / 异常情况. */
  @Column({ type: 'json', name: 'context', nullable: true })
  context!: Record<string, unknown> | null;

  /** 服务端入库时间 — 与前端 startedAtMs 不同 (网络延迟 + 重试). */
  @CreateDateColumn({ type: 'datetime', precision: 6, name: 'created_at' })
  createdAt!: Date;
}
