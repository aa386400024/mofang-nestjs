// V2026-10-12 (Phase 8.1 — KB 工作流事件 / SPEC §12.1):
//   workflow_events 表 — 状态机迁移日志, 客户端 7.6 工作流面板 timeline 用.
//
//   大厂 spec (跟 user.entity.ts 同 pattern):
//     - UUID PK + composite index (itemId, timestamp) 覆盖时间倒序查询
//     - fromStatus / toStatus 用 enum 列 (跟 knowledge_items.status 严格对齐)
//     - comment 是 nullable text (review reject 时填, 其它 action 可选)
//
//   治本:
//     - 不存 userName 冗余 (server join users.email 拿, schema 干净).
//     - 不存 "工作流当前是哪个 action" (那是 knowledge_items.status 真相源, 这
//       里只记历史, 跟 source of truth 分离).

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { KnowledgeStatus } from '../enums/knowledge-status.enum';

/**
 * workflow_events 表 — 状态机迁移日志.
 *
 * 跟客户端 7.6 workflow panel timeline 对齐.
 */
@Entity('workflow_events')
@Index('idx_kb_event_item_timestamp', ['itemId', 'timestamp'])
export class WorkflowEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'item_id' })
  itemId!: string;

  @Column({ type: 'enum', enum: KnowledgeStatus, name: 'from_status' })
  fromStatus!: KnowledgeStatus;

  @Column({ type: 'enum', enum: KnowledgeStatus, name: 'to_status' })
  toStatus!: KnowledgeStatus;

  // 触发 action 的 user (submit / approve / reject / archive / restore).
  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  @CreateDateColumn({ name: 'timestamp' })
  timestamp!: Date;

  // V0.x: reject / approve 时 comment 可选填 (跟 SPEC §12.1 "comment" 列对齐).
  @Column({ type: 'text', nullable: true })
  comment!: string | null;
}
