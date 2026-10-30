// V2026-10-29 治本 (WP8-B · B 层 · 门面流式出口单测):
//   覆盖任务单 §10 清单 7-8:
//     7. turnStream 先 session.turn 决策再取文; 成功收尾追加"问+答"并写来访半边记忆;
//        降级只追加咨询师半边、不写记忆
//     8. turnStream 与 turn() 共用同一历史 / 记忆, 无双份写入
//   另附:
//     A. 渲染器没实现流式 → 门面回退"聚合取文 + 切段成增量" (兜底形态)
//     B. 渲染器流式抛错 → 降级兜底句, 不 reject
//
//   全 mock: 内核会话端口 / 渲染端口 / 记忆仓储全部用 stub, 不起容器、不发网络.
//
//   为什么"无双份写入"必须有用例 (而不是靠人读代码):
//     门面每轮要落两处 —— 历史 (给模型看的上下文) 与来访半边工作记忆 (给内核召回).
//     流式与聚合各写一次时, 一旦有人把 `settleTurn` 复制成 `settleTurnStream`,
//     就会变成"问+答各写两遍" —— 召回权重被悄悄翻倍, 而且没有任何报错.
//     用例 8 断言记忆条数与历史长度, 把这条不变量钉死.
//
//   验证: npx jest test/engine-adapters/wp8b-turn-stream.spec.ts
//   时间戳: 2026-10-29 GMT+8

import type { StreamRenderOutcome, StreamingRenderPort } from '../../src/engine-adapters/rendering/streaming-render.port';
import { TurnRenderOrchestrator, type TurnSessionContext } from '../../src/engine-adapters/rendering/turn-render-orchestrator';
import {
  createEmptyBdiSnapshot,
  type EngineSessionHandle,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type MemoryEntry,
  type MemoryHit,
  type MemoryRecallQuery,
  type MemoryStore,
  type OpenEngineSessionInput,
  type RenderResult,
  type RenderSpec,
} from '../../src/engine-core';

const HANDLE_ID = 'handle-1';
const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const SESSION = 'session-1';
const CONTEXT: TurnSessionContext = { tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION };

/** 内核出参 (固定). */
function buildOutput(): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    intention: {
      strategy: 'recounting',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: ['judge'],
    },
  };
}

/** 内核会话端口 stub. */
class StubSession implements EngineSessionPort {
  readonly turnCalls: { readonly handleId: string; readonly input: EngineTurnInput }[] = [];

  openSession(input: OpenEngineSessionInput): EngineSessionHandle {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  async turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput> {
    this.turnCalls.push({ handleId, input });
    return buildOutput();
  }

  closeSession(handleId: string): void {
    void handleId;
  }
}

/** 记忆仓储 stub: 记录写入. */
class StubMemoryStore implements MemoryStore {
  readonly remembered: MemoryEntry[] = [];

  async remember(entry: MemoryEntry): Promise<void> {
    this.remembered.push(entry);
  }

  async recall(_query: MemoryRecallQuery): Promise<readonly MemoryHit[]> {
    return [];
  }
}

/** 流式渲染端口 stub: 记录增量与规格. */
class StubStreamingRenderer implements StreamingRenderPort {
  readonly specs: RenderSpec[] = [];
  readonly deltas: string[] = [];

  constructor(private readonly behavior: { text: string; degraded?: boolean; providerHint?: string } | { error: Error }) {}

  async render(spec: RenderSpec): Promise<RenderResult> {
    this.specs.push(spec);
    if ('error' in this.behavior) throw this.behavior.error;
    return {
      text: this.behavior.text.replaceAll('|', ''),
      taskKind: spec.taskKind,
      usage: { completionTokens: 1, totalTokens: 2 },
      fallbackUsed: false,
      providerHint: 'primary',
    };
  }

  async streamRender(spec: RenderSpec, handlers: { onDelta: (delta: string) => void | Promise<void> }): Promise<StreamRenderOutcome> {
    this.specs.push(spec);
    if ('error' in this.behavior) throw this.behavior.error;
    const parts = this.behavior.text.split('|');
    for (const part of parts) {
      this.deltas.push(part);
      await handlers.onDelta(part);
    }
    return {
      text: this.behavior.text.replaceAll('|', ''),
      taskKind: spec.taskKind,
      usage: { completionTokens: 12, totalTokens: 24 },
      fallbackUsed: this.behavior.degraded ?? false,
      providerHint: this.behavior.providerHint ?? 'primary',
      degraded: this.behavior.degraded ?? false,
    };
  }
}

/** 只有聚合能力的渲染端口 stub (无 streamRender). */
class AggregateOnlyRenderer implements StreamingRenderPort {
  readonly specs: RenderSpec[] = [];

