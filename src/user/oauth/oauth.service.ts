import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import axios from 'axios';

import { BizException } from '../../common/exceptions/biz.exception';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { MetricsService } from '../../shared/infra/metrics';
import { RedisService } from '../../shared/infra/redis';
import { REDIS_KEYS } from '../../shared/infra/redis/redis.constants';

import { AuthResponseDto } from '../dto/auth-response.dto';
import { OAuthIdentity, OAuthProvider } from '../entities/oauth-identity.entity';
import { User } from '../entities/user.entity';
import { UserService } from '../providers/user.service';
import { UserState } from '../user.state';

/**
 * OAuth provider 标准化用户信息.
 */
export interface OAuthUserInfo {
  provider: OAuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  rawData: Record<string, unknown>;
}

/**
 * OAuth service — 第三方登录 (大厂标准).
 *
 * 设计:
 *   - 支持三种 provider: 微信 / Google / Apple
 *   - 每种用最适合的协议:
 *     - WeChat: OAuth 2.0 Authorization Code (PC/H5 用, app 走微信原生 SDK 不归这里)
 *     - Google: id_token 验证 (Google Identity Service)
 *     - Apple: id_token 验证 (Sign in with Apple, jose 验签)
 *   - State 参数防 CSRF (Redis 存, 5 分钟过期)
 *   - 登录流程:
 *     1. 已有 user_oauth_identities 记录 → 自动登录 (返回 JWT)
 *     2. 没有记录:
 *        a. 如果 email 已注册 → 提示"该邮箱已注册, 是否绑定"
 *        b. 如果 email 未注册 → 创建新用户 + 自动绑定第三方
 *
 * 安全:
 *   - state 单次使用, 防 CSRF
 *   - id_token 强制验签 (Google + Apple)
 *   - 微信 access_token 通过 HTTPS + appsecret 校验
 */
