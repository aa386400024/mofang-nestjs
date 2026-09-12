import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

import { WaterAction } from '../enums/water-action.enum';

/**
 * 浇水 DTO — V2026-09-12 §6.3 共种陪伴树.
 *
 * actorUserId 不从 DTO 取 (走 JWT currentUser), actorAnonymousName 可选.
 *
 * 反双胞胎: 独立 DTO, 跟 companion-record / dual-puzzle 无关.
 */
export class WaterTreeDto {
  @IsEnum(WaterAction, {
    message: 'action 必须是 water / fertilize / prune 之一',
  })
  action!: WaterAction;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  actorAnonymousName?: string;
}
