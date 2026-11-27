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

import { CurrentUser } from '../../user/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard.js';
import { ChatHistoryQueryDto } from '../dto/llm-chat.dto.js';
import type { ChatCompletionChunkDto, ChatCompletionDto, ChatConversationSummaryDto } from '../dto/llm-chat.dto.js';
import { LlmOrchestratorService } from '../providers/llm-orchestrator.service.js';

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
   * 会话历史 — 仅返回用户可见的会话元数据.
   *
   * 不暴露 token 计数、provider / model 与 crisis_event_id：这些是内部计费与
   * 安全审计字段，前端历史页不需要，也不应通过普通用户接口泄露.
   */
  @Get('conversations')
  @ApiOperation({ summary: '会话历史列表' })
  public async listConversations(
    @CurrentUser('userId') uid: string,
    @Query() query: ChatHistoryQueryDto,
  ): Promise<ChatConversationSummaryDto[]> {
    const rows = await this.orchestrator.listConversations(uid, query.limit ?? 50);
    return rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      title: r.title,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    }));
  }

  /**
   * 单条会话 — 返回同一套用户可见投影.
   */
  @Get('conversations/:id')
  @ApiOperation({ summary: '单条会话详情' })
  public async getConversation(@CurrentUser('userId') uid: string, @Param('id') id: string): Promise<ChatConversationSummaryDto> {
    const r = await this.orchestrator.getConversation(uid, id);
    return {
      id: r.id,
      tier: r.tier,
      title: r.title,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    };
  }
}
