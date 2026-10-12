// V2026-10-12 (Phase 8.1 — KB 主表 / SPEC §12.1):
//   knowledge_items 表 — V0.x KB 内容主表, 跟客户端 7.1-7.8 KnowledgeItem 严格对齐.
//
//   大厂 spec (跟 user.entity.ts / ai-effect-record.entity.ts 同 pattern):
//     - UUID PK + char(36) uid 风格
//     - 复合 index 覆盖高频查询 (tenantId + status, authorId + createdAt, etc.)
//     - content / metadata 用 json 字段 (V0.x 简单, V1.x 拆独立表 + 全文索引)
//
//   治本:
//     - 不放 authorName / reviewerName 冗余字段 (用 join 拿, schema 干净).
//     - 不放 tenantId nullable (V0.x 强制 = uid, migration backfill 兜底).
//     - status / type 用 enum 列 (MySQL 8.0 enum 性能 OK, 跟 wire 字符串对齐).

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { KnowledgeStatus } from '../enums/knowledge-status.enum';
import { KnowledgeType } from '../enums/knowledge-type.enum';

/**
 * knowledge_items 主表.
 *
 * V0.x: 单租户, tenantId 默认 = uid. V1.x 接 Tenant entity 改 nullable + 强隔离.
 * 内容字段 (content / metadata) 是 json 字段, V0.x 简单, V1.x 拆 knowledge_chunks
 * 表 (per chunk 向量化, 接 Qdrant).
 */
@Entity('knowledge_items')
@Index('idx_kb_tenant_status', ['tenantId', 'status'])
@Index('idx_kb_tenant_type', ['tenantId', 'type'])
@Index('idx_kb_tenant_author', ['tenantId', 'authorId', 'createdAt'])
@Index('idx_kb_tenant_review', ['tenantId', 'reviewerId'])
@Index('idx_kb_tenant_scheduled', ['tenantId', 'scheduledPublishAt'])
export class KnowledgeItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = uid (一人一租户, migration backfill). V1.x 改 nullable.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'enum', enum: KnowledgeType, name: 'type' })
  type!: KnowledgeType;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  // V0.x 简单: content 整段 JSON (format + body + preview), 跟客户端 7.3 KnowledgeContent 对齐.
  // V1.x 拆 knowledge_chunks 表, per chunk 100-500 字, 向量化进 Qdrant.
  @Column({ type: 'json' })
  content!: { format: 'doc'; body: string; preview: string };

  // V0.x 简单: metadata 整段 JSON, 跟客户端 7.3 KnowledgeMetadata 对齐.
  @Column({ type: 'json' })
  metadata!: { tags: string[]; difficulty: number | null; category: string; personaId: string | null; searchKeywords: string[] };

  @Column({ type: 'enum', enum: KnowledgeStatus, default: KnowledgeStatus.Draft })
  status!: KnowledgeStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'char', length: 36, name: 'author_id' })
  authorId!: string;

  @Column({ type: 'char', length: 36, name: 'reviewer_id', nullable: true })
  reviewerId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'datetime', name: 'published_at', nullable: true })
  publishedAt!: Date | null;

  // 排期发布时间 (Phase 7.7 server side, 5min cron + skip+notify 决策 B+A).
  // V0.x 后端未建时, mock 跟 7.7 client 走 failure 路径.
  @Column({ type: 'datetime', name: 'scheduled_publish_at', nullable: true })
  scheduledPublishAt!: Date | null;
}
