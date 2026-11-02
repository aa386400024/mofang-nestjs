// V2026-09-04 治本 (V6.0 §3.3 + audit P0-1):
//   AI 动态解锁枚举 — 6 大高阶功能 + 4 状态机.
//   原因: 前端 AIUnlockFeature / AIUnlockStateX 已定义 enum, 后端保持对齐.
//   修复: code 字符串字面量与前端一致.
//   如何验证: GET /ai/unlock 返回 features[].feature 字符串能被前端
//             AIUnlockFeature.fromCode() 解析; states[].state 字符串能被
//             AIUnlockStateX.fromCode() 解析.

/**
 * 6 大高阶功能 — V6.0 §3.3 表.
 *
 * 解锁条件详情见 PRD §3.3, 核心判断维度: 需求强度(40%) / 使用深度(25%) /
 * 干预效果(20%) / 心理准备度(15%), 综合分 >= 0.6 触发软解锁.
 */
export enum AIUnlockFeature {
  /** 内部声音教练 — 自我批判语义出现频次 ≥ 每周 3 次, 基础 CBT 有效. */
  INNER_VOICE_COACH = 'inner_voice_coach',

  /** 心理基因靶向重塑 — 连续 2 周评估显示中度以上困扰 + 平台期. */
  GENOME_RESHAPE = 'genome_reshape',

  /** 人生剧本推演 — 重大人生选择 / 阶段梳理卡点. */
  LIFE_SCRIPT = 'life_script',

  /** 具身认知深度功能 — 情绪躯体化 + 基础呼吸效果有限. */
  EMBODIED_DEEP = 'embodied_deep',

  /** 共种陪伴树 — 活跃陪伴者 + ≥1 次双人 + 游戏化接受度 ≥60%. */
  COMPANION_TREE = 'companion_tree',

  /** 宠物养成 — 完成 4 模块各 5 次 + 游戏化接受度 ≥60%. */
  PET_CULTIVATION = 'pet_cultivation',
}

export const ALL_UNLOCK_FEATURES: readonly AIUnlockFeature[] = [
  AIUnlockFeature.INNER_VOICE_COACH,
  AIUnlockFeature.GENOME_RESHAPE,
  AIUnlockFeature.LIFE_SCRIPT,
  AIUnlockFeature.EMBODIED_DEEP,
  AIUnlockFeature.COMPANION_TREE,
  AIUnlockFeature.PET_CULTIVATION,
] as const;

/**
 * 解锁状态机 — V6.0 §3.3.
 *
 * - locked: 未解锁
 * - unlocking: 解锁中 (用户主动申请 / 付费 / 评分达标过渡期)
 * - unlocked: 已解锁
 * - rolled_back: 回退 (§3.3「使用效果不佳, AI 自动暂时隐藏」)
 */
export enum AIUnlockState {
  LOCKED = 'locked',
  UNLOCKING = 'unlocking',
  UNLOCKED = 'unlocked',
  ROLLED_BACK = 'rolled_back',
}

/**
 * §3.3 解锁阈值: 综合分 >= 0.6 触发软解锁 (不弹窗, 入口自动点亮).
 *
 * 大厂 standard: 阈值常量集中, 后续调参不散在 controller / service.
 */
export const UNLOCK_COMPOSITE_THRESHOLD = 0.6;

/**
 * §3.3 表权重 — 综合分 = need*0.4 + usage*0.25 + effect*0.2 + readiness*0.15.
 */
export const UNLOCK_WEIGHTS = {
  need: 0.4,
  usage: 0.25,
  effect: 0.2,
  readiness: 0.15,
} as const;
