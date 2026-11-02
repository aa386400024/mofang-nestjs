// V2026-10-30 治本 (WP19-R · 留痕链接通 + admin/api 收口 · 单测):
//   覆盖任务单 §3 验收第 9 条的 5 个场景:
//     ① trace 真落库        —— 每轮 turn 结束即写 `training_sessions.turn_debug_trace`
//                               (形状 = WP19 原单 §1.1 契约, 逐字)
//     ② 写库失败不炸链      —— 写库异常只打 error 日志, 对练主链路照常返回 reply
//     ③ 401 与 200          —— basic auth 配好后: 无凭据/错凭据 → 401; 正确凭据 → 放行
//     ④ characters 查角色池 —— `/admin/api/characters` 查 `character_profiles` (不是速查卡表)
//     ⑤ not_found 404       —— `/admin/api/sessions/:id` 会话不存在 → 404
//   另附 (任务单 §1.4 的硬要求):
//     ⑥ 用户隔离            —— 学员只看自己的会话; 管理员 (basic auth) 不过滤
//
//   全 mock: 不起 Nest 容器, 不连 DB, 不发网络.
//     · 仓储用内存 stub (记录调用参数, 便于断言"查的是哪张表 / 带什么过滤");
//     · 引擎门面用 stub (只回一份固定 TurnRenderResult);
//     · JWT 守卫用 stub (模拟"带 token / 不带 token / token 无效"三种现场).
//
//   验证: npx vitest run test/admin-debug/wp19r-trace-wiring.spec.ts
//   时间戳: 2026-10-30 GMT+8

import { FindOperator } from 'typeorm';
import { AdminBasicAuthMiddleware } from '../../src/admin-debug/admin-basic-auth.middleware.js';
import { AdminDebugController } from '../../src/admin-debug/admin-debug.controller.js';
import { TraceRecorder, resolveTraceEnabled, type TurnTrace } from '../../src/admin-debug/trace-recorder.service.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter.js';

const SESSION_ID = 'session-1';
const DB_SESSION_ID = 'db-session-1';
const USER_ID = 'student-a';

/**
 * 假配置服务 (只回 env 字典).
 */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

/**
 * 假会话仓储 (记录 update 调用; update 可配置为抛错).
 */
class FakeSessionRepo {
  readonly updates: { readonly id: unknown; readonly patch: Record<string, unknown> }[] = [];
  failWith: Error | undefined;

  async update(criteria: unknown, patch: Record<string, unknown>): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.updates.push({ id: criteria, patch });
  }
}

/**
 * 造一条符合 WP19 原单 §1.1 的调试快照.
 */
function buildTrace(overrides: Partial<TurnTrace> = {}): TurnTrace {
  return {
    turnIndex: 1,
    characterSlug: 'vpt_intimate_avoidance_l1',
    bdiSnapshot: {
      trust: 0.28,
      valence: -0.45,
      arousal: 0.62,
      resistance: 0.42,
      anxiousSecure: 'anxious',
    },
    renderSpec: {
      taskKind: 'chat',
      promptPreview: '你是来访者……',
      maxCompletionTokens: 1500,
      reasoningEffort: 'low',
    },
    llmUsage: {
      promptTokens: 0,
      completionTokens: 604,
      reasoningTokens: 38,
      ttftMs: 1988,
      finishReason: 'stop',
    },
    crisis: { detected: false, category: null },
    ts: '2026-10-30T14:30:00.000Z',
    ...overrides,
  };
}

/**
 * 假 TraceRecorder (记录调用; 可配置为抛错 —— 模拟"留痕把对练搞挂"的最坏情况).
 */
class StubTraceRecorder {
  readonly calls: { readonly dbSessionId: string; readonly trace: TurnTrace }[] = [];
  failWith: Error | undefined;

