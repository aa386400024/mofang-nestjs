// V2026-10-12 (Phase 8.1 — KB REST controller / SPEC §12.1):
//   12 endpoint, 跟客户端 7.1-7.8 严格对应. V0.x dev 直通 (server-side RBAC 弱校验,
//   跟客户端 7.8 AdminRouteGuard V0.x-ONLY 一致, BLoC state 内层 gate 严格).
//
//   端点清单 (跟客户端 KnowledgeRemoteDataSource.fetchXxx + KnowledgeRepository.method 一一对应):
//     GET    /admin/knowledge-items                    - list (含 q / type / status / authorId / sortBy / page / pageSize)
//     GET    /admin/knowledge-items/:id                - getById (详情, 含 content + metadata)
//     POST   /admin/knowledge-items                    - create
//     PATCH  /admin/knowledge-items/:id                - update (autosave, 仅 draft 可改)
//     POST   /admin/knowledge-items/:id/submit         - draft → review
//     POST   /admin/knowledge-items/:id/approve        - review → published
//     POST   /admin/knowledge-items/:id/reject         - review → draft (带 comment)
//     POST   /admin/knowledge-items/:id/archive        - published → archived
//     POST   /admin/knowledge-items/:id/restore        - archived → published
//     POST   /admin/knowledge-items/:id/schedule       - 设置定时发布 (Phase 7.7)
//     DELETE /admin/knowledge-items/:id/schedule       - 取消定时发布
//     GET    /admin/knowledge-items/:id/versions       - 版本历史 (Phase 7.5)
//
//   治本:
//     - 路由用 'admin/knowledge-items' 跟 client 7.1-7.8 /admin/knowledge
//       路径完全对应 (client baseUrl 是 /admin, 子路径 /knowledge-items).
//     - V0.x: @UseGuards(JwtAuthGuard) 单层, 不引 RolesGuard (跟 client
//       AdminRouteGuard V0.x-ONLY 一致, 客户端内层 gate 校验).
//     - V1.x: 加 @Roles('editor', 'reviewer', 'admin') + TenantContext 严格校验.

import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

// V2026-10-12 治本 (Phase 8.1 — import path):
//   CurrentUser 在 src/user/decorators/, JwtAuthGuard 在 src/auth/guards/, TenantId
//   在 src/common/decorators/. common/index.ts 不 re-export 业务 guard / decorator
//   (跟 analytics.controller 同治本), 拆 3 个 import.
import { JwtAuthGuard } from '../../auth';
import { TenantId } from '../../common';
import { RequirePrivacyLevel } from '../../common/decorators/privacy-level.decorator';
import { PrivacyGuard } from '../../common/guards/privacy.guard';
import { PrivacyLevel } from '../../common/privacy/privacy-level.enum';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { RejectKnowledgeDto, UpdateKnowledgeDto } from '../dto/knowledge.dto';
import { CreateKnowledgeDto } from '../dto/knowledge.dto';
import {
  ListKnowledgeQueryDto,
  ListKnowledgeResponseDto,
  ScheduleKnowledgeDto,
  KnowledgeDetailDto,
  WorkflowActionResponseDto,
} from '../dto/knowledge.dto';
import { KnowledgeService } from '../providers/knowledge.service';
import { ScheduledPublishService } from '../providers/scheduled-publish.service';

