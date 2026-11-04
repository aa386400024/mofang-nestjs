// V2026-11-04 WP55 (B 层 · 会话摘要补齐来访者侧):
//   目的: 钉死"滚动摘要从『咨询侧纪要』升级为『两侧对话纪要』"这条链路 ——
//     ① 两侧内容: 生成器同时拿到咨询师话与来访者话;
//     ② 配对不错位 (核心回归防线): 中间有阻断 / 降级轮次时, 来访者话仍挂在
//        **它自己那一轮**上, 不会被错配给别的轮次;
//     ③ 淘汰匹配: 内核说"这一轮被淘汰了" → 压进去的就是那一轮 (不多不少);
//     ④ 失败回滚: LLM 挂了本批轮次放回队首, 顺序不变;
//     ⑤ 会话关闭清理: 修 WP37 遗留的会话状态泄漏;
//     ⑥ 零回归: 没装配摘要服务时, 门面的历史与 prompt 逐字不变.
//
//   为什么"配对不错位"是硬断言:
//     咨询师文本 (内核给) 与来访者文本 (门面给) 是两条**独立到达**的流,
//     长度会错位 —— 某一轮被阻断或渲染降级时, 来访者根本没发言, 下标就整体偏一格.
//     按下标配对会产出"问 A 轮 / 答 B 轮"的假对话, 而摘要里的假因果会被后续对话当真.
//     本单用"轮次记录"把两侧绑成一个不可拆的单位, 配对正确性由结构保证.
//
//   全 mock, 不起 NestJS, 不发网络:
//     摘要生成器用 stub; 记忆仓储用内核内存实现; 时钟与 id 工厂注入假值.
//
//   验证: npx vitest run test/engine-adapters/wp55-rolling-summary-both-sides.spec.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

import {
  DEFAULT_ROLLING_SUMMARY_BATCH_SIZE,
  RollingSessionSummaryService,
} from '../../src/engine-adapters/persistence/rolling-session-summary.service.js';
import {
  formatRollingSummaryInput,
  type RollingSummaryInput,
  type RollingSummaryRound,
} from '../../src/engine-adapters/persistence/rolling-summary.generator.js';
import { TurnRenderOrchestrator, type TurnSessionContext } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { EngineSessionRegistry, EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import {
  ENGINE_MEMORY_STORE,
  ENGINE_RENDER_PORT,
  ENGINE_SESSION_PORT,
  ROLLING_SUMMARY_CLEANUP,
} from '../../src/engine-adapters/wiring/engine.tokens.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  createEmptyBdiSnapshot,
  type EngineSessionHandle,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type MemoryStore,
  type RenderResult,
  type SafetyVerdict,
  type WorkingWindowOverflowEvent,
} from '../../src/engine-core/index.js';

const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const SESSION = 'session-1';
const HANDLE_ID = 'handle-1';
const CLOCK = 1_700_000_000_000;
const CONTEXT: TurnSessionContext = { tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION };

/** 摘要生成器 stub: 记录入参, 返回固定摘要 (或抛错). */
function generatorStub(options: { readonly summary?: string; readonly fail?: boolean }): {
  readonly generate: (input: RollingSummaryInput) => Promise<string>;
  readonly calls: RollingSummaryInput[];
} {
  const calls: RollingSummaryInput[] = [];
  return {
    calls,
    generate: async (input) => {
      calls.push(input);
      if (options.fail) throw new Error('llm down');
      return options.summary ?? '摘要';
    },
  };
}

/** 造一次内核溢出事件 (淘汰信号). */
function overflowEvent(pushedOut: readonly string[]): WorkingWindowOverflowEvent {
  return { tenantId: TENANT, sessionId: SESSION, visitorId: VISITOR, pushedOut };
}

/** 危机判定 (用来造阻断轮次: action=block → 本轮 AI 不出声). */
const BLOCK_SAFETY: SafetyVerdict = {
  level: 'block',
  side: 'counselor_input',
  categories: ['suicide_attempt'],
  matchedRules: [],
  source: 'rule',
};

/** 门面落账时上报的一轮 (记录下来供断言). */
interface ReportedRound {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  readonly counselor: string;
  readonly visitor: string | null;
}