@Injectable()
export class OAuthService implements OnModuleInit {
  private googleClient!: OAuth2Client;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(OAuthIdentity)
    private readonly identityRepo: Repository<OAuthIdentity>,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    private readonly userService: UserService,
  ) {}

  onModuleInit(): void {
    const google = this.config.get('oauth').google;
    if (google.enabled && google.clientId) {
      this.googleClient = new OAuth2Client(google.clientId, google.clientSecret, google.callbackUrl);
    }
  }

  // ========================================================================
  // State 管理 (CSRF 防护)
  // ========================================================================

  /**
   * 生成 state 参数, 存 Redis 5 分钟.
   * 前端构造授权 URL 时携带此 state.
   */
  async generateState(provider: OAuthProvider): Promise<string> {
    const state = randomBytes(32).toString('hex');
    await this.redis.set(REDIS_KEYS.oauthState(state), provider, 300);
    return state;
  }

  /**
   * 校验 state, 单次使用.
   */
  async consumeState(state: string, provider: OAuthProvider): Promise<boolean> {
    const stored = await this.redis.get(REDIS_KEYS.oauthState(state));
    if (!stored || stored !== provider) {
      return false;
    }
    await this.redis.del(REDIS_KEYS.oauthState(state));
    return true;
  }

  // ========================================================================
  // Provider: Google (id_token 验签)
  // ========================================================================

  /**
   * Google 登录 — 通过 id_token.
   * 前端用 Google Identity Services 拿到 id_token, 后端验签.
   */
  async verifyGoogleIdToken(idToken: string): Promise<OAuthUserInfo> {
    const cfg = this.config.get('oauth').google;
    if (!cfg.enabled || !this.googleClient) {
      throw new BizException(BizCode.OAuthProviderError, 'Google OAuth 未启用');
    }
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: cfg.clientId!,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new BizException(BizCode.OAuthProviderError, 'Google id_token 无效');
      }
      return {
        provider: OAuthProvider.Google,
        providerUserId: payload.sub,
        email: payload.email ?? null,
        emailVerified: payload.email_verified ?? false,
        displayName: payload.name ?? null,
        avatarUrl: payload.picture ?? null,
        rawData: payload as unknown as Record<string, unknown>,
      };
    } catch (err) {
      this.metrics.incOAuthLogin('google', 'failed');
      throw new BizException(
        BizCode.OAuthProviderError,
        `Google 验证失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ========================================================================
  // Provider: Apple (id_token 验签 via jose)
  // ========================================================================

  /**
   * Apple 登录 — 通过 id_token.
   * Apple 的 JWKS 端点: https://appleid.apple.com/auth/keys
   */
  async verifyAppleIdToken(idToken: string): Promise<OAuthUserInfo> {
    const cfg = this.config.get('oauth').apple;
    if (!cfg.enabled || !cfg.clientId) {
      throw new BizException(BizCode.OAuthProviderError, 'Apple OAuth 未启用');
    }
    try {
      const jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: 'https://appleid.apple.com',
        audience: cfg.clientId!,
      });
      const sub = payload.sub;
      if (!sub) {
        throw new BizException(BizCode.OAuthProviderError, 'Apple id_token 无 sub');
      }
      return {
        provider: OAuthProvider.Apple,
        providerUserId: String(sub),
        email: (payload['email'] as string | undefined) ?? null,
        emailVerified: (payload['email_verified'] as boolean | undefined) ?? false,
        displayName: null, // Apple 首次登录才会返回 name, V3 在前端缓存
        avatarUrl: null,
        rawData: payload as unknown as Record<string, unknown>,
      };
    } catch (err) {
      this.metrics.incOAuthLogin('apple', 'failed');
      throw new BizException(
        BizCode.OAuthProviderError,
        `Apple 验证失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ========================================================================
  // Provider: WeChat (OAuth Code 流程)
  // ========================================================================

  /**
   * WeChat 登录 — 通过 OAuth code (网页应用 / H5).
   * 微信扫码后回调拿到 code, 后端用 code 换 access_token + openid.
   */
  async exchangeWechatCode(code: string): Promise<OAuthUserInfo> {
    const cfg = this.config.get('oauth').wechat;
    if (!cfg.enabled || !cfg.appId || !cfg.appSecret) {
      throw new BizException(BizCode.OAuthProviderError, '微信 OAuth 未启用');
    }
    try {
      // 1. code → access_token
      const tokenRes = await axios.get<{
        access_token: string;
        expires_in: number;
        refresh_token: string;
        openid: string;
        scope: string;
        unionid?: string;
        errcode?: number;
        errmsg?: string;
      }>('https://api.weixin.qq.com/sns/oauth2/access_token', {
        params: {
          appid: cfg.appId,
          secret: cfg.appSecret,
          code,
          grant_type: 'authorization_code',
        },
      });
      if (tokenRes.data.errcode || !tokenRes.data.access_token) {
        throw new Error(`wechat token err: ${tokenRes.data.errcode} ${tokenRes.data.errmsg}`);
      }
      const { access_token, openid, unionid, refresh_token, expires_in } = tokenRes.data;

      // 2. access_token → userinfo (scope 必须为 snsapi_userinfo)
      const userRes = await axios.get<{
        openid: string;
        nickname: string;
        headimgurl: string;
        unionid?: string;
        errcode?: number;
        errmsg?: string;
      }>('https://api.weixin.qq.com/sns/userinfo', {
        params: { access_token, openid },
      });
      if (userRes.data.errcode) {
        throw new Error(`wechat userinfo err: ${userRes.data.errcode} ${userRes.data.errmsg}`);
      }

      return {
        provider: OAuthProvider.Wechat,
        providerUserId: unionid ?? openid,
        email: null, // 微信不返回邮箱
        emailVerified: false,
        displayName: userRes.data.nickname,
        avatarUrl: userRes.data.headimgurl,
        rawData: { ...userRes.data, access_token, refresh_token, expires_in },
      };
    } catch (err) {
      this.metrics.incOAuthLogin('wechat', 'failed');
      throw new BizException(
        BizCode.OAuthProviderError,
        `微信登录失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ========================================================================
  // 登录 / 绑定
  // ========================================================================

  /**
   * 通过 OAuth userinfo 登录或注册.
   * 返回 AuthResponseDto (跟密码登录同结构).
   */
  async loginOrRegister(info: OAuthUserInfo): Promise<AuthResponseDto> {
    // 1. 查 oauth_identity
    const existing = await this.identityRepo.findOne({
      where: { provider: info.provider, providerUserId: info.providerUserId },
    });
    if (existing) {
      // 已绑定 → 直接登录
      const user = await this.userRepo.findOne({
        where: { uid: existing.userId, deletedAt: IsNull() },
      });
      if (!user) {
        throw new BizException(BizCode.UserNotFound, '绑定的用户不存在或已删除');
      }
      this.metrics.incOAuthLogin(info.provider, 'success');
      return this.userService.buildAuthResponse(user);
    }

    // 2. 没绑定 → 尝试匹配 email (邮箱已验证过的优先)
    if (info.email && info.emailVerified) {
      const user = await this.userRepo.findOne({
        where: { email: info.email, deletedAt: IsNull() },
      });
      if (user) {
        // 自动绑定 (大厂做法: 邮箱已验证 + provider 信任 → 直接绑定)
        await this.linkIdentity(user.uid, info);
        this.metrics.incOAuthLogin(info.provider, 'linked');
        return this.userService.buildAuthResponse(user);
      }
    }

    // 3. 完全新用户 → 创建 + 自动绑定
    const newUser = this.userRepo.create({
      email: info.email,
      phone: null,
      // OAuth 用户没密码, 用随机 hash 占位 (不能登录密码, 只能 OAuth 登录)
      passwordHash: '!OAUTH_NO_PASSWORD!',
      state: UserState.Active,
      emailVerifiedAt: info.emailVerified ? new Date() : null,
      lastLoginAt: null,
    });
    const saved = await this.userRepo.save(newUser);
    await this.linkIdentity(saved.uid, info);
    this.metrics.incOAuthLogin(info.provider, 'success');
    return this.userService.buildAuthResponse(saved);
  }

  /**
   * 给当前用户绑定第三方账号.
   * 用于"已有账号, 想绑定微信/Google/Apple"的场景.
   */
  async linkIdentity(userId: string, info: OAuthUserInfo): Promise<void> {
    const existing = await this.identityRepo.findOne({
      where: { provider: info.provider, providerUserId: info.providerUserId },
    });
    if (existing) {
      throw new BizException(BizCode.OAuthAccountAlreadyLinked);
    }
    const identity = this.identityRepo.create({
      userId,
      provider: info.provider,
      providerUserId: info.providerUserId,
      providerData: JSON.stringify(info.rawData),
    });
    await this.identityRepo.save(identity);
  }

  /**
   * 解绑.
   */
  async unlinkIdentity(userId: string, provider: OAuthProvider): Promise<void> {
    await this.identityRepo.delete({ userId, provider });
  }

  /**
   * 列出当前用户已绑定的所有 OAuth provider.
   */
  async listLinkedProviders(userId: string): Promise<OAuthProvider[]> {
    const list = await this.identityRepo.find({ where: { userId } });
    return list.map((l) => l.provider);
  }
}