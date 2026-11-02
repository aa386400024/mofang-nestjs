// V2026-09-04 治本 (V6.0 §3.5):
//   LLM Chat DTO — 流式 + 单轮 + 历史 + 工具调用统一边界.
//   关键: tier 字段驱动路由 (basic / rag / advanced).
//   反双胞胎: 不暴露 provider id / model 字段给客户端 (走默认路由),
//             admin 后台才用.

import { ApiProperty } from '@nestjs/swagger';

import { LLMTier } from '../../llm/common/enums/llm.enums';

/**
 * 单条消息 — OpenAI messages schema 兼容.
 */
export class ChatMessageDto {
  @ApiProperty({ enum: ['system', 'user', 'assistant', 'tool'] })
  role!: 'system' | 'user' | 'assistant' | 'tool';

  @ApiProperty({ description: '文本内容 (vision 可走多模态 array)' })
  content!: string;

  @ApiProperty({ description: '工具调用 id (role=tool 时必填)', required: false, nullable: true })
  toolCallId?: string;

  @ApiProperty({ description: '姓名 (多角色对话)', required: false, nullable: true })
  name?: string;
}

/**
 * Chat 完成请求 DTO — POST /v1/chat/completions 兼容.
 */
export class ChatCompletionDto {
  @ApiProperty({ enum: LLMTier, description: '§3.5 三层架构 tier' })
  tier!: LLMTier;

  @ApiProperty({ type: [ChatMessageDto] })
  messages!: ChatMessageDto[];

  @ApiProperty({ description: '是否流式 (SSE)', default: true })
  stream!: boolean;

  @ApiProperty({ description: 'RAG 知识库检索开关 (默认 true for tier=rag)', default: true })
  useRag!: boolean;

  @ApiProperty({
    description: '端侧危机预检结果 (high 时服务端强制插入安全 system prompt)',
    required: false,
    nullable: true,
    enum: ['none', 'low', 'medium', 'high'],
  })
  preCheckedCrisisLevel?: 'none' | 'low' | 'medium' | 'high';

  @ApiProperty({ description: '温度 0..2', required: false, minimum: 0, maximum: 2 })
  temperature?: number;

  @ApiProperty({ description: '最大 token', required: false, minimum: 1, maximum: 32_000 })
  maxTokens?: number;

  @ApiProperty({ description: '客户端会话 id (用于 token 累计 + crisis 关联)', required: false, nullable: true })
  conversationId?: string;
}

/**
 * Chat 增量 chunk — 流式响应每条.
 */
export class ChatCompletionChunkDto {
  @ApiProperty({ description: '增量文本' })
  delta!: string;

  @ApiProperty({ description: '累计 token 数' })
  tokenCount!: number;

  @ApiProperty({ description: '是否最终 chunk' })
  isFinal!: boolean;

  @ApiProperty({ description: '终止原因', required: false, nullable: true, enum: ['stop', 'length', 'content_filter', 'tool_calls'] })
  finishReason?: string | null;

  @ApiProperty({ description: '服务端会话 id (首次 chunk 时返回, 客户端持久化用于审计)', required: false, nullable: true })
  conversationId?: string | null;

  @ApiProperty({
    description: '危机信号 (LLM 二级分类)',
    required: false,
    nullable: true,
    additionalProperties: true,
  })
  crisisSignal?: {
    level: 'none' | 'low' | 'medium' | 'high';
    keywords: string[];
    suggestedResource?: string;
  } | null;
}
