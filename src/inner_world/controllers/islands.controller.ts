import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { GrowElementDto, IslandElementDto, IslandElementsDto } from '../dto/island.dto';
import { IslandsService } from '../providers/islands.service';

/**
 * 小岛元素接口 — V4.0 §3.1.
 *
 *   GET  /inner-world/islands/elements                — 全部 10 个 + 状态
 *   GET  /inner-world/islands/summary                 — 4 区统计 (轻量)
 *   POST /inner-world/islands/elements/:id/unlock    — 解锁
 *   POST /inner-world/islands/elements/:id/grow      — 成长值增加
 */
@ApiTags('inner-world/islands')
@Controller('inner-world/islands')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class IslandsController {
  constructor(private readonly service: IslandsService) {}

  @Get('elements')
  @ApiOperation({ summary: '全部 10 个元素 + 用户状态' })
  async elements(@CurrentUser() user: { userId: string }): Promise<IslandElementsDto> {
    return this.service.list(user.userId);
  }

  @Get('summary')
  @ApiOperation({ summary: '4 区统计 (轻量, 用于首页角标)' })
  async summary(@CurrentUser() user: { userId: string }) {
    const data = await this.service.list(user.userId);
    return data.byArea;
  }

  @Post('elements/:elementId/unlock')
  @HttpCode(200)
  @ApiOperation({ summary: '解锁元素' })
  async unlock(@CurrentUser() user: { userId: string }, @Param('elementId') elementId: string): Promise<IslandElementDto> {
    return this.service.unlock(user.userId, elementId);
  }

  @Post('elements/:elementId/grow')
  @HttpCode(200)
  @ApiOperation({ summary: '成长值 += delta (默认 10, 上限 growthMax)' })
  async grow(
    @CurrentUser() user: { userId: string },
    @Param('elementId') elementId: string,
    @Body() dto: GrowElementDto,
  ): Promise<IslandElementDto> {
    return this.service.grow(user.userId, elementId, dto);
  }
}
