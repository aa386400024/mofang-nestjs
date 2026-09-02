import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CompleteSessionDto, PracticeFeedbackDto, PracticeSessionDto, StartSessionDto } from '../dto/practice.dto';
import { PracticeSessionService } from '../providers/practice.service';

/**
 * 练习会话生命周期 controller — V2.0 §Tab2 工具执行页.
 *
 *   POST /practice/sessions/start       — 开始会话
 *   POST /practice/sessions/:id/complete — 完成会话
 *
 * 设计:
 *   - start 返回 sessionId, 前端走 /practice/tools/:id 拿完整元数据
 *   - complete 返回 PracticeFeedback (碎片 / 徽章 / 软反馈), 跟前端 entity 1:1
 *   - sessionId 走 UUID v4, 后续 V3 接 WS 实时引导按 sessionId 订阅
 */
@ApiTags('practice-sessions')
@Controller('practice/sessions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PracticeSessionsController {
  constructor(private readonly sessionService: PracticeSessionService) {}

  @Post('start')
  @ApiOperation({ summary: '开始练习会话' })
  public async startSession(@CurrentUser() user: { userId: string }, @Body() dto: StartSessionDto): Promise<PracticeSessionDto> {
    // V2026-09-01 治本 (TS6133):
    //   删 _resolveModule / title / module 死代码 — service.startSession 内部
    //   不再用这两个参数, controller 不再传, 统一在 completeSession 内部反查.
    return this.sessionService.startSession(user.userId, dto.toolId, dto.targetDurationMinutes);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: '完成练习会话' })
  public async completeSession(
    @CurrentUser() user: { userId: string },
    @Param('id') sessionId: string,
    @Body() dto: CompleteSessionDto,
  ): Promise<PracticeFeedbackDto> {
    const fb = await this.sessionService.completeSession(user.userId, sessionId, dto.actualDurationSeconds);
    if (!fb) {
      // 大厂做法: 已完成的会话重复 complete 返回 200 + 旧 feedback (幂等)
      // 这里 V2 简单返回默认 feedback, 不报错
      return {
        toolTitle: '已完成',
        durationMinutes: Math.round(dto.actualDurationSeconds / 60),
        unlockedFragments: [],
        unlockedBadge: null,
        softNote: '你做到了',
      };
    }
    return fb;
  }

  /**
   * V2026-09-01 治本 (TS6133):
   *   原私有方法 `_resolveModule` 不再被 controller 调用 (service 不再传 module),
   *   删之. service.startSession 内部统一从 toolKey 反查 module.
   */
}
