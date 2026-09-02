import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { HomeMicroInterventionService } from './home-micro-intervention.service';
import { HomeMoodLogService } from './home-mood-log.service';
import { HomeRecommendationEngine } from './home-recommendation.engine';
import { CompanionBinding } from '../../profile/entities/companion-binding.entity';
import { UserProfile } from '../../profile/entities/user-profile.entity';
import { User } from '../../user/entities/user.entity';

import type { HomeOverviewDto, SupportCompanionDto, TodayRecommendationDto } from '../dto/home-overview.dto';
import { HomeMessage } from '../entities/home-message.entity';
import type { HomeEmotionLevel } from '../home.constants';

/**
 * 心塑成长用户端「首页聚合」核心服务.
 *
 * 职责:
 *   - getOverview(uid, emotionLevel?): 首页综合快照
 *   - getTodayRecommendation(uid, emotionLevel?): 单独拉推荐
 *
 * 大厂做法:
 *   - 1 service 对应 1 controller, 不跨边界
 *   - 依赖注入 (DI) 各子服务 (micro / mood / recommendation engine)
 *   - 1 query 拿 companions + 1 query 拿 profiles + 1 query 拿 unread count
 *     内存聚合, 避免 N+1
 */
@Injectable()
export class HomeOverviewService {
  constructor(
    @InjectRepository(CompanionBinding)
    private readonly bindingRepo: Repository<CompanionBinding>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(HomeMessage)
    private readonly messageRepo: Repository<HomeMessage>,
    private readonly moodService: HomeMoodLogService,
    private readonly microService: HomeMicroInterventionService,
    private readonly recommendationEngine: HomeRecommendationEngine,
  ) {}

  /**
   * 首页综合快照.
   *
   * 入参 [emotionLevel] 优先 (来自前端 EmotionBloc, 实时),
   * 兜底从 mood_logs 表读最新一条 (V3 主路径).
   *
   * 大厂做法:
   *   - 「今日」用本地时间 0 点
   *   - 陪伴者上限 3 个 (maxVisible), 超出由前端折叠
   *   - 微干预 active + pending 同时返回
   *   - greeting 用服务端时间 (timezone-safe)
   */
  async getOverview(uid: string, emotionLevel: HomeEmotionLevel | null, now: Date = new Date()): Promise<HomeOverviewDto> {
    // 1. greeting + dateLabel + timeSlot (服务端时区)
    const greet = this.recommendationEngine.greet(now);

    // 2. 用户昵称 + 头像 + 角色
    const profile = await this.profileRepo.findOne({ where: { uid } });
    const user = await this.userRepo.findOne({ where: { uid } });
    const nickname = profile?.nickname ?? user?.phone ?? user?.email?.split('@', 1)[0] ?? '你';
    const avatarUrl = profile?.avatarUrl ?? null;
    const currentRole = profile?.currentRole ?? 'growth_user';

    // 3. 今日情绪 (前端实时 emotion 优先, 否则查表)
    const mood = emotionLevel ? null : await this.moodService.getTodayLatest(uid, now);
    const effectiveEmotion: HomeEmotionLevel | null = emotionLevel ?? mood?.level ?? null;
    const emotionFields = mood
      ? this.moodService.toOverviewFields(mood)
      : {
          emotionLevel,
          emotionNote: null,
          emotionLoggedAt: null,
        };

    // 4. 微干预 active + pending
    const micro = await this.microService.getActive(uid, effectiveEmotion, now);

    // 5. 推荐 (情绪 + 时段联合)
    const recommendation: TodayRecommendationDto = this.recommendationEngine.pick(effectiveEmotion, now);

    // 6. 陪伴者列表 (上限 3)
    const { companions, total } = await this.fetchCompanions(uid);

    // 7. 未读消息数
    const unreadCount = await this.messageRepo.count({
      where: { uid, readAt: IsNull() },
    });

    return {
      nickname,
      avatarUrl,
      currentRole,
      timeSlot: greet.timeSlot,
      greeting: greet.greeting,
      dateLabel: greet.dateLabel,
      emotionLevel: emotionFields.emotionLevel,
      emotionNote: emotionFields.emotionNote,
      emotionLoggedAt: emotionFields.emotionLoggedAt,
      activeMicroIntervention: micro.active,
      pendingMicroIntervention: micro.pending,
      todayRecommendation: recommendation,
      companions,
      companionsTotal: total,
      unreadMessageCount: unreadCount,
    };
  }

  /**
   * 单独拉今日推荐 (供「刷新推荐」按钮 + 情绪变化时调用).
   */
  async getTodayRecommendation(emotionLevel: HomeEmotionLevel | null, now: Date = new Date()): Promise<TodayRecommendationDto> {
    return this.recommendationEngine.pick(emotionLevel, now);
  }

  // ════════════════════════════════════════════════════════════════
  // 内部 helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * 拉陪伴者 (限 3 个 + total).
   *
   * 大厂做法: 1 query bindings + 1 query profiles (避免 N+1).
   * 头像 emoji 默认按 relation 给, V3 接 avatar_url 字段.
   */
  private async fetchCompanions(uid: string): Promise<{ companions: SupportCompanionDto[]; total: number }> {
    const all = await this.bindingRepo.find({
      where: { ownerUid: uid, status: 'active' },
      order: { createdAt: 'DESC' },
    });
    const total = all.length;
    const top3 = all.slice(0, 3);
    const companionUids = top3.map((b) => b.companionUid).filter((u): u is string => !!u);
    const profiles = companionUids.length ? await this.profileRepo.find({ where: companionUids.map((u) => ({ uid: u })) }) : [];
    const profileMap = new Map(profiles.map((p) => [p.uid, p]));

    const companions: SupportCompanionDto[] = top3.map((b) => {
      const profile = b.companionUid ? profileMap.get(b.companionUid) : undefined;
      return {
        id: b.id,
        nickname: profile?.nickname ?? '陪伴者',
        avatarEmoji: this.emojiForRelation(b.permissionLevel),
        relation: 'other', // V2.0 简化: 不存 relation 字段, 默认 other
        permissionLevel: b.permissionLevel,
        lastActiveAt: b.boundAt?.toISOString() ?? null,
      };
    });
    return { companions, total };
  }

  /**
   * 关系类型 → emoji 默认头像.
   */
  private emojiForRelation(permission: 'L1' | 'L2' | 'L3'): string {
    switch (permission) {
      case 'L1':
        return '🌸';
      case 'L2':
        return '🌿';
      case 'L3':
        return '🌷';
      default:
        return '🌱';
    }
  }
}
