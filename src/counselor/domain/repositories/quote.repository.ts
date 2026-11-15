// V2026-11-15 治本 (TD-21 · C2 第五批仓储端口化 · counselor 域 · P-DEBT-11 / L-1):
//   抽象: `QuoteService` 不再注入 typeorm 的泛型仓储对象, 只依赖本端口
//     interface + `QUOTE_REPOSITORY` DI token —— TypeORM 实现收进
//     `data/quote.repository.typeorm.ts`, 两处可见性查询构造与全部查询口径
//     封在实现里, service 只看到业务语义的方法.
//
//   模板先例: `src/home/domain/repositories/` (TD-20 · 同域双端口按实体划分)
//     + `src/emergency/domain/repositories/emergency-session.repository.ts`
//     (TD-19 · 查询构造下沉实现层) + `src/life-map/domain/repositories/` (TD-16)
//     + `src/consent/domain/repositories/consent.repository.ts` (TD-17)
//     + `src/good_state_diary/domain/repositories/diary-entry.repository.ts` (TD-18)
//     + `src/analytics/domain/repositories/` (TD-13).
//
//   端口划分粒度 (TD-21 判定): **按实体分端口** —— counselor 域本批切两张表,
//     内容库表 (可见性谓词 + keyset 游标 + 上下架判定) 与收藏关系表
//     (幂等 upsert + 硬删 + 行为序列排序) 的口径完全不同, 合一会把两套语义切碎.
//
//   关键方法 (方法面只收 service 现有的 5 处调用形态, 不泛化成通用代理):
//     - findVisiblePool(userId): 今日金句候选池 (可见性谓词 + 发布日倒序)
//     - listVisibleKeyset(userId, anchor, take): 金句流 keyset 游标分页
//     - findAnchorById(id): 游标锚点解析
//     - findById(quoteId): 存在性校验 (上下架 / 软删判定留 service)
//     - findManyByIds(quoteIds): 按 id 集合取行 (我的收藏)
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 操作符 —— 只允许出现在实现文件内
//     - 不写 SQL —— 端口只说「要什么」, 怎么说由实现决定
//     - 不暴露 entity 类 —— 出参用 Row 领域类型, 业务层不碰实体
//
//   **可见性谓词全仓唯一一处**: 共享内容库 user_id IS NULL + 本人自建 user_id = 本人 ——
//     谓词与它的完整理由下沉实现层 (data/quote.repository.typeorm.ts), service 侧
//     不再复写, 避免"两处各改一半"导致他人私有金句泄露.
//
//   **软删口径**: `deletedAt` 是列级 nullable datetime (非 `@DeleteDateColumn`),
//     Row **保留** 该列 —— 存在性校验要看它 (对齐 TD-18 diary 的软删 Row 口径).
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service
//        (test/counselor/td21-counselor-quote-port-c2-batch5.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-15 GMT+8

/**
 * 金句行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * V2026-11-15 治本 (TD-21): **保留 deletedAt 列** —— quotes 表用列级 nullable
 *   datetime 做软删标记 (非 `@DeleteDateColumn`), 存在性校验要看它.
 */
export interface QuoteRow {
  id: string;
  tenantId: string;
  /** 内容库全局共享时为 null; 预留「用户自建金句」扩展位. */
  userId: string | null;
  text: string;
  author: string;
  sourceWork: string | null;
  category: string;
  backgroundUrl: string;
  publishedAt: Date;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** 列级软删标记 (非 `@DeleteDateColumn`). */
  deletedAt: Date | null;
}

/**
 * 游标锚点 —— keyset 分页的推进起点 (取自锚点行的发布日 + id).
 */
export interface QuoteCursorAnchor {
  publishedAt: Date;
  id: string;
}

/**
 * 金句内容库仓储契约 —— counselor 域金句读侧的唯一真相源.
 *
 * 唯一调用方: `QuoteService` (providers/quote.service.ts).
 */
export interface QuoteRepository {
  /**
   * 取可见内容库候选池 (今日金句用).
   *
   * @param userId 当前用户 id (可见性谓词: 共享库 + 本人自建)
   * @returns 行列表 (按发布日倒序)
   */
  findVisiblePool(userId: string): Promise<QuoteRow[]>;

  /**
   * 取可见内容库的一批 (keyset 游标分页).
   *
   * @param userId 当前用户 id (可见性谓词: 共享库 + 本人自建)
   * @param anchor 游标锚点 (null = 首批)
   * @param take 取多少条 (调用方按 n+1 惯用法多取一条)
   * @returns 行列表 (按发布日倒序)
   */
  listVisibleKeyset(userId: string, anchor: QuoteCursorAnchor | null, take: number): Promise<QuoteRow[]>;

  /**
   * 按 id 取游标锚点行.
   *
   * @param id 金句 id (游标值)
   * @returns 行 (未命中返 null)
   */
  findAnchorById(id: string): Promise<QuoteRow | null>;

  /**
   * 按 id 取行 (存在性校验用) —— 上下架 / 软删判定留 service.
   *
   * @param quoteId 金句 id
   * @returns 行 (未命中返 null)
   */
  findById(quoteId: string): Promise<QuoteRow | null>;

  /**
   * 按 id 集合取行.
   *
   * @param quoteIds 金句 id 集合
   * @returns 行列表
   */
  findManyByIds(quoteIds: string[]): Promise<QuoteRow[]>;
}

/** DI token —— NestJS 注入用. */
export const QUOTE_REPOSITORY = Symbol('QUOTE_REPOSITORY');
