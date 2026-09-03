import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { BadgeStateDto, BadgesListDto, UnlockBadgeResponseDto } from '../dto/badge.dto';
import { BadgeState } from '../entities/badge-state.entity';
import { BADGE_ID_VALUES, BADGE_META, BadgeId } from '../enums/badge-id.enum';

/**
 * 徽章业务服务 — V4.0 §3.3.
 *
 * 设计原则:
 *   - 存在即解锁: 没有 unlocked 字段, 没记录 = 未解锁
 *   - reconcile() 由 reconciliation.service 集中触发
 *   - pending 概念 = unlocked_at 非空 AND consumed_at 为空
 *
 * 接口语义:
 *   - list(userId): 返回全部 9 个 + 解锁状态 (前端冷启动用)
 *   - consumePending(userId, badgeId): 用户看完 unlock overlay 后调, 标记已消费
 *   - forceUnlock(userId, badgeId): 强制解锁 (运营/测试用), 已解锁返回 alreadyUnlocked=true
 */
@Injectable()
export class BadgesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(BadgeState)
    private readonly stateRepo: Repository<BadgeState>,
  ) {}

  /**
   * 列出全部 9 个徽章 + 当前用户的解锁状态.
   * 用于前端 cold start 渲染徽章册.
   */
  async list(userId: string): Promise<BadgesListDto> {
    const states = await this.stateRepo.find({ where: { userId } });
    const stateMap = new Map<BadgeId, BadgeState>(states.map((s) => [s.badgeId, s]));

    const all: BadgeStateDto[] = BADGE_ID_VALUES.map((id) => {
      const meta = BADGE_META.get(id)!;
      const state = stateMap.get(id);
      return {
        id,
        title: meta.title,
        description: meta.description,
        emoji: meta.emoji,
        unlockedAt: state?.unlockedAt.toISOString() ?? null,
        consumedAt: state?.unlockConsumedAt?.toISOString() ?? null,
      };
    });

    const pendingUnlockIds = all.filter((b) => b.unlockedAt !== null && b.consumedAt === null).map((b) => b.id);

    return {
      badges: all,
      unlockedCount: all.filter((b) => b.unlockedAt !== null).length,
      total: BADGE_ID_VALUES.length,
      pendingUnlockIds,
    };
  }

  /**
   * 强制解锁 — 运营/测试/补发用.
   *
   * 语义:
   *   - 已存在: 返回 { alreadyUnlocked: true, unlockedAt: 原值 }
   *   - 不存在: 插入新行 + 返回新解锁时间
   */
  async forceUnlock(userId: string, badgeId: BadgeId): Promise<UnlockBadgeResponseDto> {
    if (!BADGE_ID_VALUES.includes(badgeId)) {
      throw new NotFoundException(`unknown badgeId: ${badgeId}`);
    }

    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(BadgeState);
      const existing = await repo.findOne({ where: { userId, badgeId } });
      if (existing) {
        return {
          badgeId,
          alreadyUnlocked: true,
          unlockedAt: existing.unlockedAt.toISOString(),
        };
      }
      const now = new Date();
      await repo.insert({
        userId,
        badgeId,
        unlockedAt: now,
        unlockConsumedAt: null,
      });
      return {
        badgeId,
        alreadyUnlocked: false,
        unlockedAt: now.toISOString(),
      };
    });
  }

  /**
   * 标记 pending unlock 已展示 — BadgeUnlockOverlay 关闭后调用.
   *
   * 语义:
   *   - 没解锁: 404
   *   - 已消费: 幂等返回
   *   - 未消费: 写入 consumed_at
   */
  async consumePending(userId: string, badgeId: BadgeId): Promise<BadgeStateDto> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(BadgeState);
      const existing = await repo.findOne({ where: { userId, badgeId } });
      if (!existing) {
        throw new NotFoundException(`badge ${badgeId} 未解锁, 无需消费`);
      }
      if (existing.unlockConsumedAt === null) {
        existing.unlockConsumedAt = new Date();
        await repo.save(existing);
      }
      const meta = BADGE_META.get(badgeId)!;
      return {
        id: badgeId,
        title: meta.title,
        description: meta.description,
        emoji: meta.emoji,
        unlockedAt: existing.unlockedAt.toISOString(),
        consumedAt: existing.unlockConsumedAt.toISOString(),
      };
    });
  }

  /**
   * 批量写入新解锁的徽章 — 给 reconciliation service 用.
   * 已存在的会被忽略 (数据库 UNIQUE 兜底).
   */
  async bulkInsertUnlocks(userId: string, badgeIds: readonly BadgeId[]): Promise<readonly BadgeId[]> {
    if (badgeIds.length === 0) return [];
    const newlyInserted: BadgeId[] = [];

    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(BadgeState);
      for (const id of badgeIds) {
        const existing = await repo.findOne({ where: { userId, badgeId: id } });
        if (existing) continue;
        await repo.insert({
          userId,
          badgeId: id,
          unlockedAt: new Date(),
          unlockConsumedAt: null,
        });
        newlyInserted.push(id);
      }
    });

    return newlyInserted;
  }

  /**
   * 取用户已解锁徽章 id 列表 — 公开方法, 避免外部用 brackets 访问私有 repo。
   */
  async fetchUnlockedBadgeIds(userId: string): Promise<readonly BadgeId[]> {
    const rows = await this.stateRepo.find({ where: { userId } });
    return rows.map((r) => r.badgeId);
  }
}
