// V2026-10-08 治本 (LLM streaming REST 端点):
//   用途: 手动 curl 测试 / 集成测试, 不用于生产路径
//   生产路径: VoiceGateway / Visitor Agent / Supervisor Agent 直接调
//             LlmService.streamChat(), 不走 HTTP
//   鉴权: 复用现有 JwtAuthGuard, tenantId/userId 从 req.user 取
//   SSE 响应: text/event-stream, 每行 `data: <json>\n\n`
//
// 反双胞胎:
//   - 不暴露在 /llm/stream 公开路径 — 加 @UseGuards(JwtAuthGuard) 强鉴权
//   - 不返回 LlmStreamChunk 完整内部类型 — 转 SSE 协议, 屏蔽内部细节

import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { LlmService } from './llm.service';
import type { LlmMessage } from './llm.types';
import { JwtAuthGuard } from '../../auth/guards';
import { TenantId, UserId } from '../../common/decorators';

interface StreamChatDto {
  readonly messages: readonly LlmMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
}

@Controller('agent/llm')
@UseGuards(JwtAuthGuard)
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  /**
   * POST /agent/llm/stream
   * Body: { messages: [...], temperature?, maxTokens?, topP? }
   * Response: text/event-stream
   *   - `data: {"type":"content","content":"..."}\n\n`
   *   - `data: {"type":"done","usage":{...}}\n\n`
   *   - `data: {"type":"error","error":{...}}\n\n`
   */
  @Post('stream')
  async stream(@Body() dto: StreamChatDto, @TenantId() tenantId: string, @UserId() userId: string, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stream = this.llm.streamChat(dto.messages, {
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      topP: dto.topP,
      tenantId,
      userId,
    });

    try {
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } finally {
      res.end();
    }
  }
}
