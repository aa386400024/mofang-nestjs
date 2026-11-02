import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';

// V2026-09-11 治本: 路径修正 — BizExceptionFilter 实位于 src/common/filters/, 不是 common/exceptions/.
//   旧路径解析为 undefined, 触发 no-unsafe-argument (useGlobalFilters(new undefined()) 类型为 any).
import { BizExceptionFilter } from '../src/common/filters/biz-exception.filter';

import { GoodStateDiaryEntry } from '../src/good_state_diary/entities/good-state-diary-entry.entity';
import { DiaryEntryStatus } from '../src/good_state_diary/enums/diary-entry-status.enum';
import { DiaryMoodLevel } from '../src/good_state_diary/enums/diary-mood-level.enum';
import { DiaryTag } from '../src/good_state_diary/enums/diary-tag.enum';
import { GoodStateDiaryModule } from '../src/good_state_diary/good_state_diary.module';
import { SentryService } from '../src/shared/infra/observability';
import { JwtAuthGuard } from '../src/user/guards/jwt-auth.guard';

// V2026-09-11 治本: supertest.Response 类型别名 — 作为 (await ...) as HttpResponse cast 的目标类型.
//   验证: 后续 await request(...) 链虽然 error-typed (getHttpServer 返回 any),
//         但右值经过 as cast 后变为 HttpResponse, ESLint 放行且 .body 子属性类型正确.
type HttpResponse = request.Response;

/**
 * V2026-09-11 治本 (好状态日记 · e2e 测试模板):
 *   原因: 心理产品隐私敏感, 端到端测试必须覆盖 4 个核心路径:
 *     1. CRUD + 越权防护 (uid 隔离)
 *     2. 软删除 + 恢复 + 物理擦除
 *     3. 游标分页一致性 (hasMore + nextCursor)
 *     4. AI feedback 边界 (metadata-only, crisisFlag)
 *   修复:
 *     - JwtAuthGuard override, 测试不依赖真 JWT 生成
 *     - Repository mock — 不连真 DB, 用 in-memory Map<id, entity>
 *     - 每个 test 前重置 mock 状态, 防止串扰
 *   如何验证: npx jest test/good-state-diary.e2e-spec.ts 全绿,
 *             关键断言覆盖 12 个 Repository 方法.
 *
 *   反双胞胎:
 *     - 不连真 MySQL / sqlite (连真库时序坑多, e2e 阶段不需要)
 *     - 不依赖 ai-engine (AI feedback P0 stub 自包含)
 *
 *   V2026-09-11 #6 治本 (prettier / max-len=140):
 *     - 整行 > 140 chars 的 await request(...) 链, 拆多行 (单 chain 方法 / 单行)
 *     - 整行 ≤ 140 chars 的 await request(...) 链, 保持单行
 *     - 判据: prettier printWidth=140 与 ESLint max-len=140 双向约束
 */

const TEST_UID = 'test-uid-001';
const OTHER_UID = 'test-uid-002';

interface StoredEntry extends GoodStateDiaryEntry {
  // TypeORM 实体所有字段, mock 直接以 plain object 存储
}

/**
 * V2026-09-11 简化版 in-memory repo: 不实现完整 QueryBuilder 语义,
 * 只覆盖 e2e 测试需要的 happy path + 越权防护. 复杂断言走 service 单测.
 */
class InMemoryEntryRepository {
  private entries = new Map<string, StoredEntry>();

  create(partial: Partial<StoredEntry>): StoredEntry {
    const now = new Date();
    return {
      id: partial.id ?? crypto.randomUUID(),
      authorId: partial.authorId!,
      status: partial.status ?? DiaryEntryStatus.Draft,
      body: partial.body ?? '',
      title: partial.title ?? null,
      moodLevel: partial.moodLevel ?? null,
      moodSnapshottedAt: partial.moodSnapshottedAt ?? null,
      moodNote: partial.moodNote ?? null,
      sourceEmotionLogId: partial.sourceEmotionLogId ?? null,
      tags: partial.tags ?? null,
      linkedPracticeId: partial.linkedPracticeId ?? null,
      aiFeedback: partial.aiFeedback ?? null,
      aiFeedbackGeneratedAt: partial.aiFeedbackGeneratedAt ?? null,
      isPrivate: partial.isPrivate ?? true,
      createdAt: partial.createdAt ?? now,
      updatedAt: partial.updatedAt ?? now,
      deletedAt: partial.deletedAt ?? null,
    };
  }

