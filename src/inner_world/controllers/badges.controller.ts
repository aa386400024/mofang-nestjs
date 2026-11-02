import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { BadgesListDto, ReconcileResponseDto, UnlockBadgeResponseDto } from '../dto/badge.dto';
import { BadgeId } from '../enums/badge-id.enum';
import { BadgesService } from '../providers/badges.service';
import { ReconciliationService } from '../providers/reconciliation.service';

/**
 * 徽章接口 — V4.0 §3.3.
 *
 *   GET  /inner-world/badges                          — 全部 9 个 + 状态
 *   POST /inner-world/badges/reconcile                — 主动触发检测
 *   POST /inner-world/badges/:badgeId/unlock          — 强制解锁 (运营)
 *   POST /inner-world/badges/:badgeId/consume-pending — 标记 unlock overlay 已消费
 */
@ApiTags('inner-world/badges')
@Controller('inner-world/badges')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BadgesController {
  constructor(
    private readonly service: BadgesService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get()
  @ApiOperation({ summary: '全部徽章 + 当前用户解锁状态' })
  async list(@CurrentUser() user: { userId: string }): Promise<BadgesListDto> {
    return this.service.list(user.userId);
  }

  @Post('reconcile')
  @HttpCode(200)
  @ApiOperation({ summary: '主动触发全量 reconcile (规则检测)' })
  async reconcile(@CurrentUser() user: { userId: string }): Promise<ReconcileResponseDto> {
    const t0 = Date.now();
    const newlyUnlocked = await this.reconciliation.reconcile(user.userId);
    return {
      newlyUnlocked: [...newlyUnlocked],
      durationMs: Date.now() - t0,
    };
  }

  @Post(':badgeId/unlock')
  @HttpCode(200)
  @ApiOperation({ summary: '强制解锁某徽章 (运营/补发)' })
  async forceUnlock(@CurrentUser() user: { userId: string }, @Param('badgeId') badgeId: BadgeId): Promise<UnlockBadgeResponseDto> {
    return this.service.forceUnlock(user.userId, badgeId);
  }

  @Post(':badgeId/consume-pending')
  @HttpCode(200)
  @ApiOperation({ summary: '标记 unlock overlay 已展示 (清除 pending 标记)' })
  async consumePending(@CurrentUser() user: { userId: string }, @Param('badgeId') badgeId: BadgeId) {
    return this.service.consumePending(user.userId, badgeId);
  }
}
