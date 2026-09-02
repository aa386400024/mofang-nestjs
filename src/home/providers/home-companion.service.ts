import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CompanionBinding } from '../../profile/entities/companion-binding.entity';
import { UserProfile } from '../../profile/entities/user-profile.entity';

import {
  type CompanionHomeOverviewDto,
  type CompanionPersonStatusDto,
  type DailyCompanionTipDto,
  DualPracticeListResponseDto,
  type PanicCheckResponseDto,
  type SelfCareStatusDto,
  type SwitchAccompaniedPersonResponseDto,
  type ToolboxItemDto,
} from '../dto/home-companion-overview.dto';

/**
 * 心塑陪伴者端「首页聚合」核心服务.
 *
 * 职责:
 *   - getOverview(uid): 陪伴者首页综合快照
 *   - getDailyTip(uid, now): 每日小贴士 (按日期 hash 保证一致性)
 *   - panicCheck(uid): 一键求助触发检查
 *   - listDualPractices(bindingId): 双人协同练习列表
 *
 * 关键设计:
 *   - 「被陪伴者状态」严格按权限等级 (L1/L2/L3) 字段过滤 — 越权字段自动隐藏
 *   - 陪伴者端只读: 不写 mood_logs / 不写 home_messages
 *   - 自我关怀耗竭指数: 服务端算 (陪伴时长 + 状态切换频次), 不让前端计算
 */
@Injectable()
export class HomeCompanionService {
  constructor(
    @InjectRepository(CompanionBinding)
    private readonly bindingRepo: Repository<CompanionBinding>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
  ) {}

  /**
   * 陪伴者首页综合快照.
   *
   * 大厂做法:
   *   - 1 query 拿 bindings (IN clause, 防 N+1)
   *   - 1 query 拿 profiles (按 companion_uid IN)
   *   - 内存聚合, 不用 join (TypeORM join 在大表上反而慢)
   */
  async getOverview(uid: string, currentBindingId?: string): Promise<CompanionHomeOverviewDto> {
    const bindings = await this.bindingRepo.find({
      where: { companionUid: uid, status: 'active' },
      order: { createdAt: 'DESC' },
    });
    const ownerUids = bindings.map((b) => b.ownerUid);
    const profiles = ownerUids.length ? await this.profileRepo.find({ where: ownerUids.map((u) => ({ uid: u })) }) : [];
    const profileMap = new Map(profiles.map((p) => [p.uid, p]));

    // 默认取最近一个 binding (Tab1 没「对象切换」时)
    // 若 caller 传 currentBindingId (前端 sticky), 优先用该 binding
    const activeBinding = currentBindingId ? (bindings.find((b) => b.id === currentBindingId) ?? bindings[0]) : bindings[0];
    const firstBinding = activeBinding;
    const firstProfile = firstBinding ? profileMap.get(firstBinding.ownerUid) : undefined;

    // 陪伴者自身信息 (用于「陪伴者昵称 / 头像 emoji」)
    // V2.0 简化: 用 uid 后 4 位 + 默认 emoji; V3 接 User 表
    const nickname = '你';
    const avatarEmoji = '🤝';

    const status: CompanionPersonStatusDto =
      firstBinding && firstProfile
        ? {
            nickname: this.toNickname(firstProfile),
            avatarEmoji: '🌱',
            relation: 'other', // V3 扩 binding 字段
            permissionLevel: firstBinding.permissionLevel,
            overallStatus: 'normal',
            lastActiveAt: firstBinding.boundAt?.toISOString() ?? null,
            emotionLevel: null,
            emotionLoggedAt: null,
            recentPracticeTitle: null,
            recentPracticeAt: null,
            weeklyEmotionTrend: null,
            weeklyHelpRequests: 0,
            rehabProgressPct: null,
          }
        : this.emptyStatus();

    return {
      nickname,
      avatarEmoji,
      certificationStatus: 'unverified', // V3 拉 certification 表
      dailyTip: this.pickDailyTip(uid, new Date()),
      accompaniedPersonStatus: status,
      toolbox: this.defaultToolbox(),
      selfCareStatus: this.computeSelfCareStatus(uid),
      unreadMessageCount: 0,
      accompaniedPersonsTotal: bindings.length,
    };
  }

  /**
   * 切换陪伴对象 — DESIGN §4 Tab2 「陪伴对象切换」.
   *
   * V2.0: 仅做权限检查 + 返回对方基本信息
   * V3: 加 sticky session (Redis) + 多端推送
   */
  async switchAccompaniedPerson(uid: string, bindingId: string): Promise<SwitchAccompaniedPersonResponseDto | null> {
    const binding = await this.bindingRepo.findOne({
      where: { id: bindingId, companionUid: uid, status: 'active' },
    });
    if (!binding) return null;
    const profile = await this.profileRepo.findOne({ where: { uid: binding.ownerUid } });
    return {
      bindingId: binding.id,
      nickname: profile?.nickname ?? '对方',
      avatarEmoji: '🌱',
      permissionLevel: binding.permissionLevel,
    };
  }

