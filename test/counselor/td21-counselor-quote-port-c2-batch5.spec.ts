// V2026-11-15 治本 (TD-21 · C2 第五批仓储端口化 · counselor 域 · P-DEBT-11 / L-1):
//   端口替身 spec —— `QuoteService` 用**端口替身**驱动: 不起真数据源, 不连 DB,
//   不 mock 持久化库. 替身只记调用参数 + 返回预设行.
//
//   覆盖:
//     ① 今日金句 (A1-A4): 可见池查询 / 库为空抛 QuoteLibraryEmpty /
//        「本地自然日序号 % 池大小」取模定位留 service / 收藏状态回填;
//     ② 金句流 (B1-B6): 游标锚点解析 + keyset 推进 / 游标失效抛 QuoteCursorInvalid /
//        limit+1 多取一条 + hasMore 切片 + nextCursor 组装留 service;
//     ③ 收藏 (C1-C4): 存在性校验 (上下架 / 软删) / upsert 幂等 / 取消收藏硬删且不校验;
//     ④ 我的收藏 (D1-D3): 行为序列排序 / 下架跳过 / 空集合;
//     ⑤ DTO 与行为锁 (E1-E4): 出参形状 / 方法面不泛化 / 异常上抛 / 空 id 集合短路.
//
//   时间口径: 本 spec 不依赖任何定时器 —— 回显时刻由替身按**固定常量**给出,
//     「今日取模」用调用前后两次 quoteDayIndexOf 的并集断言 (跨本地午夜也不误判).
//
//   替身写法: 直接实现端口 interface (跟 TD-13 analytics / TD-16 life-map / TD-17 consent /
//     TD-18 good_state_diary / TD-19 emergency / TD-20 home 同款口径).
//   边界: **零** entity import、零 typeorm 值符号; 实体类名不出现在本文件.
//
//   分工: 本 spec 锁**端口契约** (调用面 / 参数 / 出参形状); 业务行为 (取模定位 /
//     keyset 推进 / 上下架判定 / 收藏顺序 / DTO 转换) 由本文件一并锁住
//     (本域零既有 service spec, 业务行为无别处可锁).
//
//   验证: pnpm exec vitest run test/counselor/td21-counselor-quote-port-c2-batch5.spec.ts
//   时间戳: 2026-11-15 GMT+8

import { describe, expect, it } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { QUOTE_LIST_DEFAULT_LIMIT, quoteDayIndexOf } from '../../src/counselor/config/quote-seeds.js';
import {
  QUOTE_FAVORITE_REPOSITORY,
  type FavoriteRow,
  type QuoteFavoriteRepository,
} from '../../src/counselor/domain/repositories/quote-favorite.repository.js';
import {
  QUOTE_REPOSITORY,
  type QuoteCursorAnchor,
  type QuoteRepository,
  type QuoteRow,
} from '../../src/counselor/domain/repositories/quote.repository.js';
import { QuoteService } from '../../src/counselor/providers/quote.service.js';

/** 固定的「落库时刻」 —— 替身回显用, 不随真实时钟漂移. */
const PUBLISHED_AT = new Date('2026-10-22T00:00:00.000Z');

/** 固定的自建时刻 —— 替身回显用. */
const CREATED_AT = new Date('2026-10-22T01:02:03.000Z');

// ═════════════════════════════════════════════════════════════
// 行构造器
// ═════════════════════════════════════════════════════════════

/** 金句行 (可覆盖). */
function quoteRow(overrides: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: 'q_20261022_xinshu_slow_down',
    tenantId: 'tenant-1',
    userId: null,
    text: '慢慢来，先站稳自己，再理解他人。',
    author: '心塑',
    sourceWork: null,
    category: '自我接纳',
    backgroundUrl: 'https://cdn.xinsu.app/quote/quote_starry_mountain.jpg',
    publishedAt: PUBLISHED_AT,
    enabled: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  };
}

