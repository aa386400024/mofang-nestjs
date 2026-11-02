// V2026-10-22 治本 (首页金句 · 每日一句 — 读侧 + 收藏 service):
//   原因: `xin_su_app/docs/product/home-quote-backend-api.md` §2 定义了 3 组端点
//     (今日金句 / 金句流游标分页 / 收藏开关), 它们的共同难点与 practice 引擎同源:
//       ① **"今日"怎么算** —— 要同一天内恒定 (用户刷新不能换一句), 跨天自动轮换
//       ② **游标分页** —— 沉浸页左右滑动要能一直往下翻, 且中途来了新内容不能漏条/重条
//       ③ **收藏的可见性** —— 只对本人可见, 且绝不能带出任何他人信息
//
//   修法:
//     - 今日金句: 对**内容库**按 (published_at DESC, id DESC) 排序取池,
//       用"本地自然日序号 % 池大小"定位 —— 同一天恒定, 跨天自动换一句,
//       且永远有内容 (库非空即可), 不会像"排期制"那样过了日期就断更.
//       口径与前端本地 `quoteOfTheDay()` 一致 (都是"按天轮换"), 前端切远端后
//       行为不变, 只是池子换成了服务端内容库.
//     - 金句流: **keyset 游标分页** (按 (published_at, id) 游标推进), 不用 OFFSET ——
//       OFFSET 在滑动过程中有新内容插入时会漏条/重条; keyset 不会.
//     - 收藏: 单表 (user_id, quote_id) 关系, 无任何计数字段.
//
//   反双胞胎:
//     - 不下发任何计数: 出参 DTO 里没有 likeCount / favoriteCount —— spec §2.3/§4
//       的零压红线「不下发、不展示全站 likeCount」. 有计数就有排行榜, 排行榜会把
//       情绪陪伴位变成攀比位.
//     - 不用 "全站最热" 之类的排序维度: 金句流只按发布日排序, 不掺任何热度信号.
//     - 不用 OFFSET 分页: 见上
//     - 不把 "今日" 做成"随机": 随机会让用户每次打开看到不同的一句, 失去"每日一句"
//       的仪式感, 也让"今天这句是什么"无法被讨论
//     - 不把收藏做成软删: 软删 + UNIQUE(user_id, quote_id) 会让"取消后再收藏"撞唯一键
//       (MySQL 唯一索引不含 deleted_at) —— 本表因此**故意**走硬删, 见 entity 注释.
//
//   验证:
//     1. tsc 0 错
//     2. 同一天连续调 /quotes/today 多次 → 同一句 (恒定)
//     3. /quotes 翻页: cursor 传 nextCursor → 无重复无遗漏; 末页 nextCursor = null
//     4. 收藏 → 再收藏 → 仍只有 1 行; 取消 → 再收藏 → 成功
//     5. A 用户收藏的句子, B 用户查询时 favorited=false, 且看不到 A 的任何信息
//     6. 内容库为空 → /quotes/today 返回 404 (前端回退本地种子, 不白屏)
//
//   时间戳: 2026-10-22
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { QUOTE_LIST_DEFAULT_LIMIT, quoteDayIndexOf } from '../config/quote-seeds';
import type { QuoteDto, QuoteFavoriteResultDto, QuoteListDto, QuoteQueryDto } from '../dto/quote.dto';
import { Quote } from '../entities/quote.entity';
import { UserQuoteFavorite } from '../entities/user-quote-favorite.entity';

/**
 * 首页金句 service.
 */
