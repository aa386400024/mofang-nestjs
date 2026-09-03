/**
 * 9 个核心徽章 — V4.0 §3.3.
 *
 * 跟前端 `lib/features/inner_world/domain/entities/badge_id.dart` 字段 1:1.
 *
 * 解锁规则集中在 `policies/badge-rules.ts`, 这里只放 ID 定义.
 */
export enum BadgeId {
  FirstListen = 'first_listen',
  BreathingBeginner = 'breathing_beginner',
  ThoughtCatcher = 'thought_catcher',
  GentleExplorer = 'gentle_explorer',
  Companion = 'companion',
  IslandGardener = 'island_gardener',
  Collector = 'collector',
  BreathingArtist = 'breathing_artist',
  ForestGardener = 'forest_gardener',
}

/** 全部 9 个 ID 数组 — 用于 reconciliation 全量扫描. */
export const BADGE_ID_VALUES: BadgeId[] = [
  BadgeId.FirstListen,
  BadgeId.BreathingBeginner,
  BadgeId.ThoughtCatcher,
  BadgeId.GentleExplorer,
  BadgeId.Companion,
  BadgeId.IslandGardener,
  BadgeId.Collector,
  BadgeId.BreathingArtist,
  BadgeId.ForestGardener,
];

/** 徽章展示元数据 — 跟前端 enum 字段对齐. */
export interface BadgeMeta {
  readonly id: BadgeId;
  readonly title: string;
  readonly description: string;
  readonly emoji: string;
}

export const BADGE_META: ReadonlyMap<BadgeId, BadgeMeta> = new Map([
  [BadgeId.FirstListen, { id: BadgeId.FirstListen, title: '第一次听见', description: '完成第一次呼吸练习', emoji: '👂' }],
  [BadgeId.BreathingBeginner, { id: BadgeId.BreathingBeginner, title: '呼吸初学者', description: '连续 3 天完成呼吸', emoji: '🫧' }],
  [BadgeId.ThoughtCatcher, { id: BadgeId.ThoughtCatcher, title: '思维捕手', description: '完成第一篇觉察日记', emoji: '🦋' }],
  [BadgeId.GentleExplorer, { id: BadgeId.GentleExplorer, title: '温柔探险家', description: '完成第一次分级暴露练习', emoji: '🚩' }],
  [BadgeId.Companion, { id: BadgeId.Companion, title: '陪伴者', description: '完成第一次双人协同练习', emoji: '🤝' }],
  [BadgeId.IslandGardener, { id: BadgeId.IslandGardener, title: '岛屿园师', description: '内心小岛解锁 10 个元素', emoji: '🌱' }],
  [BadgeId.Collector, { id: BadgeId.Collector, title: '收藏爱好者', description: '累计收集 100 颗碎片', emoji: '💎' }],
  [BadgeId.BreathingArtist, { id: BadgeId.BreathingArtist, title: '呼吸画家', description: '解锁 10 幅呼吸小画', emoji: '🖌️' }],
  [BadgeId.ForestGardener, { id: BadgeId.ForestGardener, title: '森林园师', description: '思维森林长出 10 棵树', emoji: '🌳' }],
]);