  record(dbSessionId: string, trace: TurnTrace): Promise<void> {
    this.calls.push({ dbSessionId, trace });
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve();
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * 假引擎门面 (只回一份固定的 TurnRenderResult).
 */
function stubEngine(result: TurnRenderResult): {
  open(): { handleId: string; sessionId: string };
  turnStream(): Promise<TurnRenderResult>;
  close(): void;
} {
  return {
    open: () => ({ handleId: 'handle-1', sessionId: SESSION_ID }),
    turnStream: async () => result,
    close: () => {},
  };
}

/**
 * 造一份本轮渲染结果 (带 BDI 快照 + 用量 + 渲染规格摘要).
 */
function buildRenderResult(overrides: Partial<TurnRenderResult> = {}): TurnRenderResult {
  return {
    reply: '我……不太想聊这个。',
    snapshot: {
      trust: 0.31,
      emotion: { label: 'anxious', valence: -0.42, arousal: 0.58 },
      resistance: { verbal: 0.44, depth: 0.5, style: 0.3 },
    } as TurnRenderResult['snapshot'],
    turnIndex: 3,
    render: {
      fallbackUsed: false,
      providerHint: 'minimax',
      usage: { completionTokens: 604, totalTokens: 604, reasoningTokens: 38 },
      spec: {
        taskKind: 'chat',
        promptPreview: '你是来访者晚晴……',
        maxCompletionTokens: 1500,
        reasoningEffort: 'low',
      },
      finishReason: 'stop',
      ttftMs: 1988,
    },
    ...overrides,
  };
}

/**
 * 假请求.
 */
function buildRequest(headers: Record<string, string> = {}, cookies: Record<string, string> = {}): Record<string, unknown> {
  return { headers, cookies };
}

/**
 * 假响应 (记录状态码与响应体).
 */
function buildResponse(): { readonly res: never; readonly state: { statusCode: number; body: unknown } } {
  const state = { statusCode: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  };
  return { res: res as never, state };
}

describe('WP19-R · 留痕链接通 + admin/api 收口', () => {
  describe('① trace 真落库 (每轮 turn 结束即写, 形状 = WP19 §1.1)', () => {
    it('record() 把累积快照写回 training_sessions.turn_debug_trace', async () => {
      const repo = new FakeSessionRepo();
      const recorder = new TraceRecorder(repo as never, stubConfig({ NODE_ENV: 'development' }) as never);

      await recorder.record(DB_SESSION_ID, buildTrace({ turnIndex: 1 }));
      await recorder.record(DB_SESSION_ID, buildTrace({ turnIndex: 2 }));

      expect(repo.updates).toHaveLength(2);
      const last = repo.updates.at(-1);
      expect(last?.id).toEqual({ id: DB_SESSION_ID });
      const written = last?.patch['turnDebugTrace'] as TurnTrace[];
      expect(written).toHaveLength(2);
      expect(written.map((t) => t.turnIndex)).toEqual([1, 2]);
    });

    it('落库形状逐字符合 WP19 原单 §1.1 (bdiSnapshot / renderSpec / llmUsage / crisis)', async () => {
      const repo = new FakeSessionRepo();
      const recorder = new TraceRecorder(repo as never, stubConfig({ NODE_ENV: 'development' }) as never);

      await recorder.record(DB_SESSION_ID, buildTrace());

      const written = repo.updates.at(-1)?.patch['turnDebugTrace'] as TurnTrace[];
      const trace = written.at(0);
      expect(Object.keys(trace ?? {}).sort()).toEqual(
        ['bdiSnapshot', 'characterSlug', 'crisis', 'llmUsage', 'renderSpec', 'ts', 'turnIndex'].sort(),
      );
      expect(trace?.bdiSnapshot.trust).toBeGreaterThan(0);
      expect(trace?.bdiSnapshot.valence).toBeLessThan(0);
      expect(trace?.bdiSnapshot.arousal).toBeGreaterThan(0);
      expect(trace?.bdiSnapshot.resistance).toBeGreaterThan(0);
      expect(trace?.bdiSnapshot.anxiousSecure).toBe('anxious');
      expect(trace?.renderSpec.taskKind).toBe('chat');
      expect(trace?.renderSpec.maxCompletionTokens).toBe(1500);
      expect(trace?.renderSpec.reasoningEffort).toBe('low');
      expect(trace?.llmUsage.completionTokens).toBe(604);
      expect(trace?.llmUsage.ttftMs).toBe(1988);
      expect(trace?.llmUsage.finishReason).toBe('stop');
      expect(trace?.crisis.detected).toBe(false);
    });

    it('EngineStreamBackend 每轮结算后真的调 record() (接线不再是死路)', async () => {
      const recorder = new StubTraceRecorder();
      const backend = new EngineStreamBackend(
        stubEngine(buildRenderResult()) as never,
        undefined,
        undefined,
        undefined,
        undefined,
        recorder as never,
      );

      await backend.openSession({
        sessionId: SESSION_ID,
        tenantId: 'tenant-1',
        userId: USER_ID,
        templateId: 'vpt_intimate_avoidance_l1',
        dbSessionId: DB_SESSION_ID,
      });
      const { stream } = await backend.streamTurn({
        sessionId: SESSION_ID,
        tenantId: 'tenant-1',
        userId: USER_ID,
        personaId: 'vpt_intimate_avoidance_l1',
        userText: '最近还好吗？',
      });
      for await (const _chunk of stream) {
        // 消费完整流 (结束 chunk 之后才会结算并留痕).
      }

      expect(recorder.calls).toHaveLength(1);
      const trace = recorder.calls.at(0)?.trace;
      expect(recorder.calls.at(0)?.dbSessionId).toBe(DB_SESSION_ID);
      expect(trace?.turnIndex).toBe(3);
      expect(trace?.characterSlug).toBe('vpt_intimate_avoidance_l1');
      expect(trace?.bdiSnapshot.trust).toBeCloseTo(0.31);
      expect(trace?.llmUsage.completionTokens).toBe(604);
      expect(trace?.renderSpec.taskKind).toBe('chat');
    });
  });

  describe('② 写库失败不炸链 (只打 error 日志)', () => {
    it('写库抛错 → record() 不 reject, 异常被吞在记录器内部', async () => {
      const repo = new FakeSessionRepo();
      repo.failWith = new Error('db down');
      const recorder = new TraceRecorder(repo as never, stubConfig({ NODE_ENV: 'development' }) as never);

      await expect(recorder.record(DB_SESSION_ID, buildTrace())).resolves.toBeUndefined();
    });

    it('写库抛错 → 对练主链路照常返回 reply (引擎后端不炸)', async () => {
      const recorder = new StubTraceRecorder();
      recorder.failWith = new Error('db down');
      const backend = new EngineStreamBackend(
        stubEngine(buildRenderResult()) as never,
        undefined,
        undefined,
        undefined,
        undefined,
        recorder as never,
      );

      await backend.openSession({
        sessionId: SESSION_ID,
        tenantId: 'tenant-1',
        userId: USER_ID,
        dbSessionId: DB_SESSION_ID,
      });
      const { stream } = await backend.streamTurn({
        sessionId: SESSION_ID,
        tenantId: 'tenant-1',
        userId: USER_ID,
        personaId: 'voice_visitor',
        userText: '最近还好吗？',
      });

      const chunks: { type: string }[] = [];
      for await (const chunk of stream) {
        chunks.push({ type: chunk.type });
      }

      expect(chunks.some((c) => c.type === 'content')).toBe(true);
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
      expect(recorder.calls).toHaveLength(1);
    });

    it('留痕开关关掉 → 什么都不写 (prod 缺省关)', async () => {
      const repo = new FakeSessionRepo();
      const recorder = new TraceRecorder(repo as never, stubConfig({ NODE_ENV: 'production' }) as never);

      await recorder.record(DB_SESSION_ID, buildTrace());

      expect(repo.updates).toHaveLength(0);
      expect(resolveTraceEnabled(stubConfig({ NODE_ENV: 'production' }) as never)).toBe(false);
      expect(resolveTraceEnabled(stubConfig({ NODE_ENV: 'development' }) as never)).toBe(true);
      expect(resolveTraceEnabled(stubConfig({ NODE_ENV: 'development', ENGINE_DEBUG_TRACE_ENABLED: 'false' }) as never)).toBe(false);
      expect(resolveTraceEnabled(stubConfig({ NODE_ENV: 'production', ENGINE_DEBUG_TRACE_ENABLED: 'true' }) as never)).toBe(true);
    });
  });

  describe('③ basic auth: 无凭据 / 错凭据 → 401, 正确凭据 → 放行', () => {
    const configured = { ADMIN_BASIC_AUTH_USER: 'ops', ADMIN_BASIC_AUTH_PASS: 's3cret' };
    const basicHeader = (user: string, pass: string): Record<string, string> => ({
      authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
    });

    it('两个 env 都配 + 无凭据 → 401', async () => {
      const middleware = new AdminBasicAuthMiddleware(stubConfig(configured) as never, jwtStub() as never);
      const { res, state } = buildResponse();
      let nextCalled = false;

      await middleware.use(buildRequest() as never, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(state.statusCode).toBe(401);
    });

    it('两个 env 都配 + 凭据错误 → 401', async () => {
      const middleware = new AdminBasicAuthMiddleware(stubConfig(configured) as never, jwtStub() as never);
      const { res, state } = buildResponse();
      let nextCalled = false;

      await middleware.use(buildRequest(basicHeader('ops', 'wrong')) as never, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(state.statusCode).toBe(401);
    });

    it('两个 env 都配 + 凭据正确 → 放行并标记管理员', async () => {
      const middleware = new AdminBasicAuthMiddleware(stubConfig(configured) as never, jwtStub() as never);
      const { res, state } = buildResponse();
      const request = buildRequest(basicHeader('ops', 's3cret'));
      let nextCalled = false;

      await middleware.use(request as never, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(state.statusCode).toBe(0);
      expect((request as { adminBasicAuth?: boolean }).adminBasicAuth).toBe(true);
    });

    it('只配了一个 env → 按"未开启鉴权"处理 (不半开半关)', async () => {
      const middleware = new AdminBasicAuthMiddleware(stubConfig({ ADMIN_BASIC_AUTH_USER: 'ops' }) as never, jwtStub() as never);
      const { res } = buildResponse();
      let nextCalled = false;

      await middleware.use(buildRequest() as never, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it('带 token 但 token 无效 → 401 (不把已登录样子的请求当匿名放行)', async () => {
      const middleware = new AdminBasicAuthMiddleware(
        stubConfig({}) as never,
        {
          canActivate: async () => {
            throw new Error('token 无效');
          },
        } as never,
      );
      const { res, state } = buildResponse();
      let nextCalled = false;

      await middleware.use(buildRequest({ authorization: 'Bearer bad-token' }) as never, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(state.statusCode).toBe(401);
    });
  });

  describe('④ characters 改查 character_profiles (不是速查卡表)', () => {
    it('返回 slug / codename / baseline 四值 / 上下架 + 审核态', async () => {
      const { controller, characterRepo } = buildController();
      characterRepo.rows.push({
        templateId: 'vpt_intimate_avoidance_l1',
        displayName: '晚晴',
        attachmentStyle: 'avoidant',
        baselineTrust: 0.28,
        baselineResistanceVerbal: 0.42,
        baselineResistanceDepth: 0.5,
        baselineResistanceStyle: 0.38,
        baselineEmotionValence: -0.45,
        baselineEmotionArousal: 0.62,
        enabled: true,
        auditStatus: 'approved',
      });

      const rows = await controller.characters();

      expect(characterRepo.findCalls).toHaveLength(1);
      expect(rows).toHaveLength(1);
      expect(rows.at(0)?.slug).toBe('vpt_intimate_avoidance_l1');
      expect(rows.at(0)?.codename).toBe('晚晴');
      expect(rows.at(0)?.baseline.trust).toBeCloseTo(0.28);
      expect(rows.at(0)?.baseline.resist).toBeCloseTo(0.42);
      expect(rows.at(0)?.baseline.valence).toBeCloseTo(-0.45);
      expect(rows.at(0)?.baseline.arousal).toBeCloseTo(0.62);
      expect(rows.at(0)?.enabled).toBe(true);
      expect(rows.at(0)?.auditStatus).toBe('approved');
    });
  });

  describe('⑤ 会话不存在 → 404', () => {
    it('sessionDetail 找不到 → ResourceNotFound (HTTP 404)', async () => {
      const { controller } = buildController();

      await expect(controller.sessionDetail(buildRequest() as never, 'missing-session')).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });

    it('查到了 → 正常返回 (含 trace 数组)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push({
        id: SESSION_ID,
        personaName: '晚晴',
        startedAt: new Date('2026-10-30T10:00:00Z'),
        endedAt: new Date('2026-10-30T10:10:00Z'),
        status: 'finished',
        transcript: [],
        turnDebugTrace: [buildTrace()],
        techStats: { turns: 3 },
      });

      const detail = await controller.sessionDetail(buildRequest() as never, SESSION_ID);

      expect(detail.sessionId).toBe(SESSION_ID);
      expect(detail.traces).toHaveLength(1);
      expect(detail.report.status).toBe('completed');
    });
  });

  describe('⑥ 用户隔离 (学员只看自己的; 管理员不过滤)', () => {
    it('学员请求 → where 带 userId', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push({ id: SESSION_ID, personaName: '晚晴', startedAt: null, endedAt: null, status: 'finished' });

      await controller.sessions({ user: { userId: USER_ID } } as never);

      expect(sessionRepo.findCalls.at(-1)?.where?.['userId']).toBe(USER_ID);
    });

    it('管理员 (basic auth) → where 不带 userId (调试器要看全场)', async () => {
      const { controller, sessionRepo } = buildController();

      await controller.sessions({ adminBasicAuth: true, user: { userId: USER_ID } } as never);

      expect(sessionRepo.findCalls.at(-1)?.where?.['userId']).toBeUndefined();
    });

    it('匿名 (dev 裸奔) → where 不带 userId', async () => {
      const { controller, sessionRepo } = buildController();

      await controller.sessions(buildRequest() as never);

      expect(sessionRepo.findCalls.at(-1)?.where?.['userId']).toBeUndefined();
    });

    it('学员看不到别人的会话 → 详情同样按归属过滤 (查不到即 404)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push({ id: SESSION_ID, userId: 'student-b', personaName: '小满' });

      await expect(controller.sessionDetail({ user: { userId: USER_ID } } as never, SESSION_ID)).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });
  });
});

/**
 * 假 JWT 守卫 (默认"没带 token" → 抛错, 与仓库既有守卫同语义).
 */
function jwtStub(): { canActivate(): Promise<boolean> } {
  return {
    canActivate: async () => {
      throw new Error('缺少 access token');
    },
  };
}

/**
 * 假角色仓储 (只记调用).
 */
class FakeCharacterRepo {
  readonly rows: Record<string, unknown>[] = [];
  readonly findCalls: unknown[] = [];

  async find(options: unknown): Promise<Record<string, unknown>[]> {
    this.findCalls.push(options);
    return this.rows;
  }
}

/**
 * 假会话仓储 (查 + 记调用).
 */
class FakeSessionReadRepo {
  readonly rows: Record<string, unknown>[] = [];
  readonly findCalls: { readonly where?: Record<string, unknown> }[] = [];

  async find(options: { readonly where?: Record<string, unknown> }): Promise<Record<string, unknown>[]> {
    this.findCalls.push(options);
    return this.rows.filter((row) => matchesWhere(row, options.where));
  }

  async findOne(options: { readonly where?: Record<string, unknown> }): Promise<Record<string, unknown> | null> {
    this.findCalls.push(options);
    return this.rows.find((row) => matchesWhere(row, options.where)) ?? null;
  }
}

/**
 * where 条件匹配 (等值 + IsNull).
 *
 * 为什么支持 `IsNull`: controller 的软删过滤写的就是 `deletedAt: IsNull()`,
 * stub 若不认这个算子, "查得到" 的用例会假失败.
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'isNull') return row[key] === null || row[key] === undefined;
      return true;
    }
    if (expected === null || expected === undefined) return true;
    return row[key] === expected;
  });
}

/**
 * 装一个 controller (会话仓储 + 角色仓储 + 配置).
 */
function buildController(): {
  readonly controller: AdminDebugController;
  readonly sessionRepo: FakeSessionReadRepo;
  readonly characterRepo: FakeCharacterRepo;
} {
  const sessionRepo = new FakeSessionReadRepo();
  const characterRepo = new FakeCharacterRepo();
  const controller = new AdminDebugController(sessionRepo as never, characterRepo as never, stubConfig({}) as never);
  return { controller, sessionRepo, characterRepo };
}