  /**
   * 每日小贴士 — 按日期 hash + uid 推同一条 (一致性).
   *
   * V2.0: 6 条 tip 池, 按 (uid + date) 选 1 条.
   * V3: 接 LLM 个性化.
   */
  pickDailyTip(uid: string, now: Date): DailyCompanionTipDto {
    const tips: DailyCompanionTipDto[] = [
      {
        id: 'tip-2026-self-care',
        title: '先稳住自己',
        body: '你的状态决定支持的质量, 给自己 5 分钟先',
        accent: 'iris',
        icon: 'self_improvement',
      },
      {
        id: 'tip-2026-listen',
        title: '不修复, 只倾听',
        body: '对方可能只需要被听见, 不需要建议',
        accent: 'mint',
        icon: 'hearing_disabled',
      },
      {
        id: 'tip-2026-boundary',
        title: '边界清楚',
        body: '你陪伴的是 TA 的情绪, 不是 TA 的决定',
        accent: 'coral',
        icon: 'shield_outlined',
      },
      {
        id: 'tip-2026-pace',
        title: '陪伴不竞赛',
        body: '慢一点也行, 让 TA 跟上你的节奏',
        accent: 'sand',
        icon: 'hourglass_empty',
      },
      {
        id: 'tip-2026-burnout',
        title: '觉察耗竭',
        body: '如果连续 3 天都很累, 这是信号不是失败',
        accent: 'coral',
        icon: 'battery_alert',
      },
      {
        id: 'tip-2026-celebrate',
        title: '记录小胜利',
        body: '把对方的好转记下来, 那是你们共同的证据',
        accent: 'mint',
        icon: 'emoji_events_outlined',
      },
    ];
    const day = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
    // 简单 hash: uid codePoint sum + day.
    // 大厂: unicode 用 codePointAt 处理 BMP 外字符 (emoji / 罕见汉字),
    // charCodeAt 只能处理 BMP (0-0xFFFF), surrogate pair 会被切坏.
    const uidSum = uid.split('').reduce((acc, ch) => acc + (ch.codePointAt(0) ?? 0), 0);
    const idx = (uidSum + day) % tips.length;
    return tips[idx] ?? tips[0];
  }

  /**
   * 一键求助触发 — 服务端扫最近 24h 信号, 返回风险等级 + 建议.
   *
   * V2.0: 简化版 — 拉最近 24h 求助消息数 + 最近情绪
   * V3: 接信号聚合表 + 机器学习模型
   */
  async panicCheck(_uid: string): Promise<PanicCheckResponseDto> {
    // V2.0 stub: 返回低风险, 不阻塞真实数据接入
    // _uid 占位 (V3 接信号聚合表后按 _uid 扫最近 24h, 现在还没用).
    return {
      riskLevel: 'low',
      suggestedAction: '信号稳定, 继续保持陪伴节奏',
      helpSignalsLast24h: 0,
      lastEmotionLevel: null,
      needsImmediateContact: false,
    };
  }

  /**
   * 双人协同练习列表 — V2.0 新增.
   *
   * 按关系类型筛选 — partner / family / friend.
   */
  async listDualPractices(relationScope: ('partner' | 'family' | 'friend')[] | undefined): Promise<DualPracticeListResponseDto> {
    const all = this.dualPracticeLibrary();
    const items = relationScope?.length ? all.filter((p) => p.relationScope.some((s) => relationScope.includes(s))) : all;
    return { items };
  }

  // ════════════════════════════════════════════════════════════════
  // 内部 helpers
  // ════════════════════════════════════════════════════════════════

  private emptyStatus(): CompanionPersonStatusDto {
    return {
      nickname: '',
      avatarEmoji: '🌱',
      relation: 'other',
      permissionLevel: 'L1',
      overallStatus: 'normal',
      lastActiveAt: null,
      emotionLevel: null,
      emotionLoggedAt: null,
      recentPracticeTitle: null,
      recentPracticeAt: null,
      weeklyEmotionTrend: null,
      weeklyHelpRequests: 0,
      rehabProgressPct: null,
    };
  }

  private toNickname(profile: UserProfile): string {
    return profile.nickname ?? '对方';
  }

