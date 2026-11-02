import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

import {
  CreateDiaryEntryDto,
  DiaryEntryDto,
  DiaryPageDto,
  DiaryPurgeResultDto,
  ListDiaryEntriesQueryDto,
  MoodSnapshotDto,
  SearchDiaryEntriesQueryDto,
  UpdateDiaryEntryDto,
} from '../dto/good-state-diary.dto';
import { DiaryAiFeedbackDto } from '../dto/good-state-diary.dto';
import { GoodStateDiaryEntry } from '../entities/good-state-diary-entry.entity';
import { parseDiaryAiFeedbackSource, DiaryAiFeedbackSource } from '../enums/diary-ai-feedback-source.enum';
import { DiaryEntryStatus, parseDiaryEntryStatus } from '../enums/diary-entry-status.enum';
import {
  DiaryTag,
  decodeDiaryTags,
  encodeDiaryTags,
  parseDiaryTag,
  parseDiaryTagList,
  stringifyDiaryTagList,
} from '../enums/diary-tag.enum';

// ════════════════════════════════════════════════════════════════
// Cursor 编解码 (base64url, JSON { createdAt: ISO, id: UUID })
// ════════════════════════════════════════════════════════════════

interface DiaryCursor {
  /** ISO-8601, ms 精度. 注意: DB datetime(6) 是 μs 精度, 跨页极罕见漏行, V3 改 sequence. */
  t: string;
  i: string;
}