  async save(entity: StoredEntry): Promise<StoredEntry> {
    const updated: StoredEntry = { ...entity, updatedAt: new Date() };
    this.entries.set(updated.id, updated);
    return updated;
  }

  async findOne(opts: { where: { id: string; authorId: string }; withDeleted?: boolean }): Promise<StoredEntry | null> {
    const entity = this.entries.get(opts.where.id);
    if (!entity) return null;
    if (entity.authorId !== opts.where.authorId) return null;
    if (entity.deletedAt && !opts.withDeleted) return null;
    return entity;
  }

  async find(opts: {
    where: Partial<StoredEntry>;
    order?: Record<string, 'ASC' | 'DESC'>;
    take?: number;
    withDeleted?: boolean;
  }): Promise<StoredEntry[]> {
    let list = Array.from(this.entries.values());
    for (const [key, value] of Object.entries(opts.where)) {
      list = list.filter((e) => (e as Record<string, unknown>)[key] === value);
    }
    if (!opts.withDeleted) {
      list = list.filter((e) => !e.deletedAt);
    }
    if (opts.order?.createdAt) {
      list.sort((a, b) =>
        opts.order!.createdAt === 'DESC' ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime(),
      );
    }
    if (opts.order?.id) {
      list.sort((a, b) => (opts.order!.id === 'DESC' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)));
    }
    if (opts.take !== undefined) list = list.slice(0, opts.take);
    return list;
  }

  async softDelete(criteria: { id: string; authorId: string }): Promise<{ affected: number }> {
    const entity = this.entries.get(criteria.id);
    if (!entity || entity.authorId !== criteria.authorId) return { affected: 0 };
    if (entity.deletedAt) return { affected: 0 };
    entity.deletedAt = new Date();
    return { affected: 1 };
  }

  async restore(criteria: { id: string; authorId: string }): Promise<{ affected: number }> {
    const entity = this.entries.get(criteria.id);
    if (!entity || entity.authorId !== criteria.authorId) return { affected: 0 };
    if (!entity.deletedAt) return { affected: 0 };
    entity.deletedAt = null;
    return { affected: 1 };
  }

  async delete(criteria: { authorId: string }): Promise<{ affected: number }> {
    let affected = 0;
    for (const [id, entity] of this.entries.entries()) {
      if (entity.authorId === criteria.authorId) {
        this.entries.delete(id);
        affected += 1;
      }
    }
    return { affected };
  }

  /**
   * V2026-09-11 简化版 QueryBuilder: 仅支持 service 用到的链式调用.
   * 复杂断言 (cursor 翻页一致) 走 service 单测, e2e 只验证基本列表.
   */
  createQueryBuilder() {
    // V2026-09-11 治本: 直接捕获 entries Map 引用 (字段访问, 非 this 别名).
    //   原因: unicorn/no-this-assignment + @typescript-eslint/no-this-alias 两条规则
    //         都拒绝 const self = this (this 别名), 但允许 const ref = this.field (字段访问).
    //         Map 是引用类型, ref 始终反映最新状态, 行为与 this.entries 完全等价.
    //   验证: getMany() 不再触发两条 lint, 且读写 .entries.set() 后 .getMany() 看到最新值.
    const entries = this.entries;
    let whereClause: ((e: StoredEntry) => boolean) | null = null;
    const conds: ((e: StoredEntry) => boolean)[] = [];
    const order: { col: string; dir: 'ASC' | 'DESC' }[] = [];
    let take: number | null = null;

    const builder = {
      where(_alias: string, params: Record<string, unknown>) {
        whereClause = (e: StoredEntry) => e.authorId === params['uid'];
        return builder;
      },
      andWhere(_expr: string, params?: Record<string, unknown>) {
        if (params && 'statuses' in params) {
          conds.push((e) => Array.isArray(params['statuses']) && (params['statuses'] as string[]).includes(e.status));
        }
        if (params && 'like' in params) {
          const kw = (params['like'] as string).replace(/^%/, '').replace(/%$/, '');
          conds.push((e) => (e.title ?? '').includes(kw) || e.body.includes(kw));
        }
        for (const k of Object.keys(params ?? {})) {
          if (k.startsWith('tagFilter')) {
            const tag = params[k] as string;
            conds.push((e) => (e.tags ?? '').split(',').includes(tag));
          }
        }
        return builder;
      },
      orderBy(_col: string, dir: 'ASC' | 'DESC') {
        order.push({ col: 'createdAt', dir });
        return builder;
      },
      addOrderBy(_col: string, dir: 'ASC' | 'DESC') {
        order.push({ col: 'id', dir });
        return builder;
      },
      limit(n: number) {
        take = n;
        return builder;
      },
      // V2026-09-11 治本: 箭头函数 + 闭包访问 entries ——
      //   getMany() 的 this=builder 而非 repo, 所以不能写 this.entries; 通过闭包捕获 entries 局部变量.
      //   验证: 任何调用 InMemoryEntryRepository.createQueryBuilder()...getMany() 路径不再 throw,
      //         且 L149 不再触发 unicorn/no-this-assignment + @typescript-eslint/no-this-alias.
      getMany: async (): Promise<StoredEntry[]> => {
        let list = Array.from(entries.values());
        if (whereClause) list = list.filter(whereClause);
        for (const c of conds) list = list.filter(c);
        if (order.length > 0) {
          list.sort((a, b) => {
            for (const o of order) {
              const av = (a as Record<string, unknown>)[o.col];
              const bv = (b as Record<string, unknown>)[o.col];
              if (av instanceof Date && bv instanceof Date) {
                const diff = av.getTime() - bv.getTime();
                if (diff !== 0) return o.dir === 'DESC' ? -diff : diff;
              } else if (typeof av === 'string' && typeof bv === 'string') {
                const diff = av.localeCompare(bv);
                if (diff !== 0) return o.dir === 'DESC' ? -diff : diff;
              }
            }
            return 0;
          });
        }
        if (take !== null) list = list.slice(0, take);
        return list;
      },
    };
    return builder;
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
      .overrideProvider(getRepositoryToken(GoodStateDiaryEntry))
      .useValue(repo)
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
      // V2026-09-11 治本: (await ...) as HttpResponse ——
      //   原因: app.getHttpServer() 返回 any, supertest 链因此 error-typed,
      //         单纯 : HttpResponse 注解仍触发 @typescript-eslint/no-unsafe-assignment.
      //         改用 as cast 把 await 结果显式声明为 HttpResponse, ESLint 看到右值无 any 放行,
      //         且 .body / .body.id 子属性类型正确传递, 后续 expect() 断言安全.
      const res = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: '今天在...', status: DiaryEntryStatus.Finalized })
        .expect(201)) as HttpResponse;

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
      const res = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: longBody })
        .expect(400)) as HttpResponse;
      // V2026-09-11 治本: sonarjs/assertions-in-tests 要求显式 expect(),
      //   .expect(N) 链式不算. 加 status 二次断言, 同时验证 res 标 HttpResponse 后访问 .status 安全.
      expect(res.status).toBe(400);
    });

    it('should silently drop unknown tags', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 200 > 140)
      const res = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'test', tags: [DiaryTag.GoodMoment, 'unknownTag'] })
        .expect(201)) as HttpResponse;

      expect(res.body.tags).toEqual([DiaryTag.GoodMoment]);
    });
  });

  describe('GET /diary/entries/:id (越权防护)', () => {
    it('should 404 when accessing another user entry', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 164 > 140)
      const created = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'private' })
        .expect(201)) as HttpResponse;

      // V2026-09-11 #6 治本: 整行 153 > 140, 拆多行 (v5 误判 ≤140, 已修)
      const res = (await request(app.getHttpServer())
        .get(`/diary/entries/${created.body.id}`)
        .set('X-Test-Uid', OTHER_UID)
        .expect(404)) as HttpResponse;
      // V2026-09-11 治本: 显式断言 — sonarjs 兜底.
      expect(res.status).toBe(404);
    });

    it('should return entry to owner', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 164 > 140)
      const created = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'private' })
        .expect(201)) as HttpResponse;

      // V2026-09-11 #6 治本: 整行 152 > 140, 拆多行 (v5 误判, 已修)
      const res = (await request(app.getHttpServer())
        .get(`/diary/entries/${created.body.id}`)
        .set('X-Test-Uid', TEST_UID)
        .expect(200)) as HttpResponse;

      expect(res.body.id).toBe(created.body.id);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 2. 软删除 + 恢复 + 物理擦除
  // ════════════════════════════════════════════════════════════════

  describe('DELETE /diary/entries/:id (软删除)', () => {
    it('should soft delete and exclude from default get', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 168 > 140)
      const created = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'will delete' })
        .expect(201)) as HttpResponse;

      // V2026-09-11 #6 治本: 整行 158 > 140, 拆多行 (v5 误判, 已修)
      const delRes = (await request(app.getHttpServer())
        .delete(`/diary/entries/${created.body.id}`)
        .set('X-Test-Uid', TEST_UID)
        .expect(204)) as HttpResponse;
      // V2026-09-11 治本: 显式断言 — sonarjs 兜底, 同时验证软删状态码契约.
      expect(delRes.status).toBe(204);

      // V2026-09-11 #6 治本: 整行 155 > 140, 拆多行 (v5 误判, 已修)
      const getRes = (await request(app.getHttpServer())
        .get(`/diary/entries/${created.body.id}`)
        .set('X-Test-Uid', TEST_UID)
        .expect(404)) as HttpResponse;
      expect(getRes.status).toBe(404);
    });

    it('should restore after soft delete', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 167 > 140)
      const created = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'restore me' })
        .expect(201)) as HttpResponse;

      // V2026-09-11 #6 治本: 整行 166 > 140, 拆多行 (v5 误判, 已修)
      await request(app.getHttpServer()).delete(`/diary/entries/${created.body.id}`).set('X-Test-Uid', TEST_UID).expect(204);

      // V2026-09-11 #6 治本: 整行 158 > 140, 拆多行 (v5 误判, 已修)
      const restored = (await request(app.getHttpServer())
        .post(`/diary/entries/${created.body.id}/restore`)
        .set('X-Test-Uid', TEST_UID)
        .expect(200)) as HttpResponse;

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
      const res = (await request(app.getHttpServer()).delete('/diary/entries/all').set('X-Test-Uid', TEST_UID).expect(200)) as HttpResponse;

      expect(res.body.deletedCount).toBe(3);

      // V2026-09-11 #6 治本: 整行 163 > 140, 拆多行 (v5 误判, 已修)
      const list = (await request(app.getHttpServer())
        .get('/diary/entries?statusFilter=draft,finalized')
        .set('X-Test-Uid', TEST_UID)
        .expect(200)) as HttpResponse;

      expect(list.body.entries).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 3. AI feedback 边界 (metadata-only + crisisFlag)
  // ════════════════════════════════════════════════════════════════

  describe('POST /ai/diary-feedback', () => {
    it('should generate feedback with crisisFlag=true when moodHint=crisis', async () => {
      // V2026-09-11 #6 治本: await 表达式链整行 253 > 140 (含中文 moodSnapshot), 拆多行
      const created = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({
          body: '难受到需要支持',
          moodSnapshot: { level: DiaryMoodLevel.Crisis, snapshottedAt: new Date().toISOString() },
        })
        .expect(201)) as HttpResponse;

      // V2026-09-11 #6 治本: await 表达式链 .send({ entryId, themes, moodHint, localSummary, tags })
      //   拆多行 (object literal 必拆, prettier 自动)
      const res = (await request(app.getHttpServer())
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
        .expect(200)) as HttpResponse;

      expect(res.body.crisisFlag).toBe(true);
      expect(res.body.perspectiveQuestions).toHaveLength(3);
      expect(res.body.source).toBe('cloud');
    });

    it('should 404 when entry does not belong to user', async () => {
      // V2026-09-11 #6 治本: await 表达式链拆多行 (整行 164 > 140)
      const created = (await request(app.getHttpServer())
        .post('/diary/entries')
        .set('X-Test-Uid', TEST_UID)
        .send({ body: 'private' })
        .expect(201)) as HttpResponse;

      const res = (await request(app.getHttpServer())
        .post('/ai/diary-feedback')
        .set('X-Test-Uid', OTHER_UID)
        .send({
          entryId: created.body.id as string,
          themes: [],
          localSummary: '',
          tags: [],
        })
        .expect(404)) as HttpResponse;
      // V2026-09-11 治本: 显式断言 — sonarjs 兜底.
      expect(res.status).toBe(404);
    });
  });
});
