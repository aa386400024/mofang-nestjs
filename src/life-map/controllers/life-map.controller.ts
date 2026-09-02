import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type {
  CreateKeyEventDto,
  ForecastInputDto,
  GenomeDimensionListDto,
  GrowthReportDto,
  KeyEventDto,
  KeyEventListDto,
  LifeForecastDto,
  LifeMapOverviewDto,
  LifeMapTimelineDto,
  LifeStageProgressDto,
  SaveGenomeDimensionDto,
  SaveStageProgressDto,
  StageProgressListDto,
  UpdateKeyEventDto,
} from '../dto/life-map.dto';
import { LifeMapService } from '../providers/life-map.service';

/**
 * 人生地图 controller — V3.0 §3 Tab3 心理地图 + 推演 + 报告 完整版.
 *
 * 端点清单 (V3.0):
 *   GET    /profile/life-map                  - 入口页面 (三大入口进度 + 解锁状态)
 *   GET    /profile/life-map/timeline         - 时间轴缩略预览
 *   GET    /profile/life-map/stages           - 全量阶段梳理数据
 *   POST   /profile/life-map/stages           - 保存某阶段任务完成度
 *   GET    /profile/life-map/events           - 关键事件列表
 *   POST   /profile/life-map/events           - 新增关键事件
 *   PATCH  /profile/life-map/events/:id       - 更新关键事件
 *   DELETE /profile/life-map/events/:id       - 删除关键事件 (软删)
 *   GET    /profile/life-map/dimensions       - 心理基因 5 维度
 *   POST   /profile/life-map/dimensions       - 保存某维度盘点
 *   GET    /profile/life-map/forecasts        - 推演列表 + 解锁状态
 *   POST   /profile/life-map/forecasts        - 运行推演 (本地规则引擎)
 *   GET    /profile/life-map/report           - 成长轨迹综合报告
 */
@ApiTags('profile-life-map')
@Controller('profile/life-map')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LifeMapController {
  constructor(private readonly service: LifeMapService) {}

  // ── 入口 + 时间轴 ─────────────────────────────────
  @Get()
  @ApiOperation({ summary: '人生地图入口页面数据' })
  getOverview(@CurrentUser() user: { userId: string }): Promise<LifeMapOverviewDto> {
    return this.service.getOverview(user.userId);
  }

  @Get('timeline')
  @ApiOperation({ summary: '人生地图时间轴缩略' })
  getTimeline(@CurrentUser() user: { userId: string }): Promise<LifeMapTimelineDto> {
    return this.service.getTimeline(user.userId);
  }

  // ── 阶段梳理 ─────────────────────────────────
  @Get('stages')
  @ApiOperation({ summary: '全量阶段梳理数据 (4 阶段)' })
  listStages(@CurrentUser() user: { userId: string }): Promise<StageProgressListDto> {
    return this.service.listStageProgress(user.userId);
  }

  @Post('stages')
  @HttpCode(200)
  @ApiOperation({ summary: '保存某阶段任务完成度 (upsert)' })
  saveStage(@CurrentUser() user: { userId: string }, @Body() dto: SaveStageProgressDto): Promise<LifeStageProgressDto> {
    return this.service.saveStageProgress(user.userId, dto);
  }

  // ── 关键事件 CRUD ─────────────────────────────────
  @Get('events')
  @ApiOperation({ summary: '关键事件列表 (按年龄排序)' })
  listEvents(@CurrentUser() user: { userId: string }): Promise<KeyEventListDto> {
    return this.service.listKeyEvents(user.userId);
  }

  @Post('events')
  @ApiOperation({ summary: '新增关键事件' })
  createEvent(@CurrentUser() user: { userId: string }, @Body() dto: CreateKeyEventDto): Promise<KeyEventDto> {
    return this.service.createKeyEvent(user.userId, dto);
  }

  @Patch('events/:id')
  @ApiOperation({ summary: '更新关键事件' })
  updateEvent(@CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: UpdateKeyEventDto): Promise<KeyEventDto> {
    return this.service.updateKeyEvent(user.userId, id, dto);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除关键事件 (软删)' })
  async deleteEvent(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<void> {
    await this.service.deleteKeyEvent(user.userId, id);
  }

  // ── 心理基因盘点 ─────────────────────────────────
  @Get('dimensions')
  @ApiOperation({ summary: '心理基因 5 维度盘点' })
  listDimensions(@CurrentUser() user: { userId: string }): Promise<GenomeDimensionListDto> {
    return this.service.listGenomeDimensions(user.userId);
  }

  @Post('dimensions')
  @HttpCode(200)
  @ApiOperation({ summary: '保存某维度盘点 (upsert)' })
  saveDimension(@CurrentUser() user: { userId: string }, @Body() dto: SaveGenomeDimensionDto): Promise<unknown> {
    return this.service.saveGenomeDimension(user.userId, dto);
  }

  // ── 人生剧本推演 ─────────────────────────────────
  @Get('forecasts')
  @ApiOperation({ summary: '推演列表 + 解锁状态' })
  listForecasts(
    @CurrentUser() user: { userId: string },
  ): Promise<{ forecasts: LifeForecastDto[]; total: number; unlockStatus: 'unlocked' | 'locking' | 'locked'; lockedReason?: string }> {
    return this.service.listForecasts(user.userId);
  }

  @Post('forecasts')
  @ApiOperation({ summary: '运行推演 (本地规则引擎)' })
  runForecast(@CurrentUser() user: { userId: string }, @Body() input: ForecastInputDto): Promise<LifeForecastDto> {
    return this.service.runForecast(user.userId, input);
  }

  // ── 成长轨迹综合报告 ─────────────────────────────────
  @Get('report')
  @ApiOperation({ summary: '成长轨迹综合报告 (阶段 + 基因 + 卡点 + 推荐)' })
  getReport(@CurrentUser() user: { userId: string }): Promise<GrowthReportDto> {
    return this.service.getGrowthReport(user.userId);
  }
}
