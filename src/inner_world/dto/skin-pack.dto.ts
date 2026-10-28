import { IsOptional, IsString, Length } from 'class-validator';

/**
 * 工具皮肤 + 主题包 DTO.
 *
 * 跟 inner_world_skin_rarity.enum 的常量 1:1 渲染, 后端只承担"用户状态"职责.
 */
export class ToolSkinDto {
  skinId!: string;
  toolId!: string;
  title!: string;
  emoji!: string;
  rarity!: string; // 'default' | 'fragment' | 'member'
  unlockCostFragments!: number;
  /** 会员限定 — 是否对当前用户开放 (member 校验走 service 层). */
  available!: boolean;
  unlocked!: boolean;
  equipped!: boolean;
}

export class ToolSkinsListDto {
  toolId!: string;
  skins!: ToolSkinDto[];
  /** 当前装备的皮肤 id, 没装备为 null. */
  equippedSkinId!: string | null;
}

export class UnlockSkinDto {
  /** 幂等 key. */
  @IsOptional()
  @IsString()
  @Length(1, 128)
  idempotencyKey?: string;
}

export class UnlockSkinResponseDto {
  skinId!: string;
  spentFragments!: number;
  balances!: { type: string; balance: number }[];
}

export class EquipSkinDto {
  // 装备不需要 body, 路径参数 skinId 足够.
}

/** 主题包 DTO. */
export class ThemePackDto {
  packId!: string;
  title!: string;
  emoji!: string;
  rarity!: string;
  unlockCostFragments!: number;
  available!: boolean;
  unlocked!: boolean;
  active!: boolean;
  previewTokens!: readonly string[];
}

export class ThemePacksListDto {
  packs!: ThemePackDto[];
  activePackId!: string | null;
}