function encodeCursor(createdAt: Date, id: string): string {
  const payload: DiaryCursor = { t: createdAt.toISOString(), i: id };
  // V2026-09-11 治本 (unicorn/text-encoding-identifier-case):
  //   'utf-8' → 'utf8' (Node.js / WHATWG 标准命名都是 'utf8', unicorn 默认禁 'utf-8').
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): DiaryCursor | null {
  try {
    // V2026-09-11 治本 (unicorn/text-encoding-identifier-case):
    //   'utf-8' → 'utf8', 同 encodeCursor 治本.
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<DiaryCursor>;
    if (!parsed.t || !parsed.i) return null;
    const d = new Date(parsed.t);
    if (Number.isNaN(d.getTime())) return null;
    return { t: d.toISOString(), i: parsed.i };
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// LIKE 转义 (防 % _ \ 通配符注入)
// ════════════════════════════════════════════════════════════════

function escapeLikePattern(input: string): string {
  return input.replaceAll(/[\\%_]/g, String.raw`\$&`);
}

// ════════════════════════════════════════════════════════════════
// Service — V2026-09-11 心塑「好状态日记」业务层
// ════════════════════════════════════════════════════════════════

/**
 * V2026-09-11 治本 (好状态日记 · 服务层):
 *   原因: 心理产品的隐私 + 合规边界要求每条 SQL 都强校验 author_id, 严防越权读写.
 *         配合 @DeleteDateColumn, 默认 find 自动过滤软删, 「最近删除」用 withDeleted.
 *   修复:
 *     - 所有读 / 写路径都显式传 author_id 进 where, 一处漏掉就是隐私事故
 *     - softDelete / restore 走 TypeORM 的 softDelete / restore, 自动维护 deleted_at
 *     - purgeExpired / purgeAll 走 QueryBuilder DELETE (物理擦除, 不可恢复)
 *     - cursor 分页 (createdAt + id), 配合 LIMIT n+1 检测 hasMore
 *     - tag AND 过滤走 COMMA-padding LIKE (VARCHAR 列不上 GIN, 大厂 spec: P0 用 LIKE)
 *   反双胞胎:
 *     - 不复用 FragmentLog 之类的现成 service (日记流水不参与碎片统计, 单独模块)
 *     - 不复用 emergency session (生命周期不同, 不混用)
 *   如何验证: 任意 CRUD → 调用 findOwnedOrThrow 二次校验 author_id → 404 防越权.
 */
@Injectable()
export class GoodStateDiaryService {
  /** 草稿列表默认上限 (前端 getDrafts 无分页参数, 加防御性 cap). */
  private static readonly DRAFTS_LIMIT = 200;

  /** 30 天物理擦除窗口 — PRD §11.1 隐私合规底线. */
  private static readonly PURGE_SOFT_DELETE_DAYS = 30;

  constructor(
    @InjectRepository(GoodStateDiaryEntry)
    private readonly entryRepo: Repository<GoodStateDiaryEntry>,
  ) {}

  // ════════════════════════════════════════════════════════════════
  // 写路径 — CRUD
  // ════════════════════════════════════════════════════════════════

  /** 创建一条日记 — id 由 DB 生成 (uuid v4), 仓储只负责落库. */
  async create(uid: string, dto: CreateDiaryEntryDto): Promise<DiaryEntryDto> {
    const entity = this.entryRepo.create({
      authorId: uid,
      status: dto.status ?? DiaryEntryStatus.Draft,
      body: dto.body,
      title: dto.title ?? null,
      moodLevel: dto.moodSnapshot?.level ?? null,
      moodSnapshottedAt: dto.moodSnapshot ? new Date(dto.moodSnapshot.snapshottedAt) : null,
      moodNote: dto.moodSnapshot?.note ?? null,
      sourceEmotionLogId: dto.moodSnapshot?.sourceEmotionLogId ?? null,
      tags: dto.tags && dto.tags.length > 0 ? encodeDiaryTags(parseDiaryTagList(dto.tags)) : null,
      linkedPracticeId: dto.linkedPracticeId ?? null,
      isPrivate: dto.isPrivate ?? true,
    });
    const saved = await this.entryRepo.save(entity);
    return this.toDto(saved);
  }

  /** 更新既有日记 — id / authorId / createdAt 不可改 (DTO 无此字段, 防御性 hardcode). */
  async update(uid: string, entryId: string, dto: UpdateDiaryEntryDto): Promise<DiaryEntryDto> {
    const entity = await this.findOwnedOrThrow(uid, entryId);

    // Partial update — 字段在 DTO 中存在才应用 (undefined = 不变; null = 清除).
    if (dto.body !== undefined) entity.body = dto.body;
    if (dto.title !== undefined) entity.title = dto.title;
    if (dto.status !== undefined) entity.status = dto.status;
    if (dto.moodSnapshot !== undefined) {
      this.applyMoodSnapshot(entity, dto.moodSnapshot);
    }
    if (dto.tags !== undefined) {
      entity.tags = dto.tags.length > 0 ? encodeDiaryTags(parseDiaryTagList(dto.tags)) : null;
    }
    if (dto.linkedPracticeId !== undefined) {
      entity.linkedPracticeId = dto.linkedPracticeId;
    }
    if (dto.aiFeedback !== undefined) {
      this.applyAiFeedback(entity, dto.aiFeedback);
    }
    if (dto.isPrivate !== undefined) entity.isPrivate = dto.isPrivate;

    const saved = await this.entryRepo.save(entity);
    return this.toDto(saved);
  }

  /** 软删除 — 30 天内可恢复. */
  async softDelete(uid: string, entryId: string): Promise<void> {
    // 用 criteria 而不是 load + softDelete, 一步到位 + 防越权.
    const result = await this.entryRepo.softDelete({ id: entryId, authorId: uid });
    if ((result.affected ?? 0) === 0) {
      throw new BizException(BizCode.ResourceNotFound, `日记不存在或不属于当前用户`);
    }
  }

  /** 恢复软删除 — 反向设置 deleted_at = NULL. */
  async restore(uid: string, entryId: string): Promise<DiaryEntryDto> {
    const result = await this.entryRepo.restore({ id: entryId, authorId: uid });
    if ((result.affected ?? 0) === 0) {
      throw new BizException(BizCode.ResourceNotFound, `日记不存在或不属于当前用户`);
    }
    const entity = await this.findOwnedOrThrow(uid, entryId, { includeDeleted: true });
    return this.toDto(entity);
  }

  // ════════════════════════════════════════════════════════════════
  // 读路径 — 单条 / 列表 / 草稿 / 搜索
  // ════════════════════════════════════════════════════════════════

  /** 按 id 查询 — 默认排除软删除. */
  async getById(uid: string, entryId: string): Promise<DiaryEntryDto | null> {
    const entity = await this.entryRepo.findOne({ where: { id: entryId, authorId: uid } });
    return entity ? this.toDto(entity) : null;
  }

  /** 按 id 查询 (含软删除) — 「最近删除」用. */
  async getByIdIncludingDeleted(uid: string, entryId: string): Promise<DiaryEntryDto | null> {
    const entity = await this.entryRepo.findOne({
      where: { id: entryId, authorId: uid },
      withDeleted: true,
    });
    return entity ? this.toDto(entity) : null;
  }

  /** 游标分页拉取最近日记. */
  async getRecent(uid: string, query: ListDiaryEntriesQueryDto): Promise<DiaryPageDto> {
    const limit = Math.min(query.limit ?? 30, 100);
    const statuses = this.parseStatusFilter(query.statusFilter);

    const qb = this.entryRepo
      .createQueryBuilder('e')
      .where('e.author_id = :uid', { uid })
      .andWhere('e.status IN (:...statuses)', { statuses })
      .orderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(limit + 1);

    if (query.cursor) {
      const cur = decodeCursor(query.cursor);
      if (cur) {
        // DESC 排序 → 下一批取「更老」的行: created_at < cursorT, 同时间戳取 id 更小
        qb.andWhere('(e.created_at < :cursorT OR (e.created_at = :cursorT AND e.id < :cursorI))', {
          cursorT: cur.t,
          cursorI: cur.i,
        });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      entries: pageRows.map((r) => this.toDto(r)),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** 拉所有草稿 — 草稿箱用. */
  async getDrafts(uid: string): Promise<DiaryEntryDto[]> {
    const rows = await this.entryRepo.find({
      where: { authorId: uid, status: DiaryEntryStatus.Draft },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: GoodStateDiaryService.DRAFTS_LIMIT,
    });
    return rows.map((r) => this.toDto(r));
  }

  /** 全文检索 — LIKE 模糊 (P0), V3 接 MeiliSearch. */
  async search(uid: string, query: SearchDiaryEntriesQueryDto): Promise<DiaryPageDto> {
    const limit = Math.min(query.limit ?? 30, 100);
    const like = `%${escapeLikePattern(query.query)}%`;

    const qb = this.entryRepo
      .createQueryBuilder('e')
      .where('e.author_id = :uid', { uid })
      .andWhere('(e.title LIKE :like OR e.body LIKE :like)', { like })
      .orderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(limit + 1);

    if (query.cursor) {
      const cur = decodeCursor(query.cursor);
      if (cur) {
        qb.andWhere('(e.created_at < :cursorT OR (e.created_at = :cursorT AND e.id < :cursorI))', {
          cursorT: cur.t,
          cursorI: cur.i,
        });
      }
    }

    // Tag AND 过滤 — comma-padding LIKE 防子串误匹配.
    const tagFilters = this.parseTagFilters(query.tagFilters);
    for (const [idx, tag] of tagFilters.entries()) {
      qb.andWhere("CONCAT(',', IFNULL(e.tags, ''), ',') LIKE CONCAT('%,', :tagFilter" + idx + ", ',%')", {
        [`tagFilter${idx}`]: tag as string,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      entries: pageRows.map((r) => this.toDto(r)),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // 合规清理 — 启动期后台任务 / 隐私入口
  // ════════════════════════════════════════════════════════════════

  /** 物理擦除到期软删除条目 (默认 30 天) — 由 bootstrap 启动期调用. */
  async purgeExpiredSoftDeletes(cutoff?: Date): Promise<DiaryPurgeResultDto> {
    const cutoffDate = cutoff ?? new Date(Date.now() - GoodStateDiaryService.PURGE_SOFT_DELETE_DAYS * 24 * 60 * 60 * 1000);
    // 物理 DELETE — QueryBuilder 走列名, 不带 alias (同 fragment-log 治本笔记).
    const result = await this.entryRepo
      .createQueryBuilder()
      .delete()
      .where('deleted_at IS NOT NULL')
      .andWhere('deleted_at < :cutoff', { cutoff: cutoffDate })
      .execute();
    return {
      deletedCount: result.affected ?? 0,
      cutoffIso: cutoffDate.toISOString(),
    };
  }

  /** 一键清除所有 diary 数据 — 「彻底删除」入口. */
  async purgeAll(uid: string): Promise<DiaryPurgeResultDto> {
    const result = await this.entryRepo.delete({ authorId: uid });
    const cutoffIso = new Date().toISOString();
    return {
      deletedCount: result.affected ?? 0,
      cutoffIso,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // 校验 — 防资源越权 / 软删判定
  // ════════════════════════════════════════════════════════════════

  /**
   * 查找并校验所有权 — 找不到 / 不属于当前用户 / 已软删都抛 404.
   * (大厂 spec: 不区分 404 / 403, 避免泄露资源存在性.)
   */
  async findOwnedOrThrow(uid: string, entryId: string, opts: { includeDeleted?: boolean } = {}): Promise<GoodStateDiaryEntry> {
    const entity = await this.entryRepo.findOne({
      where: { id: entryId, authorId: uid },
      withDeleted: opts.includeDeleted === true,
    });
    if (!entity) {
      throw new BizException(BizCode.ResourceNotFound, `日记不存在或不属于当前用户`);
    }
    return entity;
  }

  // ════════════════════════════════════════════════════════════════
  // 内部 — 解析 + 应用部分更新
  // ════════════════════════════════════════════════════════════════

  private parseStatusFilter(raw: string | undefined): DiaryEntryStatus[] {
    if (!raw || raw.trim().length === 0) {
      return [DiaryEntryStatus.Finalized];
    }
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseDiaryEntryStatus);
    return parsed.length > 0 ? parsed : [DiaryEntryStatus.Finalized];
  }

  private parseTagFilters(raw: string | undefined): DiaryTag[] {
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseDiaryTag)
      .filter((t): t is DiaryTag => t !== null);
  }

  private applyMoodSnapshot(entity: GoodStateDiaryEntry, snap: MoodSnapshotDto | null): void {
    if (snap === null) {
      entity.moodLevel = null;
      entity.moodSnapshottedAt = null;
      entity.moodNote = null;
      entity.sourceEmotionLogId = null;
      return;
    }
    entity.moodLevel = snap.level;
    entity.moodSnapshottedAt = new Date(snap.snapshottedAt);
    entity.moodNote = snap.note ?? null;
    entity.sourceEmotionLogId = snap.sourceEmotionLogId ?? null;
  }

  private applyAiFeedback(entity: GoodStateDiaryEntry, fb: DiaryAiFeedbackDto | null): void {
    if (fb === null) {
      entity.aiFeedback = null;
      entity.aiFeedbackGeneratedAt = null;
      return;
    }
    entity.aiFeedback = {
      summary: fb.summary,
      perspectiveQuestions: fb.perspectiveQuestions,
      observedThemes: fb.observedThemes,
      generatedAt: fb.generatedAt,
      source: fb.source,
      crisisFlag: fb.crisisFlag,
    };
    entity.aiFeedbackGeneratedAt = new Date(fb.generatedAt);
  }

  /** entity → DiaryEntryDto (响应序列化). */
  private toDto(entity: GoodStateDiaryEntry): DiaryEntryDto {
    const tags = decodeDiaryTags(entity.tags);
    const moodSnapshot =
      entity.moodLevel !== null && entity.moodSnapshottedAt !== null
        ? {
            level: entity.moodLevel,
            snapshottedAt: entity.moodSnapshottedAt.toISOString(),
            note: entity.moodNote,
            sourceEmotionLogId: entity.sourceEmotionLogId,
          }
        : null;
    const aiFeedback =
      entity.aiFeedback && entity.aiFeedbackGeneratedAt !== null
        ? this.normalizeAiFeedback(entity.aiFeedback, entity.aiFeedbackGeneratedAt)
        : null;

    return {
      id: entity.id,
      authorId: entity.authorId,
      status: entity.status,
      title: entity.title,
      body: entity.body,
      moodSnapshot,
      tags: stringifyDiaryTagList(tags),
      linkedPracticeId: entity.linkedPracticeId,
      aiFeedback,
      isPrivate: entity.isPrivate,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      deletedAt: entity.deletedAt?.toISOString() ?? null,
    };
  }

  /**
   * 把 DB JSON 反序列化为强类型 DTO — 兼容老数据 schema 漂移, 缺失字段用 fallback.
   * 反序列化失败时不抛 (老数据降级, 详情页 fallback 显示「无 AI 反馈」).
   *
   * V2026-09-11 治本 (TS2322):
   *   source 字段必须严格收口为 DiaryAiFeedbackSource 枚举, 不能是字符串字面量 union
   *   ('onDevice' | 'cloud' | 'hybrid') — 跟 DiaryAiFeedbackDto.source 类型签名不一致
   *   会让前端 TypeScript 强类型校验失效. 用 parseDiaryAiFeedbackSource 统一入口,
   *   兜底走 DiaryAiFeedbackSource.OnDevice (同 enum.parse 语义).
   */
  private normalizeAiFeedback(raw: Record<string, unknown>, generatedAt: Date): DiaryAiFeedbackDto | null {
    const summary = typeof raw['summary'] === 'string' ? raw['summary'] : '';
    const questions = Array.isArray(raw['perspectiveQuestions'])
      ? (raw['perspectiveQuestions'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const themes = Array.isArray(raw['observedThemes'])
      ? (raw['observedThemes'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const source = typeof raw['source'] === 'string' ? parseDiaryAiFeedbackSource(raw['source']) : DiaryAiFeedbackSource.OnDevice;
    const crisisFlag = raw['crisisFlag'] === true;
    const genAt = typeof raw['generatedAt'] === 'string' ? raw['generatedAt'] : generatedAt.toISOString();
    return {
      summary,
      perspectiveQuestions: questions,
      observedThemes: themes,
      generatedAt: genAt,
      source,
      crisisFlag,
    };
  }
}
