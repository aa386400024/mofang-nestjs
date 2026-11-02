// V2026-10-12 (Phase 8.3 — Analytics controller / SPEC §12.5):
//   GET /admin/analytics/overview?range=week — 4 KPI + 4 trend 一次性返.
//
//   跟 client 7.8 AnalyticsPage 严格对应 (跟 client 7.8 AnalyticsOverview.fromJson
//   字段一一对应).
//
//   治本:
//     - 路由用 'admin/analytics' 跟 client 7.8 AnalyticsPage 侧边栏入口对齐
//     - V0.x: @UseGuards(JwtAuthGuard) 单层, 跟 8.1 knowledge controller 风格一致
//     - query range 默认 week (跟 client 7.8 AnalyticsPage 初次进入默认显示 week)

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

// V2026-10-12 治本 (Phase 8.3 — import path):
//   JwtAuthGuard 在 src/auth/guards/, 不在 src/common/. common/index.ts 也不
//   re-export (大厂 spec: common 是跨切关注点 utilities, 不含业务 guard).
//   治本: 从 '../../auth' 直接 import (auth/index.ts re-export JwtAuthGuard).
import { JwtAuthGuard } from '../../auth';
import { TenantId } from '../../common';
import { AnalyticsOverviewDto, TimeRange } from '../dto/analytics.dto';
import { AnalyticsService } from '../providers/analytics.service';

@ApiTags('Admin · Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Analytics overview (4 KPI + 4 trend, 决策 A: 4 档时间范围)' })
  overview(@TenantId() tenantId: string, @Query('range') range: TimeRange = TimeRange.Week): Promise<AnalyticsOverviewDto> {
    return this.analytics.getOverview(tenantId, range);
  }
}
