import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { BindConsentToUserDto } from '../dto/bind-to-user.dto';
import { ConsentStatusQueryDto, ConsentStatusResponseDto } from '../dto/consent-status.dto';
import { RecordConsentDto, RecordConsentResponseDto } from '../dto/record-consent.dto';
import { ConsentContext, ConsentService } from '../providers/consent.service';

/**
 * Consent controller — 心塑 + 魔方共用合规接口 (大厂企业级 V3).
 *
 * 路由:
 *   POST /consent/record           - 记录用户同意 (幂等, 限流 60/min)
 *   GET  /consent/status          - 查询设备同意状态 (含版本强制升级语义)
 *   POST /consent/bind-to-user    - 登录后把 device consent 关联到 user (需 JWT)
 *
 * 设计要点:
 *   - record 是高频调用 (每次 app 启动), 不强制鉴权 (游客也能记录)
 *   - bind-to-user 必须鉴权 (关联到当前 user, 防止越权)
 *   - status 公开 (前端启动快速路径)
 */
@ApiTags('Consent')
@Controller('consent')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  /**
   * 记录用户同意 (幂等).
   *
   * 高频端点 (app 每次启动 + 重试场景), 用更严格的限流防止滥用.
   * 不鉴权: 游客态也要记录 (个保法要求).
   */
  @Post('record')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: '记录用户同意 (幂等, 限流 60/min)' })
  public async record(@Body() dto: RecordConsentDto, @Req() req: Request): Promise<RecordConsentResponseDto> {
    const result = await this.consent.record(dto, this.extractContext(req));
    return {
      id: result.id,
      acceptedAt: result.acceptedAt.toISOString(),
    };
  }

  /**
   * 查询设备同意状态.
   *
   * 公开端点 (前端启动快速路径 + 网络同步).
   */
  @Get('status')
  @ApiOperation({ summary: '查询设备的同意状态 (含版本强制升级语义)' })
  public async status(@Query() query: ConsentStatusQueryDto): Promise<ConsentStatusResponseDto> {
    if (!query.deviceId || !query.consentType || !query.appId) {
      throw new BizException(BizCode.InvalidParameter, 'deviceId / consentType / appId 必填');
    }
    return this.consent.checkStatus(query.deviceId, query.consentType, query.appId);
  }

  /**
   * 游客 → 已登录迁移 (把 device 上的 consent 关联到当前 user).
   *
   * 必须鉴权: 仅能关联当前 user, 防止越权绑定别人的 consent.
   */
  @Post('bind-to-user')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: '登录后把 device consent 关联到当前 user (需 JWT)' })
  public async bindToUser(@CurrentUser('sub') uid: string, @Body() dto: BindConsentToUserDto): Promise<void> {
    await this.consent.bindToUser(dto.deviceId, uid);
  }

  /**
   * 提取请求上下文 (IP / UA) — 与 user.controller.extractContext 风格一致.
   */
  private extractContext(req: Request): ConsentContext {
    const xff = req.headers['x-forwarded-for'];
    const ipAddress =
      (typeof xff === 'string' ? xff.split(',', 1)[0]?.trim() : undefined) ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    return { ipAddress, userAgent };
  }
}
