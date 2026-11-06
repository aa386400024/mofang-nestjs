// V2026-11-06 治本 (WP58 · B 层 · turn_delta_audits 表实体):
//   职责: 承载 turn_delta_audits 表 —— 每一轮"触发了什么事件 / 原始 delta 是多少".
//   边界: 只描述表结构与列语义; 零业务逻辑、零 IO.
//
//   为什么这张表在 engine-adapters 而不是 counselor:
//     表的**写入方**是引擎侧观测通道 (adapter 自观测), 生命周期随引擎走 ——
//     与 character_profiles 同一归属理由 (见该实体文件头).
//
//   反双胞胎:
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//     - **不用 @DeleteDateColumn**: 软删查询手写 deletedAt: IsNull()
//       (仓库硬约束 #2); 本表是 append-only 审计, 压根没有软删列.
//     - **不落咨询师原话**: 只有事件类型 + 命中词 + delta 数值 —— 心理内容不进普通表.
//     - **不落完整 BDI 快照**: 只有 11 维 delta 向量, 信念层/愿望层/记忆层一律不落.
//     - **不落 cap 砍幅明细**: 砍幅已经有 DeltaCapLogger 打日志, 不重复存.
//     - **(tenant_id, session_id, turn_index) 唯一**: 一场会话一轮一条 ——
//       BullMQ 重试不会堆出多行, 重算覆盖同一行.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW CREATE TABLE turn_delta_audits;   # 8 列 + 3 索引
//     2. SHOW INDEX FROM turn_delta_audits;      # PRIMARY + UNIQUE(tenant,session,turn) + 普通
//
//   时间戳: 2026-11-06

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { TurnDeltaAuditEventDetail } from './turn-delta-audit.port.js';
import type { DeltaVector } from '../../../engine-core/index.js';

/**
 * turn_delta_audits 表 —— 一场会话每一轮的事件 + delta 审计.
 *
 * 一行 = 一场会话的一轮 (事件类型 + 命中词 + 原始 delta 向量).
 */
@Entity('turn_delta_audits')
// 一场会话一轮一条 (重试覆盖, 不堆行).
@Index('idx_turn_delta_audit_turn', ['tenantId', 'sessionId', 'turnIndex'], { unique: true })
// 按会话查询 (admin 读端点走这条索引).
@Index('idx_turn_delta_audit_session', ['tenantId', 'sessionId'])
export class TurnDeltaAuditEntity {
  /** 主键 (uuid). */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 租户 id (与内核会话归属同口径). */
  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  /** 业务会话 id (内核会话的 sessionId). */
  @Column({ type: 'varchar', length: 128, name: 'session_id' })
  sessionId!: string;

  /** 本会话累计轮次 (从 1 起). */
  @Column({ type: 'int', name: 'turn_index' })
  turnIndex!: number;

  /** 本轮命中的事件类型 (去重保序). */
  @Column({ type: 'json', name: 'event_kinds' })
  eventKinds!: string[];

  /** 每个事件的明细 (类型 + 命中词 + 强度). */
  @Column({ type: 'json', name: 'event_details' })
  eventDetails!: TurnDeltaAuditEventDetail[];

  /** 聚合后的原始 delta (11 维). */
  @Column({ type: 'json', name: 'raw_delta' })
  rawDelta!: DeltaVector;

  /** 落库时刻. */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;
}
