import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OAuthService } from './oauth.service';
import { ConfigService } from '../../common';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { CurrentUser } from '../decorators/current-user.decorator';

import { AuthResponseDto } from '../dto/auth-response.dto';
import { OAuthProvider } from '../entities/oauth-identity.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

/**
 * OAuth controller — 第三方登录端点 (大厂企业级).
 *
 * 路由:
 *   GET  /user/oauth/:provider/url          - 生成授权 URL (前端跳转)
 *   POST /user/oauth/callback               - 处理 OAuth 回调 (code 或 id_token)
 *   GET  /user/oauth/linked                 - 列已绑定的 provider (需鉴权)
 *   DELETE /user/oauth/:provider            - 解绑 (需鉴权)
 */
@ApiTags('User-OAuth')
@Controller('user/oauth')
// eslint-disable-next-line @typescript-eslint/naming-convention
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 生成 OAuth 授权 URL (前端跳转到这个 URL).
   * 返回 state 参数, 前端在回调时带回.
   */
  @Get(':provider/url')
  @ApiOperation({ summary: '生成 OAuth 授权 URL (前端跳转用)' })
  public async getAuthUrl(@Param('provider') provider: string): Promise<{ url: string; state: string }> {
    const p = this.parseProvider(provider);
    const state = await this.oauth.generateState(p);
    const url = this.buildAuthUrl(p, state);
    return { url, state };
  }

  /**
   * 统一 OAuth 回调 — 业务方负责传 code 或 id_token.
   * V2: 直接登录/注册, 返回 AuthResponseDto.
   */
  @Post('callback')
  @ApiOperation({ summary: 'OAuth 回调 (code 或 id_token, 业务方转发)' })
  public async callback(@Body() body: { provider: string; code?: string; idToken?: string; state?: string }): Promise<AuthResponseDto> {
    const p = this.parseProvider(body.provider);

    // state 校验 (CSRF)
    if (body.state) {
      const ok = await this.oauth.consumeState(body.state, p);
      if (!ok) {
        throw new BizException(BizCode.OAuthInvalidState);
      }
    }

    let info;
    switch (p) {
      case OAuthProvider.Google:
        if (!body.idToken) {
          throw new BadRequestException('id_token required');
        }
        info = await this.oauth.verifyGoogleIdToken(body.idToken);
        break;
      case OAuthProvider.Apple:
        if (!body.idToken) {
          throw new BadRequestException('id_token required');
        }
        info = await this.oauth.verifyAppleIdToken(body.idToken);
        break;
      case OAuthProvider.Wechat:
        if (!body.code) {
          throw new BadRequestException('code required');
        }
        info = await this.oauth.exchangeWechatCode(body.code);
        break;
    }
    return this.oauth.loginOrRegister(info);
  }

  /**
   * 列已绑定的 provider (需鉴权).
   */
  @Get('linked')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '列当前用户已绑定的第三方账号' })
  public async listLinked(@CurrentUser('sub') uid: string): Promise<{ providers: string[] }> {
    const list = await this.oauth.listLinkedProviders(uid);
    return { providers: list };
  }

  /**
   * 解绑 (需鉴权).
   */
  @Delete(':provider')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '解绑第三方账号' })
  public async unlink(@Param('provider') provider: string, @CurrentUser('sub') uid: string): Promise<{ ok: boolean }> {
    const p = this.parseProvider(provider);
    await this.oauth.unlinkIdentity(uid, p);
    return { ok: true };
  }

  // ========================================================================
  // Internal
  // ========================================================================

  private parseProvider(raw: string): OAuthProvider {
    const lower = raw.toLowerCase();
    if (!['wechat', 'google', 'apple'].includes(lower)) {
      throw new BizException(BizCode.InvalidParameter, '不支持的 OAuth provider');
    }
    return lower as OAuthProvider;
  }

  private buildAuthUrl(provider: OAuthProvider, state: string): string {
    switch (provider) {
      case OAuthProvider.Google: {
        const cfg = this.config.get('oauth').google;
        const params = new URLSearchParams({
          client_id: cfg.clientId ?? '',
          redirect_uri: cfg.callbackUrl,
          response_type: 'code',
          scope: 'openid email profile',
          state,
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      }
      case OAuthProvider.Wechat: {
        const cfg = this.config.get('oauth').wechat;
        const params = new URLSearchParams({
          appid: cfg.appId ?? '',
          redirect_uri: cfg.callbackUrl,
          response_type: 'code',
          scope: 'snsapi_login',
          state,
        });
        return `https://open.weixin.qq.com/connect/qrconnect?${params}#wechat_redirect`;
      }
      case OAuthProvider.Apple: {
        // Apple 用原生 SDK (iOS/macOS), 不走 web redirect
        // 这里返回 placeholder, 前端用 Apple Identity Token 后调 /user/oauth/callback
        return `apple-signin://?state=${state}`;
      }
    }
  }
}
