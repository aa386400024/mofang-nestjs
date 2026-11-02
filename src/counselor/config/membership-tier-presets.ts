// V2026-10-15 治本 (V4.2 — 5 档会员 + 2 派生 + 配额配置静态 config):
//   原因: counselor-mode-v1.0 §7.1 + §7.3 拍板 5 档会员价格 + 配额, V0.3 §13 baseline
//     0 配额表 + 0 5 档会员表, 1:1 wire 0 破坏. 5 档会员 + 配额走静态 TS config (跟 W1-2
//     long-term-case-presets + W3-4 supervision-school-presets + W5-6 ability-dimension-presets
//     同 pattern), V0.5 stage 不写 seed migration 走 service 内部读 TS config, V1.x 续做
//     写 billing_admin 实际维护.
//
//   修法:
//     - MEMBERSHIP_TIER_PRESETS: 5 + 2 派生 (student / public_welfare) preset, key = MembershipTier enum
//     - 每个 preset 含 6 字段: tier / displayName / price / durationDays / quotas / features
//     - quotas 3 类 (voice_session / long_term_case / voice_analysis), -1 表示不限, 0 表示不可用
//     - V0.x free 等同 V1.x none, 配额为 0 (无会员不可用语音 + 长程 + 语音分析)
//     - V0.x plus ≈ V1.x monthly, V0.x pro ≈ V1.x quarterly (1:1 兼容)
//
//   反双胞胎:
//     - 不用 seed migration 写 5 档会员: V0.5 阶段 service 内部读 TS config, V1.x 续做
//       写 billing_admin 实际维护 (跟 W1-2 + W3-4 + W5-6 同 pattern)
//     - 不用 i18n: V0.x 阶段中文, V1.x 多语言时再加 i18n layer
//     - 不在 preset 存配额扣减规则: 扣减逻辑在 billing.service.consume 内部
//
//   验证:
//     1. tsc 0 错 (5 + 2 preset 字段 type 严格)
//     2. 跟 counselor-mode-v1.0 §7.1 + §7.3 cross-ref: 价格 / 配额 1:1
//
//   时间戳: 2026-10-15

import { MembershipTier } from '../enums/membership-tier.enum';
import { QuotaType } from '../enums/quota-type.enum';

/**
 * 单档会员配额配置.
 *
 * -1 表示不限 (lifetime), 0 表示不可用 (none / 无该功能).
 */
export interface MembershipTierPreset {
  /** 跟 MembershipTier enum 1:1 */
  tier: MembershipTier;
  /** UI 展示名 (跟 counselor-mode-v1.0 §7.1 表 1:1) */
  displayName: string;
  /** 价格 (元, lifetime 999, monthly 29, quarterly 69, yearly 198, student 半价, public_welfare 0) */
  price: number;
  /** 有效期 (天, lifetime 36500 = 100 年) */
  durationDays: number;
  /** 3 类配额配置 (voice_session / long_term_case / voice_analysis) */
  quotas: Record<QuotaType, number>;
  /** UI 展示特性列表 (跟 counselor-mode-v1.0 §9.3 表 1:1) */
  features: string[];
}

/**
 * 5 档会员 + 2 派生 (counselor-mode-v1.0 §7.1 + §7.3 1:1).
 *
 * 排序按 §7.1 表 1:1 (none → monthly → quarterly → yearly → lifetime → student → public_welfare).
 */
