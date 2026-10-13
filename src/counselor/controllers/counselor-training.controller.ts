// V2026-10-13 治本 (Phase 7.10 P0-2 — counselor-training.controller.ts, counselor 端 training Tab):
//   心理咨询师学员端「训练」Tab 主 controller.
//
//   V0.5 简化: 跟 home/overview 共享同一份数据 (4 大训练分类 + 9 场景), 走 thin
//   delegate 到 CounselorHomeService, 避免数据双胞胎. V1.x 加进度 / 评分字段时,
//   拆独立 DTO + service.
//
//   端点 (V0.5):
//     GET /counselor/training/overview  - 训练分类总览 (跟 home 同 shape)
//
//   反双胞胎 (跟 counselor-home controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid
//     - emotionLevel 是 query 参数 (前端 EmotionBloc 实时传入)
//     - 1 端点聚合, 减少瀑布流
//     - 不复用 home-overview.controller (职责正交, 走独立 controller)

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type CounselorHomeOverviewDto, CounselorHomeQueryDto } from '../dto/counselor-home.dto';
import { CounselorHomeService } from '../providers/counselor-home.service';

/**
 * V2026-10-13 (Phase 7.10 P0-2 — CounselorTrainingController):
 *   心理咨询师学员端「训练」Tab 主 controller.
 *
 *   跟 xin_su_app CounselorTrainingBloc + CounselorTrainingRepository 端到端 1:1 对应.
 *   V0.5: thin delegate 到 CounselorHomeService (数据同源, 避免双胞胎).
 *   V1.x: 拆独立 DTO + service, 加 per-scenario progress 字段.
 */
@ApiTags('counselor-training')
@Controller('counselor/training')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorTrainingController {
  constructor(private readonly homeService: CounselorHomeService) {}

  /**
   * GET /counselor/training/overview
   *
   * V0.5: delegate 到 CounselorHomeService.getOverview (数据同源, 4 大训练分类 + 9 场景).
   * V1.x: 拆独立 service + 加 per-scenario progress 字段.
   */
  @Get('overview')
  @ApiOperation({ summary: '心理咨询师学员端「训练」Tab 总览 (4 大训练分类 + 9 场景, V0.5 delegate home service)' })
  async getOverview(@CurrentUser() user: { userId: string }, @Query() query: CounselorHomeQueryDto): Promise<CounselorHomeOverviewDto> {
    return this.homeService.getOverview(user.userId, query.emotionLevel);
  }
}
