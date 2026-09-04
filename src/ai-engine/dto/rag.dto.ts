// V2026-09-04 治本 (V6.0 §3.5 + §12 RAG):
//   RAG 知识库 DTO — 摄取 + 检索 + 完整 chat-with-rag.
//   反双胞胎: 不写 chat DTO (那是 llm-chat.dto.ts).

import { ApiProperty } from '@nestjs/swagger';

/**
 * 摄取请求 DTO — admin 后台上传心理学文章 / 练习方案.
 */
export class IngestArticleDto {
  @ApiProperty({ description: '文章 id (UUID)', example: 'uuid-v4' })
  id!: string;

  @ApiProperty({ description: 'collection 名', example: 'psychology_articles' })
  collection!: string;

  @ApiProperty({ description: '文章标题', example: '焦虑的认知行为模型' })
  title!: string;

  @ApiProperty({ description: '文章摘要 (用于检索结果展示)', example: 'CBT 三栏表 + 行为激活' })
  summary!: string;

  @ApiProperty({ description: '文章正文' })
  content!: string;

  @ApiProperty({ description: '标签数组 (用于过滤)', example: ['anxiety', 'cbt'], required: false })
  tags?: string[];
}

/**
 * 摄取响应.
 */
export class IngestResponseDto {
  @ApiProperty({ description: '文章 id' })
  id!: string;

  @ApiProperty({ description: 'collection 名' })
  collection!: string;

  @ApiProperty({ description: '向量维度' })
  dimension!: number;

  @ApiProperty({ description: '入库时间戳 (ms)' })
  ingestedAtMs!: number;
}

/**
 * 检索请求 DTO — 给 admin 后台调试用.
 */
export class SearchRequestDto {
  @ApiProperty({ description: '查询文本', example: '什么是焦虑?' })
  query!: string;

  @ApiProperty({ description: 'collection 名', default: 'psychology_articles' })
  collection!: string;

  @ApiProperty({ description: '返回前 K 条', default: 5, minimum: 1, maximum: 20 })
  topK!: number;

  @ApiProperty({ description: '分数阈值 (低于此分数过滤)', default: 0.7, minimum: 0, maximum: 1 })
  scoreThreshold!: number;
}

/**
 * 检索结果条目.
 */
export class SearchHitDto {
  @ApiProperty() id!: string;
  @ApiProperty() score!: number;
  @ApiProperty({ additionalProperties: true })
  payload!: Record<string, unknown>;
}

/**
 * 检索响应.
 */
export class SearchResponseDto {
  @ApiProperty({ type: [SearchHitDto] })
  hits!: SearchHitDto[];

  @ApiProperty({ description: '返回条数' })
  count!: number;
}
