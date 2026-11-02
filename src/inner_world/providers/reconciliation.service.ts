import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BadgesService } from './badges.service';
import { PracticeSession } from '../../practice/entities/practice-session.entity';
import { FragmentLog } from '../entities/fragment-log.entity';
import { IslandElement } from '../entities/island-element.entity';
import { BadgeId } from '../enums/badge-id.enum';
import { BadgeRuleContext, judgeAll } from '../policies/badge-rules';

/**
 * 徽章自动检测服务 — reconciliation.
 *
 * 职责:
 *   - 在碎片 grant/consume、工具 session complete 等事件后被调用
 *   - 拉取用户的"应有解锁状态", 跟实际状态对比, 补齐差集
 *   - 也可被前端 POST /inner-world/badges/reconcile 主动触发
 *
 * 设计:
 *  (1) judgeAll(ctx) 是纯函数, 跟数据层解耦, 便于单测
 *  (2) gatherContext(userId) 是 IO 密集, 缓存到内存 5s (防同一事件多次 reconcile)
 *  (3) actual 状态走 BADGE_STATES 表查询
 *  (4) 差集 = newlyUnlocked, 写表
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  // 简易 5s 缓存, 防 reconcile() 同一用户被高频调用.
  private readonly ctxCache = new Map<string, { at: number; ctx: BadgeRuleContext }>();
  private static readonly CACHE_TTL_MS = 5000;

  constructor(
    @InjectRepository(FragmentLog)
    private readonly fragmentRepo: Repository<FragmentLog>,
    @InjectRepository(IslandElement)
    private readonly elementRepo: Repository<IslandElement>,
    @InjectRepository(PracticeSession)
    private readonly sessionRepo: Repository<PracticeSession>,
    private readonly badgesService: BadgesService,
  ) {}

  /**
   * 碎片变更后调用 — 主要是为了 Collector (累计产出 >= 100) 这类规则.
   */
  async reconcileAfterFragmentChange(userId: string, _grantedDelta: number): Promise<readonly BadgeId[]> {
    // 失效缓存, 强制下次拉新.
    this.invalidateCache(userId);

    // 快速通道: 单次产出 < 100, Collector 不可能解锁, 跳过全 reconcile.
    // 但安全做法还是每次都跑 (reconcile 不依赖碎片读, 走缓存).
    return this.reconcile(userId);
  }

  /**
   * 工具 session 完成时调用 — 触发 FirstListen/Companion/GentleExplorer 这类.
   */
  async reconcileAfterToolCompletion(userId: string, _toolId: string): Promise<readonly BadgeId[]> {
    this.invalidateCache(userId);
    return this.reconcile(userId);
  }

  /**
   * 全量 reconcile — 公开, 前端可主动调.
   */
  async reconcile(userId: string): Promise<readonly BadgeId[]> {
    const ctx = await this.gatherContext(userId);
    const desired = judgeAll(ctx);
    const actual = await this.fetchUnlockedIds(userId);

    const desiredSet = new Set<BadgeId>(desired);
    const actualSet = new Set<BadgeId>(actual);
    const newlyUnlocked = [...desiredSet].filter((id) => !actualSet.has(id));

    if (newlyUnlocked.length === 0) return [];

    this.logger.log(`reconcile(userId=${userId}) new badges: ${newlyUnlocked.join(', ')}`);

    return this.badgesService.bulkInsertUnlocks(userId, newlyUnlocked);
  }

  // ───────────────── private ─────────────────

  private async gatherContext(userId: string): Promise<BadgeRuleContext> {
    const cached = this.ctxCache.get(userId);
    if (cached && Date.now() - cached.at < ReconciliationService.CACHE_TTL_MS) {
      return cached.ctx;
    }

    // 工具完成事件 — V2 阶段 practice_sessions 表是 in-memory, V3 接真持久化.
    // 这里保守取近 30 天, 避免一次性扫全表.
    const since = new Date(Date.now() - 30 * 86_400_000);
    const sessions = await this.sessionRepo.find({
      where: { uid: userId, completedAt: since },
      order: { completedAt: 'DESC' },
      take: 500,
    });
    const toolCompletions = sessions.filter((s) => s.completedAt !== null).map((s) => ({ toolId: s.toolKey, completedAt: s.completedAt! }));

    const unlockedElementCount = await this.elementRepo.count({
      where: { userId },
    });

    // refactoredLeafCount / breathDrawingCount V4.0 阶段没有后端表, 暂时返回 0.
    // V3.1 加 thought_leaves / breath_drawings 表后接入.
    const refactoredLeafCount = 0;
    const breathDrawingCount = 0;

    // totalGrantedFragments: SUM(delta > 0) by user.
    const row = await this.fragmentRepo
      .createQueryBuilder('f')
      .select('COALESCE(SUM(CASE WHEN f.delta > 0 THEN f.delta ELSE 0 END), 0)', 'total')
      // V2026-09-03 治本: 同 fragments.service 48 行注释, TypeORM 1.x 的 QueryBuilder 在 alias.property
      // 形式下会按 entity metadata 解析 property 名; entity 属性是 userId 不是 user_id, 写 f.user_id
      // 会抛 PropertyNotFound. 改 raw WHERE 走列名 (跟 theme-packs/tool-skins.service 一致).
      .where('user_id = :userId', { userId })
      .getRawOne<{ total: string }>();
    const totalGrantedFragments = Number.parseInt(row?.total ?? '0', 10);

    const ctx: BadgeRuleContext = {
      userId,
      toolCompletions,
      unlockedElementCount,
      refactoredLeafCount,
      breathDrawingCount,
      totalGrantedFragments,
    };

    this.ctxCache.set(userId, { at: Date.now(), ctx });
    return ctx;
  }

  private async fetchUnlockedIds(userId: string): Promise<readonly BadgeId[]> {
    const ids = await this.badgesService.fetchUnlockedBadgeIds(userId);
    return ids;
  }

  private invalidateCache(userId: string): void {
    this.ctxCache.delete(userId);
  }
}
