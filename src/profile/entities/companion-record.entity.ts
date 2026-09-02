import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 陪伴记录 entity — 陪伴者专属 (大厂企业级 V3).
 *
 * V2.0 §Tab4 我的陪伴记录页:
 *   - date: 日期 (YYYY-MM-DD 字符串)
 *   - title: 记录标题 (e.g. "发送安抚卡片", "同步练习")
 *   - summary: 摘要文案
 *   - tag: 状态标签 (已发送 / 已完成 / 待回复)
 *
 * V2026-09-01 扩展 (companion Tab2 复用):
 *   - relatedPersonId: 关联的成长用户 UID (前端 CompanionRecordDto.relatedPersonId,
 *     跟 companionToUid 同义但前端契约走 relatedPersonId,这里冗余存一份避免 join)
 *   - toolId / dualExerciseId / rehabItemId: 关联的工具/双人练习/康复项 ID,
 *     nullable, V2.0 占位为 null, V3 接事件总线后由 Service 写入
 *
 * 大厂做法:
 *   - 1:N, 陪伴者一人多条记录
 *   - INDEX (companion_uid, date DESC) — 按时间倒序查
 *   - INDEX (companion_uid, tag) — 按状态过滤
 *   - 软删不接 (个保法: 陪伴记录属于用户内容, 软删够用)
 *     大厂做法: 软删由 users.deleted_at 触发 (FK cascade) 真删时一并清
 *   - V3 接事件总线 (BullMQ 异步), 通知双方端
 */
@Entity('companion_records')
@Index('idx_companion_uid_date', ['companionUid', 'date'])
@Index('idx_companion_uid_tag', ['companionUid', 'tag'])
export class CompanionRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联 users.uid (陪伴者 — 操作人). */
  @Column({ type: 'char', length: 36, name: 'companion_uid' })
  companionUid!: string;

  /** 关联 users.uid (被陪伴的人 — 关联方). */
  @Column({ type: 'char', length: 36, name: 'companion_to_uid' })
  companionToUid!: string;

  @Column({ type: 'date', name: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 128, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 512, name: 'summary' })
  summary!: string;

  @Column({ type: 'varchar', length: 32, name: 'tag', default: '已完成' })
  tag!: string;

  /**
   * V2026-09-01 扩展 — 关联成长用户 UID (与 companionToUid 同义冗余, 跟前端契约对齐).
   * V2.0 nullable, V3 由 service 写入;老数据回填靠 service 端从 companionToUid 推导.
   */
  @Column({ type: 'char', length: 36, name: 'related_person_id', nullable: true })
  relatedPersonId!: string | null;

  /**
   * V2026-09-01 扩展 — 关联练习工具 ID (soothing cards 关联的 tool 等).
   * V2.0 nullable (占位, 未来 V3 由事件总线写入).
   */
  @Column({ type: 'varchar', length: 64, name: 'tool_id', nullable: true })
  toolId!: string | null;

  /**
   * V2026-09-01 扩展 — 关联双人练习 ID (dual sessions 完成的关联).
   * V2.0 nullable.
   */
  @Column({ type: 'varchar', length: 64, name: 'dual_exercise_id', nullable: true })
  dualExerciseId!: string | null;

  /**
   * V2026-09-01 扩展 — 关联康复项 ID (rehab items 完成的关联).
   * V2.0 nullable.
   */
  @Column({ type: 'varchar', length: 64, name: 'rehab_item_id', nullable: true })
  rehabItemId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
