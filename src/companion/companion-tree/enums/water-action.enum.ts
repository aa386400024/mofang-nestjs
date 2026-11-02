/**
 * 浇水动作 — V2026-09-12 §6.3 共种陪伴树.
 *
 * 大厂 standard 数值平衡 (对标蚂蚁森林合种):
 *   - water 浇水: +1, 60 秒冷却
 *   - fertilize 施肥: +3, 1 小时冷却
 *   - prune 修剪: +5, 24 小时冷却
 *
 * 反双胞胎:
 *   - 不复用 rehab/... 的 ActionType (那是康复项的状态, 不同)
 */
export enum WaterAction {
  WATER = 'water',
  FERTILIZE = 'fertilize',
  PRUNE = 'prune',
}

/**
 * 浇水动作的 delta + cooldown (秒).
 * 大厂 standard 数值 — 跟前端 companion_tree.dart 严格 1:1.
 */
export const WaterActionMeta: Readonly<Record<WaterAction, { delta: number; cooldownSeconds: number; label: string }>> = {
  [WaterAction.WATER]: { delta: 1, cooldownSeconds: 60, label: '浇水' },
  [WaterAction.FERTILIZE]: { delta: 3, cooldownSeconds: 3600, label: '施肥' },
  [WaterAction.PRUNE]: { delta: 5, cooldownSeconds: 86_400, label: '修剪' },
};