  async render(spec: RenderSpec): Promise<RenderResult> {
    this.specs.push(spec);
    return {
      text: '我最近有点累，夜里老醒。',
      taskKind: spec.taskKind,
      usage: { completionTokens: 5, totalTokens: 9 },
      fallbackUsed: false,
      providerHint: 'primary',
    };
  }
}

/** 构造门面 (真实 orchestrator, 只替换三个端口). */
function buildOrchestrator(options: {
  readonly renderer: StreamingRenderPort;
  readonly session?: StubSession;
  readonly memories?: StubMemoryStore;
}): {
  readonly orchestrator: TurnRenderOrchestrator;
  readonly session: StubSession;
  readonly memories: StubMemoryStore;
} {
  const session = options.session ?? new StubSession();
  const memories = options.memories ?? new StubMemoryStore();
  const orchestrator = new TurnRenderOrchestrator({
    session,
    renderer: options.renderer,
    memories,
    sessionContext: CONTEXT,
  });
  return { orchestrator, session, memories };
}

describe('WP8-B · 门面流式出口 (turnStream)', () => {
  describe('⑦ 决策 → 流式取文 → 落账', () => {
    it('先 session.turn 决策, 再取文; 增量原样转发, reply 是完整文本', async () => {
      const renderer = new StubStreamingRenderer({ text: '有点累|，夜里老醒。' });
      const { orchestrator, session } = buildOrchestrator({ renderer });

      const deltas: string[] = [];
      const result = await orchestrator.turnStream(
        HANDLE_ID,
        { userText: '最近睡得怎么样？' },
        {
          onDelta: (delta) => {
            deltas.push(delta);
          },
        },
      );

      expect(session.turnCalls).toHaveLength(1);
      expect(session.turnCalls[0]?.input.userText).toBe('最近睡得怎么样？');
      expect(deltas).toEqual(['有点累', '，夜里老醒。']);
      expect(result.reply).toBe('有点累，夜里老醒。');
      expect(result.turnIndex).toBe(1);
    });

    it('成功收尾: 追加"问+答"历史, 并写一条来访半边工作记忆', async () => {
      const renderer = new StubStreamingRenderer({ text: '有点累。' });
      const { orchestrator, memories } = buildOrchestrator({ renderer });

      await orchestrator.turnStream(HANDLE_ID, { userText: '最近睡得怎么样？' }, { onDelta: () => {} });

      expect(memories.remembered).toHaveLength(1);
      expect(memories.remembered[0]?.content).toBe('有点累。');
      expect(memories.remembered[0]?.tenantId).toBe(TENANT);
      expect(memories.remembered[0]?.visitorId).toBe(VISITOR);
    });

    it('降级: 只追加咨询师半边, 不写来访半边记忆 (兜底句不是来访真说的话)', async () => {
      const renderer = new StubStreamingRenderer({ text: '我先缓一下。', degraded: true, providerHint: 'degraded' });
      const { orchestrator, memories } = buildOrchestrator({ renderer });

      const result = await orchestrator.turnStream(HANDLE_ID, { userText: '最近睡得怎么样？' }, { onDelta: () => {} });

      expect(result.render.fallbackUsed).toBe(true);
      expect(result.render.providerHint).toBe('degraded');
      expect(memories.remembered).toHaveLength(0);
    });

    it('渲染器流式抛错 → 降级兜底句, 不 reject', async () => {
      const renderer = new StubStreamingRenderer({ error: new Error('渲染炸了') });
      const { orchestrator, memories } = buildOrchestrator({ renderer });

      const result = await orchestrator.turnStream(HANDLE_ID, { userText: '最近睡得怎么样？' }, { onDelta: () => {} });

      expect(result.reply).toBe('……我先缓一下，我们接着说。');
      expect(result.render.fallbackUsed).toBe(true);
      expect(memories.remembered).toHaveLength(0);
    });
  });

  describe('⑧ 与聚合路径共用同一历史 / 记忆 (无双份写入)', () => {
    it('先聚合一轮再流式一轮: 历史与记忆各只有一份, 没有翻倍', async () => {
      const renderer = new StubStreamingRenderer({ text: '第一句。' });
      const { orchestrator, memories } = buildOrchestrator({ renderer });

      await orchestrator.turn(HANDLE_ID, { userText: '问题一' });
      await orchestrator.turnStream(HANDLE_ID, { userText: '问题二' }, { onDelta: () => {} });

      // 两轮 → 两条来访半边记忆 (每轮一条), 不重复写.
      expect(memories.remembered).toHaveLength(2);
      expect(memories.remembered.map((entry) => entry.content)).toEqual(['第一句。', '第一句。']);

      // 第二轮的规格里应含上一轮的问 + 答 (证明历史被复用, 而不是各写各的).
      const secondSpec = renderer.specs[1];
      expect(secondSpec?.recentTurns.map((turn) => `${turn.role}:${turn.text}`)).toEqual([
        'counselor:问题一',
        'visitor:第一句。',
        'counselor:问题二',
      ]);
    });

    it('流式一轮内部: 记忆只写一次 (不因增量条数写多次)', async () => {
      const renderer = new StubStreamingRenderer({ text: '一|二|三' });
      const { orchestrator, memories } = buildOrchestrator({ renderer });

      await orchestrator.turnStream(HANDLE_ID, { userText: '问题' }, { onDelta: () => {} });

      expect(memories.remembered).toHaveLength(1);
      expect(memories.remembered[0]?.content).toBe('一二三');
    });
  });

  describe('A. 渲染器没实现流式 → 兜底形态', () => {
    it('聚合取文后切段成增量, 不抛错', async () => {
      const renderer = new AggregateOnlyRenderer();
      const { orchestrator } = buildOrchestrator({ renderer });

      const deltas: string[] = [];
      const result = await orchestrator.turnStream(
        HANDLE_ID,
        { userText: '最近睡得怎么样？' },
        {
          onDelta: (delta) => {
            deltas.push(delta);
          },
        },
      );

      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.join('')).toBe(result.reply);
      expect(result.reply).toBe('我最近有点累，夜里老醒。');
    });
  });
});
