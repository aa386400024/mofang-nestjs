// V2026-09-04 治本 (V6.0 §3.3):
//   AI 动态解锁 controller.
//   端点:
//     GET   /ai/unlock/states         - 拉 6 大功能状态
//     POST  /ai/unlock/evaluate       - 触发评估 (cron 也调)
//     POST  /ai/unlock/:feature/rollback - admin 回滚

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { AIUnlockStateDto, AIUnlockStatesDto } from '../dto/ai-unlock.dto';
import type { AIUnlockFeature } from '../enums/ai-unlock.enums';
import { AIUnlockService } from '../providers/ai-unlock.service';

@ApiTags('ai-unlock')
@Controller('ai/unlock')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AIUnlockController {
  constructor(private readonly service: AIUnlockService) {}

  @Get('states')
  @ApiOperation({ summary: '拉取 6 大高阶功能解锁状态' })
  public async getStates(@CurrentUser('userId') uid: string): Promise<AIUnlockStatesDto> {
    return this.service.getStates(uid);
  }

  @Post('evaluate')
  @ApiOperation({ summary: '触发评估 — cron 周期 + 手动重算' })
  public async evaluate(@CurrentUser('userId') uid: string): Promise<AIUnlockStatesDto> {
    return this.service.evaluateUnlocks(uid);
  }

  @Post(':feature/rollback')
  @ApiOperation({ summary: 'admin 强制回滚某功能到 locked (带原因)' })
  public async rollback(
    @CurrentUser('userId') uid: string,
    @Param('feature') feature: AIUnlockFeature,
    @Body('reason') reason: string,
  ): Promise<AIUnlockStateDto> {
    return this.service.rollback(uid, feature, reason ?? 'manual rollback by user/admin');
  }
}
