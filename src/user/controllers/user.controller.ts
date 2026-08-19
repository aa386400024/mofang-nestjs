import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { AuthResponseDto, CurrentUserDto } from '../dto/auth-response.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { VerifyEmailDto, ResendVerificationDto } from '../dto/verify-email.dto';
import { SessionDto } from '../dto/session.dto';
import {
  AuthMediumRateLimit,
  AuthStrictRateLimit,
} from './auth-rate-limit.decorators';

import { UserService } from '../providers/user.service';
import { SessionService } from '../providers/session.service';
import { JwtBlacklistService } from '../providers/jwt-blacklist.service';
import { PasswordResetService } from '../providers/password-reset.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { SessionRevokeReason } from '../user.constant';
import { BizException } from '../../common/exceptions/biz.exception';
import { BizCode } from '../../common/exceptions/biz-code.enum';

/**
 * User controller — 心塑 + 魔方共用账号 endpoints (大厂企业级 V2).
 *
 * 路由 (V2 完整列表):
 *   POST /user/register                          - 注册
 *   POST /user/login                             - 登录
 *   POST /user/refresh                           - 刷新 token
 *   POST /user/logout                            - 登出当前 session
 *   POST /user/logout-all                        - 登出所有其他 session
 *   GET  /user/me                                - 当前用户信息
 *
 *   POST /user/change-password                   - 改密 (已登录)
 *   POST /user/forgot-password                   - 忘记密码 (发邮件)
 *   POST /user/reset-password                    - 重置密码 (token)
 *
 *   POST /user/verify-email                      - 验证邮箱 (token)
 *   POST /user/resend-verification               - 重发验证邮件
 *
 *   GET  /user/sessions                          - 列活跃 session
 *   DELETE /user/sessions/:sid                   - 下线某设备
 *
 *   OAuth (子路由 /user/oauth/...)
 */