describe('WP55 · 会话摘要补齐来访者侧 (适配层)', () => {
  describe('① 两侧纪要: 生成器同时拿到两侧内容', () => {
    it('摘要输入里咨询师与来访者两侧都有', async () => {
      const generator = generatorStub({ summary: '聊了失眠' });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      service.recordRound(TENANT, SESSION, VISITOR, '你最近睡得怎么样？', '我凌晨三点才睡');
      service.recordOverflow(overflowEvent(['你最近睡得怎么样？']));

      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));
      expect(generator.calls[0]?.rounds).toEqual([{ counselor: '你最近睡得怎么样？', visitor: '我凌晨三点才睡' }]);
    });

    it('来访者没发言的轮次 → 记 null (不是空串)', async () => {
      const generator = generatorStub({ summary: '摘要' });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      service.recordRound(TENANT, SESSION, VISITOR, '这一轮来访者没说话', null);
      service.recordOverflow(overflowEvent(['这一轮来访者没说话']));

      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));
      expect(generator.calls[0]?.rounds[0]?.visitor).toBeNull();
    });

    it('formatRollingSummaryInput: 问答交替, 每轮两行', () => {
      const text = formatRollingSummaryInput({
        rounds: [
          { counselor: '你最近睡得怎么样？', visitor: '我凌晨三点才睡' },
          { counselor: '工作压力呢？', visitor: '最近老加班' },
        ],
      });

      expect(text).toContain('[新增的对话记录]');
      expect(text).toContain('咨询师: 你最近睡得怎么样？\n来访者: 我凌晨三点才睡');
      expect(text).toContain('咨询师: 工作压力呢？\n来访者: 最近老加班');
    });

    it('formatRollingSummaryInput: 无回复的轮次写明「（本轮来访者无回复）」', () => {
      const text = formatRollingSummaryInput({
        rounds: [{ counselor: '你还好吗？', visitor: null }],
      });

      expect(text).toContain('咨询师: 你还好吗？');
      expect(text).toContain('来访者: （本轮来访者无回复）');
    });
  });

  describe('② 配对不错位 (核心回归防线)', () => {
    it('中间有一轮被阻断 → 来访者话仍挂在它自己那一轮上', async () => {
      const generator = generatorStub({ summary: '摘要' });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 6,
      });

      // 六轮, 第 4 轮被阻断 (来访者没发言) —— 错配就发生在这里之后.
      const rounds: RollingSummaryRound[] = [
        { counselor: 'c1', visitor: 'v1' },
        { counselor: 'c2', visitor: 'v2' },
        { counselor: 'c3', visitor: 'v3' },
        { counselor: 'c4', visitor: null },
        { counselor: 'c5', visitor: 'v5' },
        { counselor: 'c6', visitor: 'v6' },
      ];
      for (const round of rounds) {
        service.recordRound(TENANT, SESSION, VISITOR, round.counselor, round.visitor);
        service.recordOverflow(overflowEvent([round.counselor]));
      }

      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));
      // 逐字相等: 每一轮的 (问, 答) 都还是它自己那一对, 顺序也没变.
      expect(generator.calls[0]?.rounds).toEqual(rounds);
    });

    it('阻断之后的轮次不会被错配 (来访者话不会挂到别的轮次上)', async () => {
      const generator = generatorStub({ summary: '摘要' });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 3,
      });

      service.recordRound(TENANT, SESSION, VISITOR, 'c1', 'v1');
      service.recordOverflow(overflowEvent(['c1']));
      service.recordRound(TENANT, SESSION, VISITOR, 'c2', null);
      service.recordOverflow(overflowEvent(['c2']));
      service.recordRound(TENANT, SESSION, VISITOR, 'c3', 'v3');
      service.recordOverflow(overflowEvent(['c3']));

      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));
      const batch = generator.calls[0]?.rounds ?? [];
      expect(batch).toHaveLength(3);
      expect(batch[1]).toEqual({ counselor: 'c2', visitor: null });
      expect(batch[2]).toEqual({ counselor: 'c3', visitor: 'v3' });
      // 关键: v3 绝不能被挂到 c2 上 (那就是凭空捏造的问答对).
      expect(batch.filter((round) => round.visitor === 'v3')).toHaveLength(1);
      expect(batch[1]?.visitor).not.toBe('v3');
    });
  });

  describe('③ 淘汰匹配: 压进去的就是被淘汰的那一轮', () => {
    it('内核淘汰哪一轮 → 压哪一轮 (不多不少)', async () => {
      const generator = generatorStub({ summary: '摘要' });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      service.recordRound(TENANT, SESSION, VISITOR, 'c1', 'v1');
      service.recordRound(TENANT, SESSION, VISITOR, 'c2', 'v2');
      service.recordOverflow(overflowEvent(['c1']));

      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));
      expect(generator.calls[0]?.rounds).toEqual([{ counselor: 'c1', visitor: 'v1' }]);
    });

    it('还没被淘汰的轮次不压 (还在 prompt 里, 压了就是重复)', async () => {
      const generator = generatorStub({ summary: '摘要' });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      service.recordRound(TENANT, SESSION, VISITOR, 'c1', 'v1');
      service.recordRound(TENANT, SESSION, VISITOR, 'c2', 'v2');
      await Promise.resolve();

      expect(generator.calls).toHaveLength(0);
      expect(service.latestSummary(TENANT, SESSION)).toBeUndefined();
    });

    it('门面上报缺失的那一轮 → 跳过, 不猜 (不产生错配)', async () => {
      const generator = generatorStub({ summary: '摘要' });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 2,
      });

      // c2 那一轮的落账被异常打断 → 门面上报缺一条.
      service.recordRound(TENANT, SESSION, VISITOR, 'c1', 'v1');
      service.recordRound(TENANT, SESSION, VISITOR, 'c3', 'v3');
      service.recordOverflow(overflowEvent(['c1']));
      service.recordOverflow(overflowEvent(['c2']));
      service.recordOverflow(overflowEvent(['c3']));

      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));
      const batch = generator.calls[0]?.rounds ?? [];
      // c2 没有轮次记录 → 跳过它, 绝不能把 c1 或 c3 的来访者话挂上去.
      expect(batch.map((round) => round.counselor)).toEqual(['c1', 'c3']);
      expect(batch[0]).toEqual({ counselor: 'c1', visitor: 'v1' });
      expect(batch[1]).toEqual({ counselor: 'c3', visitor: 'v3' });
    });
  });

  describe('④ 失败回滚: LLM 挂了本批留待下次', () => {
    it('生成器抛错 → 本批轮次放回队首, 顺序不变', async () => {
      const generator = generatorStub({ fail: true });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 2,
      });

      service.recordRound(TENANT, SESSION, VISITOR, 'c1', 'v1');
      service.recordRound(TENANT, SESSION, VISITOR, 'c2', 'v2');
      service.recordOverflow(overflowEvent(['c1']));
      service.recordOverflow(overflowEvent(['c2']));
      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));

      // 再淘汰一轮 → 上一批仍在队首, 一起再压一次 (顺序不变).
      service.recordRound(TENANT, SESSION, VISITOR, 'c3', 'v3');
      service.recordOverflow(overflowEvent(['c3']));
      await vi.waitFor(() => expect(generator.calls).toHaveLength(2));

      expect(generator.calls[1]?.rounds.map((round) => round.counselor)).toEqual(['c1', 'c2', 'c3']);
    });

    it('没装配生成器 → 只攒不压, 不抛错', async () => {
      const service = new RollingSessionSummaryService({ memories: new InMemoryMemoryStore() });

      expect(() => {
        service.recordRound(TENANT, SESSION, VISITOR, 'c1', 'v1');
        service.recordOverflow(overflowEvent(['c1']));
      }).not.toThrow();
      await Promise.resolve();

      expect(service.latestSummary(TENANT, SESSION)).toBeUndefined();
    });
  });

  describe('⑤ 门面落账上报 (两侧内容从哪来)', () => {
    it('正常轮次 → 上报咨询师话 + 来访者回复', async () => {
      const { orchestrator, reported } = buildOrchestrator({ reply: '我凌晨三点才睡' });

      await orchestrator.turn(HANDLE_ID, { userText: '你最近睡得怎么样？' });

      expect(reported).toEqual([
        {
          tenantId: TENANT,
          sessionId: SESSION,
          visitorId: VISITOR,
          counselor: '你最近睡得怎么样？',
          visitor: '我凌晨三点才睡',
        },
      ]);
    });

    it('渲染降级轮次 → 来访者侧上报 null (兜底句不是来访者说的话)', async () => {
      const { orchestrator, reported } = buildOrchestrator({ reply: '' });

      await orchestrator.turn(HANDLE_ID, { userText: '你最近睡得怎么样？' });

      expect(reported).toHaveLength(1);
      expect(reported[0]?.visitor).toBeNull();
    });

    it('阻断轮次 → 来访者侧上报 null (这一轮来访者没出声)', async () => {
      const { orchestrator, reported } = buildOrchestrator({ reply: '不该出现', safety: BLOCK_SAFETY });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '我想死了' });

      expect(result.reply).toBe('');
      expect(reported).toHaveLength(1);
      expect(reported[0]).toEqual({
        tenantId: TENANT,
        sessionId: SESSION,
        visitorId: VISITOR,
        counselor: '我想死了',
        visitor: null,
      });
    });

    it('没装配滚动摘要口 → 不上报, 也不抛错', async () => {
      const { orchestrator } = buildOrchestrator({ reply: '来访回复', withPort: false });

      await expect(orchestrator.turn(HANDLE_ID, { userText: '你好' })).resolves.toBeDefined();
    });
  });

  describe('⑥ 会话关闭清理 (修 WP37 遗留的状态泄漏)', () => {
    it('forgetSession → 状态清掉 (会话结束不留残)', async () => {
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator: generatorStub({ summary: '摘要' }),
        batchSize: 1,
      });

      service.recordRound(TENANT, SESSION, VISITOR, 'c1', 'v1');
      service.recordOverflow(overflowEvent(['c1']));
      await vi.waitFor(() => expect(service.latestSummary(TENANT, SESSION)).toBe('摘要'));
      expect(service.trackedSessionCount()).toBe(1);

      service.forgetSession(TENANT, SESSION);

      expect(service.trackedSessionCount()).toBe(0);
      expect(service.latestSummary(TENANT, SESSION)).toBeUndefined();
    });

    it('EngineTurnService.close → 释放滚动摘要的会话状态', () => {
      const forgetSession = vi.fn();
      const { service } = buildTurnService({ forgetSession });

      service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR }, { characterLabel: '晚晴' });
      service.close(HANDLE_ID);

      expect(forgetSession).toHaveBeenCalledWith(TENANT, SESSION);
    });

    it('close 时归属查不到 → 不抛错 (幂等)', () => {
      const forgetSession = vi.fn();
      const { service } = buildTurnService({ forgetSession });

      expect(() => service.close('never-opened-handle')).not.toThrow();
      expect(forgetSession).not.toHaveBeenCalled();
    });

    it('用真服务跑一遍 close → 状态真的被释放 (不是只调了个桩)', () => {
      const summary = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator: generatorStub({ summary: '摘要' }),
        batchSize: 1,
      });
      summary.recordRound(TENANT, SESSION, VISITOR, 'c1', 'v1');
      expect(summary.trackedSessionCount()).toBe(1);

      const session = new StubSession(undefined);
      const registry = new EngineSessionRegistry();
      const orchestrator = new TurnRenderOrchestrator({
        session,
        renderer: new StubRenderer('来访回复', []),
        memories: new StubMemoryStore(),
        resolveSession: () => CONTEXT,
        now: () => CLOCK,
        idFactory: () => 'memory-visitor-1',
      });
      const service = new EngineTurnService(session, orchestrator, registry, summary);

      service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR });
      service.close(HANDLE_ID);

      expect(summary.trackedSessionCount()).toBe(0);
      expect(summary.latestSummary(TENANT, SESSION)).toBeUndefined();
    });

    it('清理端口用显式 token 注入 (interface 没有运行时值, 靠类型注入会静默拿到 undefined)', () => {
      // token 本身必须是 symbol, 且与别的端口 token 不撞车.
      const tokens = [ENGINE_SESSION_PORT, ENGINE_MEMORY_STORE, ENGINE_RENDER_PORT, ROLLING_SUMMARY_CLEANUP];
      for (const token of tokens) expect(typeof token).toBe('symbol');
      expect(new Set(tokens).size).toBe(4);

      // 装配层必须真的把它接上 —— "声明了 token 但没注册 provider" = 静默注入 undefined,
      // 症状是"会话关了但滚动摘要状态不释放", 正是本单要修的泄漏.
      const moduleSource = readFileSync(path.join(process.cwd(), 'src/engine-adapters/wiring/engine.module.ts'), 'utf8');
      expect(moduleSource).toContain('provide: ROLLING_SUMMARY_CLEANUP');
      expect(moduleSource).toContain('inject: [RollingSessionSummaryService]');
    });
  });

  describe('⑦ 零回归: 没装配摘要服务时行为不变', () => {
    it('门面的历史与 prompt 逐字不变', async () => {
      const withPort = buildOrchestrator({ reply: '来访回复', withPort: true });
      const withoutPort = buildOrchestrator({ reply: '来访回复', withPort: false });

      await withPort.orchestrator.turn(HANDLE_ID, { userText: '你最近睡得怎么样？' });
      await withoutPort.orchestrator.turn(HANDLE_ID, { userText: '你最近睡得怎么样？' });

      expect(withPort.specs.at(-1)?.recentTurns).toEqual(withoutPort.specs.at(-1)?.recentTurns);
      expect(withPort.specs.at(-1)?.recentTurns).toEqual([{ role: 'counselor', text: '你最近睡得怎么样？' }]);
    });

    it('攒批阈值种子值没变 (3)', () => {
      expect(DEFAULT_ROLLING_SUMMARY_BATCH_SIZE).toBe(3);
    });
  });
});

