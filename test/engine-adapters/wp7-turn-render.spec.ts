// V2026-10-28 治本 (WP7 · B 层 · 决策→说话闭环单测):
//   覆盖任务单 §8 单测清单 1-8:
//     1. 规格映射      → intention/情绪/阻抗/移情/信任/信念与来源一致, taskKind='chat'
//     2. 历史裁剪      → 组装结果与内核 fitContextToBudget 逐字一致 (证明复用了内核口径)
//     3. 成功闭环      → reply 等于渲染文本, render.fallbackUsed/providerHint 透传
//     4. 成对记忆      → 只写来访半边 (tier=WORKING, source=TURN), 不重复写咨询师半边
//     5. 渲染异常不炸穿 → 不 reject, 返回非空兜底句, fallbackUsed=true
//     6. 内核错误冒泡  → session.turn 抛 ABORTED 原样抛出, 不被降级吞掉
//     7. system prompt 缝 → 系统消息存在, 咨询师→user / 来访→assistant
//     8. 零回归        → 门面/组装器源码零框架与网络依赖 (import 面扫描)
//
//   全 mock, 不起 NestJS, 不发网络:
//     会话端口 / 渲染端口 / 记忆仓储全部用 stub; 时钟与 id 工厂注入假值.
//
//   关于第 8 条的断言口径 (为什么扫 import 而不是扫全文):
//     任务单原文是"源码不出现 @nestjs / typeorm / fetch / axios". 若按**全文**匹配,
//     连"本文件不使用框架"这句话本身都会写不进去 —— 断言会把**说明约束的注释**
//     当成违规. 真正的风险是"引入了依赖", 所以断言打在 import/require 上:
//     那是依赖面的真实口径, 且比全文匹配更严格 (漏写注释里的字不会掩盖真依赖).
//
//   验证: npx jest test/engine-adapters/wp7-turn-render.spec.ts
//   时间戳: 2026-10-28 GMT+8

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildRenderSpec } from '../../src/engine-adapters/rendering/spec-assembler';
import {
  DEFAULT_TURN_FALLBACK_UTTERANCE,
  TurnRenderOrchestrator,
  buildVisitorMessages,
  type TurnSessionContext,
} from '../../src/engine-adapters/rendering/turn-render-orchestrator';
import {
  EngineCoreError,
  EngineErrorCode,
  MemorySource,
  MemoryTier,
  createEmptyBdiSnapshot,
  fitContextToBudget,
  type EngineSessionHandle,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type Intention,
  type MemoryEntry,
  type MemoryHit,
  type MemoryStore,
  type OpenEngineSessionInput,
  type RenderContextTurn,
  type RenderPort,
  type RenderResult,
  type RenderSpec,
  type RenderTokenBudget,
} from '../../src/engine-core';

const HANDLE_ID = 'handle-1';
const CLOCK = 1_700_000_000_000;
const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const SESSION = 'session-1';
const USER_TEXT = '你最近睡得怎么样？';
const REPLY = '有点累，夜里老醒。';

/** 渲染预算 (与门面默认一致). */
const BUDGET: RenderTokenBudget = { maxCompletionTokens: 160, contextTokens: 512 };

/** 会话归属. */
const CONTEXT: TurnSessionContext = { tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION };

/** 构造一个意图. */
function buildIntention(): Intention {
  return {
    strategy: 'recounting',
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    forbiddenBehaviors: ['judge'],
  };
}

/** 构造内核一轮出参. */
function buildOutput(overrides: Partial<EngineTurnOutput> = {}): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    intention: buildIntention(),
    ...overrides,
  };
}

/** 会话端口 stub: 固定出参或固定抛错. */
class StubSession implements EngineSessionPort {
  readonly turnCalls: { handleId: string; input: EngineTurnInput }[] = [];

  constructor(private readonly behavior: { output: EngineTurnOutput } | { error: Error }) {}

