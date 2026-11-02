import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsISO8601, IsOptional, IsString, Length, Min } from 'class-validator';

import { FragmentSource, FragmentType } from '../enums/fragment-type.enum';

/**
 * 余额单项 — 5 类碎片 × 当前余额.
 * 整个 balances 列表 = Map<FragmentType, number>.
 */
export interface FragmentBalanceDto {
  type: FragmentType;
  balance: number;
}

export class FragmentBalancesDto {
  @IsArray()
  @Type(() => FragmentBalanceItemDto)
  balances!: FragmentBalanceItemDto[];

  /** 总碎片数 (跨类型求和), 用于首页角标. */
  @IsInt()
  @Min(0)
  total!: number;
}

export class FragmentBalanceItemDto {
  @IsEnum(FragmentType)
  type!: FragmentType;

  @IsInt()
  @Min(0)
  balance!: number;
}

/**
 * 流水查询请求 — 支持 since 时间分页.
 */
export class ListFragmentLogsQueryDto {
  /** ISO-8601 时间, 仅返回 created_at > since 的记录. */
  @IsOptional()
  @IsISO8601()
  since?: string;

  /** 限制条数, 默认 50, 上限 200. */
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  /** 可选, 过滤特定类型. */
  @IsOptional()
  @IsEnum(FragmentType)
  type?: FragmentType;
}

export class FragmentLogDto {
  id!: string;
  type!: FragmentType;
  delta!: number;
  source!: string;
  context!: Record<string, unknown> | null;
  createdAt!: string; // ISO-8601
}

export class FragmentLogsDto {
  @IsArray()
  logs!: FragmentLogDto[];

  /** 下一页用 since, 没有就 null. */
  @IsOptional()
  @IsISO8601()
  nextSince?: string;
}

/**
 * 产出碎片 — 给业务事件用 (工具完成 / 急救完成 / 落叶重构等).
 *
 * 单条请求可批多个 grants, 也可指定 idempotencyKey 防双扣.
 */
export class GrantFragmentItemDto {
  @IsEnum(FragmentType)
  type!: FragmentType;

  @IsInt()
  @Min(1)
  delta!: number;

  @IsString()
  @Length(1, 64)
  source!: FragmentSource;
}

export class GrantFragmentsDto {
  @IsArray()
  @Type(() => GrantFragmentItemDto)
  grants!: GrantFragmentItemDto[];

  /** 幂等 key, 同 key 重复请求直接返回首次结果. */
  @IsOptional()
  @IsString()
  @Length(1, 128)
  idempotencyKey?: string;

  /** 业务上下文, 透传到 fragment_logs.context. */
  @IsOptional()
  context?: Record<string, unknown>;
}

export class GrantFragmentsResponseDto {
  /** 各类型新余额. */
  balances!: FragmentBalanceItemDto[];

  /** 本次 grant 触发的徽章解锁 (用于前端弹 unlock overlay). */
  newlyUnlockedBadges!: string[];
}
