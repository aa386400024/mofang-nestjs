// V2026-10-21 治本 (V1.2 VS-C — 双向移情/阻抗标记 entity):
//   原因: v1.2 spec §6.4 双向移情/阻抗标记系统 —— 同一张表上并存两个方向:
//     - visitor_auto:     AI 自动标记 (来访侧: 阻抗 / 回避 / 正移情 / 负移情 / 解离)
//     - counselor_manual: 咨询师手动标记 (反移情侧: 会谈中点「反移情觉察」+ 简短备注)
//     长程卷宗还要按 sessionNumber 聚合出"移情/阻抗变化趋势图", 所以方向 + 类型必须可枚举.
//   修法: transference_resistance_marks 表, 字段跟 spec §6.4 的 entity 草图 1:1 + 补仓库统一模板字段.
//   反双胞胎:
//     - 不拆成 2 张表 (来访侧 / 咨询师侧): 两侧字段结构完全一样, 拆表会让"按时间线看全部标记"
//       变成 UNION 查询; 方向用 enum 列区分即可
//     - 不用 markedBy 自由字符串: 会漏拼写, 且没法按方向做索引/统计
//     - 不加 DB-level FK 到 training_sessions: 跟仓库既有 pattern 一致 (软删兼容)
//     - 补 tenant_id / user_id / deleted_at: 跟 counselor 既有 12 个 entity 同一模板 (多租户隔离)
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 migration:run 后 SHOW CREATE TABLE transference_resistance_marks → 2 索引
//   时间戳: 2026-10-21

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TransferenceMarkDirection, TransferenceMarkType } from '../enums/transference-mark.enum';

/**
 * 双向移情 / 阻抗标记.
 */
@Entity('transference_resistance_marks')
@Index('idx_trrm_session_turn', ['sessionId', 'turnIndex'])
@Index('idx_trrm_user', ['userId'])
export class TransferenceResistanceMark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9).
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  /** 所属训练会话 id (training_sessions.id). */
  @Column({ type: 'char', length: 36, name: 'session_id' })
  sessionId!: string;

  /** 标记所在轮次 (transcript 里的 turn index). */
  @Column({ type: 'int', name: 'turn_index' })
  turnIndex!: number;

  /** 标记方向 (visitor_auto / counselor_manual). */
  @Column({ type: 'varchar', length: 20 })
  direction!: TransferenceMarkDirection;

  /** 标记类型 (resistance / avoidance / positive_transference / ... / counter_transference). */
  @Column({ type: 'varchar', length: 30, name: 'mark_type' })
  markType!: TransferenceMarkType;

  /** 备注 (可空). 咨询师侧必填 (手动标记要给一句说明), AI 侧可空. */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 counselor 其它 entity 一致, 查询需手写 IsNull()).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