export const MEMBERSHIP_TIER_PRESETS: Record<MembershipTier, MembershipTierPreset> = {
  // 无会员 (免费, V0.x free 兼容)
  [MembershipTier.NONE]: {
    tier: MembershipTier.NONE,
    displayName: '免费',
    price: 0,
    durationDays: 0, // 永久免费
    quotas: {
      [QuotaType.VOICE_SESSION]: 0, // 文字模式 0 消耗, 语音 0 不可用
      [QuotaType.LONG_TERM_CASE]: 0, // 长程 0 不可用
      [QuotaType.VOICE_ANALYSIS]: 0, // 语音分析 0 不可用
    },
    features: ['文字训练不限', '难度 L1-L2', '备考每日 5 题', '数据本地 30 天'],
  },

  // 月卡 29 元/月
  [MembershipTier.MONTHLY]: {
    tier: MembershipTier.MONTHLY,
    displayName: '月卡',
    price: 29,
    durationDays: 30,
    quotas: {
      [QuotaType.VOICE_SESSION]: 12, // 每月 12 场全流程语音
      [QuotaType.LONG_TERM_CASE]: 2, // 每月 2 个完整个案
      [QuotaType.VOICE_ANALYSIS]: 0, // 语音分析 0 (yearly 才解锁)
    },
    features: ['全流派督导 + 逐句精析', 'L1-L3 全解锁', '长程 2 个/月', '数据云端加密 + 多设备同步'],
  },

  // 季卡 69 元/季
  [MembershipTier.QUARTERLY]: {
    tier: MembershipTier.QUARTERLY,
    displayName: '季卡',
    price: 69,
    durationDays: 90,
    quotas: {
      [QuotaType.VOICE_SESSION]: 12 * 3, // 3 个月 36 场
      [QuotaType.LONG_TERM_CASE]: 2 * 3, // 3 个月 6 个
      [QuotaType.VOICE_ANALYSIS]: 0,
    },
    features: ['月卡全部', '备考全量真题 + 无限模考', '逐月 12 场 + 长程 2 个'],
  },

  // 年卡 198 元/年 (推荐)
  [MembershipTier.YEARLY]: {
    tier: MembershipTier.YEARLY,
    displayName: '年卡 (推荐)',
    price: 198,
    durationDays: 365,
    quotas: {
      [QuotaType.VOICE_SESSION]: 12 * 12, // 12 个月 144 场 (≈ 每周 3 场, 跟 PRD §7.5 "12 场" 一致)
      [QuotaType.LONG_TERM_CASE]: 2 * 12, // 12 个月 24 个
      [QuotaType.VOICE_ANALYSIS]: 4, // 每月 4 次 (跟 PRD §7.5 1:1)
    },
    features: ['月卡全部 + 季卡全部', '语音专项分析 4 次/月', '高阶游戏化模块', '限定皮肤', '年成本 ≈ 720 元/月均'],
  },

  // 终身卡 999 元
  [MembershipTier.LIFETIME]: {
    tier: MembershipTier.LIFETIME,
    displayName: '终身卡',
    price: 999,
    durationDays: 36_500, // 100 年
    quotas: {
      [QuotaType.VOICE_SESSION]: -1, // 不限
      [QuotaType.LONG_TERM_CASE]: -1, // 不限
      [QuotaType.VOICE_ANALYSIS]: -1, // 不限
    },
    features: ['年卡全部', '全部功能不限次', '终身云端同步', '优先客服'],
  },

  // 学生认证 (月卡/年卡半价, 跟 §7.1 学生认证 1:1)
  [MembershipTier.STUDENT]: {
    tier: MembershipTier.STUDENT,
    displayName: '学生认证 (月卡/年卡半价)',
    price: 0, // 由具体档位 (monthly 或 yearly 半价) 决定, 0 占位
    durationDays: 0, // 跟具体档位一致
    quotas: {
      [QuotaType.VOICE_SESSION]: 0,
      [QuotaType.LONG_TERM_CASE]: 0,
      [QuotaType.VOICE_ANALYSIS]: 0,
    },
    features: ['月卡 / 年卡半价', '需上传学生证审核', '同档位全部功能'],
  },

  // 公益名额 0 元 (限量, 跟 §7.1 公益名额 1:1)
  [MembershipTier.PUBLIC_WELFARE]: {
    tier: MembershipTier.PUBLIC_WELFARE,
    displayName: '公益名额',
    price: 0,
    durationDays: 365, // 1 年
    quotas: {
      [QuotaType.VOICE_SESSION]: 12 * 12, // 跟 yearly 一致
      [QuotaType.LONG_TERM_CASE]: 2 * 12,
      [QuotaType.VOICE_ANALYSIS]: 4,
    },
    features: ['年卡全部功能', '0 元免费', '每月限量, 需审核', '用于低收入 / 残障 / 公益咨询师'],
  },
};
