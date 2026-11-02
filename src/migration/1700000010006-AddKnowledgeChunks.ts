// V2026-10-14 治本 (VS-3c — knowledge_chunks 表 + vector 索引):
//   原因: V0.x 知识库全文搜索走 LIKE %q% (search.service.ts), spec §12.4 / §13.4
//     说"V0.5 简化 LIKE, V1.x 升级 FULLTEXT / Qdrant hybrid". VS-3b plan B 改走
//     OpenAI 兼容 4 provider embedding + Qdrant 1.x (不建 bge 自托管 TEI).
//     VS-3c 治本: knowledge_items 1:N knowledge_chunks, per chunk 100-500 字,
//     V0.x 用 chunk_index 顺序拼接, V1.x 接 Qdrant hybrid (vector + BM25).
//
//   设计 (跟 life-map/ 1700000010004-AddGenomeDimensions 同 pattern):
//     - chunks: 1:N knowledge_items (chunk_id 是 own PK, itemId 是 FK 索引)
//     - UNIQUE (item_id, chunk_index): 一篇文章一序号, upsert 幂等
//     - content 100-500 字 (跟 bge-small 512 tokens 匹配, 不超 embedding 限制)
//     - vector_id: Qdrant point id 同步 (后续 Qdrant upsert 用, V0.x nullable)
//     - token_count: V1.x 升级 FULLTEXT 时用, V0.x 简单
//     - 软删 (deleted_at) 跟 V3 其他模块一致
//
//   反双胞胎:
//     - 不加 FK (item_id → knowledge_items.id): 软删兼容, 应用层校验
//     - 不在 chunks 表存 vector 字段: vector 存在 Qdrant (跟 snapshot / metadata json
//       字段同 pattern, 内容存 Qdrant, MySQL 存元数据 + 关系, 单一真相源原则)
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'knowledge_chunks';  # 存在
//     2. SHOW INDEX FROM knowledge_chunks;     # 3 索引 (PRIMARY + idx_kc_item_index + idx_kc_tenant_item)
//     3. DESCRIBE knowledge_chunks;             # 7 列 + id
//     4. SELECT * FROM knowledge_chunks LIMIT 0;  # 空表
//
//   时间戳: 2026-10-14 15:06.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledgeChunks1700000010006 implements MigrationInterface {
  name = 'AddKnowledgeChunks1700000010006';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        item_id CHAR(36) NOT NULL,
        chunk_index INT NOT NULL,
        content VARCHAR(2000) NOT NULL,
        token_count INT NULL,
        vector_id VARCHAR(64) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        UNIQUE INDEX uniq_kc_item_index (item_id, chunk_index),
        INDEX idx_kc_tenant_item (tenant_id, item_id),
        INDEX idx_kc_vector_id (vector_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS knowledge_chunks;`);
  }
}
