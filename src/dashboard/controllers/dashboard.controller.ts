import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { DashboardMilestonesDto, DashboardModulesDto, DashboardOverviewDto, DashboardWeeklyChartDto } from '../dto/dashboard.dto';
import { DashboardService } from '../providers/dashboard.service';

/**
 * 仪表板 controller — V2.0 §Tab4 「我的数据」心理健身数据.
 *
 * 端点 (V2.0 范围):
 *   GET /profile/dashboard/overview    - Hero 卡 (本周训练)
 *   GET /profile/dashboard/weekly     - 本周 7 天分钟数 (柱状图)
 *   GET /profile/dashboard/modules    - 4 大训练模块进度
 *   GET /profile/dashboard/milestones - 最近里程碑
 *
 * 设计要点:
 *   - 全程 JwtAuthGuard + @CurrentUser() 注入 uid
 *   - 4 个端点独立调用, 不聚合 — 前端按需拉取 (避免单端点巨型响应)
 *   - 路径挂在 /profile/dashboard 下, 跟前端 ProfileDashboardPage 对齐
 */
@ApiTags('profile-dashboard')
@Controller('profile/dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: '心理健身 Hero 卡 (本周训练 / 连续天数 / 累计)' })
  public async getOverview(@CurrentUser() user: { userId: string }): Promise<DashboardOverviewDto> {
    return this.service.getOverview(user.userId);
  }

  @Get('weekly')
  @ApiOperation({ summary: '本周 7 天训练分钟数 (周一→周日, 柱状图)' })
  public async getWeekly(@CurrentUser() user: { userId: string }): Promise<DashboardWeeklyChartDto> {
    return this.service.getWeeklyChart(user.userId);
  }

  @Get('modules')
  @ApiOperation({ summary: '4 大训练模块完成度 (基础 / 认知 / 自尊 / 人际)' })
  public async getModules(@CurrentUser() user: { userId: string }): Promise<DashboardModulesDto> {
    return this.service.getModules(user.userId);
  }

  @Get('milestones')
  @ApiOperation({ summary: '最近里程碑列表' })
  public async getMilestones(@CurrentUser() user: { userId: string }): Promise<DashboardMilestonesDto> {
    return this.service.getMilestones(user.userId);
  }
}
