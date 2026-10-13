// V2026-10-13 治本 (Phase 7.10 P0-6 — life-map.controller.ts):
//   心塑 心理地图 Tab 主 controller (跟 xin_su_app life_map_home_page 1:1).
//
//   端点 (V0.5 简化):
//     GET /life-map/overview  - 心理地图综合快照 (3 大入口 + 2 渐进解锁 + 漂流瓶 + 时间轴)
//
//   反双胞胎 (跟其它 counselor-home controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid
//     - 1 端点聚合, 减少瀑布流
//     - 不复用 home-overview.controller (业务正交, 心塑 主 app vs 咨询师训练)

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type LifeMapOverviewDto } from '../dto/life-map.dto';
import { LifeMapService } from '../providers/life-map.service';

/**
 * V2026-10-13 (Phase 7.10 P0-6 — LifeMapController):
 *   心塑 心理地图 Tab 主 controller.
 *
 *   跟 xin_su_app LifeMapBloc 端到端 1:1 对应.
 */
@ApiTags('life-map')
@Controller('life-map')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LifeMapController {
  constructor(private readonly service: LifeMapService) {}

  @Get('overview')
  @ApiOperation({ summary: '心塑 心理地图 Tab 综合快照 (3 大入口 + 2 渐进解锁 + 漂流瓶 + 时间轴)' })
  async getOverview(@CurrentUser() user: { userId: string }): Promise<LifeMapOverviewDto> {
    return this.service.getOverview(user.userId);
  }
}
