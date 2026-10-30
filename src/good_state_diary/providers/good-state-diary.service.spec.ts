import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { vi } from 'vitest';

import { GoodStateDiaryService } from './good-state-diary.service';
import { BizCode } from '../../common/exceptions/biz-code.enum';

import { GoodStateDiaryEntry } from '../entities/good-state-diary-entry.entity';
import { DiaryEntryStatus } from '../enums/diary-entry-status.enum';
import { DiaryMoodLevel } from '../enums/diary-mood-level.enum';
import { DiaryTag } from '../enums/diary-tag.enum';

/**
 * V2026-09-11 治本 (好状态日记 · 服务单测模板):
 *   原因: 单测聚焦业务逻辑 (cursor 编解码 / 边界校验 / 软删判定),
 *         比 e2e 快 10x, 改 service 内部实现时回归保护.
 *   修复:
 *     - Repository 用 vi.fn mock, 不连真 DB
 *     - 覆盖所有 public 方法的 happy path + 关键 error path (越权 / 软删 / 入参校验)
 *     - 不测 DTO 校验 (那是 ValidationPipe 的活, 单元测不到)
 *   反双胞胎:
 *     - 不测 controller (e2e 已覆盖 HTTP 层)
 *     - 不测 AI service (它依赖日记 service 的 findOwnedOrThrow, 单测时拆开测)
 *
 *   反依赖污染:
 *     - mock repo 字段都按 TypeORM entity 定义, 避免编译时类型断言漏字段
 */

interface MockEntry extends GoodStateDiaryEntry {
  // 完全对齐
}

function makeMockRepo() {
  const store: MockEntry[] = [];
  return {
    store,
    create: vi.fn((partial: Partial<MockEntry>) => {
      const now = new Date();
      return {
        id: partial.id ?? crypto.randomUUID(),
        ...partial,
        createdAt: partial.createdAt ?? now,
        updatedAt: partial.updatedAt ?? now,
      } as MockEntry;
    }),
    save: vi.fn(async (entity: MockEntry) => {
      Object.assign(entity, { updatedAt: new Date() });
      const idx = store.findIndex((e) => e.id === entity.id);
      if (idx === -1) {
        store.push(entity);
      } else {
        store[idx] = entity;
      }
      return entity;
    }),
    findOne: vi.fn(async (opts: { where: { id: string; authorId: string }; withDeleted?: boolean }) => {
      const e = store.find((x) => x.id === opts.where.id);
      if (!e) return null;
      if (e.authorId !== opts.where.authorId) return null;
      if (e.deletedAt && !opts.withDeleted) return null;
      return e;
    }),
    softDelete: vi.fn(async (criteria: { id: string; authorId: string }) => {
      const e = store.find((x) => x.id === criteria.id);
      if (!e || e.authorId !== criteria.authorId) return { affected: 0 };
      e.deletedAt = new Date();
      return { affected: 1 };
    }),
    restore: vi.fn(async (criteria: { id: string; authorId: string }) => {
      const e = store.find((x) => x.id === criteria.id);
      if (!e || e.authorId !== criteria.authorId) return { affected: 0 };
      e.deletedAt = null;
      return { affected: 1 };
    }),
    delete: vi.fn(async (criteria: { authorId: string }) => {
      const before = store.length;
      const filtered = store.filter((e) => e.authorId !== criteria.authorId);
      store.length = 0;
      store.push(...filtered);
      return { affected: before - store.length };
    }),
    find: vi.fn(
      async (opts: { where: Partial<MockEntry>; order?: Record<string, 'ASC' | 'DESC'>; take?: number; withDeleted?: boolean }) => {
        let list = store.slice();
        for (const [k, v] of Object.entries(opts.where)) {
          // V2026-10-24 治本 (TS2352): MockEntry 没有索引签名, 直接断言成
          //   Record<string, unknown> 不被 TS 认可 → 必须先过 unknown 一道.
          list = list.filter((e) => (e as unknown as Record<string, unknown>)[k] === v);
        }
        if (!opts.withDeleted) list = list.filter((e) => !e.deletedAt);
        // V2026-10-24 治本 (TS4111): order 是 Record<string, 'ASC'|'DESC'>,
        //   属性来自索引签名 → 必须用 bracket 访问.
        if (opts.order?.['createdAt'])
          list.sort((a, b) =>
            opts.order!['createdAt'] === 'DESC'
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime(),
          );
        if (opts.take !== undefined) list = list.slice(0, opts.take);
        return list;
      },
    ),
    createQueryBuilder: vi.fn(),
  };
}

