import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import { type LoosenessReportDto, type TargetedReshapeStatusDto, CompleteTaskDto } from '../dto/genome-reshape.dto';
import { GenomeReshapeService } from '../providers/genome-reshape.service';

/**
 * 心理基因靶向重塑 Controller — V3.0 §3 Tab3 评估子模块.
 *
 * 端点清单 (V3.0):
 *   GET    /reshape/status?hasAssessment=&practiceCount=  - 卡点 + 4 周任务 + 解锁状态
 *   POST   /reshape/tasks/complete                        - 标记某周任务完成
 *   POST   /reshape/looseness                             - 上报松动度自评
 *
 * V3.0 治本:
 *   - 上下文参数 (hasAssessment / practiceCount) 走 query string,
 *     避免注入额外 service 依赖
 *   - 锁定/解锁/解锁中 三态返回, 跟前端 ProgressiveUnlockSheet 对齐
 */
@ApiTags('genome-reshape')
@Controller('reshape')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GenomeReshapeController {
  constructor(private readonly service: GenomeReshapeService) {}

  @Get('status')
  @ApiOperation({ summary: '靶向重塑综合状态 (含卡点 + 4 周任务 + 进度)' })
  async getStatus(
    @CurrentUser() user: { userId: string },
    @Query('hasAssessment') hasAssessment = 'false',
    @Query('practiceCount') practiceCount = '0',
  ): Promise<TargetedReshapeStatusDto> {
    return this.service.getStatus(user.userId, {
      hasCompletedAssessment: hasAssessment === 'true',
      basicPracticeCount: Number.parseInt(practiceCount, 10) || 0,
    });
  }

  @Post('tasks/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '标记某周任务完成' })
  async completeTask(@CurrentUser() user: { userId: string }, @Body() dto: CompleteTaskDto): Promise<{ ok: true }> {
    return this.service.completeTask(user.userId, dto);
  }

  @Post('looseness')
  @HttpCode(200)
  @ApiOperation({ summary: '上报本周卡点松动度自评 0-100' })
  async reportLooseness(@CurrentUser() user: { userId: string }, @Body() dto: LoosenessReportDto): Promise<{ ok: true }> {
    return this.service.reportLooseness(user.userId, dto);
  }
}
