import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// V2026-09-11 治本: 路径修正 — BizExceptionFilter 实位于 src/common/filters/, 不是 common/exceptions/.
//   旧路径解析为 undefined, 触发 no-unsafe-argument (useGlobalFilters(new undefined()) 类型为 any).
import { BizExceptionFilter } from '../src/common/filters/biz-exception.filter.js';

import {
  DIARY_ENTRY_REPOSITORY,
  type CreateDiaryEntryInput,
  type DiaryEntryRepository,
  type DiaryRow,
  type ListRecentEntriesQuery,
  type SearchEntriesQuery,
} from '../src/good_state_diary/domain/repositories/diary-entry.repository.js';
import { DiaryEntryStatus } from '../src/good_state_diary/enums/diary-entry-status.enum.js';
import { DiaryMoodLevel } from '../src/good_state_diary/enums/diary-mood-level.enum.js';
import { DiaryTag } from '../src/good_state_diary/enums/diary-tag.enum.js';
import { GoodStateDiaryModule } from '../src/good_state_diary/good_state_diary.module.js';
import { SentryService } from '../src/shared/infra/observability/index.js';
import { JwtAuthGuard } from '../src/user/guards/jwt-auth.guard.js';

/**
 * V2026-09-11 治本 (好状态日记 · e2e 测试模板):
 *   原因: 心理产品隐私敏感, 端到端测试必须覆盖 4 个核心路径:
 *     1. CRUD + 越权防护 (uid 隔离)
 *     2. 软删除 + 恢复 + 物理擦除
 *     3. 游标分页一致性 (hasMore + nextCursor)
 *     4. AI feedback 边界 (metadata-only, crisisFlag)
 *   修复:
 *     - JwtAuthGuard override, 测试不依赖真 JWT 生成
 *     - 仓储 mock — 不连真 DB, 用 in-memory Map<id, entry>
 *     - 每个 test 前重置 mock 状态, 防止串扰
 *   如何验证: pnpm exec vitest run test/good-state-diary.e2e-spec.ts 全绿,
 *             关键断言覆盖 12 个仓储方法.
 *
 *   反双胞胎:
 *     - 不连真 MySQL / sqlite (连真库时序坑多, e2e 阶段不需要)
 *     - 不依赖 ai-engine (AI feedback P0 stub 自包含)
 *
 *   V2026-09-11 #6 治本 (prettier / max-len=140):
 *     - 整行 > 140 chars 的 await request(...) 链, 拆多行 (单 chain 方法 / 单行)
 *     - 整行 ≤ 140 chars 的 await request(...) 链, 保持单行
 *     - 判据: prettier printWidth=140 与 ESLint max-len=140 双向约束
 *
 *   V2026-11-14 治本 (TD-18 · C2 第二批仓储端口化):
 *     - 内存替身从「typeorm 泛型仓储形状」换成**端口方法面** (10 个方法),
 *       覆盖的 provider 换端口 Symbol —— 10 例 HTTP 断言**逐字未改**
 *     - 本文件位于 test/ 根目录, 两套 vitest 入口 (默认 config / test/vitest.e2e.mts)
 *       均不收集它 (实测 "No test files found"), 属既有组织现状 —— 本单不移动位置、
 *       不改 vitest include/exclude, 适配只为源码与端口化后的 service / module 一致
 */

const TEST_UID = 'test-uid-001';
const OTHER_UID = 'test-uid-002';

/**
 * V2026-09-11 简化版 in-memory 端口替身: 不实现完整检索语义,
 * 只覆盖 e2e 测试需要的 happy path + 越权防护. 复杂断言走 service 单测.
 *
 * V2026-11-14 治本 (TD-18): 替身实现端口 interface (DiaryEntryRepository) ——
 *   方法面与端口一一对应, 编译期即可发现形状漂移.
 */
class InMemoryEntryRepository implements DiaryEntryRepository {
  private entries = new Map<string, DiaryRow>();

