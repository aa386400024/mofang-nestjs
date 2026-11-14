// V2026-11-14 治本 (TD-18 · C2 第二批仓储端口化 · good_state_diary 域 · P-DEBT-11 / L-1):
//   端口替身 spec —— good_state_diary service 用**端口替身**驱动: 不起真数据源, 不连 DB,
//   不 mock 持久化库. 替身只记调用参数 + 返回预设行.
//
//   覆盖:
//     ① create / update: 行构造 (service 侧纯对象) + 整行回存 + 404 判定;
//     ② softDelete / restore: 参数透传 + affected === 0 → 404 + 含软删读口径;
//     ③ getById / getByIdIncludingDeleted: 两种读口径的参数形态;
//     ④ getRecent: 状态解析 / 游标解码 / hasMore 与 nextCursor 留 service;
//     ⑤ getDrafts / search: 端口只收 uid / 已转义 LIKE 模式 + 已解析 tag;
//     ⑥ purgeExpiredSoftDeletes / purgeAll: cutoff 与 owner 参数透传;
//     ⑦ 调用次数口径 + 写入失败时的现有语义 (行为锁) + 端口方法面恰为 10 个.
//
//   时间口径: 本 spec 不依赖任何定时器 —— 回显时刻由替身按**固定常量**给出,
//     所以断言不随真实时钟漂移 (purge cutoff 用相对容差断言).
//
//   替身写法: 直接实现端口 interface (跟 TD-13 analytics / TD-16 life-map / TD-17 consent 同款口径).
//   边界: **零** entity import、零 typeorm 值符号; 实体类名不出现在本文件.
//
//   分工: 本 spec 锁**端口契约** (调用面 / 参数 / 出参形状); 业务行为 (游标分页 / 状态解析 /
//     越权 404 / 软删生命周期) 由 src/good_state_diary/providers/good-state-diary.service.spec.ts 锁.
//
//   验证: pnpm exec vitest run test/good_state_diary/td18-good-state-diary-port-c2-batch2.spec.ts
//   时间戳: 2026-11-14 GMT+8

import { describe, expect, it } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import {
  DIARY_ENTRY_REPOSITORY,
  type CreateDiaryEntryInput,
  type DiaryEntryRepository,
  type DiaryRow,
  type ListRecentEntriesQuery,
  type SearchEntriesQuery,
} from '../../src/good_state_diary/domain/repositories/diary-entry.repository.js';
import { DiaryEntryStatus } from '../../src/good_state_diary/enums/diary-entry-status.enum.js';
import { DiaryMoodLevel } from '../../src/good_state_diary/enums/diary-mood-level.enum.js';
import { DiaryTag } from '../../src/good_state_diary/enums/diary-tag.enum.js';
import { GoodStateDiaryService } from '../../src/good_state_diary/providers/good-state-diary.service.js';

/** 固定的"落库时刻" —— 替身回显用, 不随真实时钟漂移. */
const NOW = new Date('2026-11-14T00:00:00.000Z');

