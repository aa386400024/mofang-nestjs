import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  MicroInterventionActiveResponseDto,
  MicroInterventionCompleteDto,
  MicroInterventionCompleteResponseDto,
  MicroInterventionQueryDto,
  MicroInterventionSettingsDto,
  MicroInterventionStartResponseDto,
} from '../dto/home-overview.dto';
import { HomeMicroInterventionService } from '../providers/home-micro-intervention.service';

/**
 * 场景化微干预 controller — V2.0 §3 + §6 (DESIGN).
 *
 * 端点:
 *   GET    /home/micro-intervention/active?emotionLevel=&clientTimezone=
 *                                                   - 当前激活 / 待触发
 *   GET    /home/micro-intervention/settings       - 用户配置 (1:1)
 *   PUT    /home/micro-intervention/settings       - 更新配置
 *   POST   /home/micro-intervention/:id/start      - 开始执行 → 返回 sessionId
 *   POST   /home/micro-intervention/:id/complete   - 完成 → 写 history + 返回 feedback
 *   POST   /home/micro-intervention/:id/dismiss    - 关闭
 *
 * 设计要点:
 *   - decision tree 100% 服务端, 客户端只展示 (大厂: 策略不分散)
 *   - sessionId 由服务端生成 (crypto.randomUUID), 防伪造
 *   - complete / dismiss 幂等 (重复调用无副作用)
 */
@ApiTags('home-micro-intervention')
@Controller('home/micro-intervention')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HomeMicroInterventionController {
  constructor(private readonly service: HomeMicroInterventionService) {}

  @Get('active')
  @ApiOperation({ summary: '当前激活 / 待触发的微干预 (首页场景化卡片)' })
  public async getActive(
    @CurrentUser() user: { userId: string },
    @Query() query: MicroInterventionQueryDto,
  ): Promise<MicroInterventionActiveResponseDto> {
    return this.service.getActive(user.userId, query.emotionLevel ?? null, new Date());
  }

  @Get('settings')
  @ApiOperation({ summary: '微干预用户配置 (主开关 / 灵敏度 / 触发场景 / 静默时段)' })
  public async getSettings(@CurrentUser() user: { userId: string }): Promise<MicroInterventionSettingsDto> {
    return this.service.getSettings(user.userId);
  }

  @Put('settings')
  @ApiOperation({ summary: '更新微干预用户配置' })
  public async updateSettings(
    @CurrentUser() user: { userId: string },
    @Body() dto: MicroInterventionSettingsDto,
  ): Promise<MicroInterventionSettingsDto> {
    return this.service.updateSettings(user.userId, dto);
  }

  @Post(':id/start')
  @ApiOperation({ summary: '开始执行微干预 → 返回 sessionId + routePath' })
  public async start(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<MicroInterventionStartResponseDto> {
    const result = await this.service.start(user.userId, id);
    return {
      interventionId: result.interventionId,
      sessionId: result.sessionId,
      startedAt: result.startedAt.toISOString(),
      routePath: result.routePath,
    };
  }

  @Post(':id/complete')
  @ApiOperation({ summary: '完成微干预 (写 history + 返回 feedback)' })
  public async complete(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: MicroInterventionCompleteDto,
  ): Promise<MicroInterventionCompleteResponseDto> {
    const result = await this.service.complete(user.userId, id, dto.completed, dto.durationSeconds ?? 0);
    return {
      sessionId: result.sessionId,
      completed: result.completed,
      completedAt: result.completedAt.toISOString(),
      durationSeconds: result.durationSeconds,
      feedbackCopy: result.feedbackCopy,
    };
  }

  @Post(':id/dismiss')
  @ApiOperation({ summary: '关闭微干预 (不再弹出)' })
  public async dismiss(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<{ dismissedAt: string }> {
    const result = await this.service.dismiss(user.userId, id);
    return { dismissedAt: result.dismissedAt.toISOString() };
  }
}
