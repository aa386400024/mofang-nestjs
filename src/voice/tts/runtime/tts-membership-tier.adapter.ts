/**
 * 会员档位适配器 — 把会员 v2 的有效档位归一成 voice 侧的访问档.
 *
 * 放 voice 侧而不是 membership 侧: 依赖方向保持 voice -> membership 单向,
 * membership 不需要知道 TTS 存在; 会员服务重构只影响本文件.
 */

import { Injectable, Logger } from '@nestjs/common';

import type { TtsAccessTier } from './tts-profile.types.js';
import { MembershipTier } from '../../../membership/domain/membership.enums.js';
import { MembershipAccountService } from '../../../membership/providers/membership-account.service.js';

/** 会员 v2 四档 -> 访问档; 枚举之外的值一律 free. */
const TIER_MAP: Readonly<Record<string, TtsAccessTier>> = {
  [MembershipTier.Free]: 'free',
  [MembershipTier.Plus]: 'plus',
  [MembershipTier.Pro]: 'pro',
  [MembershipTier.Max]: 'max',
};

@Injectable()
export class TtsMembershipTierAdapter {
  private readonly logger = new Logger(TtsMembershipTierAdapter.name);

  constructor(private readonly accounts: MembershipAccountService) {}

  /**
   * 读取有效访问档; 查询异常/无账号/过期统一 free, 保证语音链路可用.
   *
   * @param uid 用户 id
   * @param now 判定时刻
   * @returns free/plus/pro/max
   */
  async getEffectiveTier(uid: string, now: Date): Promise<TtsAccessTier> {
    try {
      const tier = await this.accounts.getEffectiveTier(uid, now);
      return TIER_MAP[tier] ?? 'free';
    } catch (err) {
      // 会员查询失败不能阻断对练; 降级 Free + 可观测日志.
      this.logger.warn(`[tts_membership_tier_failed] uid=${uid} fallback=free reason=${err instanceof Error ? err.message : String(err)}`);
      return 'free';
    }
  }
}