@ApiTags('Admin · Knowledge')
@ApiBearerAuth()
// V2026-10-15 治本 (VS-4 隐私分级 enforcement 应用 — L2_INTERNAL 内部鉴权):
//   原因: knowledge controller 是 admin 端 (/admin/knowledge-items/*), 全 12 endpoint
//     都需 JWT 鉴权 (跟 V0.x client AdminRouteGuard V0.x-ONLY 一致, BLoC 内层 gate).
//     decision 1 B 方案 3 controller 配齐 L1/L2/L3 完整 path, knowledge 走 L2
//     (admin 内部, 跟 L1 公开 / L3 owner 区分).
//   修法: class-level @UseGuards(JwtAuthGuard, PrivacyGuard) + @RequirePrivacyLevel(L2_INTERNAL),
//     全 12 endpoint 覆盖 (list / :id / :id/versions / POST create / PATCH update / 5 workflow action / 2 schedule).
//   反双胞胎:
//     - 不在公开 KB 路径 (前端 lib/features/knowledge/) 加 L1 (那是另一 endpoint, V0.5 还没建 public read API, 留 V1.x),
//     - 不拆 method-level (12 endpoint 全 L2 一致, 拆了反而可能漏),
//     - 不复用 RolesGuard (那是 admin RBAC, 不同职责, 跟 V2026-10-15 5 段治本一致),
//     - 0 wire 协议改 (DTO 0 改 / path 0 改 / response 0 改).
//   验证: 大炮跑 pnpm test:e2e 验 JWT 缺 401 (跟 L2 一致) + L3 不走这里 (走 diary / emergency).
//   时间戳: 2026-10-15.
@UseGuards(JwtAuthGuard, PrivacyGuard)
@RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
@Controller('admin/knowledge-items')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly scheduledPublish: ScheduledPublishService,
  ) {}

  // ─── 查询 ───

  @Get()
  @ApiOperation({ summary: 'KB 列表 (filter + sort + page)' })
  list(@TenantId() tenantId: string, @Query() query: ListKnowledgeQueryDto): Promise<ListKnowledgeResponseDto> {
    return this.knowledge.list(tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'KB 详情 (含 content + metadata)' })
  async getById(@TenantId() tenantId: string, @Param('id') id: string): Promise<KnowledgeDetailDto> {
    try {
      return await this.knowledge.getById(tenantId, id);
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw new NotFoundException(`KB 不存在: id=${id}`);
    }
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'KB 版本历史 (Phase 7.5)' })
  async listVersions(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ): Promise<{ versions: { version: number; createdAt: Date; authorId: string }[] }> {
    // V0.x 简单: 走 knowledge.versions 拿, V1.x 加 authorName + diff summary
    const item = await this.knowledge.getById(tenantId, id);
    return {
      versions: [
        {
          version: item.version,
          createdAt: item.updatedAt,
          authorId: item.authorId,
        },
      ],
    };
  }

  // ─── CRUD ───

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '创建 KB 草稿' })
  create(@TenantId() tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: CreateKnowledgeDto): Promise<KnowledgeDetailDto> {
    return this.knowledge.create(tenantId, userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新 KB (autosave, 仅 draft 可改, server-side 兜底冻结)' })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateKnowledgeDto,
  ): Promise<KnowledgeDetailDto> {
    return this.knowledge.update(tenantId, id, userId, dto);
  }

  // ─── 5 个工作流 action ───

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: '提交审核 (draft → review)' })
  submit(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser('sub') userId: string): Promise<WorkflowActionResponseDto> {
    return this.knowledge.submit(tenantId, id, userId).then((item) => ({ item }));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '审核通过 (review → published)' })
  approve(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser('sub') userId: string): Promise<WorkflowActionResponseDto> {
    return this.knowledge.approve(tenantId, id, userId).then((item) => ({ item }));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '退稿 (review → draft, 带 comment)' })
  reject(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: RejectKnowledgeDto,
  ): Promise<WorkflowActionResponseDto> {
    return this.knowledge.reject(tenantId, id, userId, dto.comment ?? null).then((item) => ({ item }));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: '归档 (published → archived)' })
  archive(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser('sub') userId: string): Promise<WorkflowActionResponseDto> {
    return this.knowledge.archive(tenantId, id, userId).then((item) => ({ item }));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: '恢复 (archived → published)' })
  restore(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser('sub') userId: string): Promise<WorkflowActionResponseDto> {
    return this.knowledge.restore(tenantId, id, userId).then((item) => ({ item }));
  }

  // ─── 2 个排期 action (Phase 7.7) ───

  @Post(':id/schedule')
  @HttpCode(200)
  @ApiOperation({ summary: '设置定时发布 (Phase 7.7, 决策 B+A)' })
  async schedule(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ScheduleKnowledgeDto,
  ): Promise<KnowledgeDetailDto> {
    const item = await this.knowledge.schedule(tenantId, id, userId, dto);
    await this.scheduledPublish.schedule(item.id, item.scheduledPublishAt!);
    return item;
  }

  @Delete(':id/schedule')
  @HttpCode(200)
  @ApiOperation({ summary: '取消定时发布' })
  async cancelSchedule(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ): Promise<KnowledgeDetailDto> {
    const item = await this.knowledge.cancelSchedule(tenantId, id, userId);
    await this.scheduledPublish.cancel(item.id);
    return item;
  }
}