/** 收藏关系行 (可覆盖). */
function favoriteRow(overrides: Partial<FavoriteRow> = {}): FavoriteRow {
  return {
    id: 'fav-1',
    tenantId: 'tenant-1',
    userId: 'uid-1',
    quoteId: 'q_20261022_xinshu_slow_down',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════
// 端口替身
// ═════════════════════════════════════════════════════════════

/** 金句内容库端口替身 —— 只记调用参数 + 返回预设行. */
class QuoteRepoDouble {
  readonly findVisiblePoolCalls: string[] = [];
  readonly listVisibleKeysetCalls: { userId: string; anchor: QuoteCursorAnchor | null; take: number }[] = [];
  readonly findAnchorByIdCalls: string[] = [];
  readonly findByIdCalls: string[] = [];
  readonly findManyByIdsCalls: string[][] = [];

  /** 可见池返回行. */
  visiblePool: QuoteRow[] = [];
  /** keyset 查询返回行. */
  keysetRows: QuoteRow[] = [];
  /** 游标锚点行 (null = 未命中). */
  anchor: QuoteRow | null = null;
  /** 按 id 取行结果 (null = 未命中). */
  found: QuoteRow | null = null;
  /** 按 id 集合取行结果. */
  manyRows: QuoteRow[] = [];
  /** 注入给读取的失败 (测失败语义; null = 正常). */
  failure: Error | null = null;

  readonly repo: QuoteRepository;

  constructor() {
    this.repo = {
      findVisiblePool: async (userId: string): Promise<QuoteRow[]> => {
        this.findVisiblePoolCalls.push(userId);
        if (this.failure) {
          throw this.failure;
        }
        return this.visiblePool;
      },
      listVisibleKeyset: async (userId: string, anchor: QuoteCursorAnchor | null, take: number): Promise<QuoteRow[]> => {
        this.listVisibleKeysetCalls.push({ userId, anchor, take });
        if (this.failure) {
          throw this.failure;
        }
        return this.keysetRows;
      },
      findAnchorById: async (id: string): Promise<QuoteRow | null> => {
        this.findAnchorByIdCalls.push(id);
        if (this.failure) {
          throw this.failure;
        }
        return this.anchor;
      },
      findById: async (quoteId: string): Promise<QuoteRow | null> => {
        this.findByIdCalls.push(quoteId);
        if (this.failure) {
          throw this.failure;
        }
        return this.found;
      },
      findManyByIds: async (quoteIds: string[]): Promise<QuoteRow[]> => {
        this.findManyByIdsCalls.push(quoteIds);
        if (this.failure) {
          throw this.failure;
        }
        return this.manyRows;
      },
    };
  }
}

/** 收藏关系端口替身 —— 只记调用参数 + 返回预设行. */
class FavoriteRepoDouble {
  readonly upsertCalls: { userId: string; quoteId: string; tenantId: string }[] = [];
  readonly deleteCalls: { userId: string; quoteId: string }[] = [];
  readonly findByUserCalls: string[] = [];
  readonly findQuoteIdsCalls: { userId: string; quoteIds: string[] }[] = [];

  /** 收藏关系返回行. */
  favorites: FavoriteRow[] = [];
  /** 已收藏 id 返回值. */
  favoritedIds: string[] = [];
  /** 注入给写入的失败 (测失败语义; null = 正常). */
  failure: Error | null = null;

  readonly repo: QuoteFavoriteRepository;

  constructor() {
    this.repo = {
      upsert: async (userId: string, quoteId: string, tenantId: string): Promise<void> => {
        this.upsertCalls.push({ userId, quoteId, tenantId });
        if (this.failure) {
          throw this.failure;
        }
      },
      deleteByUserAndQuote: async (userId: string, quoteId: string): Promise<void> => {
        this.deleteCalls.push({ userId, quoteId });
        if (this.failure) {
          throw this.failure;
        }
      },
      findFavoritesByUser: async (userId: string): Promise<FavoriteRow[]> => {
        this.findByUserCalls.push(userId);
        if (this.failure) {
          throw this.failure;
        }
        return this.favorites;
      },
      findFavoriteQuoteIds: async (userId: string, quoteIds: string[]): Promise<string[]> => {
        this.findQuoteIdsCalls.push({ userId, quoteIds });
        if (this.failure) {
          throw this.failure;
        }
        return this.favoritedIds;
      },
    };
  }
}

/** 装配 service + 两个端口替身. */
function makeService(): { service: QuoteService; quotes: QuoteRepoDouble; favorites: FavoriteRepoDouble } {
  const quotes = new QuoteRepoDouble();
  const favorites = new FavoriteRepoDouble();
  return { service: new QuoteService(quotes.repo, favorites.repo), quotes, favorites };
}

// ═════════════════════════════════════════════════════════════
// ① 今日金句
// ═════════════════════════════════════════════════════════════

describe('QuoteService · 端口替身 · 今日金句 (TD-21 C2 第五批)', () => {
  it('A1 · getToday —— 可见池查询收 uid, 端口只返回排序后的池', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.visiblePool = [quoteRow({ id: 'q-1' })];
    favorites.favoritedIds = [];

    await service.getToday('uid-1');

    expect(quotes.findVisiblePoolCalls).toHaveLength(1);
    expect(quotes.findVisiblePoolCalls[0]).toBe('uid-1');
  });

  it('A2 · getToday 库为空 —— 抛 QuoteLibraryEmpty (前端回退本地种子)', async () => {
    const { service, quotes } = makeService();
    quotes.visiblePool = [];

    await expect(service.getToday('uid-1')).rejects.toThrow(BizException);
    await expect(service.getToday('uid-1')).rejects.toMatchObject({ code: BizCode.QuoteLibraryEmpty });
  });

  it('A3 · getToday 取模定位 —— 命中「本地自然日序号 % 池大小」位 (轮换逻辑留 service)', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.visiblePool = [quoteRow({ id: 'q-0' }), quoteRow({ id: 'q-1' }), quoteRow({ id: 'q-2' })];
    favorites.favoritedIds = [];

    const before = quoteDayIndexOf(new Date());
    const result = await service.getToday('uid-1');
    const after = quoteDayIndexOf(new Date());

    const candidates = new Set([quotes.visiblePool[before % 3]?.id, quotes.visiblePool[after % 3]?.id]);
    expect(candidates.has(result.id)).toBe(true);
  });

  it('A4 · getToday 收藏状态 —— 由收藏端口回填 (本人已收藏 → true)', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.visiblePool = [quoteRow({ id: 'q-1' })];
    favorites.favoritedIds = ['q-1'];

    const result = await service.getToday('uid-1');

    expect(favorites.findQuoteIdsCalls).toHaveLength(1);
    expect(favorites.findQuoteIdsCalls[0]?.quoteIds).toEqual(['q-1']);
    expect(result.favorited).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// ② 金句流 (keyset 游标分页)
// ═════════════════════════════════════════════════════════════

describe('QuoteService · 端口替身 · 金句流 (TD-21 C2 第五批)', () => {
  it('B1 · list 无游标 —— anchor 传 null, take = 默认条数 + 1 (n+1 惯用法)', async () => {
    const { service, quotes } = makeService();
    quotes.keysetRows = [];

    await service.list('uid-1', {});

    expect(quotes.listVisibleKeysetCalls).toHaveLength(1);
    expect(quotes.listVisibleKeysetCalls[0]?.anchor).toBeNull();
    expect(quotes.listVisibleKeysetCalls[0]?.take).toBe(QUOTE_LIST_DEFAULT_LIMIT + 1);
    expect(quotes.findAnchorByIdCalls).toHaveLength(0);
  });

  it('B2 · list 有游标 —— 先解析锚点行, anchor = (publishedAt, id)', async () => {
    const { service, quotes } = makeService();
    quotes.anchor = quoteRow({ id: 'q-anchor', publishedAt: PUBLISHED_AT });
    quotes.keysetRows = [];

    await service.list('uid-1', { cursor: 'q-anchor' });

    expect(quotes.findAnchorByIdCalls).toEqual(['q-anchor']);
    expect(quotes.listVisibleKeysetCalls[0]?.anchor).toEqual({ publishedAt: PUBLISHED_AT, id: 'q-anchor' });
  });

  it('B3 · list 游标未命中 —— 抛 QuoteCursorInvalid 且**不查 feed** (不静默从头返回)', async () => {
    const { service, quotes } = makeService();
    quotes.anchor = null;

    await expect(service.list('uid-1', { cursor: 'q-missing' })).rejects.toMatchObject({
      code: BizCode.QuoteCursorInvalid,
    });
    expect(quotes.listVisibleKeysetCalls).toHaveLength(0);
  });

  it('B4 · list limit+1 切片 —— 多取一条判 hasMore, items 截断 + nextCursor 取末条 id', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.keysetRows = [quoteRow({ id: 'q-1' }), quoteRow({ id: 'q-2' }), quoteRow({ id: 'q-3' })];
    favorites.favoritedIds = [];

    const page = await service.list('uid-1', { limit: 2 });

    expect(quotes.listVisibleKeysetCalls[0]?.take).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.id)).toEqual(['q-1', 'q-2']);
    expect(page.nextCursor).toBe('q-2');
  });

  it('B5 · list 末页 —— 无多取的一条 → nextCursor = null', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.keysetRows = [quoteRow({ id: 'q-1' }), quoteRow({ id: 'q-2' })];
    favorites.favoritedIds = [];

    const page = await service.list('uid-1', { limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('B6 · list 显式 limit —— take = limit + 1', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.keysetRows = [];
    favorites.favoritedIds = [];

    await service.list('uid-1', { limit: 5 });

    expect(quotes.listVisibleKeysetCalls[0]?.take).toBe(6);
  });
});

// ═════════════════════════════════════════════════════════════
// ③ 收藏
// ═════════════════════════════════════════════════════════════

describe('QuoteService · 端口替身 · 收藏 (TD-21 C2 第五批)', () => {
  it('C1 · favorite —— 先校验存在, 再幂等 upsert (tenantId = userId)', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.found = quoteRow({ id: 'q-1' });

    const result = await service.favorite('uid-1', 'q-1');

    expect(quotes.findByIdCalls).toEqual(['q-1']);
    expect(favorites.upsertCalls).toEqual([{ userId: 'uid-1', quoteId: 'q-1', tenantId: 'uid-1' }]);
    expect(result).toEqual({ quoteId: 'q-1', favorited: true });
  });

  it('C2 · favorite 金句不存在 —— 抛 QuoteNotFound 且**不写收藏**', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.found = null;

    await expect(service.favorite('uid-1', 'q-missing')).rejects.toMatchObject({ code: BizCode.QuoteNotFound });
    expect(favorites.upsertCalls).toHaveLength(0);
  });

  it('C3 · favorite 金句已下架 / 已软删 —— 同样抛 QuoteNotFound', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.found = quoteRow({ id: 'q-1', enabled: false });

    await expect(service.favorite('uid-1', 'q-1')).rejects.toMatchObject({ code: BizCode.QuoteNotFound });
    quotes.found = quoteRow({ id: 'q-1', deletedAt: new Date('2026-10-22T00:00:00.000Z') });

    await expect(service.favorite('uid-1', 'q-1')).rejects.toMatchObject({ code: BizCode.QuoteNotFound });
    expect(favorites.upsertCalls).toHaveLength(0);
  });

  it('C4 · unfavorite —— 硬删且**刻意不校验金句存在** (清收藏永远应该成功)', async () => {
    const { service, quotes, favorites } = makeService();

    const result = await service.unfavorite('uid-1', 'q-1');

    expect(favorites.deleteCalls).toEqual([{ userId: 'uid-1', quoteId: 'q-1' }]);
    expect(quotes.findByIdCalls).toHaveLength(0);
    expect(result).toEqual({ quoteId: 'q-1', favorited: false });
  });
});

