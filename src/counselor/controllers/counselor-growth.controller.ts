// V2026-10-13 治本 (Phase 7.10 P0-4 — counselor-growth.controller.ts):
//   心理咨询师学员端「成长」Tab 主 controller.
//
//   端点 (V0.5 简化):
//     GET /counselor/growth/overview  - 成长综合快照 (4 区块: 能力 + KPI + 训练记录 + 错题)
//
//   V2026-11-06 治本 (WP44 · 成长档案体系 — 补 2 端点):
//     GET /counselor/growth/archive-overview - 成长档案总览卡片 (总场次 / 均分 / 三大维度 / crisis)
//     GET /counselor/growth/trend            - 成长档案趋势曲线 (按天, ?days=30)
//
//   ⚠️ **为什么不是 /counselor/profile/overview** (任务单原文写的路径):
//     那个端点**已经存在** (我的 Tab: 训练偏好 + 会员状态, Flutter 客户端在用) ——
//     同名不同义 = 两个端点抢一个路径 = 迟早漂. 成长档案归"成长"语义, 所以落在
//     /counselor/growth/ 下面, 与既有的 overview 并列而不覆盖.
//
//   反双胞胎 (跟 counselor-home/training/exam/growth controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid
//     - 不复用 home-overview.controller (业务正交)

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard.js';

import { type CounselorGrowthDto, type CounselorGrowthQueryDto } from '../dto/counselor-growth.dto.js';
// ⚠️ GrowthArchiveTrendQueryDto 必须**值导入** —— ValidationPipe 靠 design:paramtypes
//   认出查询 DTO, 用 type-only import 会让它退化成 Object → 校验与转换全失效.
import { type GrowthArchiveOverviewDto, type GrowthArchiveTrendDto, GrowthArchiveTrendQueryDto } from '../dto/growth-archive.dto.js';
import { CounselorGrowthService } from '../providers/counselor-growth.service.js';
import { GrowthArchiveService } from '../providers/growth-archive.service.js';

/**
 * V2026-10-13 (Phase 7.10 P0-4 — CounselorGrowthController):
 *   心理咨询师学员端「成长」Tab 主 controller.
 */
@ApiTags('counselor-growth')
@Controller('counselor/growth')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorGrowthController {
  constructor(
    private readonly service: CounselorGrowthService,
    private readonly archive: GrowthArchiveService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: '心理咨询师学员端「成长」Tab 综合快照 (4 区块: 能力 + KPI + 训练记录 + 错题)' })
  async getOverview(@CurrentUser() user: { userId: string }, @Query() query: CounselorGrowthQueryDto): Promise<CounselorGrowthDto> {
    return this.service.getOverview(user.userId, query.emotionLevel);
  }

  /**
   * GET /counselor/growth/archive-overview — 成长档案总览卡片.
   *
   * V2026-11-06 治本 (WP44): 打开档案页时会把对练数据同步进能力雷达 (幂等全量重算),
   *   所以"练完再回来"雷达图就是新的.
   *
   * @param user 当前学员 (CurrentUser 装饰器注入)
   * @returns 总览卡片
   */
  @Get('archive-overview')
  @ApiOperation({
    summary: '成长档案总览卡片 (总场次 / 均分 / 最高分 / 三大维度均分 / 累计 crisis)',
    description:
      '数据源是 WP43 的单场快速评分 (session_evaluations) + 训练会话数. ' + '本端点会顺带把对练数据同步进能力雷达 (幂等, 可重算).',
  })
  async getArchiveOverview(@CurrentUser() user: { userId: string }): Promise<GrowthArchiveOverviewDto> {
    return this.archive.overview(user.userId);
  }

  /**
   * GET /counselor/growth/trend?days=30 — 成长档案趋势曲线 (按天).
   *
   * @param user 当前学员 (CurrentUser 装饰器注入)
   * @param query 回看天数 (默认 30, 上限 365)
   * @returns 趋势点 (按日期升序)
   */
  @Get('trend')
  @ApiOperation({
    summary: '成长档案趋势曲线 (按天聚合, ?days=30)',
    description: '按 session_evaluations 的创建日期分组取平均. 没有数据的那天不出点 (不补 0).',
  })
  async getTrend(@CurrentUser() user: { userId: string }, @Query() query: GrowthArchiveTrendQueryDto): Promise<GrowthArchiveTrendDto> {
    return this.archive.trend(user.userId, query.days ?? 30);
  }
}
