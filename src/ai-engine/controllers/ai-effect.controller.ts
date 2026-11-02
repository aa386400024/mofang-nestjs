// V2026-09-04 治本 (V6.0 §3.4):
//   AI 干预效果 controller.
//   端点:
//     POST /ai/effect/immediate        - 端侧练习结束立即上报短效
//     GET  /ai/effect/history          - 趋势面板
//     GET  /ai/effect/stats/:toolId    - 工具效果统计 (解锁降权用)

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { AIEffectHistoryDto, AIEffectRecordDto, RecordImmediateEffectDto } from '../dto/ai-effect.dto';
import { AIEffectService } from '../providers/ai-effect.service';

@ApiTags('ai-effect')
@Controller('ai/effect')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AIEffectController {
  constructor(private readonly service: AIEffectService) {}

  @Post('immediate')
  @ApiOperation({ summary: '短期效果上报 — 练习结束后调用' })
  public async recordImmediate(@CurrentUser('userId') uid: string, @Body() dto: RecordImmediateEffectDto): Promise<AIEffectRecordDto> {
    return this.service.recordImmediate(uid, dto);
  }

  @Get('history')
  @ApiOperation({ summary: '效果历史 — §3.4 趋势面板' })
  public async history(
    @CurrentUser('userId') uid: string,
    @Query('toolId') toolId?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ): Promise<AIEffectHistoryDto> {
    return this.service.getHistory(uid, {
      toolId,
      sinceMs: since ? Number(since) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('stats/:toolId')
  @ApiOperation({ summary: '工具效果统计 — 解锁降权 / 同类推荐数据源' })
  public async stats(
    @CurrentUser('userId') uid: string,
    @Param('toolId') toolId: string,
    @Query('windowDays') windowDays?: string,
  ): Promise<{
    toolId: string;
    sampleCount: number;
    avgImmediateDelta: number | null;
    positiveRate: number | null;
  }> {
    return this.service.getToolEffectStats(uid, toolId, windowDays ? Number(windowDays) : 30);
  }
}
