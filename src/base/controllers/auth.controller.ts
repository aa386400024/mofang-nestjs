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

/**
 * https://docs.nestjs.com/techniques/authentication
 *
 * V1.0 心塑前端接入: controller 加 'auth' 前缀, 路由变 /auth/login 等.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private loginCodeService: LoginCodeService,
  ) {}

  /**
   * See test/e2e/local-auth.spec.ts
   * need username, password in body
   * skip guard to @Public when using global guard
   */
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

  /**
   * See test/e2e/jwt-auth.spec.ts
   */
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

  // Only verify is performed without checking the expiration of the access_token.
  @UseGuards(JwtVerifyGuard)
  @Post('jwt/refresh')
  public jwtRefresh(@ReqUser() user: Payload, @Body('refresh_token') token?: string): JwtSign {
    if (!token || !this.auth.validateRefreshToken(user, token)) {
      throw new UnauthorizedException('InvalidRefreshToken');
    }

    return this.auth.jwtSign(user);
  }

  /**
   * 发送 6 位邮箱验证码 — V1.0 心塑前端 OTP 流程.
   *
   * 流程: POST /auth/send-code {email} → 发邮件含 6 位数字 → 用户输到 app
   * body: { email }
   * 返回: { success: true, devCode?: string }  (devCode 仅 dev 环境返回)
   * 错误:
   *   - 400 邮箱格式错
   *   - 429 60s 内重复请求 (防刷)
   *   - 500 SMTP 失败
   */
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

  /**
   * 验证 6 位邮箱验证码 — 返回 JWT (等同于登录成功).
   *
   * 用户输 6 位 → 调本端点 → 后端验证 → 返 access_token + refresh_token
   *
   * V2 简化: 本端点复用了 /auth/login 的 LocalLoginGuard 机制 — 把 code 当 password,
   * AuthService.validateUser 走 CodeStoreService 路径. 但项目目前无 CodeStoreService,
   * 所以直接走 LoginCodeService.verify, 不走 LocalLoginGuard.
   *
   * body: { email, code }
   * 返回: { accessToken, refreshToken, expiresIn, refreshExpiresIn, user }
   */
  @Post('verify-code')
  public async verifyCode(
    @Body('email') email: string,
    @Body('code') code: string,
  ): Promise<JwtSign & { userId: string; username: string; roles: string[] }> {
    if (!email || !code) {
      throw new HttpException('邮箱或验证码不能为空', HttpStatus.BAD_REQUEST);
    }
    const ok = await this.loginCodeService.verify(email, code);
    if (!ok) {
      throw new UnauthorizedException('验证码错误或已过期');
    }
    // 验证通过: 生成 JWT
    const payload: Payload = {
      userId: `email_${email}`,
      username: email,
      roles: ['user'],
    };
    return {
      ...this.auth.jwtSign(payload),
      userId: payload.userId,
      username: payload.username,
      roles: payload.roles,
    };
  }
}
