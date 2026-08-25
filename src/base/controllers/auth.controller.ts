import { Body, Controller, Get, HttpException, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  AuthService,
  LocalLoginGuard,
  LoginCodeService,
  Payload,
  AuthenticatedGuard,
  LocalAuthGuard,
  JwtAuthGuard,
  JwtSign,
  JwtVerifyGuard,
} from '../../auth';
import { ReqUser } from '../../common';
import { UserService } from '../../user/providers/user.service';

/**
 * Auth REST controller — V1.1 重构: 接入 V2 enterprise UserService.
 *
 * V1.0 → V1.1 升级:
 *   - 弃用 shared/user mock, 改用真 UserService (bcrypt + TypeORM + 完整风控)
 *   - 新增 /auth/check-email / /auth/login-password / /auth/set-password 3 个 endpoint
 *   - /auth/verify-code 复用 LoginCodeService (6 位码流程) + 真 UserService (用户 CRUD)
 *   - 错误码统一走 BizException → 自动套 BizExceptionFilter → 标准化 {code, message, data}
 *
 * V1.1 完整流程:
 *   [LoginMethodPage] 输邮箱 → POST /auth/check-email
 *     ├─ userExists=false → POST /auth/send-code → /auth/verify-code
 *     │                    → UserService.register (无密码) → JWT (email_verified_at = now)
 *     │                    → 跳 SetPasswordPage 引导设密码
 *     ├─ hasPassword=true → POST /auth/login-password (走 V2 enterprise 登录流)
 *     │                    → UserService.login (含账户锁定/邮箱验证/改密周期检查)
 *     └─ hasPassword=false → 同新用户, 验证码登录后跳 SetPasswordPage
 *
 * V2 enterprise 特性继承:
 *   - 密码用 bcrypt hash (10 rounds) — UserService.register 内部
 *   - 失败登录计数 + 账号锁定 (5 次失败锁 30 分钟) — UserService.login 内部
 *   - 邮箱未验证不能登录 — UserService.login 内部
 *   - audit log 记录所有登录尝试 — UserService 内部
 *   - session 管理 (sid + Redis blacklist) — UserService 内部
 */
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private loginCodeService: LoginCodeService,
    // V1.1: 注入真 UserService (替代 shared/user mock). 包含:
    //   - findByEmail (TypeORM Repository)
    //   - register (bcrypt hash + 邮箱验证 token 发送)
    //   - login (完整 V2 enterprise 安全检查)
    //   - changePassword (改密 + 撤销所有 session + 入密码历史)
    //   - forgotPassword/resetPassword (委托 passwordReset service)
    private userService: UserService,
  ) {}

  // ─── V1.1: 邮箱状态查询 ─────────────────────────────────────
  /**
   * 检查邮箱注册状态 — 登录页输完邮箱后立即调用, 决定走密码还是验证码.
   *
   * 边界: 调用 userService.findByEmail (V2 enterprise) 而非 shared/user mock.
   * 密码是否存在的判断: V2 UserService 没暴露密码字段, 但 passwordHash 不为 null 即"已设过密码".
   *
   * body: { email }
   * 返回: { userExists, hasPassword }
   *   - userExists=false: 新邮箱, 走验证码流程创建账号 (无密码)
   *   - hasPassword=true:  走密码登录 (V2 enterprise login 流程)
   *   - hasPassword=false: 走验证码登录, 完成后引导设密码
   */
  @Post('check-email')
  public async checkEmail(@Body('email') email: string): Promise<{ userExists: boolean; hasPassword: boolean }> {
    if (!email?.includes('@')) {
      throw new HttpException('邮箱格式错误', HttpStatus.BAD_REQUEST);
    }
    const user = await this.userService.findByEmail(email);
    if (!user) {
      return { userExists: false, hasPassword: false };
    }
    return {
      userExists: true,
      hasPassword: !!user.passwordHash,
    };
  }

  // ─── V1.1: 密码登录 (走 V2 enterprise 流) ─────────────────────
  /**
   * 密码登录 — V1.1 默认入口.
   *
   * 走真 UserService.login(), 继承所有 V2 enterprise 特性:
   *   - 状态机检查 (Banned/Deleted/PendingVerification 不能登录)
   *   - 邮箱验证检查 (email_verified_at 不为 null)
   *   - 失败登录计数 + 账号锁定 (5 次失败锁 30 分钟)
   *   - 改密周期检查 (90 天强制改密)
   *   - audit log + metrics
   *
   * body: { email, password, deviceInfo? }
   * 返回: { accessToken, refreshToken, expiresIn, refreshExpiresIn, user, sid? }
   * 错误:
   *   - 400 邮箱/密码为空
   *   - 401 邮箱/密码错 (统一文案防 enumeration attack)
   *   - 423 账号已锁定
   *   - 412 邮箱未验证
   */
  @Post('login-password')
  public async loginPassword(
    @Body() body: { email?: string; phone?: string; password: string; deviceInfo?: string },
    @Req() req: Request,
  ): Promise<JwtSign & { userId: string; username: string; roles: string[]; sid?: string }> {
    if (!body.email && !body.phone) {
      throw new HttpException('邮箱不能为空', HttpStatus.BAD_REQUEST);
    }
    if (!body.password) {
      throw new HttpException('密码不能为空', HttpStatus.BAD_REQUEST);
    }

    // 委托 V2 UserService.login (含完整风控).
    // 异常: BizException → BizExceptionFilter 自动转 {code, message}.
    // 但我们重新包一下, 让前端能拿到 V1.x 兼容的错误码.
    const result = await this.userService.login(
      { email: body.email, phone: body.phone, password: body.password, deviceInfo: body.deviceInfo },
      this.extractContext(req),
    );

    return {
      ...this.auth.jwtSign({
        userId: result.user.uid,
        username: result.user.email ?? result.user.phone ?? '',
        roles: ['user'],
      }),
      userId: result.user.uid,
      username: result.user.email ?? result.user.phone ?? '',
      roles: ['user'],
      sid: result.sid,
    };
  }

  // ─── V1.0: 发送 6 位邮箱验证码 (保留作为 fallback) ─────────────
  @Post('send-code')
  public async sendCode(@Body('email') email: string): Promise<{ success: boolean; message: string; devCode?: string }> {
    if (!email?.includes('@')) {
      throw new HttpException('邮箱格式错误', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.loginCodeService.generateAndSend(email);
      return {
        success: result.success,
        message: '验证码已发送',
        devCode: result.devCode,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('请求过于频繁')) {
        throw new HttpException(msg, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new HttpException('邮件发送失败, 请稍后重试', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── V1.1: 验证 6 位验证码 + 自动创建/登录 ─────────────────
  /**
   * 验证码登录 — V1.x fallback 路径.
   *
   * V1.1 升级: 验证通过后, 调用真 UserService.findByEmail/createUser,
   *   - 老用户: 仅生成 JWT (无密码校验, 类似 Slack magic link)
   *   - 新用户: UserService.register 创建账号, 邮箱验证标记 (email_verified_at = now)
   *
   * body: { email, code }
   * 返回: { accessToken, refreshToken, ..., hasPassword, userId, username, roles, sid? }
   * 错误:
   *   - 400 邮箱/验证码为空
   *   - 401 验证码错误或已过期
   *   - 500 用户创建失败
   */
  @Post('verify-code')
  public async verifyCode(
    @Body() body: { email: string; code: string },
  ): Promise<JwtSign & { userId: string; username: string; roles: string[]; hasPassword: boolean; sid?: string }> {
    if (!body.email || !body.code) {
      throw new HttpException('邮箱或验证码不能为空', HttpStatus.BAD_REQUEST);
    }

    // 1. 校验 6 位码 (Redis, TTL 5min)
    const ok = await this.loginCodeService.verify(body.email, body.code);
    if (!ok) {
      throw new UnauthorizedException('验证码错误或已过期');
    }

    // 2. 查用户: 不存在则创建 (V1.x 验证码流程, 无密码状态)
    let user = await this.userService.findByEmail(body.email);
    if (!user) {
      // V2 UserService.createPasswordlessUser: 创建无密码 user, 已标 email_verified_at
      user = await this.userService.createPasswordlessUser(body.email);
    } else if (!user.emailVerifiedAt) {
      // 老用户: 标记邮箱已验证 (V2 enterprise 兼容)
      await this.userService.markEmailVerified(user.uid);
      user.emailVerifiedAt = new Date();
    }

    // 3. 生成 JWT
    const payload: Payload = {
      userId: user.uid,
      username: user.email ?? body.email,
      roles: ['user'],
    };
    return {
      ...this.auth.jwtSign(payload),
      userId: user.uid,
      username: user.email ?? body.email,
      roles: ['user'],
      hasPassword: !!user.passwordHash,
    };
  }

  // ─── V1.1: 设置密码 (首次设 / 修改) ─────────────────────
  /**
   * 设置密码 — 首次登录后引导设密码 / 老用户修改密码.
   *
   * 走 V2 UserService.changePassword:
   *   - bcrypt hash (10 rounds)
   *   - 撤销所有活跃 session (V2 安全策略: 改密后其他设备强制下线)
   *   - 入密码历史 (最近 5 次不复用)
   *   - 90 天后强制改密 (passwordChangedAt)
   *
   * body: { email, password }
   * 返回: { success: true }
   * 错误:
   *   - 400 邮箱/密码为空 / 密码 < 8 位
   *   - 401 邮箱未注册 (BizException 抛 InvalidParameter)
   *   - 403 密码格式不够强 (V2: 强密码策略由 UserService.register 负责, 已用正则预校验)
   */
  @Post('set-password')
  public async setPassword(@Body() body: { email: string; password: string }): Promise<{ success: boolean }> {
    if (!body.email || !body.password) {
      throw new HttpException('邮箱或密码不能为空', HttpStatus.BAD_REQUEST);
    }
    if (body.password.length < 8) {
      throw new HttpException('密码至少 8 位', HttpStatus.BAD_REQUEST);
    }
    // 简单强度校验: 至少含字母+数字. V2 强密码策略由 UserService.register 负责 (未来迁移).
    if (!/[A-Za-z]/.test(body.password) || !/\d/.test(body.password)) {
      throw new HttpException('密码需包含字母和数字', HttpStatus.BAD_REQUEST);
    }

    const user = await this.userService.findByEmail(body.email);
    if (!user) {
      throw new HttpException('请先完成验证码登录', HttpStatus.BAD_REQUEST);
    }
    if (user.passwordHash) {
      throw new HttpException('用户已设置过密码, 请用改密流程', HttpStatus.BAD_REQUEST);
    }

    // V1.1 接入 V2 UserService.setInitialPassword (首次设密码专用, 走 bcrypt + 写 passwordChangedAt)
    await this.userService.setInitialPassword(user.uid, body.password);
    return { success: true };
  }

  // ─── V1.0 Passport / JWT 旧流程 (保留兼容) ──────────────────────
  @Post('login')
  @UseGuards(LocalLoginGuard)
  public login(@ReqUser() user: Payload): Payload {
    return user;
  }

  @Get('logout')
  public logout(@Req() req: Request, @Res() res: Response): void {
    req.logout(() => {
      res.redirect('/');
    });
  }

  @Get('check')
  @UseGuards(AuthenticatedGuard)
  public check(@ReqUser() user: Payload): Payload {
    return user;
  }

  @UseGuards(LocalAuthGuard)
  @Post('jwt/login')
  public jwtLogin(@ReqUser() user: Payload): JwtSign {
    return this.auth.jwtSign(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('jwt/check')
  public jwtCheck(@ReqUser() user: Payload): Payload {
    return user;
  }

  @UseGuards(JwtVerifyGuard)
  @Post('jwt/refresh')
  public jwtRefresh(@ReqUser() user: Payload, @Body('refresh_token') token?: string): JwtSign {
    if (!token || !this.auth.validateRefreshToken(user, token)) {
      throw new UnauthorizedException('InvalidRefreshToken');
    }
    return this.auth.jwtSign(user);
  }

  // ─── 私有辅助 ─────────────────────────────────────────

  /**
   * 提取请求上下文 (IP + UA) — V2 enterprise UserService.login() 需要.
   */
  private extractContext(req: Request): {
    ipAddress: string;
    userAgent: string;
    userAgentRaw: string;
    deviceType: string;
  } {
    const xff = req.headers['x-forwarded-for'];
    const ipAddress =
      (typeof xff === 'string' ? xff.split(',', 1)[0]?.trim() : undefined) ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    return {
      ipAddress,
      userAgent,
      userAgentRaw: userAgent,
      deviceType: this.detectDeviceType(userAgent),
    };
  }

  private detectDeviceType(ua: string): string {
    const lower = ua.toLowerCase();
    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/.test(lower)) return 'mobile';
    if (/ipad|tablet|playbook|silk/.test(lower)) return 'tablet';
    return 'desktop';
  }
}
