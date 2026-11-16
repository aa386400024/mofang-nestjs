import { Inject, Injectable } from '@nestjs/common';

import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';

import { DIARY_ENTRY_REPOSITORY, type DiaryEntryRepository, type DiaryRow } from '../domain/repositories/diary-entry.repository.js';
import {
  CreateDiaryEntryDto,
  DiaryEntryDto,
  DiaryPageDto,
  DiaryPurgeResultDto,
  ListDiaryEntriesQueryDto,
  MoodSnapshotDto,
  SearchDiaryEntriesQueryDto,
  UpdateDiaryEntryDto,
} from '../dto/good-state-diary.dto.js';
import { DiaryAiFeedbackDto } from '../dto/good-state-diary.dto.js';
import { parseDiaryAiFeedbackSource, DiaryAiFeedbackSource } from '../enums/diary-ai-feedback-source.enum.js';
import { DiaryEntryStatus, parseDiaryEntryStatus } from '../enums/diary-entry-status.enum.js';
import {
  DiaryTag,
  decodeDiaryTags,
  encodeDiaryTags,
  parseDiaryTag,
  parseDiaryTagList,
  stringifyDiaryTagList,
} from '../enums/diary-tag.enum.js';

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
 *   原因: 心理产品的隐私 + 合规边界要求每条读 / 写路径都强校验 author_id, 严防越权读写.
 *         配合 @DeleteDateColumn, 默认读自动过滤软删, 「最近删除」用含软删口径.
 *   修复:
 *     - 所有读 / 写路径都显式带上 author_id 条件, 一处漏掉就是隐私事故
 *     - softDelete / restore 走软删口径, 自动维护 deleted_at
 *     - purgeExpired / purgeAll 走物理擦除 (不可恢复)
 *     - cursor 分页 (createdAt + id), 配合 LIMIT n+1 检测 hasMore
 *     - tag AND 过滤走 COMMA-padding LIKE (VARCHAR 列不上 GIN, 大厂 spec: P0 用 LIKE)
 *   反双胞胎:
 *     - 不复用 FragmentLog 之类的现成 service (日记流水不参与碎片统计, 单独模块)
 *     - 不复用 emergency session (生命周期不同, 不混用)
 *   如何验证: 任意 CRUD → 调用 findOwnedOrThrow 二次校验 author_id → 404 防越权.
 *
 * V2026-11-14 治本 (TD-18 · C2 第二批仓储端口化 · good_state_diary 域 · P-DEBT-11 / L-1):
 *   - 仓储访问改走**端口** (`domain/repositories/diary-entry.repository.js` 的 interface
 *     + `DIARY_ENTRY_REPOSITORY` DI token), typeorm 值符号全部收进 `data/` 的
 *     TypeORM 实现; service 不再出现 entity 类名, 不再值位置 import entity
 *   - **实体工厂下沉实现层** —— service 只构造纯对象 (行的字段集合由 service 决定),
 *     落库由 `data/` 实现负责 (对齐 TD-17 D-6)
 *   - 业务语义**逐字不变**: author_id 越权隔离 / 软删默认过滤与含软删口径 /
 *     status 默认 finalized / 双游标 (createdAt + id DESC) / limit + 1 检测 hasMore /
 *     LIKE 通配转义 / tag AND comma-padding LIKE / 草稿 take 200 / 30 天擦除窗口 /
 *     affected === 0 与未命中均抛 404 / DTO 转换 (含 deletedAt ISO) 不变
 *   - 公共方法签名 (create / update / softDelete / restore / getById /
 *     getByIdIncludingDeleted / getRecent / getDrafts / search /
 *     purgeExpiredSoftDeletes / purgeAll / findOwnedOrThrow) **逐字不变**;
 *     findOwnedOrThrow 的返回类型由 entity 换成端口行类型 (唯一调用方 AI service
 *     只 await 不消费字段, 不受影响)
 */
@Injectable()
export class GoodStateDiaryService {
  /** 30 天物理擦除窗口 — PRD §11.1 隐私合规底线. */
  private static readonly PURGE_SOFT_DELETE_DAYS = 30;

