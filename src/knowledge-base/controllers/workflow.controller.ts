// V2026-10-12 (Phase 8.8 — workflow panel 补建, 跟 client 7.6 WorkflowListPage 对齐):
//   7.6 client 用 3 个 endpoint 拉 list (my-drafts / pending-review / published),
//   8.1 vertical slice 当时漏建 (focus 在 knowledge-base CRUD), 大炮 16:50 反馈
//   /admin/workflow/* 3 个 404. 治本: 复用 knowledge.service.list 走 status filter,
//   3 endpoint 走同 ListKnowledgeQueryDto 分页/排序 (跟 list 共享).
//
//   V0.x 路由规范 (跟 client 7.6 WorkflowListPage 严格对齐):
//     GET /admin/workflow/my-drafts         - 当前用户作为 author 的 draft (3 tab "我的草稿")
//     GET /admin/workflow/pending-review     - 全部 status=review (3 tab "待我审核", reviewer 视角看全部)
//     GET /admin/workflow/published         - 全部 status=published (3 tab "已发布")
//
//   治本:
//     - 不另建 WorkflowService (跟 knowledge.service 紧耦合, 复用 list 节省 ~200 行)
//     - 不在 controller 内联 DTO (用 ListKnowledgeQueryDto, 跟 /admin/knowledge-items
//       list 共享, 1:1 字段对齐)
//     - 鉴权 @UseGuards(JwtAuthGuard) 跟 knowledge.controller 风格一致.

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth';
import { TenantId } from '../../common';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { ListKnowledgeQueryDto, ListKnowledgeResponseDto } from '../dto/knowledge.dto';
import { KnowledgeService } from '../providers/knowledge.service';

@ApiTags('Admin · Knowledge · Workflow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/workflow')
export class WorkflowController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /**
   * 我的草稿 — 当前用户作为 author 的 draft KB.
   * 跟 client 7.6 WorkflowListPage "我的草稿" tab 字段对齐.
   */
  @Get('my-drafts')
  @ApiOperation({ summary: '我的草稿 (3 tab "我的草稿", author=currentUser + status=draft)' })
  myDrafts(
    @TenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Query() query: ListKnowledgeQueryDto,
  ): Promise<ListKnowledgeResponseDto> {
    return this.knowledge.list(tenantId, {
      ...query,
      status: 'draft',
      authorId: userId,
    });
  }

  /**
   * 待我审核 — 全部 status=review (reviewer 视角看全部 pending item).
   * 跟 client 7.6 WorkflowListPage "待我审核" tab 字段对齐.
   * V0.x 简化: 返全部 review 状态, V1.x 加 reviewerId=currentUser 过滤 (本人审核的).
   */
  @Get('pending-review')
  @ApiOperation({ summary: '待我审核 (3 tab "待我审核", status=review 全部)' })
  pendingReview(@TenantId() tenantId: string, @Query() query: ListKnowledgeQueryDto): Promise<ListKnowledgeResponseDto> {
    return this.knowledge.list(tenantId, {
      ...query,
      status: 'review',
    });
  }

  /**
   * 已发布 — 全部 status=published (3 tab "已发布", RAG 召回源).
   * 跟 client 7.6 WorkflowListPage "已发布" tab 字段对齐.
   */
  @Get('published')
  @ApiOperation({ summary: '已发布 (3 tab "已发布", status=published 全部)' })
  published(@TenantId() tenantId: string, @Query() query: ListKnowledgeQueryDto): Promise<ListKnowledgeResponseDto> {
    return this.knowledge.list(tenantId, {
      ...query,
      status: 'published',
    });
  }
}
