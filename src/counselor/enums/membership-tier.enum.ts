// V2026-10-15 治本 (V4.1 — membership_tier 5 档 + 2 派生枚举):
//   原因: counselor-mode-v1.0 §7.1 拍板 5 档会员 (none/monthly/quarterly/yearly/lifetime)
//     + 2 派生 (student 半价 / publicwelfare 0 元), V0.3 §13 baseline 已有 user_memberships
//     表 3 档 (free/plus/pro) 跟 V0.5 culture 1:1 wire 0 破坏, V1.x W7-8 走 user_memberships
//     加列 tier_v2 (5 档) 增量, V0.x tier (3 档) 保留 V0.x 客户端继续读.
//
//   修法:
//     - 5 tier 跟 counselor-mode-v1.0 §7.1 1:1 (none = V0.x free, monthly/quarterly/yearly/lifetime)
//     - 2 派生 (student 半价 / publicwelfare 0 元) 跟 §7.1 student 认证 / 公益名额 1:1
//     - 静态 enum (无 DB 行, 跟 V0.x enum 风格一致)
//     - 跟 membership-tier-presets.ts 5 preset 1:1 配对
//     - 跟 V0.x user_memberships.tier (free/plus/pro) 1:1 兼容: V1.x 客户端读 tier_v2,
//       V0.x 客户端读 tier, 0 冲突
//
//   反双胞胎:
//     - 不在 V0.x user_memberships.tier 字段改 enum 字符串: 破坏 1:1 wire, V0.x 客户端
//       读 free/plus/pro 失败
//     - 不用 i18n key: V0.x 阶段中文, V1.x 多语言时再加 i18n layer
//     - 不写 "none" 含义: 跟 V0.x free 1:1 映射, V0.x 客户端 free ↔ V1.x 客户端 none 语义一致
//
//   验证:
//     1. SELECT enum: 7 值全在 (5 + 2 派生)
//     2. 跟 counselor-mode-v1.0 §7.1 表 cross-ref: 5 名称 + 价格 1:1
//     3. 跟 membership-tier-presets.ts 5 preset 1:1
//
//   时间戳: 2026-10-15

/**
 * 5 档会员 (V1.x counselor-mode §7.1) + 2 派生 (student / publicwelfare).
 *
 * 跟 V0.x user_memberships.tier (free/plus/pro) 1:1 兼容:
 *   - V0.x free ↔ V1.x none
 *   - V0.x plus ↔ V1.x monthly
 *   - V0.x pro ↔ V1.x quarterly
 * 跟 xin_su_app MembershipTier enum 1:1 同步.
 * 跟 src/counselor/config/membership-tier-presets.ts 5 preset 1:1 配对.
 */
export enum MembershipTier {
  /** 无会员 (免费, 跟 V0.x free 语义一致) */
  NONE = 'none',
  /** 月卡 29 元/月 */
  MONTHLY = 'monthly',
  /** 季卡 69 元/季 */
  QUARTERLY = 'quarterly',
  /** 年卡 198 元/年 (推荐) */
  YEARLY = 'yearly',
  /** 终身卡 999 元 (V0.3 §10 已写) */
  LIFETIME = 'lifetime',
  /** 学生认证 (月卡/年卡半价, 跟 §7.1 学生认证 1:1) */
  STUDENT = 'student',
  /** 公益名额 0 元 (限量, 跟 §7.1 公益名额 1:1) */
  PUBLIC_WELFARE = 'public_welfare',
}
