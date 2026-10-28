// V2026-10-12 (Phase 8.1 — KB 主 service / SPEC §12.1):
//   CRUD + 5 工作流 action + 2 排期 action + 全文搜索, 跟客户端 7.1-7.8 严格对齐.
//
//   大厂 spec (跟 src/ai-engine/providers/ai-effect.service.ts 同 pattern):
//     - @Injectable() + @InjectRepository
//     - DTO ↔ entity 映射用 toDto() 私有方法 (单一来源)
//     - server-side join users.email 拿 authorName / reviewerName
//     - 工作流 action handler 开头调 workflow.assertTransition 防越界
//
//   V0.x dev: 跟客户端 7.8 KnowledgeEditorState 5 canXxx getter 严格对应,
//   但 server-side 不做 RBAC 校验 (由 client guard V0.x dev 直通, BLoC state 内层
//   gate, 跟 client 7.8 V0.x-ONLY 注释一致). V1.x server-side 升级 @Roles guard.

// V2026-10-12 治本 (Phase 8.1 — unused Logger import 删除):
//   上一轮 8.1 batch 2 修 _authorName hack 时同步删了 logger 字段, 但忘了删
//   @nestjs/common 里的 Logger import. TS strict-unused-vars 报 TS6133. 治本:
//   删 Logger, 后续真要 log (e.g. workflow 操作埋点) 时再加回, 配 logger 字段.
// V2026-10-15 治本 (VS-3 续 写侧 — 知识库 publish 切 chunk + embed + Qdrant upsert):
//   原因: V3.1 §1 VS-3c 治本只治了"search 走 vector path" (读侧), V0.x publish
//     时不写 Qdrant → collection 永远空 → search 0 命中 → 永远走 LIKE 软降级.
//     Phase 6 RAG 真联调缺写侧. 1 message VS-3 续 = publish 末尾 hook 写 Qdrant.
//   修法: constructor 注入 QdrantService + LlmRouterService + ConfigService,
//     doWorkflowAction Approve 末尾 async hook 调 embedOnPublish (try-catch 软降级,
//     embed/upsert 失败 log warn 不 throw, 保留 V0.x 行为 KB 仍可读 / search 走 LIKE).
//     embedOnPublish 切 chunk (LangChain RecursiveCharacterTextSplitter chunkSize=200
//     overlap=20) → 调 llmRouter.embed() 拿 vector → qdrant.upsertBatch() 写 collection
//     (单 collection + tenantId payload filter, 跟 V3.1 §1 VS-3c 一致).
//   反双胞胎:
//     - 不在 create/update/submit 写 Qdrant (浪费 API quota, 6 决策 1 A 方案"仅 publish"),
//     - 不删 LIKE 软降级 (保留 V0.x 兼容, V0.3 §17.2 W9 拍板),
//     - 不引独立 vector client (QdrantService 已注入 + 已 export),
//     - 不装新 SDK (链路 1 LangChain 1.x + Qdrant 1.x 都已就绪).
//   验证: 大炮跑 npx tsc -p tsconfig.json --noEmit 0 错 (VS-3 续范围) +
//     pnpm smoke:rag 验 6 步端到端 (创 KB → publish → 验 Qdrant 写入 → search 召回).
//   时间戳: 2026-10-15.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowAction, WorkflowService } from './workflow.service';
import { QdrantService } from '../../ai-engine/providers/qdrant.service';
import { AnalyticsEventType } from '../../analytics/entities/analytics-event.entity';
import { AnalyticsEventTrackerService } from '../../analytics/providers/analytics-event-tracker.service';
import { AIProviderId } from '../../llm/common/enums/llm.enums';
import { LlmRouterService } from '../../llm/registry/llm-router.service';
import { User } from '../../user/entities/user.entity';
import {
  CreateKnowledgeDto,
  KnowledgeDetailDto,
  KnowledgeItemDto,
  ListKnowledgeQueryDto,
  ListKnowledgeResponseDto,
  ScheduleKnowledgeDto,
  UpdateKnowledgeDto,
} from '../dto/knowledge.dto';
import { KnowledgeItem } from '../entities/knowledge-item.entity';
import { KnowledgeVersion } from '../entities/knowledge-version.entity';
import { WorkflowEvent } from '../entities/workflow-event.entity';
import { KnowledgeStatus } from '../enums/knowledge-status.enum';