@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(
    private readonly user: UserService,
    private readonly sessions: SessionService,
    private readonly blacklist: JwtBlacklistService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  // ========================================================================
  // 注册 / 登录 / 刷新
  // ========================================================================

  @Post('register')
  @AuthStrictRateLimit()
  @ApiOperation({ summary: '注册新用户' })
  public register(@Body() dto: RegisterDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.user.register(dto, this.extractContext(req));
  }

  @Post('login')
  @AuthStrictRateLimit()
  @ApiOperation({ summary: '手机号/邮箱 + 密码登录' })
  public login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.user.login(dto, this.extractContext(req));
  }

  @Post('refresh')
  @AuthMediumRateLimit()
  @ApiOperation({ summary: '刷新 token (rotation)' })
  public refresh(@Body() dto: RefreshTokenDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.user.refresh(dto.refreshToken, this.extractContext(req));
  }

  // ========================================================================
  // 登出
  // ========================================================================

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: '登出当前 session (撤销当前 refresh token)' })
  public async logout(@CurrentUser() payload: { sub: string; jti: string }): Promise<void> {
    await this.sessions.revoke(payload.jti, SessionRevokeReason.Logout);
    // blacklist 用 7 天 TTL (refresh 过期时间, 大约)
    await this.blacklist.revoke(payload.jti, Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: '登出所有其他 session (保留当前)' })
  public async logoutAll(
    @CurrentUser('sub') uid: string,
    @CurrentUser('jti') currentJti: string,
  ): Promise<void> {
    // 找当前 session 的 sid
    const current = await this.sessions.findByJti(currentJti);
    const revoked = await this.sessions.revokeAllByUserId(uid, SessionRevokeReason.LogoutAll, current?.sid);
    await this.blacklist.revokeMany(
      revoked.map((r) => ({ jti: r.jti, expiresAtMs: r.expiresAtMs })),
    );
  }

  // ========================================================================
  // 当前用户信息
  // ========================================================================

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前登录用户信息' })
  public async me(@CurrentUser('sub') uid: string): Promise<CurrentUserDto> {
    const me = await this.user.me(uid);
    if (!me) {
      throw new Error('用户不存在');
    }
    return me;
  }

  // ========================================================================
  // 改密 (已登录)
  // ========================================================================

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: '改密 (已登录, 知道旧密码, 撤销所有 session)' })
  public async changePassword(
    @CurrentUser('sub') uid: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.user.changePassword(uid, dto.oldPassword, dto.newPassword, this.extractContext(req));
  }

  // ========================================================================
  // 忘记密码 / 重置密码 (未登录, 邮件流程)
  // ========================================================================

  @Post('forgot-password')
  @AuthStrictRateLimit()
  @HttpCode(204)
  @ApiOperation({ summary: '忘记密码 — 发邮件' })
  public async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.passwordReset.requestReset(dto.email);
  }

  @Post('reset-password')
  @AuthStrictRateLimit()
  @HttpCode(204)
  @ApiOperation({ summary: '重置密码 — token + 新密码' })
  public async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    const uid = await this.passwordReset.verifyToken(dto.token);
    await this.passwordReset.resetPassword(uid, dto.newPassword);
  }

  // ========================================================================
  // 邮箱验证
  // ========================================================================

  @Post('verify-email')
  @AuthMediumRateLimit()
  @HttpCode(204)
  @ApiOperation({ summary: '验证邮箱 (邮件链接的 token)' })
  public async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request): Promise<void> {
    await this.user.verifyEmail(dto.token, this.extractContext(req));
  }

  @Post('resend-verification')
  @AuthStrictRateLimit()
  @HttpCode(204)
  @ApiOperation({ summary: '重发验证邮件' })
  public async resendVerification(@Body() dto: ResendVerificationDto): Promise<void> {
    await this.user.resendVerification(dto.email);
  }

  // ========================================================================
  // Sessions 多端管理
  // ========================================================================

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '列当前用户所有活跃 session' })
  public async listSessions(@CurrentUser() payload: { sub: string; jti: string }): Promise<{ sessions: SessionDto[] }> {
    const sessions = await this.sessions.listActiveByUserId(payload.sub);
    return {
      sessions: sessions.map((s) => ({
        sid: s.sid,
        deviceInfo: s.deviceInfo,
        deviceType: s.deviceType,
        ipAddress: s.ipAddress,
        location: s.location,
        lastActiveAt: s.lastActiveAt,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        isCurrent: s.jti === payload.jti,
      })),
    };
  }

  @Delete('sessions/:sid')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: '下线某个 session (按 sid)' })
  public async revokeSession(
    @CurrentUser('sub') uid: string,
    @Param('sid') sid: string,
  ): Promise<void> {
    const session = await this.sessions.findBySid(sid);
    if (!session) {
      throw new BizException(BizCode.ResourceNotFound, 'session 不存在');
    }
    if (session.userId !== uid) {
      throw new BizException(BizCode.Forbidden, '无权操作此 session');
    }
    const ok = await this.sessions.revokeBySid(sid, SessionRevokeReason.ManualRevoke);
    if (!ok) {
      throw new BizException(BizCode.ResourceNotFound, 'session 不存在');
    }
    await this.blacklist.revoke(session.jti, session.expiresAt.getTime());
  }

  // ========================================================================
  // 内部
  // ========================================================================

  private extractContext(req: Request): {
    ipAddress: string;
    userAgent: string;
    userAgentRaw: string;
    deviceType: string;
  } {
    const xff = req.headers['x-forwarded-for'];
    const ipAddress =
      (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) ??
      req.ip ??
      req.socket.remoteAddress ??
      'unknown';
    const userAgent = (req.headers['user-agent'] ?? 'unknown') as string;
    return {
      ipAddress,
      userAgent,
      userAgentRaw: userAgent,
      deviceType: this.detectDeviceType(userAgent),
    };
  }

  private detectDeviceType(ua: string): string {
    const lower = ua.toLowerCase();
    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/.test(lower)) {
      return 'mobile';
    }
    if (/ipad|tablet|playbook|silk/.test(lower)) {
      return 'tablet';
    }
    return 'desktop';
  }
}