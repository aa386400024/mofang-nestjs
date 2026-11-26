/**
 * 会员有效档位端口 — voice 侧只认“有效访问档”, 不 import 会员枚举/实体.
 *
 * 为什么需要端口:
 * - voice 是 agent 侧, 会员是账号业务侧; 直接 import MembershipAccountService
 *   会把语音链路与会员表结构绑死, 会员重构会连带炸对练;
 * - 适配器负责把 DB 状态 (status/periodEnd) 归一成 free/plus/pro/max,
 *   查询异常/未登录/过期统一落 free, 保证语音永远有可用档位.
 */

import type { TtsAccessTier } from '../runtime/tts-profile.types.js';

export const MEMBERSHIP_TIER_PORT = Symbol('MEMBERSHIP_TIER_PORT');

export interface MembershipTierPort {
  /**
   * 读取用户当前有效访问档.
   *
   * 语义: 只有 status=Active 且 periodEnd > now 才返回付费档;
   * 其余 (不存在/过期/查询异常) 一律返回 free, 不抛错.
   *
   * @param uid 用户 id
   * @param now 判定时刻
   * @returns 有效访问档
   */
  getEffectiveTier(uid: string, now: Date): Promise<TtsAccessTier>;
}
