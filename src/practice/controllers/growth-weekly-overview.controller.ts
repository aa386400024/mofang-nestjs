/**
 * V2026-09-14 治本 (Stage C 后端契约): GET /growth/weekly-overview.
 *
 * 跟前端 lib/features/growth/data/api/growth_api.dart GrowthApi.getWeeklyOverview() 1:1 对齐.
 *
 * 设计:
 *   - 走 JwtAuthGuard + @CurrentUser 拿 userId
 *   - 失败走 BizException (跟 daily-tools controller 一致)
 *   - 返回 WeeklyOverviewDto (10 字段, 含 4 KPI 跨 feature 聚合)
 *
 * 反双胞胎:
 *   - 不复用 daily-tools 的 prefix (虽然同 feature, 路径独立让 LLM 路由不混淆)
 *   - 不在 controller 写 KPI 计算 (派生字段在 service)
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { WeeklyOverviewDto } from '../dto/growth.dto';
import { GrowthWeeklyOverviewService } from '../providers/growth-weekly-overview.service';

@ApiTags('growth')
@Controller('growth')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GrowthWeeklyOverviewController {
  constructor(private readonly service: GrowthWeeklyOverviewService) {}

  /**
   * V2026-09-14 治本 (大厂 RESTful):
   *   GET /growth/weekly-overview?date=2026-09-14
   *   返回本周成长概览 (含 4 KPI 跨 feature 聚合).
   */
  @Get('weekly-overview')
  @ApiOperation({ summary: '本周成长概览 + 4 KPI (V6.0 §4.3)' })
  @ApiQuery({ name: 'date', required: false, description: 'ISO-8601 YYYY-MM-DD, 默认服务端按 ISO 周计算' })
  async getWeeklyOverview(@CurrentUser() user: { userId: string }, @Query('date') date?: string): Promise<WeeklyOverviewDto> {
    return this.service.getWeeklyOverview(user.userId, date);
  }
}