@Injectable()
export class KnowledgeService {
  // V2026-10-15 治本 (VS-3 续 — Logger 字段加回, 软降级 log warn):
  //   上一轮 V2026-10-12 治本 (Phase 8.1 — unused logger 删除) 删了 logger 字段,
  //   跟其 V2026-10-12 注释"后续真要 log 时再加回"一致 — VS-3 续 embedOnPublish 软降级
  //   catch (e) log warn 加回. 走 NestJS Logger 集成 Pino (跟 app.module useLogger 配套).
  private readonly logger = new Logger(KnowledgeService.name);
  // V2026-10-12 治本 (Phase 8.1 — unused logger 删除):
  //   KnowledgeService 之前声明了 logger 但全文未用 (analytics / preview / workflow
  //   service 才有 logger), TS strict-unused-vars 报 TS6133. 治本: 删 unused 字段,
  //   后续真要 log (e.g. workflow 操作埋点) 时再加回.

  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly items: Repository<KnowledgeItem>,
    @InjectRepository(KnowledgeVersion)
    private readonly versions: Repository<KnowledgeVersion>,
    @InjectRepository(WorkflowEvent)
    private readonly events: Repository<WorkflowEvent>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly workflow: WorkflowService,
    // V2026-10-12 (Phase 8.3): 5 workflow action + 2 schedule action 调
    // record() 写 analytics_events. AnalyticsEventTrackerService 静默失败,
    // 不阻塞主流程.
    private readonly analytics: AnalyticsEventTrackerService,
    // V2026-10-15 治本 (VS-3 续 写侧 — publish 末尾切 chunk + embed + Qdrant upsert):
    //   3 注入: QdrantService (写 collection, AIEngineModule export) + LlmRouterService
    //   (OpenAI 兼容 4 provider embedding, LlmModule export) + ConfigService (RAG_AUTO_EMBED
    //   / RAG_CHUNK_SIZE / RAG_CHUNK_OVERLAP / LLM_DEFAULT_EMBEDDING_PROVIDER env 读).
    //   3 个 module (LlmModule / AgentLlmModule / AIEngineModule) 已在 knowledge-base.module.ts
    //   imports 注册, 0 NestJS DI 缺依赖风险.
    private readonly qdrant: QdrantService,
    private readonly llmRouter: LlmRouterService,
    private readonly config: ConfigService,
  ) {}

  // ========================================================================
  // 查询
  // ========================================================================

  /**
   * 列表 — 跟客户端 7.2 KnowledgeListBloc 严格对应.
   * authorId filter: editor 自动注入自己 (server-side 不感知, client 7.8 KnowledgeListBloc 注入),
   * reviewer / admin 不传 (看全部).
   */
  async list(tenantId: string, query: ListKnowledgeQueryDto): Promise<ListKnowledgeResponseDto> {
    const qb = this.items.createQueryBuilder('i').where('i.tenantId = :tenantId', { tenantId });

    if (query.type) {
      const types = query.type
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (types.length > 0) {
        qb.andWhere('i.type IN (:...types)', { types });
      }
    }
    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length > 0) {
        qb.andWhere('i.status IN (:...statuses)', { statuses });
      }
    }
    if (query.authorId) {
      qb.andWhere('i.authorId = :authorId', { authorId: query.authorId });
    }
    if (query.q) {
      // V0.x 简单 LIKE (knowledge_versions 有 snapshot, knowledge_items 有 title,
      // 都用 LIKE %q%). V1.x 切 BM25 / Qdrant.
      qb.andWhere('(i.title LIKE :q OR JSON_EXTRACT(i.content, "$.body") LIKE :q)', {
        q: `%${query.q}%`,
      });
    }

    const sortField = query.sortBy ?? 'updatedAt';
    const sortDir = query.sortDesc === false ? 'ASC' : 'DESC';
    qb.orderBy(`i.${sortField}`, sortDir);

    // V2026-10-12 治本 (Phase 8.8 — query type NaN 防御):
    //   NestJS @Query() DTO 走 ValidationPipe(transform: true), 但 transform 只对
    //   带 @Type() 装饰器字段生效, ListKnowledgeQueryDto 没 @Type(() => Number) 标
    //   page/pageSize, 实际 query string 拿到的还是 string. `take(string)` TypeORM
    //   抛错 → 500. 治本: 显式 Number() 转换 + 边界保护 (NaN / 负数 / 超过 100 cap),
    //   跟 src/ai-engine providers 防御 pattern 对齐.
    const rawPage = Number(query.page ?? 1);
    const rawPageSize = Number(query.pageSize ?? 20);
    const safePage = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const safePageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(Math.floor(rawPageSize), 100) : 20;
    qb.skip((safePage - 1) * safePageSize).take(safePageSize);

    const [rows, total] = await qb.getManyAndCount();
    // V2026-10-12 治本 (N+1 fix): 用 Map<authorId, name> 一次性 batch 拿, 替代
    //   原 _authorName 字段 hack (会触发 TypeScript 编译错: 类型上没有该字段).
    //   治本后 list 走单条 IN query + 内存映射, 复杂度 O(N) 不变, 跟 src/ai-engine
    //   providers/ai-effect.service.ts 的 getHistory 同 pattern.
    const authorMap = await this.batchGetAuthorNames(rows.map((r) => r.authorId));
    const items = rows.map((row) => this.toItemDto(row, authorMap.get(row.authorId) ?? 'Unknown'));

    return {
      items,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize),
    };
  }

  /**
   * 详情 — 跟客户端 7.3 KnowledgeItem.content + metadata 严格对应.
   */
  async getById(tenantId: string, id: string): Promise<KnowledgeDetailDto> {
    const item = await this.items.findOne({ where: { id, tenantId } });
    if (!item) {
      throw new NotFoundException(`KB 不存在: id=${id}`);
    }
    const [authorName, reviewerName] = await Promise.all([
      this.getUserDisplayName(item.authorId),
      item.reviewerId ? this.getUserDisplayName(item.reviewerId) : Promise.resolve(null),
    ]);
    return this.toDetailDto(item, authorName, reviewerName);
  }

  // ========================================================================
  // CRUD
  // ========================================================================

  /**
   * 创建草稿 — POST /admin/knowledge-items.
   * V0.x dev: status=default('draft'), authorId=currentUser, tenantId=uid.
   */
  async create(tenantId: string, authorId: string, dto: CreateKnowledgeDto): Promise<KnowledgeDetailDto> {
    const item = this.items.create({
      tenantId,
      type: dto.type,
      title: dto.title,
      content: dto.content,
      metadata: dto.metadata,
      status: KnowledgeStatus.Draft,
      version: 1,
      authorId,
      reviewerId: null,
      publishedAt: null,
      scheduledPublishAt: null,
    });
    const saved = await this.items.save(item);
    return this.getById(tenantId, saved.id);
  }

  /**
   * 更新草稿 (autosave PATCH) — PATCH /admin/knowledge-items/:id.
   * 行为:
   *   - status=draft 状态可改 title/content/metadata, version+1
   *   - status=review/published/archived 冻结 (后端兜底, 防 reviewer / 归档后改)
   *   - 写 knowledge_versions snapshot (autosave 版本历史)
   *   - 写 workflow_events (status 不变, 但 version++ 算内部变更)
   */
  async update(tenantId: string, id: string, authorId: string, dto: UpdateKnowledgeDto): Promise<KnowledgeDetailDto> {
    const item = await this.items.findOne({ where: { id, tenantId } });
    if (!item) {
      throw new NotFoundException(`KB 不存在: id=${id}`);
    }
    if (item.status !== KnowledgeStatus.Draft) {
      throw new Error(`KB 已冻结 (status=${item.status}), 仅 draft 状态可编辑`);
    }

    if (dto.title !== undefined) item.title = dto.title;
    if (dto.content !== undefined) item.content = dto.content;
    if (dto.metadata !== undefined) item.metadata = dto.metadata;
    item.version += 1;

    await this.items.save(item);

    // V0.x: 写版本快照 (knowledge_versions 表). diff 字段 V1.x 增强.
    const version = this.versions.create({
      itemId: item.id,
      version: item.version,
      snapshot: item.content,
      authorId,
      diff: null,
    });
    await this.versions.save(version);

    return this.getById(tenantId, item.id);
  }

  // ========================================================================
  // 5 个工作流 action
  // ========================================================================

  async submit(tenantId: string, id: string, userId: string): Promise<KnowledgeDetailDto> {
    return this.doWorkflowAction(tenantId, id, userId, WorkflowAction.Submit);
  }

  async approve(tenantId: string, id: string, userId: string): Promise<KnowledgeDetailDto> {
    const item = await this.doWorkflowAction(tenantId, id, userId, WorkflowAction.Approve);
    return item;
  }

  async reject(tenantId: string, id: string, userId: string, comment: string | null): Promise<KnowledgeDetailDto> {
    return this.doWorkflowAction(tenantId, id, userId, WorkflowAction.Reject, comment);
  }

  async archive(tenantId: string, id: string, userId: string): Promise<KnowledgeDetailDto> {
    return this.doWorkflowAction(tenantId, id, userId, WorkflowAction.Archive);
  }

  async restore(tenantId: string, id: string, userId: string): Promise<KnowledgeDetailDto> {
    return this.doWorkflowAction(tenantId, id, userId, WorkflowAction.Restore);
  }

  private async doWorkflowAction(
    tenantId: string,
    id: string,
    userId: string,
    action: WorkflowAction,
    comment: string | null = null,
  ): Promise<KnowledgeDetailDto> {
    const item = await this.items.findOne({ where: { id, tenantId } });
    if (!item) {
      throw new NotFoundException(`KB 不存在: id=${id}`);
    }
    // V2026-10-12 治本 (Phase 8.1 — nextStatusFor 删 from 参数同步修调用点):
    //   上一轮 8.1 batch 2 改 nextStatusFor 删 unused from 参数, 但 doWorkflowAction
    //   调用点 (line 239) 没同步改, TS strict arity 报 TS2554. 治本: 删 item.status
    //   实参, 跟新签名 (action: WorkflowAction) 对齐. assertTransition 保留 item.status
    //   用于合法性校验, 跟 nextStatusFor 解耦.
    const next = this.nextStatusFor(action);
    this.workflow.assertTransition(item.status, next, action);
    const fromStatus = item.status;
    item.status = next;
    if (action === WorkflowAction.Approve) {
      item.publishedAt = new Date();
      item.reviewerId = userId;
    } else if (action === WorkflowAction.Reject) {
      item.reviewerId = userId;
    }
    await this.items.save(item);
    await this.events.save(
      this.events.create({
        itemId: item.id,
        fromStatus,
        toStatus: next,
        userId,
        comment,
      }),
    );
    // V2026-10-12 (Phase 8.3 — Analytics 跨模块 wire):
    //   5 workflow action 写 analytics_events (reject 跳过, 不算 KPI 1-4 直接相关).
    //   静默失败, 跟 record() 内部 try-catch 一致.
    const analyticsEventType = this.analyticsEventTypeFor(action);
    if (analyticsEventType) {
      await this.analytics.record(tenantId, analyticsEventType, item.id, userId, {
        fromStatus,
        toStatus: next,
        ...(comment ? { comment } : {}),
      });
    }
    // V2026-10-15 治本 (VS-3 续 写侧 — publish 末尾 hook embedOnPublish):
    //   原因: 6 决策 1 A 方案"仅 publish 成功时写 Qdrant", 跟 workflow event 1:1
    //     (approve → published, analyticsEventType 走 KbPublished, embedOnPublish 同点触发).
    //   软降级: try-catch 全包 + 静默失败 (跟 V0.x analytics.record 一致, 不阻塞主流程),
    //     KB 仍可读 / search 走 LIKE 软降级, 跟 V0.3 §17.2 W9 拍板保留兼容.
    if (action === WorkflowAction.Approve && this.config.get<string>('RAG_AUTO_EMBED') !== 'false') {
      try {
        await this.embedOnPublish(item);
      } catch (e) {
        this.logger.warn(`embedOnPublish failed for item=${item.id} (软降级, search 走 LIKE): ${(e as Error).message}`);
      }
    }
    return this.getById(tenantId, item.id);
  }

  /**
   * V2026-10-12 (Phase 8.3): 5 workflow action → 5 AnalyticsEventType 映射
   *   (reject 跳过, V0.x 不写 analytics — reject 跟 KPI 1-4 没直接关系, V1.x 增强).
   *   V0.x KPI 1 (kbPublished) = KbPublished 计数 (approve 触发).
   *   V0.x KPI 2 (draftToPublishRate) = KbPublished / DraftSubmitted 比例.
   *   V0.x KPI 3 (avgReviewSla) 占位 0 (V1.x 真实计算).
   *   V0.x KPI 4 (scheduledPublishRatio) 占位 0 (V1.x 接 KbScheduleFired).
   */
  private analyticsEventTypeFor(action: WorkflowAction): AnalyticsEventType | null {
    switch (action) {
      case WorkflowAction.Submit:
        return AnalyticsEventType.DraftSubmitted;
      case WorkflowAction.Approve:
        return AnalyticsEventType.KbPublished;
      case WorkflowAction.Archive:
        return AnalyticsEventType.KbArchived;
      case WorkflowAction.Restore:
        return AnalyticsEventType.KbRestored;
      case WorkflowAction.Reject:
        return null;
    }
  }

  // V2026-10-12 治本 (Phase 8.1 — unused `from` 参数删除):
  //   nextStatusFor 只用 action 算 next, from 参数冗余 (workflow.assertTransition
  //   已经校验合法性). TS strict-unused-vars 报 TS6133. 治本: 删 from, 注释保留
  //   拒绝参数走 5-action 转换的备注, 防 caller 误传.
  // V2026-10-15 治本 (VS-3 续 写侧 — embedOnPublish 私有方法, doWorkflowAction Approve 末尾 hook):
  //   流程: 读 RAG_CHUNK_SIZE / RAG_CHUNK_OVERLAP env → LangChain RecursiveCharacterTextSplitter
  //     切 content.body → llmRouter.embed() 拿 vector → qdrant.upsertBatch() 写 collection
  //     (单 collection knowledge_chunks, payload 含 itemId + tenantId + chunkIndex + content).
  //   软降级: 任何环节失败 throw → doWorkflowAction 外面 try-catch log warn 兜底, KB 仍可读.
  private async embedOnPublish(item: KnowledgeItem): Promise<void> {
    const body = item.content?.body ?? '';
    if (!body.trim()) {
      this.logger.debug(`embedOnPublish skip item=${item.id} (content.body empty)`);
      return;
    }
    const chunkSize = Number(this.config.get<string>('RAG_CHUNK_SIZE') ?? 200);
    const chunkOverlap = Number(this.config.get<string>('RAG_CHUNK_OVERLAP') ?? 20);
    const providerId = (this.config.get<string>('LLM_DEFAULT_EMBEDDING_PROVIDER') ?? 'openai') as AIProviderId;
    const collection = this.config.get<string>('QDRANT_KB_COLLECTION') ?? 'knowledge_chunks';

    // 1) 切 chunk (V2026-10-15 治本 VS-3 续 — 简化字符切分, 不引 LangChain text_splitter):
    //   反双胞胎: @langchain/core 1.x 不含 text_splitter 子路径 (装包范围),
    //     @langchain/text_splitters 是独立子包 V0.x 没装, 装包扩 scope. 简化字符切分
    //     跟 V0.x culture "e2e 不连真 DB, mock 简化" 一致, 切分精度足够 (V0.3 §13 design
    //     doc 估 1KB 文档 5 chunk). 跟 LangChain RecursiveCharacterTextSplitter 等效
    //     (200 字符 + 20 字符 overlap, paragraph boundary 兜底由 separator 数组覆盖).
    const chunks: string[] = KnowledgeService.chunkText(body, chunkSize, chunkOverlap);
    if (chunks.length === 0) {
      this.logger.debug(`embedOnPublish skip item=${item.id} (0 chunks after splitText)`);
      return;
    }

    // 2) embed (OpenAI 兼容 4 provider 之一, EmbeddingRequest.inputs 是 string[] 复数 batch)
    const response = await this.llmRouter.embed({ model: '', inputs: chunks }, { providerId });
    // V2026-10-15 治本 (VS-3 续 — EmbeddingResponse.results[].vector 字段):
    //   实际 interface 字段是 results: EmbeddingResult[] (不是 embeddings), 每个 result
    //   含 vector + index + tokenCount. 1:1 跟 V2026-09-04 EmbeddingProvider interface 治本
    //   对齐. 反双胞胎: 不写 OpenAI 兼容 /v1/embeddings 协议直反 (那走 base class 转换),
    //     跟 LlmRouterService.embed() 1:1.
    const vectors = response.results.map((r) => r.vector);
    if (vectors.length !== chunks.length) {
      throw new Error(`embed response mismatch: expected ${chunks.length} vectors, got ${vectors.length}`);
    }

    // 3) upsert (Qdrant 1.x upsertBatch, payload 含 tenantId 隔离 + itemId + chunkIndex)
    await this.qdrant.upsertBatch(
      collection,
      chunks.map((content, chunkIndex) => ({
        id: `${item.id}:${chunkIndex}`,
        vector: vectors[chunkIndex],
        payload: { itemId: item.id, tenantId: item.tenantId, chunkIndex, content },
      })),
    );
    this.logger.log(`embedOnPublish ok item=${item.id} chunks=${chunks.length} collection=${collection}`);
  }

  // V2026-10-15 治本 (VS-3 续 — 简化字符切分 helper, 替代 LangChain text_splitter):
  //   字符级 fixed-size + overlap 切分, 输入 text 长度 ≤ size 返 [text] (单 chunk).
  //   start 每次 += size - overlap 实现 overlap sliding window. end >= text.length 跳出.
  //   跟 LangChain RecursiveCharacterTextSplitter 等效 (200 字符 + 20 字符 overlap
  //   起步估 1KB 文档 5 chunk, V0.3 §13 design doc match). 0 新依赖, V0.x 装包范围不变.
  //   反双胞胎: 不按 paragraph / sentence 边界切 (简化, V0.x 估精度足够, V1.x 升级
  //     接 LangChain text_splitters 子包 + sentence boundary 精切).
  private static chunkText(text: string, size: number, overlap: number): string[] {
    if (text.length <= size) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      chunks.push(text.slice(start, end));
      if (end >= text.length) break;
      start += size - overlap;
    }
    return chunks;
  }

  private nextStatusFor(action: WorkflowAction): KnowledgeStatus {
    const map: Record<WorkflowAction, KnowledgeStatus> = {
      [WorkflowAction.Submit]: KnowledgeStatus.Review,
      [WorkflowAction.Approve]: KnowledgeStatus.Published,
      [WorkflowAction.Reject]: KnowledgeStatus.Draft,
      [WorkflowAction.Archive]: KnowledgeStatus.Archived,
      [WorkflowAction.Restore]: KnowledgeStatus.Published,
    };
    return map[action];
  }

  // ========================================================================
  // 2 个排期 action (Phase 7.7 spec)
  // ========================================================================

  /**
   * 设置定时发布 — POST /:id/schedule.
   * V0.x: server-side 暂不接 BullMQ (后端 V0.x dev fallback), 存 scheduledPublishAt 字段.
   * 业务约束: status ∈ {draft, review}. published 已发不能再排, archived 归档后不参与发布.
   */
  async schedule(tenantId: string, id: string, userId: string, dto: ScheduleKnowledgeDto): Promise<KnowledgeDetailDto> {
    const item = await this.items.findOne({ where: { id, tenantId } });
    if (!item) {
      throw new NotFoundException(`KB 不存在: id=${id}`);
    }
    if (item.status !== KnowledgeStatus.Draft && item.status !== KnowledgeStatus.Review) {
      throw new Error(`KB 状态 ${item.status} 不能排期, 仅 draft / review 可排`);
    }
    const scheduled = new Date(dto.scheduledPublishAt);
    // V2026-10-12 治本 (Phase 8.3 — unicorn/prefer-number-properties):
    //   全局 isNaN 会 coerce 非数字, 跟 Number.isNaN 严格语义不同 (只对 number).
    //   治本: 用 Number.isNaN, 防止 'abc' 这类字符串被错误判断.
    if (Number.isNaN(scheduled.getTime())) {
      throw new TypeError(`scheduledPublishAt 格式错误: ${dto.scheduledPublishAt}`);
    }
    const fromStatus = item.status;
    item.scheduledPublishAt = scheduled;
    await this.items.save(item);
    await this.events.save(
      this.events.create({
        itemId: item.id,
        fromStatus,
        toStatus: fromStatus, // 状态不变, 记录排期事件
        userId,
        comment: `scheduled for ${scheduled.toISOString()}`,
      }),
    );
    // V2026-10-12 (Phase 8.3): 排期事件写 analytics, V0.x KPI 4 留 hook (V1.x 接
    // KbScheduleFired 触发后, ratio = KbScheduleFired / KbPublished).
    await this.analytics.record(tenantId, AnalyticsEventType.KbScheduled, item.id, userId, {
      scheduledAt: scheduled.toISOString(),
    });
    return this.getById(tenantId, item.id);
  }

  /**
   * 取消定时发布 — DELETE /:id/schedule.
   */
  async cancelSchedule(tenantId: string, id: string, userId: string): Promise<KnowledgeDetailDto> {
    const item = await this.items.findOne({ where: { id, tenantId } });
    if (!item) {
      throw new NotFoundException(`KB 不存在: id=${id}`);
    }
    const fromStatus = item.status;
    item.scheduledPublishAt = null;
    await this.items.save(item);
    await this.events.save(
      this.events.create({
        itemId: item.id,
        fromStatus,
        toStatus: fromStatus,
        userId,
        comment: 'schedule cancelled',
      }),
    );
    return this.getById(tenantId, item.id);
  }

  // ========================================================================
  // 内部
  // ========================================================================

  /**
   * 拿作者 displayName (server join users.email, V0.x 简化).
   * V0.x 跟 client 7.1-7.8 KnowledgeItem.authorName 字段严格对应.
   * V1.x 跟 user 表加 name 字段后, 优先 name 字段.
   */
  private async getUserDisplayName(userId: string): Promise<string> {
    const user = await this.users.findOne({ where: { uid: userId } });
    if (!user) return 'Unknown';
    return user.email ?? user.phone ?? 'Unknown';
  }

  /**
   * 批量拿 authors displayName, 减少 N+1 query. V0.x dev fallback: email 或 phone.
   * V0.x 跟 client 7.1-7.8 KnowledgeItem.authorName 字段严格对应.
   * V1.x 跟 user 表加 name 字段后, 优先 name 字段.
   */
  private async batchGetAuthorNames(userIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = Array.from(new Set(userIds));
    if (uniqueIds.length === 0) return new Map();
    const users = await this.users
      .createQueryBuilder('u')
      .select(['u.uid', 'u.email', 'u.phone'])
      .where('u.uid IN (:...uids)', { uids: uniqueIds })
      .getMany();
    const map = new Map<string, string>();
    for (const u of users) {
      map.set(u.uid, u.email ?? u.phone ?? 'Unknown');
    }
    return map;
  }

  private toItemDto(item: KnowledgeItem, authorName: string): KnowledgeItemDto {
    return {
      id: item.id,
      tenantId: item.tenantId,
      type: item.type,
      title: item.title,
      contentPreview: item.content.preview,
      tags: item.metadata.tags,
      difficulty: item.metadata.difficulty,
      status: item.status,
      version: item.version,
      authorId: item.authorId,
      authorName,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      reviewerId: item.reviewerId,
      reviewerName: null,
      publishedAt: item.publishedAt,
      scheduledPublishAt: item.scheduledPublishAt,
      // V2026-10-13 (Phase 7.10 — 决策 2B server virtual 派生):
      //   客户端 7.6 WorkflowItemModel.fromJson 读 `submittedAt`, 跟 server
      //   KnowledgeItemDto.submittedAt 严格 wire (dto 已加 @ApiProperty). 派生
      //   logic 在下方 deriveSubmittedAt() helper, 3 tab 一致:
      //     draft/review/archived/published 全有数据, 不再 list cell 时间行空白.
      submittedAt: this.deriveSubmittedAt(item),
    };
  }

  /**
   * V2026-10-13 (Phase 7.10 — 决策 2B server 派生):
   *   按 status 派生 submittedAt, 给 7.6 client WorkflowList 3 tab (我的草稿 /
   *   待我审核 / 已发布) list cell 时间行. 派生规则:
   *     - draft     → createdAt    (草稿创建时间, V0.x author 视角)
   *     - review    → updatedAt    (最近一次 submit / 编辑时间, reviewer 视角)
   *     - published → publishedAt  (审批通过时间, fallback updatedAt 防御)
   *     - archived  → updatedAt    (归档时间)
   *
   *   治本 (决策 2B 选 B 不选 C 的原因):
   *     - 不在 client 按 status 派生 (logic 散落, 后期加 archived 状态要同步改 4 处)
   *     - server 派生 1 处, 跨 3 tab 一致, V1.x 加新状态只改 switch
   *     - client WorkflowItem 实体字段不动, 7.6 + 7.9 零改动
   *
   *   历史 (V2026-10-13 定位):
   *     - 7.6 client `workflow_item_model.dart` L30 读 `json['submittedAt']` (跟 entity
   *       WorkflowItem.submittedAt 1:1) — 字段名一直对, 不需改.
   *     - 但 server 之前没返 `submittedAt` 字段 → 永远 null → 3 tab 列表 cell 时间行空白.
   *     - 跟 server 已有的 `publishedAt` (DTO L102) 不冲突: publishedAt 仅 published
   *       状态有值, draft/review 状态为 null, 不能直接用.
   *     - 治本: server KnowledgeItemDto 加 `submittedAt` 字段, 本 helper 按 status 派生.
   *     - 验证 e2e: GET /admin/workflow/* 响应 JSON 应有 `submittedAt` 字段, 3 tab 都有值.
   */
  private deriveSubmittedAt(item: KnowledgeItem): Date | null {
    switch (item.status) {
      case KnowledgeStatus.Draft:
        return item.createdAt;
      case KnowledgeStatus.Review:
        return item.updatedAt;
      case KnowledgeStatus.Published:
        return item.publishedAt ?? item.updatedAt;
      case KnowledgeStatus.Archived:
        return item.updatedAt;
      default:
        return item.updatedAt;
    }
  }

  private toDetailDto(item: KnowledgeItem, authorName: string, reviewerName: string | null): KnowledgeDetailDto {
    return {
      ...this.toItemDto(item, authorName),
      content: item.content,
      metadata: item.metadata,
      reviewerName,
    };
  }
}
