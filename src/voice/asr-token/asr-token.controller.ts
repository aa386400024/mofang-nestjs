// V2026-10-08 治本 (ASR token HTTP 端点 — SPEC §9.2):
//   路径: GET /voice/asr-token
//   鉴权: 复用 JwtAuthGuard, 客户端用 user JWT 调
//   返回: { url, token, expiresAt }
//
//   反双胞胎:
//     - 不用 GraphQL — REST 简单够用
//     - 不暴露完整 ASR 协议参数 — 客户端只拿短期 token, 协议细节服务端封装
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. curl -H "Authorization: Bearer ***" /voice/asr-token 返 JSON
//     3. 拿 token 直连 MiniMax ASR 测通

import { Controller, Get, UseGuards } from '@nestjs/common';

import { AsrTokenService, type AsrTokenInfo } from './asr-token.service';
import { JwtAuthGuard } from '../../auth/guards';
import { TenantId, UserId } from '../../common/decorators';

@Controller('voice/asr-token')
@UseGuards(JwtAuthGuard)
export class AsrTokenController {
  constructor(private readonly service: AsrTokenService) {}

  /**
   * GET /voice/asr-token
   * Response: { url: string, token: string, expiresAt: number }
   */
  @Get()
  issue(@TenantId() tenantId: string, @UserId() userId: string): Promise<AsrTokenInfo> {
    return this.service.issueToken(userId, tenantId);
  }
}