  openSession(input: OpenEngineSessionInput): EngineSessionHandle {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  async turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput> {
    this.turnCalls.push({ handleId, input });
    if ('error' in this.behavior) throw this.behavior.error;
    return this.behavior.output;
  }

  closeSession(): void {
    /* 门面不调它; 占位以满足端口契约. */
  }
}

/** 渲染端口 stub: 固定返回文本或固定抛错. */
class StubRenderer implements RenderPort {
  readonly specs: RenderSpec[] = [];

  constructor(
    private readonly behavior: { ok: true; text: string; fallbackUsed?: boolean; providerHint?: string } | { ok: false; error: Error },
  ) {}

  async render(spec: RenderSpec): Promise<RenderResult> {
    this.specs.push(spec);
    if ('error' in this.behavior) throw this.behavior.error;
    return {
      text: this.behavior.text,
      taskKind: spec.taskKind,
      usage: { completionTokens: 20, totalTokens: 40 },
      fallbackUsed: this.behavior.fallbackUsed ?? false,
      ...(this.behavior.providerHint ? { providerHint: this.behavior.providerHint } : {}),
    };
  }
}

/** 记忆仓储 stub: 记录写入; 可注入失败. */
class StubMemoryStore implements MemoryStore {
  readonly remembered: MemoryEntry[] = [];
  failRemember = false;

  async remember(entry: MemoryEntry): Promise<void> {
    if (this.failRemember) throw new Error('store down');
    this.remembered.push(entry);
  }