// ── 测试替身 ──────────────────────────────────────────────────────

/** 门面构造: 带一个记录轮次上报的滚动摘要口. */
function buildOrchestrator(options: { readonly reply: string; readonly safety?: SafetyVerdict; readonly withPort?: boolean }): {
  readonly orchestrator: TurnRenderOrchestrator;
  readonly reported: ReportedRound[];
  readonly specs: { readonly recentTurns: readonly { role: string; text: string }[] }[];
} {
  const reported: ReportedRound[] = [];
  const specs: { recentTurns: readonly { role: string; text: string }[] }[] = [];

  const session = new StubSession(options.safety);
  const renderer = new StubRenderer(options.reply, specs);
  const orchestrator = new TurnRenderOrchestrator({
    session,
    renderer,
    memories: new StubMemoryStore(),
    resolveSession: () => CONTEXT,
    now: () => CLOCK,
    idFactory: () => 'memory-visitor-1',
    ...(options.withPort === false
      ? {}
      : {
          rollingSummary: {
            latestSummary: () => {},
            recordRound: (tenantId: string, sessionId: string, visitorId: string, counselor: string, visitor: string | null): void => {
              reported.push({ tenantId, sessionId, visitorId, counselor, visitor });
            },
          },
        }),
  });

  return { orchestrator, reported, specs };
}

