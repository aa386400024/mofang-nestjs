// V2026-11-15 治本 (TD-21 · C2 第五批仓储端口化 · counselor 域 · P-DEBT-11 / L-1):
//   `QuoteFavoriteRepository` 端口的 TypeORM 实现 —— counselor 域**唯一**允许出现
//   typeorm 值符号的业务文件 (module 装配层除外).
//
//   治本:
//     - 幂等收藏的冲突键 (userId + quoteId) 下沉实现层
//     - 取消收藏走**硬删** (与内容库表的软删口径相反) —— 理由见 entity 注释:
//       软删 + UNIQUE(user_id, quote_id) 会让「取消后再收藏」撞唯一键
//     - 收藏列表排序 (createdAt DESC = 行为序列) 与「取已收藏 id」的查询全部下沉
//     - entity → Row 映射下沉实现层, service 零映射职责
//     - **不吞异常** —— 写失败要冒到 service (service 现有语义逐字保留)
//
//   反双胞胎:
//     - 不把实体行漏给 service —— 端口出参是 Row 领域类型 (窄字段)
//     - 收藏关系表**没有** deletedAt 列 —— Row 也不含该列, 不得写成软删表
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后收藏 3 个端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-15 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';

import type { FavoriteRow, QuoteFavoriteRepository } from '../domain/repositories/quote-favorite.repository.js';
import { UserQuoteFavorite } from '../entities/user-quote-favorite.entity.js';

/**
 * 收藏关系仓储 (TypeORM 真库实现).
 */
@Injectable()
export class QuoteFavoriteRepositoryTypeorm implements QuoteFavoriteRepository {
  /**
   * @param repo 收藏关系实体仓储
   */
  constructor(
    @InjectRepository(UserQuoteFavorite)
    private readonly repo: Repository<UserQuoteFavorite>,
  ) {}

  /**
   * 幂等收藏 —— 冲突键 (userId + quoteId) 命中时为 no-op.
   *
   * @param userId 当前用户 id
   * @param quoteId 金句 id
   * @param tenantId 租户 id (一人一租户: 与 userId 同值)
   */
  async upsert(userId: string, quoteId: string, tenantId: string): Promise<void> {
    await this.repo.upsert(
      {
        tenantId,
        userId,
        quoteId,
      },
      { conflictPaths: ['userId', 'quoteId'] },
    );
  }

  /**
   * 取消收藏 (硬删) —— 删不存在的收藏是 no-op.
   *
   * @param userId 当前用户 id
   * @param quoteId 金句 id
   */
  async deleteByUserAndQuote(userId: string, quoteId: string): Promise<void> {
    await this.repo.delete({ userId, quoteId });
  }

  /**
   * 列某人的收藏关系 (最近收藏的在前 = 行为序列).
   *
   * @param userId 当前用户 id
   * @returns 收藏关系行列表
   */
  async findFavoritesByUser(userId: string): Promise<FavoriteRow[]> {
    const rows = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => toRow(row));
  }

  /**
   * 取给定金句集合里本人已收藏的 id (零 N+1: 一条查询).
   *
   * @param userId 当前用户 id
   * @param quoteIds 金句 id 集合
   * @returns 已收藏的金句 id 列表
   */
  async findFavoriteQuoteIds(userId: string, quoteIds: string[]): Promise<string[]> {
    const rows = await this.repo.find({
      where: { userId, quoteId: In(quoteIds) },
      select: { id: true, quoteId: true },
    });
    return rows.map((row) => row.quoteId);
  }
}

/** entity → Row 映射 (窄字段; 本表硬删, 无软删列). */
function toRow(entity: UserQuoteFavorite): FavoriteRow {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    userId: entity.userId,
    quoteId: entity.quoteId,
    createdAt: entity.createdAt,
  };
}
