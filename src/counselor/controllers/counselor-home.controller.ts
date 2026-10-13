// V2026-10-13 治本 (Phase 7.10 — counselor-home.controller.ts, counselor 端 home Tab):
//   心理咨询师学员端「首页」Tab 主 controller.
//
//   端点 (V0.5 简化, V1.x 拓展):
//     GET /counselor/home/overview?emotionLevel=  - 综合快照
//
//   跟 home-overview controller 风格一致:
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid
//     - emotionLevel 是 query 参数 (前端 EmotionBloc 实时传入)
//     - 1 端点聚合, 减少瀑布流
//
//   反双胞胎:
//     - 不复用 home-overview (那是心塑主 app 用, counselor 端独立模块)
//     - 不引 GraphQL (REST 跟 client Dio 风格一致)

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type CounselorHomeOverviewDto, CounselorHomeQueryDto } from '../dto/counselor-home.dto';
import { CounselorHomeService } from '../providers/counselor-home.service';

/**
 * V2026-10-13 (Phase 7.10 — CounselorHomeController):
 *   心理咨询师学员端「首页」Tab 主 controller.
 *
 *   跟 xin_su_app CounselorHomeBloc + CounselorHomeRepository 端到端 1:1 对应.
 */
@ApiTags('counselor-home')
@Controller('counselor/home')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorHomeController {
  constructor(private readonly service: CounselorHomeService) {}

  /**
   * GET /counselor/home/overview
   *
   * 返 CounselorHomeOverviewDto (跟 xin_su_app CounselorHomeOverview entity 1:1):
   *   - greeting / dateLabel
   *   - todayRecommendation (AI 推荐, emotion-aware)
   *   - ability (6 维能力雷达)
   *   - weeklyProgress (4 KPI)
   *   - trainingCategories (4 大分类 + 9 场景)
   *   - currentRole (写死 counselor_learner, V1.x 跟 profile.currentRole 1:1)
   */
  @Get('overview')
  @ApiOperation({ summary: '心理咨询师学员端「首页」Tab 综合快照 (4 大训练分类 + 6 维能力雷达 + 4 KPI + AI 推荐)' })
  async getOverview(@CurrentUser() user: { userId: string }, @Query() query: CounselorHomeQueryDto): Promise<CounselorHomeOverviewDto> {
    return this.service.getOverview(user.userId, query.emotionLevel);
  }
}
