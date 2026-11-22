/**
 * 内心小岛 4 个区域 — V4.0 §3.1.
 *
 * 跟前端 `lib/features/inner_world/domain/entities/island_element.dart` 对齐.
 */
export enum IslandArea {
  Beach = 'beach',
  Forest = 'forest',
  Foothill = 'foothill',
  MountainTop = 'mountain_top',
}

/** 元素类型 — 决定 Rive 资源 / 互动方式. */
export enum IslandElementKind {
  /** 4 只核心宠物. */
  Pet = 'pet',
  /** 静态摆件 (树/灯/石头). */
  Plant = 'plant',
  /** 动态建筑 (灯塔/小屋/桥). */
  Building = 'building',
}

/**
 * 内置元素定义 — 4 × 2-3 = 10 个.
 *
 * 设计原则:
 *   - 定义硬编码在代码 (不需要 user-specific 表), 跟前端 enum 1:1
 *   - elementId 是稳定字符串 ID, 跨设备 / 跨版本不变
 *   - 默认全 locked, 用户首次 unlock 后写入 island_elements 表
 */
export interface IslandElementDef {
  readonly elementId: string;
  readonly area: IslandArea;
  readonly kind: IslandElementKind;
  readonly title: string;
  readonly emoji: string;
  /** 成长值阈值, 达到后触发视觉升级 (Rive state machine). */
  readonly growthMax: number;
}

export const ISLAND_ELEMENT_DEFS: readonly IslandElementDef[] = [
  // 海滩 (3 个)
  { elementId: 'beach.lighthouse', area: IslandArea.Beach, kind: IslandElementKind.Building, title: '灯塔', emoji: '🗼', growthMax: 100 },
  { elementId: 'beach.coconut', area: IslandArea.Beach, kind: IslandElementKind.Plant, title: '椰子树', emoji: '🌴', growthMax: 80 },
  { elementId: 'beach.jellyfish', area: IslandArea.Beach, kind: IslandElementKind.Pet, title: '呼吸水母', emoji: '🪼', growthMax: 120 },
  // 森林 (3 个)
  { elementId: 'forest.oak', area: IslandArea.Forest, kind: IslandElementKind.Plant, title: '橡树', emoji: '🌳', growthMax: 100 },
  { elementId: 'forest.cabin', area: IslandArea.Forest, kind: IslandElementKind.Building, title: '小木屋', emoji: '🏕️', growthMax: 90 },
  { elementId: 'forest.fox', area: IslandArea.Forest, kind: IslandElementKind.Pet, title: '思考狐狸', emoji: '🦊', growthMax: 120 },
  // 山脚 (2 个)
  { elementId: 'foothill.bridge', area: IslandArea.Foothill, kind: IslandElementKind.Building, title: '小桥', emoji: '🌉', growthMax: 80 },
  { elementId: 'foothill.bear', area: IslandArea.Foothill, kind: IslandElementKind.Pet, title: '抱抱熊', emoji: '🐻', growthMax: 120 },
  // 山顶 (2 个)
  {
    elementId: 'mountain-top.flag',
    area: IslandArea.MountainTop,
    kind: IslandElementKind.Building,
    title: '山顶旗',
    emoji: '🚩',
    growthMax: 80,
  },
  {
    elementId: 'mountain-top.hedgehog',
    area: IslandArea.MountainTop,
    kind: IslandElementKind.Pet,
    title: '边界刺猬',
    emoji: '🦔',
    growthMax: 120,
  },
];

/** 装饰类型. */
export enum DecorationKind {
  Furniture = 'furniture',
  Plant = 'plant',
  Seasonal = 'seasonal',
}

/**
 * 内置装饰定义 — 用户用碎片购买后可摆放到 4 区.
 *
 * 价格档位 (V4.0 §3.2): 5/10/15 碎片, 区分摆件/植物/季节.
 */
export interface DecorationDef {
  readonly decorationId: string;
  readonly kind: DecorationKind;
  readonly title: string;
  readonly emoji: string;
  /** 价格: 碎片总数 (任意类型混合扣). */
  readonly priceFragments: number;
}

export const DECORATION_DEFS: readonly DecorationDef[] = [
  // 摆件 (5 碎片)
  { decorationId: 'deco.lantern', kind: DecorationKind.Furniture, title: '纸灯笼', emoji: '🏮', priceFragments: 5 },
  { decorationId: 'deco.rock', kind: DecorationKind.Furniture, title: '禅意石', emoji: '🪨', priceFragments: 5 },
  { decorationId: 'deco.bell', kind: DecorationKind.Furniture, title: '风铃', emoji: '🛎️', priceFragments: 5 },
  // 植物 (10 碎片)
  { decorationId: 'deco.bonsai', kind: DecorationKind.Plant, title: '盆栽', emoji: '🌿', priceFragments: 10 },
  { decorationId: 'deco.cherry', kind: DecorationKind.Plant, title: '樱花树', emoji: '🌸', priceFragments: 15 },
  { decorationId: 'deco.lotus', kind: DecorationKind.Plant, title: '莲花', emoji: '🪷', priceFragments: 10 },
  // 季节 (15 碎片)
  { decorationId: 'deco.snowman', kind: DecorationKind.Seasonal, title: '雪人', emoji: '⛄', priceFragments: 15 },
  { decorationId: 'deco.firework', kind: DecorationKind.Seasonal, title: '烟花', emoji: '🎆', priceFragments: 15 },
  { decorationId: 'deco.kite', kind: DecorationKind.Seasonal, title: '风筝', emoji: '🪁', priceFragments: 15 },
];
