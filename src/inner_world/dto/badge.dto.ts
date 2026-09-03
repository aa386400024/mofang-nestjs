import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

import { BadgeId } from '../enums/badge-id.enum';

/**
 * 徽章 DTO 集合.
 *
 * 字段命名: 跟前端 `badge_id.dart` / `BadgesBloc` 1:1.
 */
export class BadgeStateDto {
  id!: BadgeId;
  title!: string;
  description!: string;
  emoji!: string;
  /** ISO-8601, 未解锁为 null. */
  unlockedAt!: string | null;
  /** ISO-8601, 已展示过 unlock overlay = 非 null. */
  consumedAt!: string | null;
}

export class BadgesListDto {
  badges!: BadgeStateDto[];
  /** 解锁总数. */
  unlockedCount!: number;
  /** 全部徽章数 (固定 9). */
  total!: number;
  /** 待展示的解锁 ( = unlockedAt IS NOT NULL AND consumedAt IS NULL). */
  pendingUnlockIds!: BadgeId[];
}

export class UnlockBadgeDto {
  @IsEnum(BadgeId)
  badgeId!: BadgeId;

  /** 业务来源: 'reconcile' (自动) | 'manual' (运营). */
  @IsOptional()
  @IsString()
  @Length(1, 32)
  source?: string;
}

export class UnlockBadgeResponseDto {
  badgeId!: BadgeId;
  alreadyUnlocked!: boolean;
  unlockedAt!: string;
}

/**
 * reconcile() 触发后, 服务端会扫所有规则, 找出本次新解锁的.
 */
export class ReconcileResponseDto {
  newlyUnlocked!: BadgeId[];
  /** 规则扫描耗时 (ms), 用于监控. */
  durationMs!: number;
}
