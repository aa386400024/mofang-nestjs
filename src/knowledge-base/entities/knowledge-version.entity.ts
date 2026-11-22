// V2026-10-12 (Phase 8.1 — KB 版本快照 / SPEC §12.1):
//   knowledge_versions 表 — 每次 autosave PATCH 触发版本快照, 客户端 7.5 版本历史用.
//
//   大厂 spec (跟 user.entity.ts 同 pattern):
//     - UUID PK + composite index (itemId, version) 覆盖快速查询
//     - snapshot 是 json (同 content shape), diff 是 nullable json (V1.x 增强,
//       V0.x 存简单 from/to 对比)
//     - authorId 是触发 PATCH 的 user (跟 knowledge_items.authorId 区分:
//       知识创建者 vs 版本快照创建者, 通常一致但 PATCH 阶段可能 reviewer 改)
//
//   反双胞胎:
//     - 不存完整 knowledge_items row (id / status / metadata 等), 只存 content
//       snapshot + diff. 重建完整 item 需要 join + 算 status, V0.x 简单.

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * knowledge_versions 表.
 *
 * 跟客户端 7.5 KnowledgeVersion 字段对齐 (itemId, version, snapshot, authorId, createdAt).
 * V0.x diff 字段占位, 留 V1.x 增强.
 */
@Entity('knowledge_versions')
@Index('idx_kb_version_item_version', ['itemId', 'version'])
export class KnowledgeVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'item_id' })
  itemId!: string;

  // V0.x: int 简单, 跟 knowledge_items.version 同步. V1.x 改 bigint 防超.
  @Column({ type: 'int' })
  version!: number;

  // V0.x 简单: snapshot = content { format, body, preview } (跟 knowledge_items.content 同 shape).
  @Column({ type: 'json' })
  snapshot!: { format: 'doc'; body: string; preview: string };

  @Column({ type: 'char', length: 36, name: 'author_id' })
  authorId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  // V0.x 占位 (nullable). V1.x 增强: { title: { from, to }, body: { from, to } }.
  @Column({ type: 'json', nullable: true })
  diff!: Record<string, { from: unknown; to: unknown }> | null;
}
