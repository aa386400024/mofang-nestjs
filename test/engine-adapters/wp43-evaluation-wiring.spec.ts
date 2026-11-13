// V2026-11-06 治本 (WP43 · 评估引擎基础版 · 引擎侧接线单测):
//   覆盖"内核出参 → 评估插槽"这条**接线** (纯算分规则与落库在
//   test/counselor/wp43-evaluation-engine.spec.ts 里):
//     ① 每轮内核出参被投影成评估输入 (snapshot / events / safety 三类事实);
//     ② 会话收尾 → 交办给业务侧插槽 (fire-and-forget);
//     ③ 二次 closeSession 不重复交办 (voice 侧会把当前后端与引擎后端各关一次);
//     ④ 重连 (再 openSession) → 评估台账重置, 不把上一场算进来;
//     ⑤ 没有业务会话 id / 没有学员身份 → 不交办 (不是错误, 是"这场不评估").
//
//   全 mock: 引擎门面用 stub; 不起 Nest 容器, 不发网络, 不碰数据库.
//
//   验证: npx vitest run test/engine-adapters/wp43-evaluation-wiring.spec.ts
//
//   时间戳: 2026-11-06
import type { LlmStreamChunk } from '../../src/agent/llm/llm.types.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter.js';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import {
  SessionEvaluationRegistry,
  type SessionEvaluationSessionInput,
  type SessionEvaluationSink,
} from '../../src/voice/session-evaluation-slot.js';

const SESSION_ID = 'session-1';
const HANDLE_ID = 'handle-1';
const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';
const DB_SESSION_ID = 'db-sess-1';

/**
 * 假引擎门面.
 */
class StubEngine {
  /** 本轮快照 (可替换, 用来模拟旧快照缺字段). */
  snapshotOverride: TurnRenderResult['snapshot'] | undefined;

  /** 本轮渲染元信息 (可替换, 用来模拟渲染降级). */
  renderOverride: TurnRenderResult['render'] | undefined;

