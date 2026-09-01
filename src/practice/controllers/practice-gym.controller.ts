import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { GymCurrentPlanDto, GymGenomeReportDto, GymWeeklyPlanDto, TargetedReshapeDto } from '../dto/practice.dto';
import { PracticeGymService, TargetedReshapeService } from '../providers/practice.service';

/**
 * 心理健身房 controller — V2.0 §Tab2 分类7.
 *
 *   GET /practice/gym/current-plan       — 当前训练计划
 *   GET /practice/gym/weekly-map         — 12 周进阶地图
 *   GET /practice/gym/genome-report      — 心理基因报告
 *   GET /practice/gym/targeted-reshape   — 靶向重塑状态
 *
 * V2.0 端点独立 (大厂 dashboard standard): 前端按需拉取, 避免单端点巨型响应.
 * V3 接真实事件总线后, Service 内部加 cache, 端点路径不变.
 */
@ApiTags('practice-gym')
@Controller('practice/gym')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PracticeGymController {
  constructor(
    private readonly gymService: PracticeGymService,
    private readonly reshapeService: TargetedReshapeService,
  ) {}

  @Get('current-plan')
  @ApiOperation({ summary: '当前训练计划' })
  public async getCurrentPlan(@CurrentUser() user: { userId: string }): Promise<GymCurrentPlanDto> {
    return this.gymService.getCurrentPlan(user.userId);
  }

  @Get('weekly-map')
  @ApiOperation({ summary: '12 周进阶地图' })
  public async getWeeklyMap(@CurrentUser() user: { userId: string }): Promise<GymWeeklyPlanDto[]> {
    return this.gymService.getWeeklyMap(user.userId);
  }

  @Get('genome-report')
  @ApiOperation({ summary: '心理基因报告 (5 维度)' })
  public async getGenomeReport(@CurrentUser() user: { userId: string }): Promise<GymGenomeReportDto> {
    return this.gymService.getGenomeReport(user.userId);
  }

  @Get('targeted-reshape')
  @ApiOperation({ summary: '心理基因靶向重塑状态 (V3.0 渐进解锁)' })
  public async getTargetedReshape(@CurrentUser() user: { userId: string }): Promise<TargetedReshapeDto> {
    return this.reshapeService.getState(user.userId);
  }
}
