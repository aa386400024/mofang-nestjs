// V2026-10-12 (Phase 8.1 — KB DTO / SPEC §12.1):
//   8 DTO 一次打包, 跟客户端 7.1-7.8 KnowledgeItem / KnowledgeContent / KnowledgeMetadata
//   字段严格对齐. 大厂 spec (跟 ai-effect.dto.ts pattern):
//     - class-validator + @ApiProperty swagger 装饰器
//     - readonly 字段 (跟 7.x client 不可变 entity 对齐)
//     - enums (sortBy) 跟前端 KnowledgeSortBy 严格 wire

import { ApiProperty } from '@nestjs/swagger';

import { KnowledgeStatus } from '../enums/knowledge-status.enum';
import { KnowledgeType } from '../enums/knowledge-type.enum';

/**
 * 排序字段 — 跟客户端 7.2 KnowledgeSortBy 严格 wire 字符串.
 */
export enum KnowledgeSortBy {
  UpdatedAt = 'updatedAt',
  CreatedAt = 'createdAt',
  Title = 'title',
  Version = 'version',
}

/**
 * 列表查询条件 — 跟客户端 7.2 KnowledgeFilter 严格对应.
 */
export class ListKnowledgeQueryDto {
  @ApiProperty({ description: '按类型过滤 (逗号分隔)', required: false, example: 'case,standard' })
  type?: string;

  @ApiProperty({ description: '按状态过滤 (逗号分隔)', required: false, example: 'draft,review' })
  status?: string;

  @ApiProperty({ description: '按 authorId 过滤 (editor 自动注入自己, reviewer/admin 留空)', required: false })
  authorId?: string;

  @ApiProperty({ description: '关键词搜索 (走 BM25 全文索引, V0.x 简单 LIKE)', required: false })
  q?: string;

  @ApiProperty({
    description: '排序字段',
    enum: KnowledgeSortBy,
    default: KnowledgeSortBy.UpdatedAt,
    required: false,
  })
  sortBy?: KnowledgeSortBy = KnowledgeSortBy.UpdatedAt;

  @ApiProperty({ description: '是否降序', default: true, required: false })
  sortDesc?: boolean = true;

  @ApiProperty({ description: '页码 (从 1 起)', default: 1, required: false })
  page?: number = 1;

  @ApiProperty({ description: '每页条数', default: 20, required: false })
  pageSize?: number = 20;
}

/**
 * 单条 KB 列表项 (列表用, 不含 content 完整 body, 跟客户端 7.2 knowledge-page 字段对齐).
 */
export class KnowledgeItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'V0.x 默认 = uid; V1.x = 真实租户' }) tenantId!: string;
  @ApiProperty({ enum: KnowledgeType }) type!: KnowledgeType;
  @ApiProperty() title!: string;
  @ApiProperty({ description: '内容预览 (前 ~200 字, server-side 截取)' }) contentPreview!: string;
  @ApiProperty({ description: '元数据 tags 字段 (跟 KnowledgeMetadata.tags 一致)' }) tags!: string[];
  @ApiProperty({ description: '元数据 difficulty 字段 (1/2/3)' }) difficulty!: number | null;
  @ApiProperty({ enum: KnowledgeStatus }) status!: KnowledgeStatus;
  @ApiProperty() version!: number;
  @ApiProperty() authorId!: string;
  @ApiProperty({ description: 'server join users.email 拿, V0.x 简化' }) authorName!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ required: false, nullable: true }) reviewerId?: string | null;
  @ApiProperty({ required: false, nullable: true }) reviewerName?: string | null;
  @ApiProperty({ required: false, nullable: true }) publishedAt?: Date | null;
  @ApiProperty({ required: false, nullable: true, description: 'Phase 7.7 排期发布时间' })
  scheduledPublishAt?: Date | null;
}

/**
 * 列表响应 — 跟客户端 7.2 KnowledgePage 严格对应.
 */
export class ListKnowledgeResponseDto {
  @ApiProperty({ type: [KnowledgeItemDto] }) items!: KnowledgeItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() totalPages!: number;
}

/**
 * 详情 DTO (含 content 完整 body + metadata, 跟客户端 7.3 KnowledgeItem.content / metadata 严格对应).
 */
export class KnowledgeDetailDto extends KnowledgeItemDto {
  @ApiProperty({
    description: '完整内容 (跟客户端 7.3 KnowledgeContent 对齐)',
    example: { format: 'doc', body: String.raw`[{"insert":"...\n"}]`, preview: '...' },
  })
  content!: { format: 'doc'; body: string; preview: string };

  @ApiProperty({
    description: '元数据 (跟客户端 7.3 KnowledgeMetadata 对齐)',
    example: { tags: [], difficulty: 1, category: 'CBT', personaId: null, searchKeywords: [] },
  })
  metadata!: { tags: string[]; difficulty: number | null; category: string; personaId: string | null; searchKeywords: string[] };
}

/**
 * 创建草稿 — POST /admin/knowledge-items.
 */
export class CreateKnowledgeDto {
  @ApiProperty() title!: string;
  @ApiProperty({ enum: KnowledgeType }) type!: KnowledgeType;
  @ApiProperty() content!: { format: 'doc'; body: string; preview: string };
  @ApiProperty() metadata!: {
    tags: string[];
    difficulty: number | null;
    category: string;
    personaId: string | null;
    searchKeywords: string[];
  };
}

/**
 * 更新草稿 (autosave PATCH) — PATCH /admin/knowledge-items/:id.
 */
export class UpdateKnowledgeDto {
  @ApiProperty({ required: false }) title?: string;
  @ApiProperty({ required: false }) content?: { format: 'doc'; body: string; preview: string };
  @ApiProperty({ required: false }) metadata?: {
    tags: string[];
    difficulty: number | null;
    category: string;
    personaId: string | null;
    searchKeywords: string[];
  };
}

/**
 * 退稿 comment — POST /admin/knowledge-items/:id/reject.
 */
export class RejectKnowledgeDto {
  @ApiProperty({ description: '退稿原因 (可选)', required: false, nullable: true })
  comment?: string | null;
}

/**
 * 设置定时发布 — POST /admin/knowledge-items/:id/schedule.
 */
export class ScheduleKnowledgeDto {
  @ApiProperty({ description: 'ISO 8601 UTC timestamp', example: '2026-10-15T09:00:00.000Z' })
  scheduledPublishAt!: string;
}

/**
 * 工作流 action 通用响应 — 返更新后的 KnowledgeItem.
 */
export class WorkflowActionResponseDto {
  @ApiProperty({ type: KnowledgeDetailDto }) item!: KnowledgeDetailDto;
}