  constructor(
    @Inject(DIARY_ENTRY_REPOSITORY)
    private readonly entryRepo: DiaryEntryRepository,
  ) {}

  // ════════════════════════════════════════════════════════════════
  // 写路径 — CRUD
  // ════════════════════════════════════════════════════════════════

  /** 创建一条日记 — id 由 DB 生成 (uuid v4), 仓储只负责落库. */
  async create(uid: string, dto: CreateDiaryEntryDto): Promise<DiaryEntryDto> {
    const row = await this.entryRepo.create({
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
    return this.toDto(row);
  }

  /** 更新既有日记 — id / authorId / createdAt 不可改 (DTO 无此字段, 防御性 hardcode). */
  async update(uid: string, entryId: string, dto: UpdateDiaryEntryDto): Promise<DiaryEntryDto> {
    const row = await this.findOwnedOrThrow(uid, entryId);

    // Partial update — 字段在 DTO 中存在才应用 (undefined = 不变; null = 清除).
    if (dto.body !== undefined) row.body = dto.body;
    if (dto.title !== undefined) row.title = dto.title;
    if (dto.status !== undefined) row.status = dto.status;
    if (dto.moodSnapshot !== undefined) {
      this.applyMoodSnapshot(row, dto.moodSnapshot);
    }
    if (dto.tags !== undefined) {
      row.tags = dto.tags.length > 0 ? encodeDiaryTags(parseDiaryTagList(dto.tags)) : null;
    }
    if (dto.linkedPracticeId !== undefined) {
      row.linkedPracticeId = dto.linkedPracticeId;
    }
    if (dto.aiFeedback !== undefined) {
      this.applyAiFeedback(row, dto.aiFeedback);
    }
    if (dto.isPrivate !== undefined) row.isPrivate = dto.isPrivate;

    const saved = await this.entryRepo.save(row);
    return this.toDto(saved);
  }

  /** 软删除 — 30 天内可恢复. */
  async softDelete(uid: string, entryId: string): Promise<void> {
    // 用 id + author_id 条件一步到位 + 防越权.
    const result = await this.entryRepo.softDelete(uid, entryId);
    if ((result.affected ?? 0) === 0) {
      throw new BizException(BizCode.ResourceNotFound, `日记不存在或不属于当前用户`);
    }
  }

  /** 恢复软删除 — 反向设置 deleted_at = NULL. */
  async restore(uid: string, entryId: string): Promise<DiaryEntryDto> {
    const result = await this.entryRepo.restore(uid, entryId);
    if ((result.affected ?? 0) === 0) {
      throw new BizException(BizCode.ResourceNotFound, `日记不存在或不属于当前用户`);
    }
    const row = await this.findOwnedOrThrow(uid, entryId, { includeDeleted: true });
    return this.toDto(row);
  }

  // ════════════════════════════════════════════════════════════════
  // 读路径 — 单条 / 列表 / 草稿 / 搜索
  // ════════════════════════════════════════════════════════════════

  /** 按 id 查询 — 默认排除软删除. */
  async getById(uid: string, entryId: string): Promise<DiaryEntryDto | null> {
    const row = await this.entryRepo.findById(uid, entryId);
    return row ? this.toDto(row) : null;
  }

  /** 按 id 查询 (含软删除) — 「最近删除」用. */
  async getByIdIncludingDeleted(uid: string, entryId: string): Promise<DiaryEntryDto | null> {
    const row = await this.entryRepo.findById(uid, entryId, { includeDeleted: true });
    return row ? this.toDto(row) : null;
  }

  /** 游标分页拉取最近日记. */
  async getRecent(uid: string, query: ListDiaryEntriesQueryDto): Promise<DiaryPageDto> {
    const limit = Math.min(query.limit ?? 30, 100);
    const statuses = this.parseStatusFilter(query.statusFilter);
    // 游标编解码留在 service (纯函数) —— 实现层只收解码后的 {t, i}.
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.entryRepo.listRecent({
      uid,
      statuses,
      limit,
      cursor: cursor ?? undefined,
    });

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
    const rows = await this.entryRepo.findDrafts(uid);
    return rows.map((r) => this.toDto(r));
  }

  /** 全文检索 — LIKE 模糊 (P0), V3 接 MeiliSearch. */
  async search(uid: string, query: SearchDiaryEntriesQueryDto): Promise<DiaryPageDto> {
    const limit = Math.min(query.limit ?? 30, 100);
    // LIKE 通配符转义留在 service (纯函数) —— 实现层拿到的已是转义后的模式.
    const like = `%` + escapeLikePattern(query.query) + `%`;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    // Tag 解析留在 service —— comma-padding LIKE 的 AND 条件在实现层.
    const tagFilters = this.parseTagFilters(query.tagFilters);

    const rows = await this.entryRepo.searchEntries({
      uid,
      likePattern: like,
      limit,
      cursor: cursor ?? undefined,
      tagFilters,
    });

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
    const result = await this.entryRepo.purgeExpiredSoftDeletes(cutoffDate);
    return {
      deletedCount: result.affected ?? 0,
      cutoffIso: cutoffDate.toISOString(),
    };
  }

  /** 一键清除所有 diary 数据 — 「彻底删除」入口. */
  async purgeAll(uid: string): Promise<DiaryPurgeResultDto> {
    const result = await this.entryRepo.deleteByAuthor(uid);
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
  async findOwnedOrThrow(uid: string, entryId: string, opts: { includeDeleted?: boolean } = {}): Promise<DiaryRow> {
    const row = await this.entryRepo.findById(uid, entryId, { includeDeleted: opts.includeDeleted === true });
    if (!row) {
      throw new BizException(BizCode.ResourceNotFound, `日记不存在或不属于当前用户`);
    }
    return row;
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

  private applyMoodSnapshot(row: DiaryRow, snap: MoodSnapshotDto | null): void {
    if (snap === null) {
      row.moodLevel = null;
      row.moodSnapshottedAt = null;
      row.moodNote = null;
      row.sourceEmotionLogId = null;
      return;
    }
    row.moodLevel = snap.level;
    row.moodSnapshottedAt = new Date(snap.snapshottedAt);
    row.moodNote = snap.note ?? null;
    row.sourceEmotionLogId = snap.sourceEmotionLogId ?? null;
  }

  private applyAiFeedback(row: DiaryRow, fb: DiaryAiFeedbackDto | null): void {
    if (fb === null) {
      row.aiFeedback = null;
      row.aiFeedbackGeneratedAt = null;
      return;
    }
    row.aiFeedback = {
      summary: fb.summary,
      perspectiveQuestions: fb.perspectiveQuestions,
      observedThemes: fb.observedThemes,
      generatedAt: fb.generatedAt,
      source: fb.source,
      crisisFlag: fb.crisisFlag,
    };
    row.aiFeedbackGeneratedAt = new Date(fb.generatedAt);
  }

  /** 行 → DiaryEntryDto (响应序列化). */
  private toDto(row: DiaryRow): DiaryEntryDto {
    const tags = decodeDiaryTags(row.tags);
    const moodSnapshot =
      row.moodLevel !== null && row.moodSnapshottedAt !== null
        ? {
            level: row.moodLevel,
            snapshottedAt: row.moodSnapshottedAt.toISOString(),
            note: row.moodNote,
            sourceEmotionLogId: row.sourceEmotionLogId,
          }
        : null;
    const aiFeedback =
      row.aiFeedback && row.aiFeedbackGeneratedAt !== null ? this.normalizeAiFeedback(row.aiFeedback, row.aiFeedbackGeneratedAt) : null;

    return {
      id: row.id,
      authorId: row.authorId,
      status: row.status,
      title: row.title,
      body: row.body,
      moodSnapshot,
      tags: stringifyDiaryTagList(tags),
      linkedPracticeId: row.linkedPracticeId,
      aiFeedback,
      isPrivate: row.isPrivate,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
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
