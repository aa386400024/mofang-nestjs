// V2026-10-13 治本 (Phase 7.10 P0-3 — counselor-exam.controller.ts, counselor 端 exam Tab):
//   心理咨询师学员端「题库」Tab 主 controller.
//
//   端点 (V0.5 简化):
//     GET /counselor/exam/overview  - 题库综合快照 (4 大分类 + 11 卡片 + KPI)
//
//   反双胞胎 (跟 counselor-home/training controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid
//     - emotionLevel 是 query 参数 (前端 EmotionBloc 实时传入, V1.x 接入推荐)
//     - 1 端点聚合, 减少瀑布流
//     - 不复用 home-overview.controller (业务正交)

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type CounselorExamDto, CounselorExamQueryDto } from '../dto/counselor-exam.dto';
import { CounselorExamService } from '../providers/counselor-exam.service';

/**
 * V2026-10-13 (Phase 7.10 P0-3 — CounselorExamController):
 *   心理咨询师学员端「题库」Tab 主 controller.
 *
 *   跟 xin_su_app CounselorExamBloc 端到端 1:1 对应.
 */
@ApiTags('counselor-exam')
@Controller('counselor/exam')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorExamController {
  constructor(private readonly service: CounselorExamService) {}

  @Get('overview')
  @ApiOperation({ summary: '心理咨询师学员端「题库」Tab 综合快照 (4 大分类 + 11 卡片 + 3 KPI)' })
  async getOverview(@CurrentUser() user: { userId: string }, @Query() query: CounselorExamQueryDto): Promise<CounselorExamDto> {
    return this.service.getOverview(user.userId, query.emotionLevel);
  }
}