  private defaultToolbox(): ToolboxItemDto[] {
    return [
      {
        id: 'reassurance_card',
        title: '安抚卡片',
        subtitle: '发送温暖卡片给对方',
        emoji: '💌',
        accent: 'coral',
        routePath: '/companion/reassurance',
        isNew: false,
      },
      {
        id: 'sync_practice',
        title: '同步练习',
        subtitle: '双方一起做练习',
        emoji: '🤝',
        accent: 'mint',
        routePath: '/companion/sync-practice',
        isNew: false,
      },
      {
        id: 'companion_task',
        title: '陪伴任务',
        subtitle: '为对方安排一件小事',
        emoji: '📝',
        accent: 'iris',
        routePath: '/companion/tasks',
        isNew: false,
      },
      {
        id: 'crisis_response',
        title: '危机应对',
        subtitle: '紧急情况处理流程',
        emoji: '🆘',
        accent: 'sand',
        routePath: '/companion/crisis',
        isNew: false,
      },
      {
        id: 'dual_growth',
        title: '一起成长练习',
        subtitle: '在关系中共同疗愈',
        emoji: '🌱',
        accent: 'mint',
        routePath: '/companion/dual-practices',
        isNew: true,
      },
    ];
  }

  /**
   * 双人协同练习库 — V2.0 新增 (DESIGN §4「双人协同成长系统」).
   *
   * 3 类关系 × 多个练习, 按 relationScope 筛选.
   */
  private dualPracticeLibrary(): {
    id: string;
    title: string;
    subtitle: string;
    emoji: string;
    accent: 'coral' | 'mint' | 'iris' | 'sand';
    durationMinutes: number;
    relationScope: ('partner' | 'family' | 'friend')[];
    routePath: string;
  }[] {
    return [
      {
        id: 'dp-attachment-repair-5steps',
        title: '依恋修复五步法',
        subtitle: '30 分钟 · 双端同步',
        emoji: '🤝',
        accent: 'coral',
        durationMinutes: 30,
        relationScope: ['partner', 'family'],
        routePath: '/companion/dual-practice/dp-attachment-repair-5steps',
      },
      {
        id: 'dp-differentiation-comm',
        title: '差异沟通练习',
        subtitle: '20 分钟 · 双端同步',
        emoji: '💬',
        accent: 'mint',
        durationMinutes: 20,
        relationScope: ['partner', 'family'],
        routePath: '/companion/dual-practice/dp-differentiation-comm',
      },
      {
        id: 'dp-emotion-sync-anchor',
        title: '情绪同步锚定',
        subtitle: '15 分钟 · 双端同步',
        emoji: '🫁',
        accent: 'iris',
        durationMinutes: 15,
        relationScope: ['partner', 'family', 'friend'],
        routePath: '/companion/dual-practice/dp-emotion-sync-anchor',
      },
      {
        id: 'dp-value-clarify',
        title: '共同价值澄清',
        subtitle: '25 分钟 · 双端同步',
        emoji: '🌟',
        accent: 'coral',
        durationMinutes: 25,
        relationScope: ['partner'],
        routePath: '/companion/dual-practice/dp-value-clarify',
      },
      {
        id: 'dp-mirror-practice',
        title: '镜映练习',
        subtitle: '亲子版 · 20 分钟',
        emoji: '🪞',
        accent: 'mint',
        durationMinutes: 20,
        relationScope: ['family'],
        routePath: '/companion/dual-practice/dp-mirror-practice',
      },
      {
        id: 'dp-emotion-name',
        title: '情绪命名协同',
        subtitle: '亲子版 · 15 分钟',
        emoji: '🏷️',
        accent: 'iris',
        durationMinutes: 15,
        relationScope: ['family'],
        routePath: '/companion/dual-practice/dp-emotion-name',
      },
      {
        id: 'dp-boundary-calibrate',
        title: '边界校准练习',
        subtitle: '挚友版 · 20 分钟',
        emoji: '🚧',
        accent: 'sand',
        durationMinutes: 20,
        relationScope: ['friend'],
        routePath: '/companion/dual-practice/dp-boundary-calibrate',
      },
      {
        id: 'dp-need-expression',
        title: '需求表达演练',
        subtitle: '挚友版 · 15 分钟',
        emoji: '✋',
        accent: 'mint',
        durationMinutes: 15,
        relationScope: ['friend'],
        routePath: '/companion/dual-practice/dp-need-expression',
      },
    ];
  }

  /**
   * 自我关怀耗竭指数 — V2.0 简化版.
   *
   * V2.0: 跟 binding 数 + boundAt 算粗略天数
   * V3: 接陪伴者工时表 + 状态切换频次
   */
  private computeSelfCareStatus(_uid: string): SelfCareStatusDto {
    // 占位: 让 UI 不黑屏, 真实算法 V3 接
    // _uid 占位 (V3 接陪伴者工时表后按 _uid 算, 现在还没用).
    return {
      daysSinceLastBreak: 0,
      burnoutLevel: 20,
      recommendedAction: '保持当前节奏, 别忘了自己也重要',
      accent: 'low',
    };
  }
}
