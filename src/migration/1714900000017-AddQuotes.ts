// V2026-10-22 治本 (首页金句 · 每日一句 — quotes + user_quote_favorites 2 张新表):
//   原因: `xin_su_app/docs/product/home-quote-backend-api.md` §2 要求后端提供
//     今日金句 / 金句流 / 收藏三组端点, 而 §1 说「内容来自前端 localQuotes 种子,
//     远端就绪后只换数据源」—— 内容所有权从客户端迁到服务端, 必然要落库.
//
//   设计 (跟 1714900000016-AddPracticeCustomScenarios V1.3 §7 风格一致):
//     - quotes: 1 张表, 11 列 (id + 7 字段 + created_at/updated_at/deleted_at)
//       + 2 索引 (PRIMARY + idx_q_published)
//     - user_quote_favorites: 1 张表, 5 列 + 3 索引
//       (PRIMARY + UNIQUE (user_id, quote_id) + (user_id, created_at))
//     - 全部软删 (deleted_at) + tenant_id + user_id (跟 V1.2 D13 一致)
//     - 无 DB-level FK (跟 ADR-0003 一致, 跨表引用应用层校验)
//     - **内容不进 migration**: 金句是持续演进的内容, 走独立脚本
//       bin/seed-quotes.ts 按稳定 id 幂等 upsert
//
//   反双胞胎:
//     - 不加 like_count / favorite_count / view_count 列: spec §2.3 + §4 的零压红线
//       「不下发、不展示全站 likeCount」. 列都不存在 = 物理上不可能下发.
//     - quotes.id 用 VARCHAR(64) 而非项目默认的 CHAR(36) UUID: 金句 id 同时是
//       spec §2.2 的游标值与 §2.3 的收藏路径参数, 必须是**内容方可复现的稳定 slug**
//       (q_YYYYMMDD_<slug>), 否则运营/知识库侧无法做幂等同步.
//     - user_quote_favorites 走**硬删** (无 deleted_at): UNIQUE (user_id, quote_id)
//       不含 deleted_at, 软删会让"取消收藏后再收藏同一句"撞唯一键.
//       本表因此与项目其他软删表**故意不同** —— 收藏是可再生的个人标记, 留痕价值低,
//       而"可再收藏"是硬需求.
//     - 不用 MySQL ENUM 列类型: 跟项目既有 pattern 一致 (varchar + 应用层校验);
//       category 是开放集合 (领域标签会随内容扩展), 更不该用 ENUM
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'quotes'; # 1 张表
//     2. SHOW TABLES LIKE 'user_quote_favorites'; # 1 张表
//     3. SHOW INDEX FROM quotes; # 2 索引
//     4. SHOW INDEX FROM user_quote_favorites; # 3 索引
//     5. DESCRIBE user_quote_favorites; # 5 列 (无 deleted_at, 硬删表)
//     6. 全表 grep 'like_count\|favorite_count' 列名命中数 = 0 (零压红线物理校验)
//
//   时间戳: 2026-10-22
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuotes1714900000017 implements MigrationInterface {
  name = 'AddQuotes1714900000017';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── quotes (首页金句内容库, 11 列 + 2 索引) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NULL,
        text TEXT NOT NULL,
        author VARCHAR(100) NOT NULL,
        source_work VARCHAR(200) NULL,
        category VARCHAR(50) NOT NULL,
        background_url VARCHAR(500) NOT NULL,
        published_at DATETIME(6) NOT NULL,
        enabled TINYINT NOT NULL DEFAULT 1,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at DATETIME(6) NULL,
        INDEX idx_q_published (published_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ─── user_quote_favorites (收藏关系, 5 列 + 3 索引; 硬删表) ───
    await qr.query(`
      CREATE TABLE IF NOT EXISTS user_quote_favorites (
        id CHAR(36) NOT NULL PRIMARY KEY,
        tenant_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        quote_id VARCHAR(64) NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE KEY uniq_uqf_user_quote (user_id, quote_id),
        INDEX idx_uqf_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // 反向: 先删从表再删主表 (无 FK, 但保持语义顺序, 便于人工回滚时阅读).
    await qr.query(`DROP TABLE IF EXISTS user_quote_favorites;`);
    await qr.query(`DROP TABLE IF EXISTS quotes;`);
  }
}
