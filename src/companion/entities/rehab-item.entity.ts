import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 康复协同 entity — 仅 L3 权限可见 (V2.0 §Tab2 陪伴者端 Tab2 康复协同).
 *
 * 设计:
 *   - 4 个 kind: medication / appointment / checkin / crisis_followup
 *   - L3 权限校验在 controller 层做 (前端根据 activePerson.permissionLevel 过滤)
 *   - 软删由 users.deleted_at cascade 触发
 *
 * V3 升级: 接用药提醒 / 复诊同步 (接医院 HIS 接口), 字段保留 dueAt / completedAt.
 */
@Entity('companion_rehab_items')
@Index('idx_rehab_items_owner_due', ['ownerUid', 'dueAt'])
export class RehabItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'owner_uid' })
  ownerUid!: string;

  @Column({ type: 'char', length: 36, name: 'companion_uid' })
  companionUid!: string;

  @Column({ type: 'varchar', length: 200, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 32, name: 'kind' })
  kind!: 'medication' | 'appointment' | 'checkin' | 'crisis_followup';

  @Column({ type: 'datetime', name: 'due_at' })
  dueAt!: Date;

  @Column({ type: 'varchar', length: 255, name: 'note', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'datetime', name: 'completed_at', nullable: true })
  completedAt!: Date | null;
}