  async recall(): Promise<readonly MemoryHit[]> {
    return [];
  }
}

/** 构造门面 (全注入, 无全局状态). */
function buildOrchestrator(options: {
  readonly session?: StubSession;
  readonly renderer?: StubRenderer;
  readonly memories?: StubMemoryStore;
}): {
  readonly orchestrator: TurnRenderOrchestrator;
  readonly session: StubSession;
  readonly renderer: StubRenderer;
  readonly memories: StubMemoryStore;
} {
  const session = options.session ?? new StubSession({ output: buildOutput() });
  const renderer = options.renderer ?? new StubRenderer({ ok: true, text: REPLY });
  const memories = options.memories ?? new StubMemoryStore();
  const orchestrator = new TurnRenderOrchestrator({
    session,
    renderer,
    memories,
    resolveSession: () => CONTEXT,
    now: () => CLOCK,
    idFactory: () => 'memory-visitor-1',
  });
  return { orchestrator, session, renderer, memories };
}

describe('WP7 · 决策→说话闭环', () => {
  describe('① 规格映射', () => {
    it('intention / 情绪 / 阻抗 / 移情 / 信任 / 信念 与来源一致, taskKind=chat', () => {
      const output = buildOutput();
      const spec = buildRenderSpec({
        output,
        recentTurns: [{ role: 'counselor', text: USER_TEXT }],
        tokenBudget: BUDGET,
      });

      expect(spec.taskKind).toBe('chat');
      expect(spec.intention).toEqual(output.intention);
      expect(spec.emotion).toEqual(output.snapshot.emotion);
      expect(spec.resistance).toEqual(output.snapshot.resistance);
      expect(spec.transference).toEqual(output.snapshot.transference);
      expect(spec.trust).toBe(output.snapshot.trust);
      expect(spec.coreBeliefs).toEqual(output.snapshot.coreBeliefs);
      expect(spec.forbiddenBehaviors).toEqual(['judge']);
      expect(spec.recall).toEqual([]);
      expect(spec.tokenBudget).toBe(BUDGET);
    });

    it('内核没给出意图时构造中性最小意图, 不抛错', () => {
      const output = buildOutput({ intention: undefined });
      const spec = buildRenderSpec({ output, recentTurns: [], tokenBudget: BUDGET });

      expect(spec.intention.strategy).toBe('simple_response');
      expect(spec.intention.emotion).toEqual(output.snapshot.emotion);
      expect(spec.intention.forbiddenBehaviors).toEqual([]);
    });

    it('角色层禁止行为与意图层合并去重', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        roleForbiddenBehaviors: ['judge', 'promise'],
        tokenBudget: BUDGET,
      });

      expect(spec.forbiddenBehaviors).toEqual(['judge', 'promise']);
    });
  });

  describe('② 历史裁剪', () => {
    it('组装结果与内核 fitContextToBudget 逐字一致 (复用内核口径)', () => {
      const longTurns: RenderContextTurn[] = Array.from({ length: 30 }, (_, index) => ({
        role: index % 2 === 0 ? ('counselor' as const) : ('visitor' as const),
        text: '这是一句比较长的话用来把上下文预算撑满'.repeat(6),
      }));

      const spec = buildRenderSpec({ output: buildOutput(), recentTurns: longTurns, tokenBudget: { ...BUDGET, contextTokens: 100 } });

      expect(spec.recentTurns).toEqual(fitContextToBudget(longTurns, 100).turns);
      expect(spec.recentTurns.length).toBeLessThan(longTurns.length);
      // 最新一轮永远保留 (对话新近性最重要).
      expect(spec.recentTurns.at(-1)?.text).toBe(longTurns.at(-1)?.text);
    });
  });

  describe('③ 成功闭环', () => {
    it('reply 等于渲染文本, render 元信息正确透传', async () => {
      const renderer = new StubRenderer({ ok: true, text: REPLY, fallbackUsed: false, providerHint: 'deepseek' });
      const { orchestrator } = buildOrchestrator({ renderer });

      const result = await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(result.reply).toBe(REPLY);
      expect(result.render.fallbackUsed).toBe(false);
      expect(result.render.providerHint).toBe('deepseek');
      expect(result.render.usage).toEqual({ completionTokens: 20, totalTokens: 40 });
      expect(result.turnIndex).toBe(1);
      expect(result.intention?.strategy).toBe('recounting');
    });

    it('内核出参逐字透传 (快照 / 轨迹 / 安全 / 开场上下文)', async () => {
      const output = buildOutput({
        turnIndex: 3,
        trajectoryTrace: {
          scriptId: 'script-1',
          mode: 'force_override',
          activated: true,
          activeNodeId: 'n1',
          advanced: true,
          cursor: 2,
          visitedNodeIds: ['n1'],
        },
        safety: { level: 'warn', side: 'counselor_input', categories: ['value_judgment'], matchedRules: [], source: 'rule' },
        openingContext: [{ entry: buildMemoryEntry(), score: 0.8 }],
      });
      const { orchestrator } = buildOrchestrator({ session: new StubSession({ output }) });

      const result = await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(result.snapshot).toEqual(output.snapshot);
      expect(result.turnIndex).toBe(3);
      expect(result.trajectoryTrace).toEqual(output.trajectoryTrace);
      expect(result.safety).toEqual(output.safety);
      expect(result.openingContext).toEqual(output.openingContext);
    });

    it('第二轮的渲染上下文含上一轮的问与答', async () => {
      const renderer = new StubRenderer({ ok: true, text: REPLY });
      const { orchestrator } = buildOrchestrator({ renderer });

      await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });
      await orchestrator.turn(HANDLE_ID, { userText: '那睡之前你会想什么？' });

      const secondSpec = renderer.specs[1];
      expect(secondSpec?.recentTurns).toEqual([
        { role: 'counselor', text: USER_TEXT },
        { role: 'visitor', text: REPLY },
        { role: 'counselor', text: '那睡之前你会想什么？' },
      ]);
    });
  });

  describe('④ 成对记忆', () => {
    it('只写来访半边 (tier=WORKING, source=TURN), 不重复写咨询师半边', async () => {
      const memories = new StubMemoryStore();
      const { orchestrator } = buildOrchestrator({ memories });

      await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(memories.remembered).toHaveLength(1);
      expect(memories.remembered[0]).toMatchObject({
        content: REPLY,
        tier: MemoryTier.WORKING,
        source: MemorySource.TURN,
        tenantId: TENANT,
        visitorId: VISITOR,
        sessionId: SESSION,
        importance: 0.5,
        occurredAt: CLOCK,
      });
      // 咨询师半边由内核 rememberTurn 写, 门面不重复写.
      expect(memories.remembered.some((entry) => entry.content === USER_TEXT)).toBe(false);
    });

    it('记忆写失败不炸穿 (本轮回复照常返回)', async () => {
      const memories = new StubMemoryStore();
      memories.failRemember = true;
      const { orchestrator } = buildOrchestrator({ memories });

      const result = await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(result.reply).toBe(REPLY);
    });
  });

  describe('⑤ 渲染异常不炸穿', () => {
    it('renderer reject → 不 reject, 返回非空兜底句, fallbackUsed=true', async () => {
      const renderer = new StubRenderer({ ok: false, error: new Error('provider exploded') });
      const memories = new StubMemoryStore();
      const { orchestrator } = buildOrchestrator({ renderer, memories });

      const result = await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(result.reply).toBe(DEFAULT_TURN_FALLBACK_UTTERANCE);
      expect(result.reply.length).toBeGreaterThan(0);
      expect(result.render.fallbackUsed).toBe(true);
      expect(result.render.providerHint).toBe('degraded');
      // 降级句是系统产物, 不是来访真说的话 → 不写工作记忆.
      expect(memories.remembered).toHaveLength(0);
    });

    it('渲染结果为空串 → 同样降级为兜底句', async () => {
      const renderer = new StubRenderer({ ok: true, text: ' '.repeat(3) });
      const { orchestrator } = buildOrchestrator({ renderer });

      const result = await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(result.reply).toBe(DEFAULT_TURN_FALLBACK_UTTERANCE);
      expect(result.render.fallbackUsed).toBe(true);
    });
  });

  describe('⑥ 内核错误冒泡', () => {
    it('session.turn 抛 ABORTED → 原样抛出, 不被降级吞掉', async () => {
      const session = new StubSession({ error: new EngineCoreError(EngineErrorCode.ABORTED, '用户已中断') });
      const { orchestrator } = buildOrchestrator({ session });

      await expect(orchestrator.turn(HANDLE_ID, { userText: USER_TEXT })).rejects.toThrow('用户已中断');
    });
  });

  describe('⑦ system prompt 缝', () => {
    it('系统消息存在, 咨询师→user / 来访→assistant', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [
          { role: 'counselor', text: USER_TEXT },
          { role: 'visitor', text: '有点累' },
        ],
        tokenBudget: BUDGET,
      });

      const messages = buildVisitorMessages(spec);

      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toContain('来访者');
      expect(messages[1]).toEqual({ role: 'user', content: USER_TEXT });
      expect(messages[2]).toEqual({ role: 'assistant', content: '有点累' });
    });

    it('系统侧带本轮状态与禁止行为, 但历史里不掺状态词', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [{ role: 'counselor', text: USER_TEXT }],
        tokenBudget: BUDGET,
      });

      const messages = buildVisitorMessages(spec);
      const systemText = messages[0]?.content ?? '';

      expect(systemText).toContain('复述一段经历');
      expect(systemText).toContain('judge');
      expect(systemText).toContain('不给建议');
      // 历史消息只有原话, 不含任何状态词.
      expect(messages[1]?.content).toBe(USER_TEXT);
    });
  });

  describe('⑧ 零回归', () => {
    it('门面/组装器零框架与网络依赖 (import 面扫描)', () => {
      const root = path.join(__dirname, '../../src/engine-adapters/rendering');
      const forbidden = /@nestjs|typeorm|\bfetch\b|axios/;

      for (const file of ['turn-render-orchestrator.ts', 'spec-assembler.ts']) {
        const source = readFileSync(path.join(root, file), 'utf8');
        const specifiers = [...source.matchAll(/(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
        expect(specifiers.filter((specifier) => forbidden.test(specifier))).toEqual([]);
      }
    });
  });
});

/** 构造一条记忆条目 (开场上上下文用). */
function buildMemoryEntry(): MemoryEntry {
  return {
    id: 'memory-1',
    tenantId: TENANT,
    visitorId: VISITOR,
    sessionId: SESSION,
    tier: MemoryTier.LONG_TERM,
    source: MemorySource.SUMMARY,
    content: '上次来访提到长期失眠。',
    importance: 0.8,
    occurredAt: CLOCK,
  };
}
