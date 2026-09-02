import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  EmbodiedAuthStatusDto,
  EmbodiedFeedbackDto,
  EmbodiedToolDto,
  EmbodiedVitalsDto,
  RequestEmbodiedAuthDto,
} from '../dto/practice.dto';
import { PracticeEmbodiedService } from '../providers/practice.service';

/**
 * 具身认知 controller — V2.0 §Tab2 分类8 + 心理健身房高级.
 *
 *   GET    /practice/embodied/auth-status     — 授权状态
 *   POST   /practice/embodied/auth-request    — 申请授权
 *   GET    /practice/embodied/tools           — 4 个具身工具列表
 *   GET    /practice/embodied/vitals          — 实时生理数据
 *   POST   /practice/embodied/sessions/:id/feedback — 完成反馈
 *
 * 反双胞胎 (核心设计):
 *   - 业务实现委托 EmbodiedModule (profile/embodied-data/*), 本 controller 只做:
 *     1. 路径命名空间暴露 (/practice/embodied/* vs /profile/embodied-data/*)
 *     2. DTO 字段映射 (heartRate -> heartRateBpm, 跟前端 entity 1:1)
 *     3. 工具列表 (4 个具身工具, 是 practice 模块独有的语义资源)
 *   - 设备 / 权限管理仍走 /profile/embodied-data/devices + permissions (大厂 RESTful 单资源约束)
 *
 * V2.0 sample, V3 接真实传感器流时, Service 加 Redis cache + 实时 stream, 端点路径不变.
 */
@ApiTags('practice-embodied')
@Controller('practice/embodied')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PracticeEmbodiedController {
  constructor(private readonly service: PracticeEmbodiedService) {}

  @Get('auth-status')
  @ApiOperation({ summary: '传感器授权状态' })
  public async getAuthStatus(@CurrentUser() user: { userId: string }): Promise<EmbodiedAuthStatusDto> {
    return this.service.getAuthStatus(user.userId);
  }

  @Post('auth-request')
  @ApiOperation({ summary: '申请传感器授权' })
  public async requestAuth(@CurrentUser() user: { userId: string }, @Body() _dto: RequestEmbodiedAuthDto): Promise<EmbodiedAuthStatusDto> {
    return this.service.requestAuth(user.userId);
  }

  @Get('tools')
  @ApiOperation({ summary: '具身认知工具列表 (4 个)' })
  public async listTools(@CurrentUser() user: { userId: string }): Promise<EmbodiedToolDto[]> {
    return this.service.listTools(user.userId);
  }

  @Get('vitals')
  @ApiOperation({ summary: '实时生理数据 (心率/HRV/呼吸)' })
  public async getVitals(@CurrentUser() user: { userId: string }): Promise<EmbodiedVitalsDto> {
    return this.service.getVitals(user.userId);
  }

  @Post('sessions/:id/feedback')
  @ApiOperation({ summary: '生成具身练习完成反馈 (V2.0 sample, V3 接传感器历史)' })
  public async generateFeedback(@Param('id') sessionId: string): Promise<EmbodiedFeedbackDto> {
    return this.service.generateFeedback(sessionId);
  }
}
