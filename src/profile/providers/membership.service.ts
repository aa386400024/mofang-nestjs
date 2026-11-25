import { Injectable } from '@nestjs/common';

import { MembershipStatus } from '../../membership/domain/membership.enums.js';
import { LEGACY_TIER_REVERSE_MAP } from '../../membership/membership.constants.js';
import { MembershipAccountService } from '../../membership/providers/membership-account.service.js';
import { MembershipBenefitDto, MembershipDto } from '../dto/membership.dto.js';

/**
 * 旧 /profile/membership 兼容层。
 *
 * 账号、档位、配额由 MembershipAccountService 统一提供；本层只做旧 4 态 /
 * 旧 3 档 / 5 个硬编码权益的 wire 映射，旧客户端继续可用，新字段一并返回。
 */
@Injectable()
export class MembershipService {
  constructor(private readonly accountService: MembershipAccountService) {}

  async getMembership(uid: string): Promise<MembershipDto> {
    const overview = await this.accountService.getOverview(uid);
    const account = overview.account;
    return {
      status: this.toLegacyStatus(account.status),
      tier: LEGACY_TIER_REVERSE_MAP[account.tier],
      expiresAt: account.expiresAt,
      benefits: this.getBenefits(account.status),
      tierV2: account.tier,
      minutesRemaining: overview.quota.totalRemainingMinutes,
      periodEnd: account.periodEnd,
    };
  }

  /** 新状态机 → 旧 4 态 wire，旧客户端不感知 grace/paused/refunded。 */
  private toLegacyStatus(status: MembershipStatus): 'inactive' | 'active' | 'expired' | 'trial' {
    if (status === MembershipStatus.Active || status === MembershipStatus.Grace) return 'active';
    if (status === MembershipStatus.Trial) return 'trial';
    if (status === MembershipStatus.Expired || status === MembershipStatus.Refunded) return 'expired';
    return 'inactive';
  }

  /**
   * 5 个 V2.0 权益 — 跟前端 V2.0 §Tab4 会员中心一致.
   * unlocked 跟当前 membership.status 关联 (active / trial → 解锁, 否则锁).
   */
  private getBenefits(status: MembershipStatus): MembershipBenefitDto[] {
    const isActive = status === MembershipStatus.Active || status === MembershipStatus.Trial;
    return [
      {
        icon: 'insights_outlined',
        title: '高级成长报告',
        description: '月度深度报告 + 周趋势曲线',
        unlocked: isActive,
      },
      {
        icon: 'psychology_outlined',
        title: '全套循证练习库',
        description: 'CBT / ACT / DBT / 正念全系列解锁',
        unlocked: isActive,
      },
      {
        icon: 'psychology_alt_outlined',
        title: 'AI 心塑助手无限次',
        description: '24 小时在线, 不限对话次数',
        unlocked: isActive,
      },
      {
        icon: 'handshake_outlined',
        title: '高级陪伴权限',
        description: 'L3 互动权限, 含康复进度同步',
        unlocked: isActive,
      },
      {
        icon: 'headset_mic_outlined',
        title: '专家答疑 (每月 2 次)',
        description: '心理咨询师在线文字答疑',
        unlocked: isActive,
      },
    ];
  }
}