  open(input: { sessionId: string }): { handleId: string; sessionId: string } {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  close(): void {
    /* noop */
  }

  async turnStream(
    _handleId: string,
    _input: { userText: string },
    handlers: { onDelta: (delta: string) => void | Promise<void> },
  ): Promise<TurnRenderResult> {
    await handlers.onDelta('我……不太想聊这个。');
    const base = buildRenderResult();
    const result = this.renderOverride ? { ...base, render: this.renderOverride } : base;
    return this.snapshotOverride ? { ...result, snapshot: this.snapshotOverride } : result;
  }
}

/**
 * 造一份本轮渲染结果 (内核出参的形状).
 */
function buildRenderResult(): TurnRenderResult {
  return {
    reply: '我……不太想聊这个。',
    snapshot: {
      trust: 0.61,
      safety: 0.55,
      bond: 0.42,
      emotion: { label: 'anxious', valence: -0.31, arousal: 0.45 },
      resistance: { verbal: 0.22, depth: 0.5, style: 0.3 },
    } as TurnRenderResult['snapshot'],
    turnIndex: 7,
    events: ['empathy', 'open_probe'],
    safety: { level: 'warn', categories: ['passive_ideation'] } as unknown as TurnRenderResult['safety'],
    render: {
      fallbackUsed: false,
      providerHint: 'minimax',
      usage: { completionTokens: 604, totalTokens: 604 },
    },
  };
}

/**
 * 装一个被测的后端 (引擎 stub + 评估插槽).
 *
 * @returns 后端 + 插槽 + 交办记录
 */
function buildBackend(options: { readonly renderOverride?: TurnRenderResult['render'] } = {}): {
  readonly backend: EngineStreamBackend;
  readonly registry: SessionEvaluationRegistry;
  readonly handed: SessionEvaluationSessionInput[];
} {
  const engine = new StubEngine();
  engine.renderOverride = options.renderOverride;
  const registry = new SessionEvaluationRegistry();
  const handed: SessionEvaluationSessionInput[] = [];
  const sink: SessionEvaluationSink = {
    name: 'stub-sink',
    finalize: async (input) => {
      handed.push(input);
    },
  };
  registry.register(sink);
  const backend = new EngineStreamBackend(
    engine as unknown as EngineTurnService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    registry,
  );
  return { backend, registry, handed };
}

/**
 * 把一条流收成 chunk 数组.
 *
 * @param stream 流
 * @returns chunk 列表
 */
async function collect(stream: Promise<{ readonly stream: AsyncIterable<LlmStreamChunk> }>): Promise<LlmStreamChunk[]> {
  const { stream: iterable } = await stream;
  const chunks: LlmStreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * 让 fire-and-forget 的交办有机会跑完.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WP43 · 引擎侧接线 (内核出参 → 评估插槽)', () => {
  it('① 每轮内核出参被投影成评估输入 (三类事实齐)', async () => {
    const { backend, handed } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, dbSessionId: DB_SESSION_ID });
    await collect(
      backend.streamTurn({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, personaId: 'v', userText: '最近睡得怎么样？' }),
    );
    backend.closeSession(SESSION_ID);
    await flushMicrotasks();

    expect(handed).toHaveLength(1);
    const turns = handed[0]?.turns ?? [];
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      turnIndex: 7,
      trust: 0.61,
      safety: 0.55,
      bond: 0.42,
      resistance: 0.22,
      valence: -0.31,
      arousal: 0.45,
      events: ['empathy', 'open_probe'],
      safetyLevel: 'warn',
      safetyCategories: ['passive_ideation'],
      // V2026-11-07 治本 (degraded 打标): 本轮没降级 → 标记为 false.
      degraded: false,
    });
    expect(handed[0]?.dbSessionId).toBe(DB_SESSION_ID);
    expect(handed[0]?.userId).toBe(USER_ID);
  });

  it('⑥ 渲染降级轮次 → 投影带 degraded 标记 (degraded 打标唯一的数据源)', async () => {
    const { backend, handed } = buildBackend({
      renderOverride: { fallbackUsed: true, providerHint: 'degraded', usage: { completionTokens: 0, totalTokens: 0 } },
    });
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, dbSessionId: DB_SESSION_ID });
    await collect(
      backend.streamTurn({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, personaId: 'v', userText: '最近睡得怎么样？' }),
    );
    backend.closeSession(SESSION_ID);
    await flushMicrotasks();

    expect(handed).toHaveLength(1);
    expect(handed[0]?.turns[0]?.degraded).toBe(true);
  });

  it('② 会话收尾才交办 (还没 close → 不交办)', async () => {
    const { backend, handed } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, dbSessionId: DB_SESSION_ID });
    await collect(backend.streamTurn({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, personaId: 'v', userText: '第一句' }));
    await flushMicrotasks();
    expect(handed).toHaveLength(0);
  });

  it('③ 二次 closeSession 不重复交办', async () => {
    const { backend, handed } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, dbSessionId: DB_SESSION_ID });
    await collect(backend.streamTurn({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, personaId: 'v', userText: '第一句' }));
    backend.closeSession(SESSION_ID);
    backend.closeSession(SESSION_ID);
    await flushMicrotasks();
    expect(handed).toHaveLength(1);
  });

  it('④ 重连 → 评估台账重置 (上一场的轮次不串进新一场)', async () => {
    const { backend, handed } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, dbSessionId: DB_SESSION_ID });
    await collect(
      backend.streamTurn({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, personaId: 'v', userText: '上一场的句' }),
    );

    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, dbSessionId: DB_SESSION_ID });
    await collect(
      backend.streamTurn({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, personaId: 'v', userText: '这一场的句' }),
    );
    backend.closeSession(SESSION_ID);
    await flushMicrotasks();

    expect(handed).toHaveLength(1);
    expect(handed[0]?.turns).toHaveLength(1);
  });

  it('⑤ 没有业务会话 id / 没有学员身份 → 不交办', async () => {
    const { backend, handed } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID });
    await collect(backend.streamTurn({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, personaId: 'v', userText: '第一句' }));
    backend.closeSession(SESSION_ID);
    await flushMicrotasks();
    expect(handed).toHaveLength(0);

    const second = buildBackend();
    // 没有学员身份 → 归属不明 → 不评估.
    await second.backend.openSession({ sessionId: 'session-2', tenantId: TENANT_ID, dbSessionId: DB_SESSION_ID });
    // ⚠️ 故意**不带** userId (学员身份缺失) —— 这是本用例要验的前置条件.
    await collect(
      second.backend.streamTurn({
        sessionId: 'session-2',
        tenantId: TENANT_ID,
        personaId: 'v',
        userText: '第一句',
      }),
    );
    second.backend.closeSession('session-2');
    await flushMicrotasks();
    expect(second.handed).toHaveLength(0);
  });

  it('⑦ 快照缺字段 (旧快照 / 接续旧会话) → 回合照常跑完, 缺失按 0 兜底', async () => {
    const engine = new StubEngine();
    const registry = new SessionEvaluationRegistry();
    const handed: SessionEvaluationSessionInput[] = [];
    registry.register({
      name: 'stub-sink',
      finalize: async (input) => {
        handed.push(input);
      },
    });
    // 精简快照: 没有 safety / bond / resistance / emotion (WP42 之前持久化的旧快照).
    engine.snapshotOverride = { trust: 0.4 } as unknown as TurnRenderResult['snapshot'];
    const backend = new EngineStreamBackend(
      engine as unknown as EngineTurnService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, dbSessionId: DB_SESSION_ID });
    await collect(backend.streamTurn({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, personaId: 'v', userText: '第一句' }));
    backend.closeSession(SESSION_ID);
    await flushMicrotasks();

    expect(handed).toHaveLength(1);
    expect(handed[0]?.turns[0]).toMatchObject({ trust: 0.4, safety: 0, bond: 0, resistance: 0, valence: 0, arousal: 0 });
  });

  it('⑥ 一轮都没跑 → 不交办 (不写一条 0 分)', async () => {
    const { backend, handed } = buildBackend();
    await backend.openSession({ sessionId: SESSION_ID, tenantId: TENANT_ID, userId: USER_ID, dbSessionId: DB_SESSION_ID });
    backend.closeSession(SESSION_ID);
    await flushMicrotasks();
    expect(handed).toHaveLength(0);
  });
});
