// V2026-10-13 治本 (Phase 7.10 P0-4 — counselor-growth.controller.ts):
//   心理咨询师学员端「成长」Tab 主 controller.
//
//   端点 (V0.5 简化):
//     GET /counselor/growth/overview  - 成长综合快照 (4 区块: 能力 + KPI + 训练记录 + 错题)
//
//   反双胞胎 (跟 counselor-home/training/exam controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid
//     - 1 端点聚合, 减少瀑布流
//     - 不复用 home-overview.controller (业务正交, 成长 Tab 4 区块独立)

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type CounselorGrowthDto, CounselorGrowthQueryDto } from '../dto/counselor-growth.dto';
import { CounselorGrowthService } from '../providers/counselor-growth.service';

/**
 * V2026-10-13 (Phase 7.10 P0-4 — CounselorGrowthController):
 *   心理咨询师学员端「成长」Tab 主 controller.
 */
@ApiTags('counselor-growth')
@Controller('counselor/growth')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorGrowthController {
  constructor(private readonly service: CounselorGrowthService) {}

  @Get('overview')
  @ApiOperation({ summary: '心理咨询师学员端「成长」Tab 综合快照 (4 区块: 能力 + KPI + 训练记录 + 错题)' })
  async getOverview(@CurrentUser() user: { userId: string }, @Query() query: CounselorGrowthQueryDto): Promise<CounselorGrowthDto> {
    return this.service.getOverview(user.userId, query.emotionLevel);
  }
}