  async create(input: CreateDiaryEntryInput): Promise<DiaryRow> {
    const now = new Date();
    const row: DiaryRow = {
      id: crypto.randomUUID(),
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
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.entries.set(row.id, row);
    return row;
  }

  async save(row: DiaryRow): Promise<DiaryRow> {
    const updated: DiaryRow = { ...row, updatedAt: new Date() };
    this.entries.set(updated.id, updated);
    return updated;
  }

  async findById(uid: string, entryId: string, opts?: { includeDeleted?: boolean }): Promise<DiaryRow | null> {
    const row = this.entries.get(entryId);
    if (!row) return null;
    if (row.authorId !== uid) return null;
    if (row.deletedAt && opts?.includeDeleted !== true) return null;
    return row;
  }

  async findDrafts(uid: string): Promise<DiaryRow[]> {
    return Array.from(this.entries.values())
      .filter((e) => e.authorId === uid && e.status === DiaryEntryStatus.Draft && !e.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, 200);
  }

  async listRecent(query: ListRecentEntriesQuery): Promise<DiaryRow[]> {
    let list = Array.from(this.entries.values()).filter(
      (e) => e.authorId === query.uid && !e.deletedAt && query.statuses.includes(e.status),
    );
    list = list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    if (query.cursor) {
      const cursorT = new Date(query.cursor.t).getTime();
      const cursorI = query.cursor.i;
      list = list.filter((e) => e.createdAt.getTime() < cursorT || (e.createdAt.getTime() === cursorT && e.id < cursorI));
    }
    return list.slice(0, query.limit + 1);
  }

  async searchEntries(query: SearchEntriesQuery): Promise<DiaryRow[]> {
    const keyword = query.likePattern.replace(/^%/, '').replace(/%$/, '');
    let list = Array.from(this.entries.values()).filter(
      (e) =>
        e.authorId === query.uid &&
        !e.deletedAt &&
        ((e.title ?? '').includes(keyword) || e.body.includes(keyword)) &&
        query.tagFilters.every((tag) => (e.tags ?? '').split(',').includes(tag)),
    );
    list = list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    if (query.cursor) {
      const cursorT = new Date(query.cursor.t).getTime();
      const cursorI = query.cursor.i;
      list = list.filter((e) => e.createdAt.getTime() < cursorT || (e.createdAt.getTime() === cursorT && e.id < cursorI));
    }
    return list.slice(0, query.limit + 1);
  }

  async softDelete(uid: string, entryId: string): Promise<{ affected: number }> {
    const row = this.entries.get(entryId);
    if (!row || row.authorId !== uid) return { affected: 0 };
    if (row.deletedAt) return { affected: 0 };
    row.deletedAt = new Date();
    return { affected: 1 };
  }

  async restore(uid: string, entryId: string): Promise<{ affected: number }> {
    const row = this.entries.get(entryId);
    if (!row || row.authorId !== uid) return { affected: 0 };
    if (!row.deletedAt) return { affected: 0 };
    row.deletedAt = null;
    return { affected: 1 };
  }

  async deleteByAuthor(uid: string): Promise<{ affected: number }> {
    let affected = 0;
    for (const [id, row] of this.entries.entries()) {
      if (row.authorId === uid) {
        this.entries.delete(id);
        affected += 1;
      }
    }
    return { affected };
  }

  async purgeExpiredSoftDeletes(cutoff: Date): Promise<{ affected: number }> {
    let affected = 0;
    for (const [id, row] of this.entries.entries()) {
      if (row.deletedAt && row.deletedAt < cutoff) {
        this.entries.delete(id);
        affected += 1;
      }
    }
    return { affected };
  }

  clear(): void {
    this.entries.clear();
  }
}

describe('GoodStateDiaryController (e2e)', () => {
  let app: INestApplication;
  let repo: InMemoryEntryRepository;

  beforeAll(async () => {
    repo = new InMemoryEntryRepository();

    // V2026-09-11 治本: SentryService stub — BizExceptionFilter 构造依赖 SentryService,
    //   e2e 不连真 Sentry, 用 noop stub 满足构造并消除 new BizExceptionFilter() 的 unsafe 链.
    //   注意: BizExceptionFilter 只用到 captureException + captureMessage, 但类型上需要满足完整
    //         SentryService shape, 故用 `as unknown as SentryService` 显式断言 (测试 mock 标准做法).
    //   箭头函数体用 `{}` 空块而非显式 `=> undefined`, 规避 unicorn/no-useless-undefined 规则.
    const sentryStub = {
      captureException: (): void => {},
      captureMessage: (): void => {},
    } as unknown as SentryService;

    const moduleFixture = await Test.createTestingModule({
      imports: [GoodStateDiaryModule],
    })
      // V2026-11-14 治本 (TD-18): 覆盖改打**端口 Symbol** —— 端口替身接管全部读写口径.
      .overrideProvider(DIARY_ENTRY_REPOSITORY)
      .useValue(repo)
      // V2026-11-14 治本 (TD-18): forFeature 注册的实体仓储 provider 在模块编译期会被实例化,
      //   其工厂需要 DataSource token; 本 e2e 不连真库, 且本单要求零 typeorm 值符号 /
      //   零 entity import, 故按 token 字符串覆盖掉它 (端口已被上一行覆盖, 该 provider 的产物不会被使用).
      .overrideProvider('GoodStateDiaryEntryRepository')
      .useValue({})
      .overrideProvider(SentryService)
      .useValue(sentryStub)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
          req.headers['user-id'] = req.headers['x-test-uid'] ?? TEST_UID;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    // V2026-09-11 治本: 把 sentryStub 显式传入 filter 构造, 避免 NestJS DI 时
    //   useGlobalFilters(new BizExceptionFilter()) 报 ExceptionFilter<any> 签名错误.
    app.useGlobalFilters(new BizExceptionFilter(sentryStub));
    await app.init();
  });

  beforeEach(() => {
    repo.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  // ════════════════════════════════════════════════════════════════
  // 1. CRUD + 越权防护
  // ════════════════════════════════════════════════════════════════

  describe('POST /diary/entries', () => {
    it('should create a new diary entry', async () => {
      // V2026-11-13 治本 (TD-5): 去掉 (await ...) as HttpResponse 断言 ——
      //   原因: supertest 改成 default import 后, await request(...) 链本身就是
      //         superagent Response 类型; 那层 cast 变成"同类型断言", 被
      //         @typescript-eslint/no-unnecessary-type-assertion 判为冗余.
      //   影响: 运行时逐字不变 (断言是编译期的), .body 仍是 any (与之前一致).
      const res = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: '今天在...', status: DiaryEntryStatus.Finalized })
        .expect(201);

      expect(res.body).toMatchObject({
        authorId: TEST_UID,
        body: '今天在...',
        status: DiaryEntryStatus.Finalized,
        isPrivate: true,
      });
      expect(res.body.id).toBeDefined();
    });

    it('should reject body longer than 5000 chars', async () => {
      const longBody = 'a'.repeat(5001);
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 159 > 140)
      const res = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: longBody })
        .expect(400);
      // V2026-09-11 治本: sonarjs/assertions-in-tests 要求显式 expect(),
      //   .expect(N) 链式不算. 加 status 二次断言, 同时验证 res 访问 .status 安全.
      expect(res.status).toBe(400);
    });

    it('should silently drop unknown tags', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 200 > 140)
      const res = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'test', tags: [DiaryTag.GoodMoment, 'unknownTag'] })
        .expect(201);

      expect(res.body.tags).toEqual([DiaryTag.GoodMoment]);
    });
  });

  describe('GET /diary/entries/:id (越权防护)', () => {
    it('should 404 when accessing another user entry', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 164 > 140)
      const created = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'private' })
        .expect(201);

      // V2026-09-11 #6 治本: 整行 153 > 140, 拆多行 (v5 误判 ≤140, 已修)
      const res = await request(app.getHttpServer()).get(`/diary/entries/${created.body.id}`).set('X-Test-Uid', OTHER_UID).expect(404);
      // V2026-11-13 治本: 显式断言 — sonarjs 兜底.
      expect(res.status).toBe(404);
    });

    it('should return entry to owner', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 164 > 140)
      const created = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'private' })
        .expect(201);

      // V2026-09-11 #6 治本: 整行 152 > 140, 拆多行 (v5 误判, 已修)
      const res = await request(app.getHttpServer()).get(`/diary/entries/${created.body.id}`).set('X-Test-Uid', TEST_UID).expect(200);

      expect(res.body.id).toBe(created.body.id);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 2. 软删除 + 恢复 + 物理擦除
  // ════════════════════════════════════════════════════════════════

  describe('DELETE /diary/entries/:id (软删除)', () => {
    it('should soft delete and exclude from default get', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 168 > 140)
      const created = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'will delete' })
        .expect(201);

      // V2026-09-11 #6 治本: 整行 158 > 140, 拆多行 (v5 误判, 已修)
      const delRes = await request(app.getHttpServer()).delete(`/diary/entries/${created.body.id}`).set('X-Test-Uid', TEST_UID).expect(204);
      // V2026-09-11 治本: 显式断言 — sonarjs 兜底, 同时验证软删状态码契约.
      expect(delRes.status).toBe(204);

      // V2026-09-11 #6 治本: 整行 155 > 140, 拆多行 (v5 误判, 已修)
      const getRes = await request(app.getHttpServer()).get(`/diary/entries/${created.body.id}`).set('X-Test-Uid', TEST_UID).expect(404);
      expect(getRes.status).toBe(404);
    });

    it('should restore after soft delete', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 167 > 140)
      const created = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'restore me' })
        .expect(201);

      // V2026-09-11 #6 治本: 整行 166 > 140, 拆多行 (v5 误判, 已修)
      await request(app.getHttpServer()).delete(`/diary/entries/${created.body.id}`).set('X-Test-Uid', TEST_UID).expect(204);

      // V2026-09-11 #6 治本: 整行 158 > 140, 拆多行 (v5 误判, 已修)
      const restored = await request(app.getHttpServer())
        .post(`/diary/entries/${created.body.id}/restore`)
        .set('X-Test-Uid', TEST_UID)
        .expect(200);

      expect(restored.body.deletedAt).toBeNull();
    });
  });

  describe('DELETE /diary/entries/all', () => {
    it('should purge all user entries', async () => {
      // V2026-09-11 #6 治本: for 循环里 await + 6 空格缩进, 整行 163 > 140, 拆多行
      for (let i = 0; i < 3; i += 1) {
        await request(app.getHttpServer())
          .post('/diary/entries')
          .set('X-Test-Uid', TEST_UID)
          .send({ body: `entry ${i}` })
          .expect(201);
      }

      // V2026-09-11 #6 治本: 整行 163 > 140, 拆多行 (v5 误判, 已修)
      const res = await request(app.getHttpServer()).delete('/diary/entries/all').set('X-Test-Uid', TEST_UID).expect(200);

      expect(res.body.deletedCount).toBe(3);

      // V2026-09-11 #6 治本: 整行 163 > 140, 拆多行 (v5 误判, 已修)
      const list = await request(app.getHttpServer())
        .get('/diary/entries?statusFilter=draft,finalized')
        .set('X-Test-Uid', TEST_UID)
        .expect(200);

      expect(list.body.entries).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 3. AI feedback 边界 (metadata-only + crisisFlag)
  // ════════════════════════════════════════════════════════════════

  describe('POST /ai/diary-feedback', () => {
    it('should generate feedback with crisisFlag=true when moodHint=crisis', async () => {
      // V2026-09-11 #6 治本: await 表达式链整行 253 > 140 (含中文 moodSnapshot), 拆多行
      const created = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({
          body: '难受到需要支持',
          moodSnapshot: { level: DiaryMoodLevel.Crisis, snapshottedAt: new Date().toISOString() },
        })
        .expect(201);

      // V2026-09-11 #6 治本: await 表达式链 .send({ entryId, themes, moodHint, localSummary, tags })
      //   拆多行 (object literal 必拆, prettier 自动)
      const res = await request(app.getHttpServer())
        .post('/ai/diary-feedback')
        .set('X-Test-Uid', TEST_UID)
        .send({
          // V2026-09-11 治本: created.body.id 是 any (superagent Response.body 未类型化),
          //   显式 as string 消除 no-unsafe-assignment (对象字面量属性赋值触发规则).
          entryId: created.body.id as string,
          themes: ['压力'],
          moodHint: DiaryMoodLevel.Crisis,
          localSummary: '今天状态很差',
          tags: [DiaryTag.Challenge],
        })
        .expect(200);

      expect(res.body.crisisFlag).toBe(true);
      expect(res.body.perspectiveQuestions).toHaveLength(3);
      expect(res.body.source).toBe('cloud');
    });

    it('should 404 when entry does not belong to user', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 164 > 140)
      const created = await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'private' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/ai/diary-feedback')
        .set('X-Test-Uid', OTHER_UID)
        .send({
          entryId: created.body.id as string,
          themes: [],
          localSummary: '',
          tags: [],
        })
        .expect(404);
      // V2026-11-13 治本: 显式断言 — sonarjs 兜底.
      expect(res.status).toBe(404);
    });
  });
});
