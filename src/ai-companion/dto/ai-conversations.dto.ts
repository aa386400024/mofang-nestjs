import { ApiProperty } from '@nestjs/swagger';

import type { AiCompanionMode } from '../../shared/types/practice.types';

/**
 * AI 对话列表 DTO — V2.0 §Tab4 AI 对话记录页.
 *
 * 4 段日期分组 (今天 / 昨天 / 本周 / 更早) 由前端基于 createdAt 计算,
 * 后端只负责按时间倒序返回.
 */
export class AiConversationDto {
  @ApiProperty({ description: '会话 id', example: 'uuid-v4' })
  id!: string;

  @ApiProperty({ description: '时间戳 (用于分组)', example: '2026-08-28T21:12:00Z' })
  timestamp!: string;

  @ApiProperty({ description: '开题情绪 emoji', example: '🌧️' })
  emoji!: string;

  @ApiProperty({ description: '对话摘要标题', example: '开会前突然很焦虑' })
  title!: string;

  @ApiProperty({ description: '对话摘要详情', example: '聊了"被当众提问"的恐惧, AI 帮我识别出「灾难化」思维...' })
  summary!: string;

  @ApiProperty({ description: '对话轮数', example: 8 })
  rounds!: number;

  @ApiProperty({ description: '陪伴模式', enum: ['normal', 'inner_voice_coach'] })
  mode!: AiCompanionMode;
}

/**
 * 列表响应 — 直接数组, 由前端按 createdAt 分组.
 */
export class AiConversationsResponseDto {
  @ApiProperty({ type: [AiConversationDto] })
  items!: AiConversationDto[];
}
