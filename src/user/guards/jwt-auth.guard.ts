import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { JwtBlacklistService } from '../providers/jwt-blacklist.service';
import { TokenType } from '../user.constant';

/**
 * JwtAuthGuard — 企业级 JWT 验证 guard (大厂标准).
 *
 * 职责:
 *   1. 从 Authorization header 提取 Bearer token
 *   2. 用 JwtService.verify 验证 token 签名 + 过期
 *   3. 检查 token type === 'access' (防止 refresh token 被误用)
 *   4. 检查 blacklist (token 是否被主动撤销, 改密码/登出后) — Redis
 *   5. 把 payload 注入 request.user (供 @CurrentUser() decorator 取)
 *
 * V2 改造:
 *   - blacklist 检查改为 async (Redis backend)
 *   - session.lastActiveAt 自动更新 (用于多端 UI "X 分钟前活跃")
 *
 * 区别于 auth/guards/* (项目示例的 JwtAuthGuard):
 *   - 项目示例用 passport-jwt + PassportStrategy, 完整但复杂
 *   - 我们用 JwtService 直接验证, 简化, 避免循环依赖
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly blacklist: JwtBlacklistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new BizException(BizCode.Unauthorized, '缺少 Authorization Bearer token');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new BizException(BizCode.Unauthorized, 'token 为空');
    }

    let payload: { sub: string; jti: string; type: string };
    try {
      payload = this.jwt.verify<{ sub: string; jti: string; type: string }>(token, {
        secret: this.config.get<string>('jwtSecret'),
      });
    } catch {
      throw new BizException(BizCode.TokenExpired, 'token 无效或已过期');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (payload.type !== TokenType.Access) {
      throw new BizException(BizCode.TokenInvalid, 'token 类型错误, 需要 access token');
    }

    // 检查 blacklist (Redis backend, 改密码 / 主动下线 后 token 被撤销)
    const revoked = await this.blacklist.isRevoked(payload.jti);
    if (revoked) {
      throw new BizException(BizCode.TokenRevoked, 'token 已被撤销');
    }

    (request as unknown as { user: { sub: string; jti: string; type: string } }).user = payload;
    return true;
  }
}
