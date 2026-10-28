import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { ToolSkinDto, ToolSkinsListDto, UnlockSkinDto, UnlockSkinResponseDto } from '../dto/skin-pack.dto';
import { ToolId } from '../enums/skin-rarity.enum';
import { ToolSkinsService } from '../providers/tool-skins.service';

/**
 * 工具皮肤接口 — V4.0 §3.4.
 *
 *   GET  /inner-world/tool-skins?toolId=xxx       — 该工具的全部皮肤 + 状态
 *   POST /inner-world/tool-skins/:skinId/unlock   — 碎片解锁
 *   POST /inner-world/tool-skins/:skinId/equip   — 装备 (同工具其他先 unequip)
 */
@ApiTags('inner-world/tool-skins')
@Controller('inner-world/tool-skins')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ToolSkinsController {
  constructor(private readonly service: ToolSkinsService) {}

  @Get()
  @ApiOperation({ summary: '某工具的全部皮肤 + 当前用户状态' })
  async list(@CurrentUser() user: { userId: string }, @Query('toolId') toolId: ToolId): Promise<ToolSkinsListDto> {
    return this.service.listAvailable(user.userId, toolId);
  }

  @Post(':skinId/unlock')
  @HttpCode(200)
  @ApiOperation({ summary: '解锁皮肤 (碎片扣减)' })
  async unlock(
    @CurrentUser() user: { userId: string },
    @Param('skinId') skinId: string,
    @Body() dto: UnlockSkinDto,
  ): Promise<UnlockSkinResponseDto> {
    return this.service.unlock(user.userId, skinId, dto);
  }

  @Post(':skinId/equip')
  @HttpCode(200)
  @ApiOperation({ summary: '装备皮肤 (同工具其他自动 unequip)' })
  async equip(@CurrentUser() user: { userId: string }, @Param('skinId') skinId: string): Promise<ToolSkinDto> {
    return this.service.equip(user.userId, skinId);
  }
}
