import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { DecorationDto, PlaceDecorationDto, PurchaseDecorationDto, PurchaseDecorationResponseDto } from '../dto/island.dto';
import { DecorationsService } from '../providers/decorations.service';

/**
 * 装饰接口 — V4.0 §3.2.
 *
 *   GET  /inner-world/decorations                    — 全部装饰 + 用户状态
 *   POST /inner-world/decorations/:id/purchase       — 购买 (碎片扣减 + 解锁)
 *   POST /inner-world/decorations/:id/place          — 摆放到某区
 *   POST /inner-world/decorations/:id/remove         — 移除摆放 (保留持有)
 */
@ApiTags('inner-world/decorations')
@Controller('inner-world/decorations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DecorationsController {
  constructor(private readonly service: DecorationsService) {}

  @Get()
  @ApiOperation({ summary: '全部装饰 + 当前用户持有/摆放状态' })
  async list(@CurrentUser() user: { userId: string }): Promise<DecorationDto[]> {
    return this.service.list(user.userId);
  }

  @Post(':decorationId/purchase')
  @HttpCode(200)
  @ApiOperation({ summary: '购买装饰 (碎片扣减 + 解锁)' })
  async purchase(
    @CurrentUser() user: { userId: string },
    @Param('decorationId') decorationId: string,
    @Body() dto: PurchaseDecorationDto,
  ): Promise<PurchaseDecorationResponseDto> {
    return this.service.purchase(user.userId, { ...dto, decorationId });
  }

  @Post(':decorationId/place')
  @HttpCode(200)
  @ApiOperation({ summary: '摆放到某区' })
  async place(
    @CurrentUser() user: { userId: string },
    @Param('decorationId') decorationId: string,
    @Body() dto: PlaceDecorationDto,
  ): Promise<DecorationDto> {
    return this.service.place(user.userId, decorationId, dto);
  }

  @Post(':decorationId/remove')
  @HttpCode(200)
  @ApiOperation({ summary: '移除摆放 (保留持有)' })
  async remove(@CurrentUser() user: { userId: string }, @Param('decorationId') decorationId: string): Promise<DecorationDto> {
    return this.service.remove(user.userId, decorationId);
  }
}
