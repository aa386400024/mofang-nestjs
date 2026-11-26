// V2026-11-15 治本 (TD-21 · C2 第五批仓储端口化 · counselor 域 · P-DEBT-11 / L-1):
//   `QuoteRepository` 端口的 TypeORM 实现 —— counselor 域**唯一**允许出现
//   typeorm 值符号的业务文件 (module 装配层除外).
//
//   治本:
//     - **可见性查询构造全部下沉**: 今日池与金句流共用同一套 where / order,
//       收进一个私有构造方法 —— 改一处即改两处, 不会出现"今日池过滤了、feed 忘了"
//       的半改状态 (这是共享内容库 + 用户自建金句并存时的泄漏面).
//     - keyset 游标推进条件下沉实现层
//     - entity → Row 映射下沉实现层, service 零映射职责
//     - 实现不写新口径、不加新条件 —— 本单是结构重构, 不是查询优化
//     - 不暴露 EntityManager / 查询选项给上层
//     - **不吞异常** —— 查询失败要冒到 service (service 现有语义逐字保留)
//
//   反双胞胎:
//     - 不把实体行漏给 service —— 端口出参是 Row 领域类型 (窄字段)
//     - 可见性谓词只有这一处 —— service 侧不复写
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后金句 5 个端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-15 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, type Repository, type SelectQueryBuilder } from 'typeorm';

import type { QuoteCursorAnchor, QuoteRepository, QuoteRow } from '../domain/repositories/quote.repository.js';
import { Quote } from '../entities/quote.entity.js';

/**
 * 金句内容库仓储 (TypeORM 真库实现).
 */
@Injectable()
export class QuoteRepositoryTypeorm implements QuoteRepository {
  /**
   * @param repo 金句内容库实体仓储
   */
  constructor(
    @InjectRepository(Quote)
    private readonly repo: Repository<Quote>,
  ) {}

  /**
   * 取可见内容库候选池 (今日金句用) —— 可见性谓词 + 发布日倒序.
   *
   * @param userId 当前用户 id
   * @returns 行列表
   */
  async findVisiblePool(userId: string): Promise<QuoteRow[]> {
    const rows = await this.visibleQueryBuilder(userId).getMany();
    return rows.map((row) => toRow(row));
  }

  /**
   * 取可见内容库的一批 (keyset 游标分页).
   *
   * @param userId 当前用户 id
   * @param anchor 游标锚点 (null = 首批)
   * @param take 取多少条
   * @returns 行列表
   */
  async listVisibleKeyset(userId: string, anchor: QuoteCursorAnchor | null, take: number): Promise<QuoteRow[]> {
    const qb = this.visibleQueryBuilder(userId);
    if (anchor) {
      // keyset 推进: 更旧的 (published_at 更大 = 更小 because DESC) ...
      qb.andWhere('(q.publishedAt < :anchorPublishedAt OR (q.publishedAt = :anchorPublishedAt AND q.id < :anchorId))', {
        anchorPublishedAt: anchor.publishedAt,
        anchorId: anchor.id,
      });
    }
    const rows = await qb.take(take).getMany();
    return rows.map((row) => toRow(row));
  }

  /**
   * 按 id 取游标锚点行.
   *
   * @param id 金句 id (游标值)
   * @returns 行 (未命中返 null)
   */
  async findAnchorById(id: string): Promise<QuoteRow | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? toRow(row) : null;
  }

  /**
   * 按 id 取行 (存在性校验用) —— 上下架 / 软删判定留 service.
   *
   * @param quoteId 金句 id
   * @returns 行 (未命中返 null)
   */
  async findById(quoteId: string): Promise<QuoteRow | null> {
    const row = await this.repo.findOne({ where: { id: quoteId } });
    return row ? toRow(row) : null;
  }

  /**
   * 按 id 集合取行.
   *
   * @param quoteIds 金句 id 集合
   * @returns 行列表
   */
  async findManyByIds(quoteIds: string[]): Promise<QuoteRow[]> {
    // AF-537 P1 6.21#1: 收藏列表必须过滤软删 / 下架，否则已下架内容仍可被读出。
    const rows = await this.repo.find({
      where: { id: In(quoteIds), deletedAt: IsNull(), enabled: true },
    });
    return rows.map((row) => toRow(row));
  }

  /**
   * 可见内容库查询构造 —— **可见性谓词全仓唯一一处**.
   *
   * 谓词 (**全仓唯一一处**): 共享内容库 user_id IS NULL, 本人自建 user_id = 本人.
   * 今天库里全是共享内容, 但 user_id 列已预留 —— 谓词必须现在就写对, 否则将来
   * 加了「用户自建金句」就会漏过滤, 别人的私有金句直接泄露.
   *
   * 今日池与金句流共用这一份构造: 两者可见性口径必须**逐字一致**, 分头写两份
   * 就是"改一处漏一处"的写法.
   */
  private visibleQueryBuilder(userId: string): SelectQueryBuilder<Quote> {
    return this.repo
      .createQueryBuilder('q')
      .where('q.deletedAt IS NULL')
      .andWhere('q.enabled = :enabled', { enabled: true })
      .andWhere('(q.userId IS NULL OR q.userId = :userId)', { userId })
      .orderBy('q.publishedAt', 'DESC')
      .addOrderBy('q.id', 'DESC');
  }
}

/** entity → Row 映射 (窄字段; 保留 deletedAt 软删列). */
function toRow(entity: Quote): QuoteRow {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    userId: entity.userId,
    text: entity.text,
    author: entity.author,
    sourceWork: entity.sourceWork,
    category: entity.category,
    backgroundUrl: entity.backgroundUrl,
    publishedAt: entity.publishedAt,
    enabled: entity.enabled,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    deletedAt: entity.deletedAt,
  };
}