// ═════════════════════════════════════════════════════════════
// ④ 我的收藏
// ═════════════════════════════════════════════════════════════

describe('QuoteService · 端口替身 · 我的收藏 (TD-21 C2 第五批)', () => {
  it('D1 · listFavorites —— 按收藏顺序输出 (行为序列), 收藏态恒为 true', async () => {
    const { service, quotes, favorites } = makeService();
    favorites.favorites = [favoriteRow({ id: 'fav-2', quoteId: 'q-2' }), favoriteRow({ id: 'fav-1', quoteId: 'q-1' })];
    quotes.manyRows = [quoteRow({ id: 'q-1' }), quoteRow({ id: 'q-2' })];

    const result = await service.listFavorites('uid-1');

    expect(favorites.findByUserCalls).toEqual(['uid-1']);
    expect(quotes.findManyByIdsCalls[0]).toEqual(['q-2', 'q-1']);
    expect(result.items.map((item) => item.id)).toEqual(['q-2', 'q-1']);
    expect(result.items.every((item) => item.favorited)).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it('D2 · listFavorites —— 金句已下架 / 已删除的收藏项跳过', async () => {
    const { service, quotes, favorites } = makeService();
    favorites.favorites = [favoriteRow({ id: 'fav-gone', quoteId: 'q-gone' }), favoriteRow({ id: 'fav-1', quoteId: 'q-1' })];
    quotes.manyRows = [quoteRow({ id: 'q-1' })];

    const result = await service.listFavorites('uid-1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('q-1');
  });

  it('D3 · listFavorites 空 —— 直接返回空列表, 不查金句表', async () => {
    const { service, quotes, favorites } = makeService();
    favorites.favorites = [];

    const result = await service.listFavorites('uid-1');

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(quotes.findManyByIdsCalls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════
// ⑤ DTO 与行为锁
// ═════════════════════════════════════════════════════════════

describe('QuoteService · 端口替身 · DTO 与行为锁 (TD-21 C2 第五批)', () => {
  it('E1 · DTO 转换 —— publishedAt 转 ISO, 出参字段逐字 (零压: 无任何计数字段)', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.visiblePool = [quoteRow({ id: 'q-1' })];
    favorites.favoritedIds = [];

    const result = await service.getToday('uid-1');

    expect(result).toEqual({
      id: 'q-1',
      text: '慢慢来，先站稳自己，再理解他人。',
      author: '心塑',
      category: '自我接纳',
      backgroundUrl: 'https://cdn.xinsu.app/quote/quote_starry_mountain.jpg',
      publishedAt: '2026-10-22T00:00:00.000Z',
      sourceWork: null,
      favorited: false,
    });
    expect(Object.keys(result)).not.toContain('likeCount');
    expect(Object.keys(result)).not.toContain('favoriteCount');
  });

  it('E2 · 方法面不泛化 —— 金句端口恰 5 个 / 收藏端口恰 4 个, 无通用仓储代理', () => {
    const { quotes, favorites } = makeService();

    expect(Object.keys(quotes.repo).sort()).toEqual([
      'findAnchorById',
      'findById',
      'findManyByIds',
      'findVisiblePool',
      'listVisibleKeyset',
    ]);
    expect(Object.keys(favorites.repo).sort()).toEqual(['deleteByUserAndQuote', 'findFavoriteQuoteIds', 'findFavoritesByUser', 'upsert']);
    expect(typeof QUOTE_REPOSITORY).toBe('symbol');
    expect(QUOTE_REPOSITORY.description).toBe('QUOTE_REPOSITORY');
    expect(typeof QUOTE_FAVORITE_REPOSITORY).toBe('symbol');
    expect(QUOTE_FAVORITE_REPOSITORY.description).toBe('QUOTE_FAVORITE_REPOSITORY');
  });

  it('E3 · 读取失败时的现有语义 —— 异常上抛 (行为锁)', async () => {
    const { service, quotes } = makeService();
    quotes.failure = new Error('db down');

    await expect(service.getToday('uid-1')).rejects.toThrow('db down');
  });

  it('E4 · 空 id 集合 —— 收藏状态查询短路, 不打收藏端口 (零 N+1)', async () => {
    const { service, quotes, favorites } = makeService();
    quotes.keysetRows = [];

    await service.list('uid-1', { limit: 5 });

    expect(favorites.findQuoteIdsCalls).toHaveLength(0);
  });
});
