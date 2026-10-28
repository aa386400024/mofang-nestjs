import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { IslandArea } from '../enums/island-area.enum';

/**
 * 单个元素 DTO — 用于 elements 列表接口.
 */
export class IslandElementDto {
  elementId!: string;
  area!: IslandArea;
  title!: string;
  emoji!: string;
  kind!: string; // 'pet' | 'plant' | 'building'
  growthValue!: number;
  growthMax!: number;
  unlockedAt!: string | null; // ISO-8601, null = 未解锁
}

export class IslandElementsDto {
  elements!: IslandElementDto[];
  /** 按 4 区分组统计. */
  byArea!: Record<IslandArea, { total: number; unlocked: number }>;
}

/**
 * 解锁/成长 写请求.
 */
export class UnlockElementDto {
  @IsString()
  @Length(1, 64)
  elementId!: string;
}

export class GrowElementDto {
  /** 增量, 默认 10. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  delta?: number;

  /** 业务来源: 'practice.tool.completed' / 'act.thought-leaves.refactored' / ... */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  source?: string;
}

/** 装饰 DTO. */
export class DecorationDto {
  decorationId!: string;
  title!: string;
  emoji!: string;
  kind!: string;
  priceFragments!: number;
  owned!: boolean;
  placedArea!: IslandArea | null;
  placedX!: number | null;
  placedY!: number | null;
}

export class PlaceDecorationDto {
  @IsEnum(IslandArea)
  area!: IslandArea;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  x?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  y?: number;
}

export class PurchaseDecorationDto {
  @IsString()
  @Length(1, 64)
  decorationId!: string;

  /** 幂等 key. */
  @IsOptional()
  @IsString()
  @Length(1, 128)
  idempotencyKey?: string;
}

export class PurchaseDecorationResponseDto {
  decorationId!: string;
  spentFragments!: number;
  /** 扣减后的新余额. */
  balances!: { type: string; balance: number }[];
}
