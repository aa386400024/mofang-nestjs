// V2026-11-15 治本 (TD-21 · C2 第五批仓储端口化 · counselor 域 · P-DEBT-11 / L-1):
//   抽象: `QuoteService` 对收藏关系表的直连仓储改为本端口
//     interface + `QUOTE_FAVORITE_REPOSITORY` DI token —— TypeORM 实现收进
//     `data/quote-favorite.repository.typeorm.ts`, 幂等 upsert 的冲突键 /
//     硬删 / 行为序列排序口径全封在实现里.
//
//   模板先例: `src/home/domain/repositories/` (TD-20 · 同域双端口按实体划分)
//     + `src/emergency/domain/repositories/emergency-session.repository.ts` (TD-19)
//     + `src/life-map/domain/repositories/` (TD-16) +
//     `src/consent/domain/repositories/consent.repository.ts` (TD-17) +
//     `src/good_state_diary/domain/repositories/diary-entry.repository.ts` (TD-18) +
//     `src/analytics/domain/repositories/` (TD-13).
//
//   端口划分粒度 (TD-21 判定): **按实体分端口** —— 收藏关系表与内容库表口径完全不同.
//
//   关键方法 (方法面只收 service 现有的 4 处调用形态, 不泛化成通用代理):
//     - upsert(userId, quoteId, tenantId): 幂等收藏 (冲突键 userId + quoteId)
//     - deleteByUserAndQuote(userId, quoteId): 取消收藏 (硬删)
//     - findFavoritesByUser(userId): 列收藏关系 (createdAt 倒序 = 行为序列)
//     - findFavoriteQuoteIds(userId, quoteIds): 取给定金句集合里的已收藏 id
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 操作符 —— 只允许出现在实现文件内
//     - 不暴露 entity 类 —— 出参用 Row 领域类型, 业务层不碰实体
//
//   **硬删口径 (与内容库表相反)**: 收藏关系表**没有** deletedAt 列 —— 取消收藏走硬删.
//     理由 (entity 注释已固化): 软删 + UNIQUE(user_id, quote_id) 会让「取消后再收藏」
//     撞唯一键 (MySQL 唯一索引不含 deleted_at) —— 故本表**故意**走硬删.
//     本端口的 FavoriteRow 因此**不含** deletedAt 字段, 也不得把它写成软删表.
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service
//        (test/counselor/td21-counselor-quote-port-c2-batch5.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-15 GMT+8

/**
 * 收藏关系行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * V2026-11-15 治本 (TD-21): **不含 deletedAt 列** —— 本表走硬删, 见文件头说明.
 */
export interface FavoriteRow {
  id: string;
  tenantId: string;
  userId: string;
  quoteId: string;
  createdAt: Date;
}

/**
 * 收藏关系仓储契约 —— counselor 域收藏写入侧的唯一真相源.
 *
 * 唯一调用方: `QuoteService` (providers/quote.service.ts).
 */
export interface QuoteFavoriteRepository {
  /**
   * 幂等收藏 —— 冲突键 (userId + quoteId) 命中时为 no-op.
   *
   * @param userId 当前用户 id
   * @param quoteId 金句 id
   * @param tenantId 租户 id (一人一租户: 与 userId 同值)
   */
  upsert(userId: string, quoteId: string, tenantId: string): Promise<void>;

  /**
   * 取消收藏 (硬删) —— 删不存在的收藏是 no-op.
   *
   * @param userId 当前用户 id
   * @param quoteId 金句 id
   */
  deleteByUserAndQuote(userId: string, quoteId: string): Promise<void>;

  /**
   * 列某人的收藏关系 (最近收藏的在前).
   *
   * @param userId 当前用户 id
   * @returns 收藏关系行列表
   */
  findFavoritesByUser(userId: string): Promise<FavoriteRow[]>;

  /**
   * 取给定金句集合里本人已收藏的 id.
   *
   * @param userId 当前用户 id
   * @param quoteIds 金句 id 集合
   * @returns 已收藏的金句 id 列表
   */
  findFavoriteQuoteIds(userId: string, quoteIds: string[]): Promise<string[]>;
}

/** DI token —— NestJS 注入用. */
export const QUOTE_FAVORITE_REPOSITORY = Symbol('QUOTE_FAVORITE_REPOSITORY');
