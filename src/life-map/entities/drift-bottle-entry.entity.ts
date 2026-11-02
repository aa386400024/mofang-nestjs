import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { DriftBottleStatus } from '../enums/drift-bottle-status.enum';

/**
 * 漂流瓶 entity — V2026-09-12 §6.5 心塑 V6.0.
 *
 * 大厂 standard (跟前端 lib/features/life_map/domain/entities/drift_bottle.dart 1:1):
 *   - id PK uuid (前端用 _uuid.v4())
 *   - authorId 真值 (后台审计用, UI 永远不展示)
 *   - authorAnonymousName 匿名化展示名 (服务端预置池随机 + 可用户自填, 后端白名单过滤)
 *   - content 500 字硬截断 (前端 + 后端双保险)
 *   - status 单向不可回退 (DRIFT → PICKED → RESPONDED)
 *   - pickedByUserId + respondedText nullable (没被捞/没回信时)
 *
 * 反双胞胎:
 *   - 不复用 consent/entities/user-consent (那是同意书, 无关)
 *   - 不复用 good_state_diary/GoodStateDiaryEntry (那是觉察日记, 无关)
 *
 * 索引策略:
 *   - author_id: 自己看"我的瓶子"
 *   - (status, created_at): 海面捞瓶 listByRandom
 *   - author_id + created_at: "我投的"列表
 *   - picked_by_user_id: "我收到的回信" 列表
 */
@Entity('life_map_drift_bottles')
@Index('idx_drift_bottles_author_created', ['authorId', 'createdAt'])
@Index('idx_drift_bottles_status_created', ['status', 'createdAt'])
@Index('idx_drift_bottles_picker', ['pickedByUserId'])
export class DriftBottleEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'author_id' })
  authorId!: string;

  @Column({ type: 'varchar', length: 64, name: 'author_anonymous_name' })
  authorAnonymousName!: string;

  @Column({ type: 'text', name: 'content' })
  content!: string;

  @Column({
    type: 'enum',
    enum: DriftBottleStatus,
    default: DriftBottleStatus.DRIFT,
    name: 'status',
  })
  status!: DriftBottleStatus;

  @Column({
    type: 'varchar',
    length: 64,
    name: 'picked_by_user_id',
    nullable: true,
  })
  pickedByUserId!: string | null;

  @Column({
    type: 'varchar',
    length: 64,
    name: 'picked_by_anonymous_name',
    nullable: true,
  })
  pickedByAnonymousName!: string | null;

  @Column({ type: 'datetime', name: 'picked_at', nullable: true })
  pickedAt!: Date | null;

  @Column({ type: 'text', name: 'responded_text', nullable: true })
  respondedText!: string | null;

  @Column({ type: 'datetime', name: 'responded_at', nullable: true })
  respondedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
