import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { HomeOverviewDto, RecommendationQueryDto, TodayRecommendationDto } from '../dto/home-overview.dto';
import type { HomeEmotionLevel } from '../home.constants';
import { HomeOverviewService } from '../providers/home-overview.service';

/**
 * 首页综合快照 controller — V2.0 §3 (DESIGN).
 *
 * 端点 (双角色共享, 用 JwtAuthGuard):
 *   GET /home/overview?emotionLevel=...           - 成长用户首页综合快照
 *   GET /home/recommendation/today?emotionLevel= - 单独拉今日推荐 (供下拉刷新)
 *
 * 设计要点:
 *   - 单端点聚合 (大厂 dashboard standard): UI 一拉到位, 减少瀑布流
 *   - emotionLevel 是 query 参数 (前端 EmotionBloc 实时传入)
 *   - 服务端 timezone-safe (用服务端时间做 greeting + 推荐时段)
 *   - 401 / 403 / 429 由全局 Filter + Guard 处理
 */
@ApiTags('home-overview')
@Controller('home')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HomeOverviewController {
  constructor(private readonly service: HomeOverviewService) {}

  @Get('overview')
  @ApiOperation({ summary: '首页综合快照 (问候 / 情绪 / 微干预 / 推荐 / 陪伴者 / 未读)' })
  public async getOverview(
    @CurrentUser() user: { userId: string },
    @Query() query: { emotionLevel?: HomeEmotionLevel },
  ): Promise<HomeOverviewDto> {
    return this.service.getOverview(user.userId, query.emotionLevel ?? null);
  }

  @Get('recommendation/today')
  @ApiOperation({ summary: '今日推荐 (单独拉取, 供「情绪变化」/「下拉刷新」调用)' })
  public async getTodayRecommendation(@Query() query: RecommendationQueryDto): Promise<TodayRecommendationDto> {
    return this.service.getTodayRecommendation(query.emotionLevel ?? null);
  }
}