/** 30 天窗口 (毫秒) —— purge cutoff 断言用. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ═════════════════════════════════════════════════════════════
// 行构造器
// ═════════════════════════════════════════════════════════════

/** 读路径返回的行 (可覆盖). */
function diaryRow(overrides: Partial<DiaryRow> = {}): DiaryRow {
  return {
    id: 'entry-1',
    authorId: 'uid-1',
    status: DiaryEntryStatus.Draft,
    title: null,
    body: 'body',
    moodLevel: null,
    moodSnapshottedAt: null,
    moodNote: null,
    sourceEmotionLogId: null,
    tags: null,
    linkedPracticeId: null,
    aiFeedback: null,
    aiFeedbackGeneratedAt: null,
    isPrivate: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

/** 写路径回显行 —— 由入参构造, 缺省时刻用固定常量. */
function rowFromCreate(input: CreateDiaryEntryInput): DiaryRow {
  return {
    id: 'entry-new',
    authorId: input.authorId,
    status: input.status,
    title: input.title,
    body: input.body,
    moodLevel: input.moodLevel,
    moodSnapshottedAt: input.moodSnapshottedAt,
    moodNote: input.moodNote,
    sourceEmotionLogId: input.sourceEmotionLogId,
    tags: input.tags,
    linkedPracticeId: input.linkedPracticeId,
    aiFeedback: null,
    aiFeedbackGeneratedAt: null,
    isPrivate: input.isPrivate,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

// ═════════════════════════════════════════════════════════════
// 端口替身
// ═════════════════════════════════════════════════════════════

/** 日记仓储端口替身 —— 只记调用参数 + 返回预设行. */
class DiaryRepoDouble {
  /** create 的入参序列. */
  readonly creates: CreateDiaryEntryInput[] = [];
  /** save 的整行序列. */
  readonly saves: DiaryRow[] = [];
  /** findById 的入参序列. */
  readonly findByIdCalls: { uid: string; entryId: string; opts?: { includeDeleted?: boolean } }[] = [];
  /** findDrafts 的入参序列. */
  readonly draftLookups: string[] = [];
  /** listRecent 的入参序列. */
  readonly recentQueries: ListRecentEntriesQuery[] = [];
  /** searchEntries 的入参序列. */
  readonly searchQueries: SearchEntriesQuery[] = [];
  /** softDelete 的入参序列. */
  readonly softDeletes: { uid: string; entryId: string }[] = [];
  /** restore 的入参序列. */
  readonly restores: { uid: string; entryId: string }[] = [];
  /** deleteByAuthor 的入参序列. */
  readonly authorDeletes: string[] = [];
  /** purgeExpiredSoftDeletes 的 cutoff 序列. */
  readonly purges: Date[] = [];

  /** findById 返回行 (缺省 null = 没这条 / 越权 / 已软删). */
  found: DiaryRow | null = null;
  /** findDrafts 返回行. */
  drafts: DiaryRow[] = [];
  /** listRecent 返回行 (替身按 limit + 1 截断 —— 锁「多取一条判 hasMore」口径). */
  recent: DiaryRow[] = [];
  /** searchEntries 返回行 (同上). */
  searched: DiaryRow[] = [];
  /** 四个生命周期出口的受影响行数 (缺省 0). */
  affected = 0;
  /** 注入给写入的失败 (测失败语义; null = 正常). */
  writeFailure: Error | null = null;

  readonly repo: DiaryEntryRepository;

  constructor() {
    this.repo = {
      create: async (input: CreateDiaryEntryInput): Promise<DiaryRow> => {
        this.creates.push(input);
        if (this.writeFailure) {
          throw this.writeFailure;
        }
        return rowFromCreate(input);
      },
      save: async (row: DiaryRow): Promise<DiaryRow> => {
        this.saves.push(row);
        if (this.writeFailure) {
          throw this.writeFailure;
        }
        return row;
      },
      findById: async (uid: string, entryId: string, opts?: { includeDeleted?: boolean }): Promise<DiaryRow | null> => {
        this.findByIdCalls.push({ uid, entryId, opts });
        return this.found;
      },
      findDrafts: async (uid: string): Promise<DiaryRow[]> => {
        this.draftLookups.push(uid);
        return this.drafts;
      },
      listRecent: async (query: ListRecentEntriesQuery): Promise<DiaryRow[]> => {
        this.recentQueries.push(query);
        return this.recent.slice(0, query.limit + 1);
      },
      searchEntries: async (query: SearchEntriesQuery): Promise<DiaryRow[]> => {
        this.searchQueries.push(query);
        return this.searched.slice(0, query.limit + 1);
      },
      softDelete: async (uid: string, entryId: string): Promise<{ affected: number }> => {
        this.softDeletes.push({ uid, entryId });
        return { affected: this.affected };
      },
      restore: async (uid: string, entryId: string): Promise<{ affected: number }> => {
        this.restores.push({ uid, entryId });
        return { affected: this.affected };
      },
      deleteByAuthor: async (uid: string): Promise<{ affected: number }> => {
        this.authorDeletes.push(uid);
        return { affected: this.affected };
      },
      purgeExpiredSoftDeletes: async (cutoff: Date): Promise<{ affected: number }> => {
        this.purges.push(cutoff);
        return { affected: this.affected };
      },
    };
  }
}

/** 装配 service + 端口替身. */
function makeService(): { service: GoodStateDiaryService; double: DiaryRepoDouble } {
  const double = new DiaryRepoDouble();
  return { service: new GoodStateDiaryService(double.repo), double };
}

/** 解码 base64url 游标 —— 断言 nextCursor 的载荷形态. */
function decodeCursorPayload(cursor: string): { t: string; i: string } {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { t: string; i: string };
}

// ═════════════════════════════════════════════════════════════
// ① create / update
// ═════════════════════════════════════════════════════════════

describe('GoodStateDiaryService · 端口替身 (TD-18 C2 第二批)', () => {
  it('A1 · create —— 入参逐字透传 (行纯对象构造, service 侧零工厂依赖)', async () => {
    const { service, double } = makeService();

    const result = await service.create('uid-1', {
      body: '今天状态一般',
      title: '标题',
      status: DiaryEntryStatus.Finalized,
      moodSnapshot: {
        level: DiaryMoodLevel.Low,
        snapshottedAt: '2026-11-14T00:00:00.000Z',
        note: 'note',
        sourceEmotionLogId: 'emo-1',
      },
      tags: [DiaryTag.GoodMoment],
      linkedPracticeId: 'prac-1',
      isPrivate: false,
    });

    expect(double.creates).toHaveLength(1);
    expect(double.creates[0]).toEqual({
      authorId: 'uid-1',
      status: DiaryEntryStatus.Finalized,
      body: '今天状态一般',
      title: '标题',
      moodLevel: DiaryMoodLevel.Low,
      moodSnapshottedAt: new Date('2026-11-14T00:00:00.000Z'),
      moodNote: 'note',
      sourceEmotionLogId: 'emo-1',
      tags: 'goodMoment',
      linkedPracticeId: 'prac-1',
      isPrivate: false,
    });
    // 落库行回显 —— id 由落库层生成, 软删列缺省 null
    expect(result.id).toBe('entry-new');
    expect(result.status).toBe(DiaryEntryStatus.Finalized);
    expect(result.deletedAt).toBeNull();
  });

  it('A2 · create 缺省兜底 —— status=draft / isPrivate=true / 情绪四列 null / 空 tag 归 null', async () => {
    const { service, double } = makeService();

    await service.create('uid-1', { body: 'x', tags: [] });

    expect(double.creates[0]).toEqual({
      authorId: 'uid-1',
      status: DiaryEntryStatus.Draft,
      body: 'x',
      title: null,
      moodLevel: null,
      moodSnapshottedAt: null,
      moodNote: null,
      sourceEmotionLogId: null,
      tags: null,
      linkedPracticeId: null,
      isPrivate: true,
    });
  });

  it('A3 · update —— 先按 owner 口径取行, 改字段后整行回存 (含 id / createdAt / deletedAt)', async () => {
    const { service, double } = makeService();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    double.found = diaryRow({ id: 'entry-1', body: 'old', createdAt });

    const result = await service.update('uid-1', 'entry-1', { body: 'new' });

    expect(double.findByIdCalls).toHaveLength(1);
    expect(double.findByIdCalls[0]?.uid).toBe('uid-1');
    expect(double.findByIdCalls[0]?.entryId).toBe('entry-1');
    // 默认口径 = 不含软删行
    expect(double.findByIdCalls[0]?.opts?.includeDeleted).toBe(false);
    expect(double.saves).toHaveLength(1);
    expect(double.saves[0]?.body).toBe('new');
    expect(double.saves[0]?.id).toBe('entry-1');
    expect(double.saves[0]?.createdAt).toEqual(createdAt);
    expect(double.saves[0]?.deletedAt).toBeNull();
    expect(result.body).toBe('new');
  });

  it('A4 · update 越权 / 软删未命中 —— 抛 404 且不落库', async () => {
    const { service, double } = makeService();
    double.found = null;

    await expect(service.update('uid-2', 'entry-1', { body: 'hijack' })).rejects.toMatchObject({
      code: BizCode.ResourceNotFound,
    });
    expect(double.saves).toHaveLength(0);
  });

  // ═════════════════════════════════════════════════════════════
  // ② softDelete / restore
  // ═════════════════════════════════════════════════════════════

  it('A5 · softDelete —— 参数透传 + affected === 0 抛 404', async () => {
    const { service, double } = makeService();
    double.affected = 0;

    await expect(service.softDelete('uid-1', 'entry-1')).rejects.toMatchObject({
      code: BizCode.ResourceNotFound,
    });
    expect(double.softDeletes).toEqual([{ uid: 'uid-1', entryId: 'entry-1' }]);

    double.affected = 1;
    await service.softDelete('uid-1', 'entry-1');
    expect(double.softDeletes).toHaveLength(2);
  });

  it('A6 · restore —— 参数透传 + affected === 0 抛 404 + 成功后按含软删口径回读', async () => {
    const { service, double } = makeService();
    double.affected = 0;

    await expect(service.restore('uid-1', 'entry-1')).rejects.toMatchObject({
      code: BizCode.ResourceNotFound,
    });
    expect(double.restores).toHaveLength(1);

    double.affected = 1;
    double.found = diaryRow({ deletedAt: null });
    const result = await service.restore('uid-1', 'entry-1');

    expect(double.restores).toHaveLength(2);
    expect(double.restores[1]).toEqual({ uid: 'uid-1', entryId: 'entry-1' });
    expect(double.findByIdCalls[0]?.opts?.includeDeleted).toBe(true);
    expect(result.deletedAt).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════
  // ③ getById / getByIdIncludingDeleted
  // ═════════════════════════════════════════════════════════════

  it('A7 · getById / getByIdIncludingDeleted —— 两种读口径的参数形态', async () => {
    const { service, double } = makeService();
    double.found = diaryRow();

    await service.getById('uid-1', 'entry-1');
    expect(double.findByIdCalls[0]?.uid).toBe('uid-1');
    expect(double.findByIdCalls[0]?.entryId).toBe('entry-1');
    // 默认口径 = 第三参不传 (由实现层兜底为「不含软删」)
    expect(double.findByIdCalls[0]?.opts).toBeUndefined();

    await service.getByIdIncludingDeleted('uid-1', 'entry-1');
    expect(double.findByIdCalls[1]?.opts?.includeDeleted).toBe(true);
  });

  it('A8 · getById 未命中 —— 返回 null (不抛错)', async () => {
    const { service, double } = makeService();
    double.found = null;

    const result = await service.getById('uid-1', 'missing');

    expect(result).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════
  // ④ getRecent
  // ═════════════════════════════════════════════════════════════

  it('A9 · getRecent —— 端口收「已解析状态 + 页面条数」, hasMore 与 nextCursor 留 service', async () => {
    const { service, double } = makeService();
    double.recent = [
      diaryRow({ id: 'entry-3', createdAt: new Date('2026-03-03T00:00:00.000Z') }),
      diaryRow({ id: 'entry-2', createdAt: new Date('2026-02-02T00:00:00.000Z') }),
      diaryRow({ id: 'entry-1', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    ];

    const page = await service.getRecent('uid-1', { limit: 2 });

    expect(double.recentQueries[0]?.uid).toBe('uid-1');
    // 状态解析留 service —— 缺省只看 finalized
    expect(double.recentQueries[0]?.statuses).toEqual([DiaryEntryStatus.Finalized]);
    expect(double.recentQueries[0]?.limit).toBe(2);
    expect(double.recentQueries[0]?.cursor).toBeUndefined();
    // 多取一条 → hasMore 由 service 判定, 切片后只回 limit 条
    expect(page.hasMore).toBe(true);
    expect(page.entries).toHaveLength(2);
    // nextCursor 用「页内最后一行」的 createdAt + id 编码
    expect(decodeCursorPayload(page.nextCursor ?? '')).toEqual({
      t: '2026-02-02T00:00:00.000Z',
      i: 'entry-2',
    });
  });

  it('A10 · getRecent —— statusFilter 逗号分隔在 service 解析成多状态', async () => {
    const { service, double } = makeService();

    await service.getRecent('uid-1', { statusFilter: 'draft,finalized' });

    expect(double.recentQueries[0]?.statuses).toEqual([DiaryEntryStatus.Draft, DiaryEntryStatus.Finalized]);
  });

  it('A11 · getRecent —— 游标在 service 解码后交给端口; 非法游标退化为首页', async () => {
    const { service, double } = makeService();
    const cursor = Buffer.from(JSON.stringify({ t: '2026-01-01T00:00:00.000Z', i: 'entry-1' }), 'utf8').toString('base64url');

    await service.getRecent('uid-1', { cursor });
    expect(double.recentQueries[0]?.cursor).toEqual({ t: '2026-01-01T00:00:00.000Z', i: 'entry-1' });

    await service.getRecent('uid-1', { cursor: 'not-a-valid-cursor' });
    expect(double.recentQueries[1]?.cursor).toBeUndefined();
  });

  it('A12 · getRecent —— limit 上限 100 (service 侧 clamp)', async () => {
    const { service, double } = makeService();

    await service.getRecent('uid-1', { limit: 500 });

    expect(double.recentQueries[0]?.limit).toBe(100);
  });

  // ═════════════════════════════════════════════════════════════
  // ⑤ getDrafts / search
  // ═════════════════════════════════════════════════════════════

  it('A13 · getDrafts —— 端口只收 uid (status / 排序 / take 上限在实现层)', async () => {
    const { service, double } = makeService();
    double.drafts = [diaryRow({ id: 'entry-1' })];

    const result = await service.getDrafts('uid-1');

    expect(double.draftLookups).toEqual(['uid-1']);
    expect(result).toHaveLength(1);
  });

  it('A14 · search —— LIKE 模式已转义 + tag 已解析 + hasMore 与 nextCursor 留 service', async () => {
    const { service, double } = makeService();
    double.searched = [
      diaryRow({ id: 'entry-3', createdAt: new Date('2026-03-03T00:00:00.000Z') }),
      diaryRow({ id: 'entry-2', createdAt: new Date('2026-02-02T00:00:00.000Z') }),
      diaryRow({ id: 'entry-1', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    ];

    const page = await service.search('uid-1', { query: 'a%b_c', tagFilters: 'goodMoment,challenge', limit: 2 });

    // 通配符转义留 service —— 端口拿到的是已转义模式
    expect(double.searchQueries[0]?.likePattern).toBe(String.raw`%a\%b\_c%`);
    expect(double.searchQueries[0]?.tagFilters).toEqual([DiaryTag.GoodMoment, DiaryTag.Challenge]);
    expect(double.searchQueries[0]?.uid).toBe('uid-1');
    expect(double.searchQueries[0]?.limit).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.entries).toHaveLength(2);
    expect(decodeCursorPayload(page.nextCursor ?? '')).toEqual({
      t: '2026-02-02T00:00:00.000Z',
      i: 'entry-2',
    });
  });

  // ═════════════════════════════════════════════════════════════
  // ⑥ purgeExpiredSoftDeletes / purgeAll
  // ═════════════════════════════════════════════════════════════

  it('A15 · purgeExpiredSoftDeletes —— 30 天 cutoff 由 service 算, 端口只收算好的日期', async () => {
    const { service, double } = makeService();

    await service.purgeExpiredSoftDeletes();

    expect(double.purges).toHaveLength(1);
    const cutoff = double.purges[0] ?? new Date(0);
    expect(Math.abs(Date.now() - cutoff.getTime() - THIRTY_DAYS_MS)).toBeLessThan(5000);
  });

  it('A16 · purgeExpiredSoftDeletes —— 显式 cutoff 原样透传', async () => {
    const { service, double } = makeService();
    const fixed = new Date('2026-01-01T00:00:00.000Z');

    await service.purgeExpiredSoftDeletes(fixed);

    expect(double.purges[0]).toBe(fixed);
  });

  it('A17 · purgeAll —— 端口按 owner 收 uid, 返回受影响行数', async () => {
    const { service, double } = makeService();
    double.affected = 2;

    const result = await service.purgeAll('uid-1');

    expect(double.authorDeletes).toEqual(['uid-1']);
    expect(result.deletedCount).toBe(2);
  });

  // ═════════════════════════════════════════════════════════════
  // ⑦ 调用次数 / 方法面 / 失败语义
  // ═════════════════════════════════════════════════════════════

  it('A18 · 调用次数口径 —— 每个端口方法各调一次', async () => {
    const { service, double } = makeService();
    double.found = diaryRow();
    double.recent = [diaryRow()];
    double.searched = [diaryRow()];
    double.drafts = [diaryRow()];
    double.affected = 1;

    await service.create('uid-1', { body: 'x' });
    await service.update('uid-1', 'entry-1', { body: 'y' });
    await service.getById('uid-1', 'entry-1');
    await service.getDrafts('uid-1');
    await service.getRecent('uid-1', {});
    await service.search('uid-1', { query: 'x' });
    await service.softDelete('uid-1', 'entry-1');
    await service.purgeAll('uid-1');
    await service.purgeExpiredSoftDeletes();

    expect(double.creates).toHaveLength(1);
    expect(double.saves).toHaveLength(1);
    expect(double.findByIdCalls).toHaveLength(2);
    expect(double.draftLookups).toHaveLength(1);
    expect(double.recentQueries).toHaveLength(1);
    expect(double.searchQueries).toHaveLength(1);
    expect(double.softDeletes).toHaveLength(1);
    expect(double.authorDeletes).toHaveLength(1);
    expect(double.purges).toHaveLength(1);
  });

  it('A19 · 方法面不泛化 —— 端口方法恰为 10 个, 无通用仓储代理', () => {
    const { double } = makeService();

    expect(Object.keys(double.repo).sort()).toEqual([
      'create',
      'deleteByAuthor',
      'findById',
      'findDrafts',
      'listRecent',
      'purgeExpiredSoftDeletes',
      'restore',
      'save',
      'searchEntries',
      'softDelete',
    ]);
    expect(typeof DIARY_ENTRY_REPOSITORY).toBe('symbol');
    expect(DIARY_ENTRY_REPOSITORY.description).toBe('DIARY_ENTRY_REPOSITORY');
  });

  it('A20 · 写入失败时的现有语义 —— 异常上抛 (行为锁)', async () => {
    const { service, double } = makeService();
    double.writeFailure = new Error('db down');

    await expect(service.create('uid-1', { body: 'x' })).rejects.toThrow('db down');
  });
});