/**
 * V2026-10-26 治本 (QueryBuilder mock 补 author / status 过滤 — 之前完全不过滤):
 *   原因: 旧 mock 的 `getMany` 直接 `return store.slice()` —— 一条过滤都不做,
 *     于是 service.getRecent 的 SQL 过滤 (`e.author_id = :uid` / `e.status IN (...)`)
 *     在单测里是**假的**:
 *       - 「默认只看 finalized」拿到的却是全部条目 → 直接变红
 *       - purgeAll 的跨用户断言是**侥幸通过**的 —— 它通过, 只是因为 purgeAll 真的把
 *         本人的行从 store 里删掉了, **不是**因为查询带了 author 过滤
 *   修法: mock 记录 where/andWhere 传进来的参数, getMany 时按 author + status 过滤.
 *     这两条是 service 每次都必带的, 也是这个单测真正要验的那两条.
 *     cursor 条件**故意不实现**: 本文件没有 cursor 用例, 实现了也没人验 (留着占位).
 */
function setupQueryBuilderMock(repo: ReturnType<typeof makeMockRepo>, store: MockEntry[]) {
  // V2026-10-26 治本 (TS7022/TS7024 — 自引用对象必须**显式标注类型**):
  //   `qb` 的成员要 `return qb` (链式调用), 若让 TS 去**推断** qb 的类型, 就成了
  //   「qb 的类型依赖 qb 自己的初始化器」的循环 → TS7022 (qb 隐式 any) + TS7024 (返回 any).
  //   治本: 把形状抽成显式 interface —— 类型是**声明**出来的, 不是推断出来的, 循环自然断开.
  interface QueryBuilderMock {
    where: vi.Mock<QueryBuilderMock, [string, Record<string, unknown>?]>;
    andWhere: vi.Mock<QueryBuilderMock, [string, Record<string, unknown>?]>;
    orderBy: vi.Mock<QueryBuilderMock, [string, string]>;
    addOrderBy: vi.Mock<QueryBuilderMock, [string, string]>;
    limit: vi.Mock<QueryBuilderMock, [number]>;
    getMany: vi.Mock<Promise<MockEntry[]>>;
    delete: vi.Mock<QueryBuilderMock>;
    execute: vi.Mock<Promise<{ affected: number }>>;
  }

  repo.createQueryBuilder = vi.fn(() => {
    // V2026-10-26 治本: 过滤条件**每次建 QB 都要新建** ——
    //   建在工厂外面的话, 上一条查询留下的 status 过滤会漏进下一条 (service.search
    //   不带 status 过滤, 却被上一次 getRecent 的 status 条件污染).
    const filters: { authorId?: string; statuses?: string[] } = {};
    const qb: QueryBuilderMock = {
      where: vi.fn((clause: string, params?: Record<string, unknown>) => {
        // V2026-10-26 治本 (TS4111): params 是索引签名 → 必须方括号访问.
        if (clause.includes('e.author_id') && typeof params?.['uid'] === 'string') {
          filters.authorId = params['uid'];
        }
        return qb;
      }),
      andWhere: vi.fn((clause: string, params?: Record<string, unknown>) => {
        if (clause.includes('e.status IN') && Array.isArray(params?.['statuses'])) {
          filters.statuses = params['statuses'] as string[];
        }
        return qb;
      }),
      orderBy: vi.fn((_clause: string, _dir: string): QueryBuilderMock => qb),
      addOrderBy: vi.fn((_clause: string, _dir: string): QueryBuilderMock => qb),
      limit: vi.fn((_n: number): QueryBuilderMock => qb),
      getMany: vi.fn(async () => {
        let list = store.slice();
        if (filters.authorId !== undefined) {
          list = list.filter((e) => e.authorId === filters.authorId);
        }
        // 局部 const 收窄 (不在回调里读 filters.statuses, 避免非空断言).
        const statuses = filters.statuses;
        if (statuses !== undefined) {
          list = list.filter((e) => statuses.includes(e.status));
        }
        return list;
      }),
      delete: vi.fn((): QueryBuilderMock => qb),
      execute: vi.fn(async () => ({ affected: store.length })),
    };
    return qb;
  });
}

