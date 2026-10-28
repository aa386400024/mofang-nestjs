/**
 * 心理碎片 5 种类型 — V4.0 §3.2.
 *
 * 跟前端 `lib/features/inner_world/domain/entities/fragment_type.dart`
 * 字段 1:1, 改这里必须同步改前端.
 *
 * 获取规则 (见 reconciliation 业务):
 *   - 平静气泡 (calm):     基础 3 个, 双人 2 个
 *   - 思维镜片 (thinking): CBT/ACT 完成 +2, 双人 2 个
 *   - 星光粒子 (starlight): 完成 5 感接地法 +1, 深度工具 +2
 *   - 温暖碎片 (warmth):   急救完成 +1, 陪伴练习 +2
 *   - 勇气结晶 (courage):  分级暴露完成 +1, 小怪兽驯服节点 +1
 */
export enum FragmentType {
  Calm = 'calm',
  Thinking = 'thinking',
  Starlight = 'starlight',
  Warmth = 'warmth',
  Courage = 'courage',
}

/**
 * 来源标记 — 描述碎片产生/消耗的业务触发点.
 *
 * 设计原则:
 *   - 字符串常量 (非 enum), 方便业务自由扩展, 不需改库
 *   - 前端 grant 来源: practice.tool.completed / emergency.tool.completed /
 *     dual.exercise.completed / manual.decor.purchase.undo ...
 *   - 前端 consume 来源: shop.skin / shop.decoration / shop.blindbox ...
 */
export type FragmentSource =
  | 'practice.tool.completed'
  | 'emergency.tool.completed'
  | 'emergency.blindbox.completed'
  | 'dual.exercise.completed'
  | 'act.thought-leaves.refactored'
  | 'genome-reshape.monster.tamed'
  | 'companion.tree.watered'
  | 'manual.adjust'
  | 'shop.skin.consume'
  | 'shop.theme.consume'
  | 'shop.decoration.consume'
  | 'shop.blindbox.consume'
  | 'system.reconcile';

export const FRAGMENT_TYPE_VALUES: FragmentType[] = [
  FragmentType.Calm,
  FragmentType.Thinking,
  FragmentType.Starlight,
  FragmentType.Warmth,
  FragmentType.Courage,
];
