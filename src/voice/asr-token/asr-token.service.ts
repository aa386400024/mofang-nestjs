// V2026-10-08 治本 (ASR 短期 token 服务 — SPEC §9.2):
//   目的: 给客户端签发短期 JWT (5min TTL), 用于直连 MiniMax ASR WebSocket.
//   凭证隔离: 客户端永远不接触 MINIMAX_API_KEY, 只拿短期 token.
//
//   实现要点:
//   - 用 NestJS 自带 JwtService, 复用现有 secret 管理
//   - 5min TTL, 客户端 30s 提前 refresh (AsrTokenInfo.isExpiringSoon)
//   - 返回 MiniMax ASR WebSocket URL + token, 客户端不再拼
//
//   反双胞胎:
//     - 不用单独的 crypto 库签 JWT — 项目已用 @nestjs/jwt
//     - 不缓存 token — 每次新开 ASR 会话都拿新 token, 避免过期
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. curl /voice/asr-token 返 { url, token, expiresAt }
//     3. 集成测试: 用 token 直连 MiniMax ASR, 说话 → 收 partial/final

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export interface AsrTokenInfo {
  readonly url: string;
  readonly token: string;
  readonly expiresAt: number;
}

interface AsrJwtPayload {
  sub: string;
  tenantId: string;
  scope: 'asr:stream';
  iat: number;
  exp: number;
}

@Injectable()
export class AsrTokenService {
  private readonly logger = new Logger(AsrTokenService.name);
  private readonly asrTokenSecret: string;
  private readonly ttlSec: number;
  private readonly asrWsUrl: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    // 反双胞胎: 不允许默认空, 强制 env 注入 (治本).
    const secret = config.get<string>('minimax.asrTokenSecret');
    if (!secret) {
      throw new Error('AsrTokenService: missing env MINIMAX_ASR_TOKEN_SECRET');
    }
    this.asrTokenSecret = secret;
    this.ttlSec = config.get<number>('minimax.asrTokenTtlSec') ?? 300;
    const baseUrl = config.getOrThrow<string>('minimax.baseUrl');
    this.asrWsUrl = baseUrl.replace(/^http/, 'ws') + '/v1/asr/stream';
  }

  /** 签发短期 ASR token. */
  async issueToken(userId: string, tenantId: string): Promise<AsrTokenInfo> {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload: AsrJwtPayload = {
      sub: userId,
      tenantId,
      scope: 'asr:stream',
      iat: nowSec,
      exp: nowSec + this.ttlSec,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.asrTokenSecret,
      expiresIn: this.ttlSec,
    });
    const expiresAt = (nowSec + this.ttlSec) * 1000;
    this.logger.log(`[issueToken] user=${userId} tenant=${tenantId} ttl=${this.ttlSec}s`);
    return {
      url: this.asrWsUrl,
      token,
      expiresAt,
    };
  }
}