describe('GoodStateDiaryService', () => {
  let service: GoodStateDiaryService;
  let repo: ReturnType<typeof makeMockRepo>;
  let store: MockEntry[];

  const TEST_UID = 'test-uid-001';
  const OTHER_UID = 'test-uid-002';

  beforeEach(async () => {
    repo = makeMockRepo();
    store = repo.store;
    setupQueryBuilderMock(repo, store);

    const moduleRef = await Test.createTestingModule({
      providers: [GoodStateDiaryService, { provide: getRepositoryToken(GoodStateDiaryEntry), useValue: repo }],
    }).compile();

    service = moduleRef.get(GoodStateDiaryService);
  });

  // ════════════════════════════════════════════════════════════════
  // create
  // ════════════════════════════════════════════════════════════════

  describe('create', () => {
    it('should create entry with default status=draft + isPrivate=true', async () => {
      const result = await service.create(TEST_UID, { body: 'hello' });
      expect(result.status).toBe(DiaryEntryStatus.Draft);
      expect(result.isPrivate).toBe(true);
      expect(result.authorId).toBe(TEST_UID);
    });

    it('should encode tag list as comma-separated', async () => {
      const result = await service.create(TEST_UID, {
        body: 'tagged',
        tags: [DiaryTag.GoodMoment, DiaryTag.Gratitude],
      });
      expect(result.tags).toEqual([DiaryTag.GoodMoment, DiaryTag.Gratitude]);
    });

    it('should handle moodSnapshot with all fields', async () => {
      const snapshottedAt = '2026-09-11T10:00:00.000Z';
      const result = await service.create(TEST_UID, {
        body: 'with mood',
        moodSnapshot: {
          level: DiaryMoodLevel.Low,
          snapshottedAt,
          note: '刚吵完架',
          sourceEmotionLogId: 'emo-log-001',
        },
      });
      expect(result.moodSnapshot).toMatchObject({
        level: DiaryMoodLevel.Low,
        note: '刚吵完架',
        sourceEmotionLogId: 'emo-log-001',
      });
    });
  });

  // ════════════════════════════════════════════════════════════════
  // update — partial update + 防越权
  // ════════════════════════════════════════════════════════════════

  describe('update', () => {
    let entryId: string;

    beforeEach(async () => {
      const created = await service.create(TEST_UID, { body: 'original', status: DiaryEntryStatus.Finalized });
      entryId = created.id;
    });

    it('should update body and status', async () => {
      const updated = await service.update(TEST_UID, entryId, {
        body: 'updated',
        status: DiaryEntryStatus.Draft,
      });
      expect(updated.body).toBe('updated');
      expect(updated.status).toBe(DiaryEntryStatus.Draft);
    });

    it('should allow clearing moodSnapshot by setting to null', async () => {
      await service.update(TEST_UID, entryId, {
        moodSnapshot: {
          level: DiaryMoodLevel.Low,
          snapshottedAt: '2026-09-11T10:00:00.000Z',
        },
      });
      const cleared = await service.update(TEST_UID, entryId, { moodSnapshot: null });
      expect(cleared.moodSnapshot).toBeNull();
    });

    it('should throw 404 when updating another user entry', async () => {
      // V2026-10-26 治本: 断言字段名从 `bizCode` 改成 `code` ——
      //   BizException 的业务码字段就叫 `code` (public readonly code: BizCode),
      //   `bizCode` 从来不存在, 这条断言**从来没生效过** (toMatchObject 匹配不到就红).
      //   上一个 commit (af1ccfa) 把仓库其余套件统一改成了 `code`, 漏了这个文件.
      await expect(service.update(OTHER_UID, entryId, { body: 'hijack' })).rejects.toMatchObject({ code: BizCode.ResourceNotFound });
    });

    it('should throw 404 when updating soft-deleted entry', async () => {
      await service.softDelete(TEST_UID, entryId);
      await expect(service.update(TEST_UID, entryId, { body: 'after delete' })).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });
  });

  // ════════════════════════════════════════════════════════════════
  // softDelete + restore
  // ════════════════════════════════════════════════════════════════

  describe('softDelete + restore', () => {
    it('should soft delete and exclude from getById', async () => {
      const created = await service.create(TEST_UID, { body: 'doomed' });
      await service.softDelete(TEST_UID, created.id);

      const found = await service.getById(TEST_UID, created.id);
      expect(found).toBeNull();
    });

    it('should restore and re-include in getById', async () => {
      const created = await service.create(TEST_UID, { body: 'restore' });
      await service.softDelete(TEST_UID, created.id);

      const restored = await service.restore(TEST_UID, created.id);
      expect(restored.deletedAt).toBeNull();

      const found = await service.getById(TEST_UID, created.id);
      expect(found).not.toBeNull();
    });

    it('should 404 when restoring another user entry', async () => {
      const created = await service.create(TEST_UID, { body: 'private' });
      await service.softDelete(TEST_UID, created.id);

      await expect(service.restore(OTHER_UID, created.id)).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });
  });

  // ════════════════════════════════════════════════════════════════
  // getRecent — statusFilter + limit cap
  // ════════════════════════════════════════════════════════════════

  describe('getRecent', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i += 1) {
        await service.create(TEST_UID, { body: `finalized ${i}`, status: DiaryEntryStatus.Finalized });
      }
      for (let i = 0; i < 2; i += 1) {
        await service.create(TEST_UID, { body: `draft ${i}`, status: DiaryEntryStatus.Draft });
      }
    });

    it('should default to status=finalized only', async () => {
      const page = await service.getRecent(TEST_UID, {});
      // V2026-09-11 治本 (sonarjs/prefer-specific-assertions):
      //   .length.toBe() → toHaveLength(), 失败时报错更精确.
      expect(page.entries).toHaveLength(5);
      expect(page.entries.every((e) => e.status === DiaryEntryStatus.Finalized)).toBe(true);
    });

    it('should include both statuses when statusFilter has both', async () => {
      const page = await service.getRecent(TEST_UID, { statusFilter: 'draft,finalized' });
      expect(page.entries).toHaveLength(7);
    });

    it('should clamp limit to 100', async () => {
      const page = await service.getRecent(TEST_UID, { limit: 500 });
      expect(page.entries.length).toBeLessThanOrEqual(100);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // purgeAll — 一键清除本人全部
  // ════════════════════════════════════════════════════════════════

  describe('purgeAll', () => {
    it('should only purge current user entries', async () => {
      await service.create(TEST_UID, { body: 'mine 1' });
      await service.create(TEST_UID, { body: 'mine 2' });
      await service.create(OTHER_UID, { body: 'theirs' });

      const result = await service.purgeAll(TEST_UID);
      expect(result.deletedCount).toBe(2);

      const others = await service.getRecent(OTHER_UID, { statusFilter: 'draft,finalized' });
      expect(others.entries).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // BizException 错误码
  // ════════════════════════════════════════════════════════════════

  describe('error codes', () => {
    it('should use BizCode.ResourceNotFound for 404', async () => {
      // V2026-09-11 治本 (jest/no-jasmine-globals + jest/no-conditional-expect):
      //   原写法 `try { ...; fail(); } catch (e) { expect(...) }` 被两个 rule 同时 hit:
      //     - jest/no-jasmine-globals: `fail` 是 Jasmine 全局, jest 应当抛异常或 throw new Error
      //     - jest/no-conditional-expect: catch 块里 conditional expect 不可控
      //   改用 `await expect(...).rejects.toMatchObject({...})` 一行写完, 语义不变, lint 双过.
      await expect(service.update(TEST_UID, 'non-existent', { body: 'x' })).rejects.toMatchObject({ code: BizCode.ResourceNotFound });
    });
  });
});
