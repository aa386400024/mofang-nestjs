/**
 * 工具皮肤 + 主题包定义 — V4.0 §3.4.
 *
 * 皮肤 rarity 决定解锁方式:
 *   - Default:  默认 (无需解锁)
 *   - Fragment: 碎片解锁 (cost 是任意类型碎片数量)
 *   - Member:   会员限定 (走 membership 校验, 不在 V4.0 范围)
 *
 * 主题包类似.
 */
export enum SkinRarity {
  Default = 'default',
  Fragment = 'fragment',
  Member = 'member',
}

/** 工具 ID — 跟 practice-tools 主键对齐, 字符串稳定. */
export enum ToolId {
  Grounding54321 = 'emergency.5-4-3-2-1',
  Breathing448 = 'emergency.4-4-8',
  SafePlace = 'emergency.safe_place',
  Tipp = 'emergency.tipp',
  ThoughtDefusion = 'emergency.thought-defusion',
  ThoughtLeaves = 'act.thought-leaves',
}

/** 皮肤定义 — 至少 4 款 / 工具 (V4.0 §3.4). */
export interface ToolSkinDef {
  readonly skinId: string;
  readonly toolId: ToolId;
  readonly title: string;
  readonly emoji: string;
  readonly rarity: SkinRarity;
  /** 解锁所需碎片数 (rarity=fragment 时必填, 否则 0). */
  readonly unlockCostFragments: number;
  /** 是否需要会员 (rarity=member 时返回 true, 不在前端硬判断). */
  readonly requiresMember: boolean;
  /** 主题色 token (跟前端 brand_colors 对齐). */
  readonly accentToken: string;
}

/**
 * 内置皮肤清单.
 *
 * 约束:
 *   - 每个工具至少 1 个 Default + 1 个 Fragment 解锁 + 1 个 Member 限定
 *   - 数量超出时可自由扩展
 */
export const TOOL_SKIN_DEFS: readonly ToolSkinDef[] = [
  // 5-4-3-2-1 接地法 (4 款)
  {
    skinId: 'grounding.default',
    toolId: ToolId.Grounding54321,
    title: '默认',
    emoji: '🌿',
    rarity: SkinRarity.Default,
    unlockCostFragments: 0,
    requiresMember: false,
    accentToken: 'success',
  },
  {
    skinId: 'grounding.forest',
    toolId: ToolId.Grounding54321,
    title: '森林',
    emoji: '🌲',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 20,
    requiresMember: false,
    accentToken: 'mistyPink',
  },
  {
    skinId: 'grounding.ocean',
    toolId: ToolId.Grounding54321,
    title: '海洋',
    emoji: '🌊',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 25,
    requiresMember: false,
    accentToken: 'mintCyan',
  },
  {
    skinId: 'grounding.member',
    toolId: ToolId.Grounding54321,
    title: '会员限定',
    emoji: '✨',
    rarity: SkinRarity.Member,
    unlockCostFragments: 0,
    requiresMember: true,
    accentToken: 'warning',
  },

  // 4-4-8 呼吸法
  {
    skinId: 'breathing.default',
    toolId: ToolId.Breathing448,
    title: '默认',
    emoji: '🫁',
    rarity: SkinRarity.Default,
    unlockCostFragments: 0,
    requiresMember: false,
    accentToken: 'success',
  },
  {
    skinId: 'breathing.dawn',
    toolId: ToolId.Breathing448,
    title: '晨曦',
    emoji: '🌅',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 15,
    requiresMember: false,
    accentToken: 'warning',
  },
  {
    skinId: 'breathing.midnight',
    toolId: ToolId.Breathing448,
    title: '午夜',
    emoji: '🌌',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 20,
    requiresMember: false,
    accentToken: 'softBlue',
  },
  {
    skinId: 'breathing.member',
    toolId: ToolId.Breathing448,
    title: '会员限定',
    emoji: '✨',
    rarity: SkinRarity.Member,
    unlockCostFragments: 0,
    requiresMember: true,
    accentToken: 'mistyPink',
  },

  // 安全岛引导
  {
    skinId: 'safeplace.default',
    toolId: ToolId.SafePlace,
    title: '默认',
    emoji: '🏝️',
    rarity: SkinRarity.Default,
    unlockCostFragments: 0,
    requiresMember: false,
    accentToken: 'success',
  },
  {
    skinId: 'safeplace.sunset',
    toolId: ToolId.SafePlace,
    title: '日落',
    emoji: '🌇',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 20,
    requiresMember: false,
    accentToken: 'warning',
  },
  {
    skinId: 'safeplace.member',
    toolId: ToolId.SafePlace,
    title: '会员限定',
    emoji: '✨',
    rarity: SkinRarity.Member,
    unlockCostFragments: 0,
    requiresMember: true,
    accentToken: 'mistyPink',
  },

  // TIPP
  {
    skinId: 'tipp.default',
    toolId: ToolId.Tipp,
    title: '默认',
    emoji: '🧊',
    rarity: SkinRarity.Default,
    unlockCostFragments: 0,
    requiresMember: false,
    accentToken: 'softBlue',
  },
  {
    skinId: 'tipp.glacier',
    toolId: ToolId.Tipp,
    title: '冰川',
    emoji: '🏔️',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 20,
    requiresMember: false,
    accentToken: 'softBlue',
  },
  {
    skinId: 'tipp.member',
    toolId: ToolId.Tipp,
    title: '会员限定',
    emoji: '✨',
    rarity: SkinRarity.Member,
    unlockCostFragments: 0,
    requiresMember: true,
    accentToken: 'mistyPink',
  },

  // 思维泡泡 (解离)
  {
    skinId: 'bubble.default',
    toolId: ToolId.ThoughtDefusion,
    title: '默认',
    emoji: '🫧',
    rarity: SkinRarity.Default,
    unlockCostFragments: 0,
    requiresMember: false,
    accentToken: 'mistyPink',
  },
  {
    skinId: 'bubble.aurora',
    toolId: ToolId.ThoughtDefusion,
    title: '极光',
    emoji: '🌌',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 25,
    requiresMember: false,
    accentToken: 'softBlue',
  },
  {
    skinId: 'bubble.member',
    toolId: ToolId.ThoughtDefusion,
    title: '会员限定',
    emoji: '✨',
    rarity: SkinRarity.Member,
    unlockCostFragments: 0,
    requiresMember: true,
    accentToken: 'warning',
  },

  // 思维落叶森林 (act.thought-leaves)
  {
    skinId: 'leaves.default',
    toolId: ToolId.ThoughtLeaves,
    title: '默认',
    emoji: '🍂',
    rarity: SkinRarity.Default,
    unlockCostFragments: 0,
    requiresMember: false,
    accentToken: 'warning',
  },
  {
    skinId: 'leaves.spring',
    toolId: ToolId.ThoughtLeaves,
    title: '春日',
    emoji: '🌱',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 25,
    requiresMember: false,
    accentToken: 'success',
  },
  {
    skinId: 'leaves.member',
    toolId: ToolId.ThoughtLeaves,
    title: '会员限定',
    emoji: '✨',
    rarity: SkinRarity.Member,
    unlockCostFragments: 0,
    requiresMember: true,
    accentToken: 'mistyPink',
  },
];

