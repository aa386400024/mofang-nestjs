import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../user/guards/jwt-auth.guard';

import { CompanionTreeDto } from '../dto/tree-stage.dto';
import { WaterTreeDto } from '../dto/water-tree.dto';
import { TreeWaterLog } from '../entities/tree-water-log.entity';

import { CompanionTreeService } from '../providers/companion-tree.service';

/**
 * 共种陪伴树 controller — V2026-09-12 §6.3 心塑 V6.0.
 *
 *   POST /companion/companion-trees/active         取 / 创建当前活跃树 (单人/双人)
 *   POST /companion/companion-trees/:id/water      浇水 / 施肥 / 修剪
 *   GET  /companion/companion-trees/mine            我的历史树
 *   GET  /companion/companion-trees/:id/logs?limit  最近照顾日志
 *
 * 大厂 standard:
 *   - @UseGuards(JwtAuthGuard) 锁定
 *   - @CurrentUser() 取 userId
 *   - 4 个端点拆清楚, 不重名 (跟前端 usecase 一一对应)
 *
 * 反双胞胎:
 *   - 不暴露 /companion/companion-trees/:id/delete (V6.0 暂不做归档, 大树后转生)
 *   - 不复用 rehab controller (独立业务)
 */
@ApiTags('companion-trees')
@Controller('companion/companion-trees')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CompanionTreeController {
  constructor(private readonly service: CompanionTreeService) {}

  /**
   * 取 / 创建当前活跃树.
   *
   * 大厂 standard: 不暴露 GET /:id (直接 active 一棵, 简化前端调用).
   */
  @Post('active')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取 / 创建当前活跃树 (V6.0 §6.3)' })
  @ApiQuery({ name: 'partnerId', required: false, description: '双人模式: 另一作者 userId' })
  @ApiResponse({
    status: 200,
    description: '当前活跃树',
    type: CompanionTreeDto,
  })
  public async getOrCreateActive(
    @CurrentUser() user: { userId: string },
    @Query('partnerId') partnerId?: string,
  ): Promise<CompanionTreeDto> {
    return this.service.getOrCreateActiveTree({
      userAId: user.userId,
      userBId: partnerId ?? null,
    });
  }

  /**
   * 浇水 / 施肥 / 修剪 (V6.0 §6.3 共种陪伴树).
   *
   * 大厂 standard: @Param('treeId') 从 path 取树 id, @Body() dto 取动作.
   * 跟现有 companion dual-sessions/:id/update 一致 (NestJS 大厂 standard).
   */
  @Post(':treeId/water')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '浇水 / 施肥 / 修剪 (V6.0 §6.3 共种陪伴树)' })
  @ApiResponse({
    status: 200,
    description: '照顾成功',
    type: CompanionTreeDto,
  })
  @ApiResponse({ status: 404, description: '树不存在' })
  @ApiResponse({ status: 422, description: '冷却中或非作者' })
  public async water(
    @CurrentUser() user: { userId: string },
    @Param('treeId') treeId: string,
    @Body() dto: WaterTreeDto,
  ): Promise<CompanionTreeDto> {
    return this.service.waterTree({
      treeId,
      actorUserId: user.userId,
      action: dto.action,
      actorAnonymousName: dto.actorAnonymousName,
    });
  }

  /**
   * 我的历史树 (大厂 standard: 双 tab 共养 / 自己养).
   */
  @Get('mine')
  @ApiOperation({ summary: '我的历史树 (按 createdAt DESC)' })
  @ApiResponse({
    status: 200,
    description: '我的所有树',
    type: [CompanionTreeDto],
  })
  public async myTrees(@CurrentUser() user: { userId: string }): Promise<CompanionTreeDto[]> {
    return this.service.myTrees(user.userId);
  }

  /**
   * 最近照顾日志 (按 createdAt DESC).
   */
  @Get(':treeId/logs')
  @ApiOperation({ summary: '最近照顾日志 (按 createdAt DESC)' })
  @ApiQuery({ name: 'limit', required: false, description: '默认 30, 上限 100' })
  @ApiResponse({
    status: 200,
    description: '最近 N 条照顾日志',
    type: [TreeWaterLog],
  })
  public async recentLogs(
    @CurrentUser() _user: { userId: string },
    @Param('treeId') treeId: string,
    @Query('limit') limit?: string,
  ): Promise<TreeWaterLog[]> {
    return this.service.recentLogs({
      treeId,
      limit: limit ? Math.min(100, Number.parseInt(limit, 10)) : 30,
    });
  }
}