@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);

  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepo: Repository<Quote>,
    @InjectRepository(UserQuoteFavorite)
    private readonly favoriteRepo: Repository<UserQuoteFavorite>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════
  // §2.1 GET /counselor/quotes/today
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 取今日金句.
   *
   * 定位方式: 内容库按 (published_at DESC, id DESC) 排序成池, 取
   * `本地自然日序号 % 池大小` 位. 语义:
   *   - 同一天内**恒定** (所有人、多次刷新都是同一句)
   *   - 跨天自动轮换, 且只要库非空就永远有内容 (不会像排期制那样过期断更)
   *   - 池顺序与 /quotes 的 feed 顺序一致, 所以"今日那一句"在沉浸页里位置可预期
   *
   * @param userId 当前用户 id (用于回填本人收藏状态)
   * @returns 今日金句
   * @throws BizException(QuoteLibraryEmpty) 内容库为空
   */
  async getToday(userId: string): Promise<QuoteDto> {
    const pool = await this.findVisibleQuotes(userId);
    if (pool.length === 0) {
      this.logger.warn('[quote_today_empty] 内容库为空, 前端应回退本地种子');
      throw new BizException(BizCode.QuoteLibraryEmpty);
    }

    const index = quoteDayIndexOf(new Date()) % pool.length;
    const picked = pool[index] ?? pool[0];
    if (!picked) {
      // 理论上不可达 (池非空时取模必落在 [0, len)); 兜底抛业务错, 保证不 500.
      throw new BizException(BizCode.QuoteLibraryEmpty);
    }

    const favorited = await this.loadFavoritedIds(userId, [picked.id]);
    return this.toDto(picked, favorited);
  }

  // ══════════════════════════════════════════════════════════════════════
  // §2.2 GET /counselor/quotes?cursor=&limit=
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 金句流 (游标分页).
   *
   * 排序固定为 (published_at DESC, id DESC) —— 新的在前. 游标是**金句 id**,
   * 语义为"取该条之后的更旧一批". 用 keyset (而非 OFFSET) 的原因:
   * 沉浸页是无限滑动的, 滑动过程中若运营新增了金句, OFFSET 会漏条/重条,
   * keyset 则稳定.
   *
   * @param userId 当前用户 id
   * @param query 游标 + 条数
   * @returns 金句列表 + 下一页游标
   */
  async list(userId: string, query: QuoteQueryDto): Promise<QuoteListDto> {
    const limit = query.limit ?? QUOTE_LIST_DEFAULT_LIMIT;

    const qb = this.quoteRepo
      .createQueryBuilder('q')
      .where('q.deletedAt IS NULL')
      .andWhere('q.enabled = :enabled', { enabled: true })
      // 可见性谓词 (**全仓唯一一处**): 共享内容库 user_id IS NULL, 本人自建 user_id = 本人.
      // 今天库里全是共享内容, 但 user_id 列已预留 —— 谓词必须现在就写对, 否则将来
      // 加了"用户自建金句"就会漏过滤, 别人的私有金句直接泄露.
      .andWhere('(q.userId IS NULL OR q.userId = :userId)', { userId })
      .orderBy('q.publishedAt', 'DESC')
      .addOrderBy('q.id', 'DESC');

    if (query.cursor) {
      // 游标解析: 找到该条, 拿它的 (published_at, id) 作为游标锚点.
      // 解析不到 → 400 (游标失效, 客户端应重置分页从头开始), 不静默从头返回.
      const anchor = await this.quoteRepo.findOne({ where: { id: query.cursor } });
      if (!anchor) {
        throw new BizException(BizCode.QuoteCursorInvalid, `游标无效或已失效: ${query.cursor}`);
      }
      // keyset 推进: 更旧的 (published_at 更大 = 更小 because DESC) ...
      qb.andWhere('(q.publishedAt < :anchorPublishedAt OR (q.publishedAt = :anchorPublishedAt AND q.id < :anchorId))', {
        anchorPublishedAt: anchor.publishedAt,
        anchorId: anchor.id,
      });
    }

    // 多取一条用来判断还有没有下一页 (LIMIT n+1 惯用法), 避免多打一次 COUNT。
    const rows = await qb.take(limit + 1).getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const favorited = await this.loadFavoritedIds(
      userId,
      items.map((item) => item.id),
    );

    const last = items.at(-1);
    return {
      items: items.map((item) => this.toDto(item, favorited)),
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // §2.3 POST/DELETE /counselor/quotes/:id/favorite
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 收藏 (幂等).
   *
   * 重复收藏同一句不会产生第二行 (UNIQUE (user_id, quote_id) + upsert).
   *
   * @param userId 当前用户 id
   * @param quoteId 金句 id
   * @returns 收藏状态
   */
  async favorite(userId: string, quoteId: string): Promise<QuoteFavoriteResultDto> {
    await this.assertQuoteExists(quoteId);

    // upsert: 冲突时走 ON DUPLICATE KEY UPDATE, 保证"重复收藏"是幂等 no-op.
    await this.favoriteRepo.upsert(
      {
        tenantId: userId, // A9 一人一租户
        userId,
        quoteId,
      },
      { conflictPaths: ['userId', 'quoteId'] },
    );

    this.logger.log(`[quote_favorited] user=${userId} quote=${quoteId}`);
    return { quoteId, favorited: true };
  }

  /**
   * 取消收藏.
   *
   * 走**硬删** (不是软删): UNIQUE (user_id, quote_id) 不含 deleted_at,
   * 软删会让"取消后再收藏同一句"撞唯一键. 硬删让出唯一键, 再收藏必然成功.
   *
   * @param userId 当前用户 id
   * @param quoteId 金句 id
   * @returns 收藏状态
   */
  async unfavorite(userId: string, quoteId: string): Promise<QuoteFavoriteResultDto> {
    // **刻意不校验金句是否存在**: 取消收藏的目标终态是"没有这条收藏", 而这个终态
    // 在金句已被下架/删除时**已经成立**了. 若此时抛 404, 用户就无法清掉一条失效收藏
    // (前端列表里那条还在, 收藏态却删不掉). 删除一条不存在的收藏本来就是 no-op.
    // 注意与收藏端点的不对称: POST 必须校验 (不能收藏不存在的句子),
    // DELETE 不校验 (清收藏永远应该成功).
    await this.favoriteRepo.delete({ userId, quoteId });

    this.logger.log(`[quote_unfavorited] user=${userId} quote=${quoteId}`);
    return { quoteId, favorited: false };
  }

  /**
   * 我的收藏列表 (供客户端回填"已收藏"状态).
   *
   * spec §5 写「本地收藏 `_liked` 改为远端 2.3 接口」—— 但只有 POST/DELETE 两个
   * 开关端点的话, 客户端**冷启动后无从知道**哪些句子被收藏过 (本地集合在内存里,
   * 重启即丢). 故补这一个"读"端点, 让收藏状态可跨设备恢复.
   *
   * 排序: 最近收藏的在前 (收藏关系表自身的 created_at), 而不是按金句发布日 ——
   * "我的收藏"是一个**行为序列**, 用户关心的是"我最近收藏了什么".
   *
   * @param userId 当前用户 id
   * @returns 收藏的金句列表
   */
  async listFavorites(userId: string): Promise<QuoteListDto> {
    const relations = await this.favoriteRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    if (relations.length === 0) {
      return { items: [], nextCursor: null };
    }

    const quoteIds = relations.map((relation) => relation.quoteId);
    const quotes = await this.quoteRepo.find({ where: { id: In(quoteIds) } });
    const byId = new Map(quotes.map((quote) => [quote.id, quote]));

    // 按收藏顺序输出; 金句已被下架/删除的跳过 (收藏指向的是 id, 内容没了就没了).
    const items: QuoteDto[] = [];
    for (const relation of relations) {
      const quote = byId.get(relation.quoteId);
      if (quote) {
        items.push(this.toDto(quote, new Set([quote.id])));
      }
    }

    return { items, nextCursor: null };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 内部工具
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 取可见内容库 (按 feed 顺序: 发布日倒序).
   *
   * @param userId 当前用户 id (用于可见性谓词: 共享库 + 本人自建)
   */
  private async findVisibleQuotes(userId: string): Promise<Quote[]> {
    return (
      this.quoteRepo
        .createQueryBuilder('q')
        .where('q.deletedAt IS NULL')
        .andWhere('q.enabled = :enabled', { enabled: true })
        // 可见性谓词 (**全仓唯一一处**): 共享内容库 user_id IS NULL, 本人自建 user_id = 本人.
        // 今天库里全是共享内容, 但 user_id 列已预留 —— 谓词必须现在就写对, 否则将来
        // 加了"用户自建金句"就会漏过滤, 别人的私有金句直接泄露.
        .andWhere('(q.userId IS NULL OR q.userId = :userId)', { userId })
        .orderBy('q.publishedAt', 'DESC')
        .addOrderBy('q.id', 'DESC')
        .getMany()
    );
  }

  /**
   * 取本人在给定金句集合里的收藏状态 (零 N+1: 一条查询 + 内存 Set).
   *
   * @param userId 当前用户 id
   * @param quoteIds 金句 id 集合
   * @returns 已收藏的 id 集合
   */
  private async loadFavoritedIds(userId: string, quoteIds: string[]): Promise<Set<string>> {
    if (quoteIds.length === 0) {
      return new Set<string>();
    }
    const relations = await this.favoriteRepo.find({
      where: { userId, quoteId: In(quoteIds) },
      select: { id: true, quoteId: true },
    });
    return new Set(relations.map((relation) => relation.quoteId));
  }

  /**
   * 校验金句存在且可用.
   *
   * @param quoteId 金句 id
   * @throws BizException(QuoteNotFound) 不存在 / 已下架
   */
  private async assertQuoteExists(quoteId: string): Promise<Quote> {
    const quote = await this.quoteRepo.findOne({ where: { id: quoteId } });
    if (!quote || !quote.enabled || quote.deletedAt !== null) {
      throw new BizException(BizCode.QuoteNotFound, `金句不存在或已下架: ${quoteId}`);
    }
    return quote;
  }

  /**
   * entity → 出参 DTO.
   *
   * @param quote 金句行
   * @param favorited 已收藏的 id 集合
   */
  private toDto(quote: Quote, favorited: Set<string>): QuoteDto {
    return {
      id: quote.id,
      text: quote.text,
      author: quote.author,
      category: quote.category,
      backgroundUrl: quote.backgroundUrl,
      publishedAt: quote.publishedAt.toISOString(),
      sourceWork: quote.sourceWork,
      favorited: favorited.has(quote.id),
    };
  }
}
