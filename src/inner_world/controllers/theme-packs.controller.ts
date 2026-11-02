import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { ThemePacksListDto } from '../dto/skin-pack.dto';
import { ThemePacksService } from '../providers/theme-packs.service';

/**
 * 主题包接口 — V4.0 §3.4.
 *
 *   GET  /inner-world/theme-packs                  — 全部主题包 + 用户状态
 *   POST /inner-world/theme-packs/:packId/unlock   — 解锁 (碎片)
 *   POST /inner-world/theme-packs/:packId/activate — 启用 (全局唯一)
 */
@ApiTags('inner-world/theme-packs')
@Controller('inner-world/theme-packs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ThemePacksController {
  constructor(private readonly service: ThemePacksService) {}

  @Get()
  @ApiOperation({ summary: '全部主题包 + 用户状态' })
  async list(@CurrentUser() user: { userId: string }): Promise<ThemePacksListDto> {
    return this.service.list(user.userId);
  }

  @Post(':packId/unlock')
  @HttpCode(200)
  @ApiOperation({ summary: '解锁主题包 (碎片扣减)' })
  async unlock(@CurrentUser() user: { userId: string }, @Param('packId') packId: string) {
    return this.service.unlock(user.userId, packId);
  }

  @Post(':packId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: '启用主题包 (全局唯一, 其他先 deactivate)' })
  async activate(@CurrentUser() user: { userId: string }, @Param('packId') packId: string): Promise<ThemePacksListDto> {
    return this.service.activate(user.userId, packId);
  }
}
