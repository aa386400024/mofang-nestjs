import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { FragmentType } from '../enums/fragment-type.enum';

/**
 * 碎片流水表 — V4.0 §3.2.
 *
 * 设计:
 *   - 单表流水模式: 产出 delta > 0, 消耗 delta < 0
 *   - 没有"余额"字段, 余额由 SUM(delta) GROUP BY type 实时计算
 *   - source 字段是字符串常量, 不进 enum (业务自由扩展)
 *
 * 性能:
 *   - (user_id, type, created_at DESC) 复合索引 — 流水查询/余额聚合都用这个
 *   - 用户级切片永远是热路径 (前端每次 grant/consume 后都会拉新余额)
 *
 * 软删除:
 *   - V4.0 不做软删除, 流水是审计级数据, 不允许删除
 *   - 业务撤销走反向流水 (delta=-originalDelta), 不删原行
 */
@Entity('inner_world_fragment_logs')
@Index('idx_iwf_user_type_time', ['userId', 'type', 'createdAt'])
@Index('idx_iwf_user_time', ['userId', 'createdAt'])
export class FragmentLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: FragmentType, name: 'type' })
  type!: FragmentType;

  /** 正数 = 产出, 负数 = 消耗. 单条绝对值上限 999. */
  @Column({ type: 'int', name: 'delta' })
  delta!: number;

  /** 业务来源: 'practice.tool.completed' / 'shop.skin.consume' / ... */
  @Column({ type: 'varchar', length: 64, name: 'source' })
  source!: string;

  /** 业务级幂等 key: 同 key 重复请求直接拒绝, 避免双扣/双发. */
  @Column({ type: 'varchar', length: 128, name: 'idempotency_key', nullable: true })
  idempotencyKey!: string | null;

  /** 透传上下文: 关联业务实体 (e.g. { toolId, ' sessionId }) 用于追溯.
   *  V2026-09-03 治本: type 用 'json' (MySQL 原生支持), 而不是 'jsonb'
   *  (PostgreSQL 专属). 读写 API 上 TS 都是 Record<string, unknown>, 应用层无差别.
   */
  @Column({ type: 'json', name: 'context', nullable: true })
  context!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;
}