/** 会话门面服务 (带一个记录 forgetSession 调用的滚动摘要清理口). */
function buildTurnService(options: { readonly forgetSession: (tenantId: string, sessionId: string) => void }): {
  readonly service: EngineTurnService;
} {
  const session = new StubSession(undefined);
  const registry = new EngineSessionRegistry();
  const orchestrator = new TurnRenderOrchestrator({
    session,
    renderer: new StubRenderer('来访回复', []),
    memories: new StubMemoryStore(),
    resolveSession: () => CONTEXT,
    now: () => CLOCK,
    idFactory: () => 'memory-visitor-1',
  });
  const service = new EngineTurnService(session, orchestrator, registry, {
    forgetSession: options.forgetSession,
  });
  return { service };
}

/** 构造内核一轮出参. */
function buildOutput(safety?: SafetyVerdict): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    ...(safety ? { safety } : {}),
  };
}

/** 会话端口 stub: 固定出参. */
class StubSession implements EngineSessionPort {
  constructor(private readonly safety?: SafetyVerdict) {}

  openSession(input: { sessionId: string }): EngineSessionHandle {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  async turn(_handleId: string, _input: EngineTurnInput): Promise<EngineTurnOutput> {
    return buildOutput(this.safety);
  }

  closeSession(): void {
    /* 占位以满足端口契约. */
  }
}

/** 渲染端口 stub: 记录规格, 返回固定文本 (空串 = 降级). */
class StubRenderer {
  constructor(
    private readonly reply: string,
    private readonly specs: { recentTurns: readonly { role: string; text: string }[] }[],
  ) {}

  async render(spec: { recentTurns: readonly { role: string; text: string }[] }): Promise<RenderResult> {
    this.specs.push(spec);
    return {
      text: this.reply,
      taskKind: 'chat',
      usage: { completionTokens: 20, totalTokens: 40 },
      fallbackUsed: false,
    };
  }
}

/** 记忆仓储 stub. */
class StubMemoryStore implements MemoryStore {
  async remember(): Promise<void> {
    /* 占位. */
  }

  async recall(): Promise<never[]> {
    return [];
  }
}
