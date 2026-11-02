// V2026-10-14 治本 (VS-3c — knowledge_chunks entity):
//   原因: V0.x knowledge_items.content 是 json 字段 (整段), spec §12.4 / §13.4
//     说"V0.5 简化 LIKE, V1.x 升级 FULLTEXT / Qdrant hybrid". VS-3b 装 Qdrant + OpenAI
//     兼容 embedding, VS-3c 治本: knowledge_items 1:N knowledge_chunks, per chunk
//     100-500 字, Qdrant point id 同步 (vector_id).
//
//   大厂 spec (跟 user.entity.ts / knowledge-item.entity.ts 同 pattern):
//     - UUID PK + char(36) id 风格
//     - UNIQUE (itemId, chunkIndex) 覆盖 upsert 幂等
//     - content VARCHAR(2000) 跟 bge-small 512 tokens 匹配 (V1.x OpenAI 兼容 1024 维
//       也支持 8K tokens, VARCHAR(2000) 足够 99% KB 场景)
//     - vectorId: Qdrant point id 同步 (V0.x 不用, 留 V1.x 写真)
//     - 软删 (deletedAt) 跟 V3 其他模块一致
//
//   反双胞胎:
//     - 不存 vector 字段: vector 存 Qdrant, chunks 表只存元数据 + 内容 (跟 snapshot /
//       metadata json 字段同 pattern, 内容存 Qdrant, MySQL 存元数据 + 关系)
//     - 不加 FK (itemId → knowledge_items.id): 软删兼容, 应用层校验
//     - 不重 fields (跟 knowledge-items content.json 字段互斥, 治本 = 拆出去)

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * knowledge_chunks 表.
 *
 * 跟客户端 7.2 KnowledgeListBloc 行为对齐: 搜索走 chunk 召回 (V0.x Qdrant 走向量,
 * V1.x hybrid vector + BM25).
 */
@Entity('knowledge_chunks')
@Index('uniq_kc_item_index', ['itemId', 'chunkIndex'], { unique: true })
@Index('idx_kc_tenant_item', ['tenantId', 'itemId'])
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = uid (一人一租户, migration backfill). V1.x 改 nullable.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'item_id' })
  itemId!: string;

  // V0.x: 0-based 序号, content 自动按 chunkIndex 顺序拼接. V1.x 升级 Qdrant hybrid 时保留.
  @Column({ type: 'int', name: 'chunk_index' })
  chunkIndex!: number;

  // V0.x: VARCHAR(2000) 限制 (跟 bge-small 512 tokens + OpenAI 兼容 8K tokens 兼容).
  // V1.x 升级 FULLTEXT 时可改 TEXT 类型.
  @Column({ type: 'varchar', length: 2000 })
  content!: string;

  // V0.x: nullable, 后续 ingest 时调 OpenAI 兼容 embedding service 算. V1.x 必填.
  @Column({ type: 'int', name: 'token_count', nullable: true })
  tokenCount!: number | null;

  // V0.x: Qdrant point id 同步, nullable (V0.x Qdrant 还没装, VS-3b 装后 V0.x 还是
  // nullable, 真正 V1.x 写时填). V1.x: UPSERT Qdrant 时填, 删 article 时一起删.
  @Column({ type: 'varchar', length: 64, name: 'vector_id', nullable: true })
  vectorId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删, 跟 V3 其他模块一致. V0.x 简单 (无 TTL), V1.x 加 GC cron.
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
