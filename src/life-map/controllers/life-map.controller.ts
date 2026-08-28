import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { LifeMapOverviewDto, LifeMapTimelineDto } from '../dto/life-map.dto';
import { LifeMapService } from '../providers/life-map.service';

/**
 * 人生地图 controller — V2.0 §Tab4 「我的数据」人生轨迹心理地图.
 *
 * 端点 (V2.0 范围):
 *   GET /profile/life-map          - 入口页面 (三大入口 + 解锁状态)
 *   GET /profile/life-map/timeline - 时间轴缩略预览 (5 个阶段)
 *
 * V2.0 不做:
 *   - 阶段梳理编辑 (留 V3)
 *   - 关键事件 CRUD (留 V3)
 *   - 心理基因维度盘点 (留 V3)
 *   - 推演引擎 (留 V3)
 */
@ApiTags('profile-life-map')
@Controller('profile/life-map')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LifeMapController {
  constructor(private readonly service: LifeMapService) {}

  @Get()
  @ApiOperation({ summary: '人生地图入口页面数据 (三大入口进度 + 解锁状态)' })
  public async getOverview(@CurrentUser() user: { userId: string }): Promise<LifeMapOverviewDto> {
    return this.service.getOverview(user.userId);
  }

  @Get('timeline')
  @ApiOperation({ summary: '人生地图时间轴缩略 (5 阶段是否已记录)' })
  public async getTimeline(@CurrentUser() user: { userId: string }): Promise<LifeMapTimelineDto> {
    return this.service.getTimeline(user.userId);
  }
}
