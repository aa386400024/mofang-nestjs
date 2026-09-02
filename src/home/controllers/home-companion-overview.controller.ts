import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CompanionHomeOverviewDto } from '../dto/home-companion-overview.dto';
import { HomeCompanionService } from '../providers/home-companion.service';

/**
 * 陪伴者端首页综合快照 controller — V2.0 §4 (DESIGN).
 *
 * 端点:
 *   GET /home/companion-overview?currentBindingId=... - 陪伴者首页综合快照
 *
 * 设计要点:
 *   - 严格按权限等级过滤 (L1 / L2 / L3) — 越权字段自动隐藏
 *   - 自我关怀耗竭指数: 服务端算 (大厂 standard: 政策不在前端)
 *
 * 注意: 单独 controller 拆出来, 避免跟 /home/companion/* 路由前缀冲突.
 */
@ApiTags('home-companion')
@Controller('home')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HomeCompanionOverviewController {
  constructor(private readonly service: HomeCompanionService) {}

  @Get('companion-overview')
  @ApiOperation({ summary: '陪伴者首页综合快照 (问候 / 小贴士 / 被陪伴者状态 / 工具箱 / 自我关怀)' })
  public async getCompanionOverview(
    @CurrentUser() user: { userId: string },
    @Query('currentBindingId') currentBindingId?: string,
  ): Promise<CompanionHomeOverviewDto> {
    return this.service.getOverview(user.userId, currentBindingId);
  }
}