/**
 * 主题包 — 整 app 级别的视觉风格包 (V4.0 §3.4).
 *
 * 区别: 工具皮肤只改单个工具的视觉; 主题包改整个 app 的色彩 / 字体 / 布局 token.
 */
export interface ThemePackDef {
  readonly packId: string;
  readonly title: string;
  readonly emoji: string;
  readonly rarity: SkinRarity;
  readonly unlockCostFragments: number;
  readonly requiresMember: boolean;
  /** 预览色 token (hex), 前端 chip 用. */
  readonly previewTokens: readonly string[];
}

export const THEME_PACK_DEFS: readonly ThemePackDef[] = [
  {
    packId: 'theme.default',
    title: '默认',
    emoji: '🎨',
    rarity: SkinRarity.Default,
    unlockCostFragments: 0,
    requiresMember: false,
    previewTokens: ['primary', 'mistyPink', 'softBlue', 'mintCyan'],
  },
  {
    packId: 'theme.sakura',
    title: '樱花季',
    emoji: '🌸',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 30,
    requiresMember: false,
    previewTokens: ['mistyPink', 'warning', 'primary'],
  },
  {
    packId: 'theme.forest',
    title: '森林夜',
    emoji: '🌲',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 30,
    requiresMember: false,
    previewTokens: ['success', 'mintCyan', 'primary'],
  },
  {
    packId: 'theme.ocean',
    title: '深海洋',
    emoji: '🌊',
    rarity: SkinRarity.Fragment,
    unlockCostFragments: 30,
    requiresMember: false,
    previewTokens: ['softBlue', 'mintCyan'],
  },
  {
    packId: 'theme.member',
    title: '会员限定',
    emoji: '✨',
    rarity: SkinRarity.Member,
    unlockCostFragments: 0,
    requiresMember: true,
    previewTokens: ['warning', 'primary', 'mistyPink'],
  },
];
