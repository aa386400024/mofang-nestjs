// V2026-09-04 治本 (V6.0 §3.5 + §11.2):
//   LLM Chat controller — 流式 SSE + 单轮 + 历史.
//   端点:
//     POST  /v1/chat/completions          - OpenAI 兼容, SSE 流式
//     POST  /v1/chat/once                 - 非流式 (admin / 批量)
//     GET   /v1/chat/conversations        - 历史列表
//     GET   /v1/chat/conversations/:id    - 单条

import { Body, Controller, Get, HttpCode, HttpStatus, MessageEvent, Param, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable, from } from 'rxjs';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { ChatCompletionChunkDto, ChatCompletionDto } from '../dto/llm-chat.dto';
import { LlmOrchestratorService } from '../providers/llm-orchestrator.service';

@ApiTags('llm-chat')
@Controller('v1/chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LlmChatController {
  constructor(private readonly orchestrator: LlmOrchestratorService) {}

  /**
   * SSE 流式 chat — OpenAI 兼容协议超集.
   *
   * V2026-09-04 治本: 用 @Sse() decorator + Observable<MessageEvent>
   * 而不是手写 SSE 帧. NestJS 自动处理 Content-Type / chunked encoding.
   */
  @Sse('completions')
  @ApiOperation({ summary: '流式 chat — OpenAI 兼容 SSE 协议' })
  public completions(@CurrentUser('userId') uid: string, @Body() dto: ChatCompletionDto): Observable<MessageEvent> {
    return from(this.toMessageEvents(this.orchestrator.streamChat(uid, dto)));
  }

  /**
   * AsyncIterable → Observable<MessageEvent>.
   *
   * 反双胞胎: 不手写 data: {...}\n\n 帧编码 — NestJS MessageEvent 自动包装.
   */
  private async *toMessageEvents(iterable: AsyncIterable<ChatCompletionChunkDto>): AsyncIterable<MessageEvent> {
    for await (const chunk of iterable) {
      yield { data: chunk };
    }
  }

  /**
   * 单轮 chat — admin 后台测试 / 批量评估.
   */
  @Post('once')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '非流式 chat — admin 测试 / 批量评估' })
  public async once(@CurrentUser('userId') uid: string, @Body() dto: ChatCompletionDto): Promise<ChatCompletionChunkDto> {
    return this.orchestrator.chatOnce(uid, { ...dto, stream: false });
  }

  /**
   * 会话历史.
   */
  @Get('conversations')
  @ApiOperation({ summary: '会话历史列表' })
  public async listConversations(
    @CurrentUser('userId') uid: string,
    @Query('limit') limit?: string,
  ): Promise<
    {
      id: string;
      tier: string;
      providerId: string | null;
      model: string | null;
      title: string | null;
      promptTokens: number;
      completionTokens: number;
      crisisEventId: string | null;
      startedAt: Date;
      endedAt: Date | null;
    }[]
  > {
    const rows = await this.orchestrator.listConversations(uid, limit ? Number(limit) : 50);
    return rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      providerId: r.providerId,
      model: r.model,
      title: r.title,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      crisisEventId: r.crisisEventId,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    }));
  }

  /**
   * 单条会话.
   */
  @Get('conversations/:id')
  @ApiOperation({ summary: '单条会话详情' })
  public async getConversation(
    @CurrentUser('userId') uid: string,
    @Param('id') id: string,
  ): Promise<{
    id: string;
    tier: string;
    providerId: string | null;
    model: string | null;
    title: string | null;
    promptTokens: number;
    completionTokens: number;
    crisisEventId: string | null;
    startedAt: Date;
    endedAt: Date | null;
  }> {
    const r = await this.orchestrator.getConversation(uid, id);
    return {
      id: r.id,
      tier: r.tier,
      providerId: r.providerId,
      model: r.model,
      title: r.title,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      crisisEventId: r.crisisEventId,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    };
  }
}
