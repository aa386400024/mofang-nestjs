// V2026-09-04 治本 (V6.0 §4.2):
//   急救会话 controller.
//   端点:
//     POST /emergency/sessions           - upsert 单条 (含前端 UUID)
//     GET  /emergency/sessions           - 列出 (跨设备同步)
//     GET  /emergency/sessions/:id       - 单条
//     GET  /emergency/stats              - §3.4 工具效果统计

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
// V2026-09-04 治本 (smoke 修): 上游使用 UpsertEmergencySessionDto 为 Body 参数,
//   必须真 import, 不用 `import type`. `import type` 编译时擦除, runtime 拿不到 DTO class,
//   NestJS design:paramtypes metadata 退化成 `Function`, ValidationPipe 不会调 plainToClass,
//   dto 永远 {}, service 调 dto.startedAtMs.toString() 必崩. 同类问题 V6.0 §3.1 ai-profile 上轮修复.
//   EmergencySessionDto / EmergencySessionListDto 是响应型, 用 `import type` 没问题.
import { EmergencySessionDto, EmergencySessionListDto, UpsertEmergencySessionDto } from '../dto/emergency.dto';
import { EmergencyService } from '../providers/emergency.service';

@ApiTags('emergency')
@Controller('emergency')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EmergencyController {
  constructor(private readonly service: EmergencyService) {}

  @Post('sessions')
  @ApiOperation({ summary: '急救会话 upsert — 含前端 UUID 幂等键' })
  public async upsert(@CurrentUser('userId') uid: string, @Body() dto: UpsertEmergencySessionDto): Promise<EmergencySessionDto> {
    return this.service.upsert(uid, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: '急救会话列表 — 跨设备同步' })
  public async list(
    @CurrentUser('userId') uid: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ): Promise<EmergencySessionListDto> {
    return this.service.list(uid, {
      sinceMs: since ? Number(since) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: '急救会话单条详情' })
  public async getOne(@CurrentUser('userId') uid: string, @Param('id') id: string): Promise<EmergencySessionDto | null> {
    return this.service.getOne(uid, id);
  }

  @Get('stats')
  @ApiOperation({ summary: '§3.4 急救工具效果统计 — 解锁降权数据源' })
  public async stats(
    @CurrentUser('userId') uid: string,
    @Query('windowDays') windowDays?: string,
  ): Promise<
    {
      toolKind: string;
      sampleCount: number;
      avgIntensityDelta: number | null;
      completionRate: number;
    }[]
  > {
    return this.service.getToolStats(uid, windowDays ? Number(windowDays) : 30);
  }
}
