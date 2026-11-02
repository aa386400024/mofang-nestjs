// V2026-11-02 治本 (WP14 · 学员心理风险处置层单测):
//   覆盖任务单 §8 的验收面 (5 个必测场景 + 三条边界):
//     ① **high 阻断不渲染**      → block 级危机: 不调 RenderPort.render, reply 为空;
//     ② **medium 不阻断推 toast** → warn 级危机: AI 正常回复, 处置档位 = toast;
//     ③ **visitor_output 不推学员** → AI 来访角色的台词是演练素材, 学员侧一律无动作;
//     ④ **PsyGUARD 挂掉回落本地词典** → D12 治本: 远端 503 → 委托本地词典判;
//     ⑤ **monitored=true 后续强制探测** → high 之后本场进入重点监测, 后续每轮强制问远端.
//
//   另加**三条边界**的钉死 (它们比"有没有弹窗"更要紧):
//     · **side 边界**: 学员自己说的话要处置, AI 角色说的话绝不处置;
//     · **类别边界**: 只有**危机类别**才处置 —— 专业越界 (承诺治愈 / 双重关系 …)
//       是督导的事后复盘项, 不该在对话中途弹窗打断学员;
//     · **零回归**: 没有处置时结果形状逐字不变 (不带 disposal 键).
//
//   全 mock: 会话端口 / 渲染端口 / 记忆仓储 / 处置闸门全用 stub; 不起 NestJS, 不发网络.
//
//   验证: npx vitest run test/engine-adapters/wp14-student-risk-disposal.spec.ts
//   时间戳: 2026-11-02

import { runWithProbeSource } from '../../src/engine-adapters/rendering/probe-source.js';
import {
  buildCrisisModalFrame,
  buildCrisisToastFrame,
  buildStudentRiskDecision,
  buildStudentRiskDecisionFromProbe,
  decideStudentRiskAction,
  mergeStudentRiskDecisions,
  truncateRiskSnippet,
  type StudentRiskDecision,
  type StudentRiskGate,
} from '../../src/engine-adapters/rendering/student-risk-disposal.js';
import { TurnRenderOrchestrator, type TurnSessionContext } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { createRiskProbe } from '../../src/engine-adapters/wiring/engine.providers.js';
import { HttpPsyGuardProbe, type PsyGuardFetch } from '../../src/engine-adapters/wiring/risk/http-psyguard.probe.js';
import { LocalCrisisProbe, detectCrisisCategories } from '../../src/engine-adapters/wiring/risk/local-crisis.probe.js';
import {
  createEmptyBdiSnapshot,
  type EngineSessionHandle,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type Intention,
  type MemoryEntry,
  type MemoryHit,
  type MemoryStore,
  type OpenEngineSessionInput,
  type RenderPort,
  type RenderResult,
  type RenderSpec,
  type SafetyVerdict,
} from '../../src/engine-core/index.js';

const HANDLE_ID = 'handle-1';
const CLOCK = 1_700_000_000_000;
const CONTEXT: TurnSessionContext = { tenantId: 'tenant-1', visitorId: 'visitor-1', sessionId: 'session-1' };
const REPLY = '有点累，夜里老醒。';

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

/** 构造内核一轮出参 (可带安全判定). */
function buildOutput(safety?: SafetyVerdict): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    intention: buildIntention(),
    ...(safety ? { safety } : {}),
  };
}

/** 构造一条安全判定. */
function buildVerdict(overrides: Partial<SafetyVerdict> = {}): SafetyVerdict {
  return {
    level: 'pass',
    side: 'counselor_input',
    categories: [],
    matchedRules: [],
    source: 'rule',
    ...overrides,
  };
}

/** 会话端口 stub: 按队列返回出参. */
class StubSession implements EngineSessionPort {
  readonly turnCalls: { handleId: string; input: EngineTurnInput }[] = [];

  constructor(private readonly outputs: EngineTurnOutput[]) {}

  openSession(input: OpenEngineSessionInput): EngineSessionHandle {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  async turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput> {
    this.turnCalls.push({ handleId, input });
    const next = this.outputs.shift() ?? buildOutput();
    return next;
  }

  closeSession(): void {
    /* 门面不调它; 占位以满足端口契约. */
  }
}

/** 渲染端口 stub: 记录调用次数. */
class StubRenderer implements RenderPort {
  readonly specs: RenderSpec[] = [];

  async render(spec: RenderSpec): Promise<RenderResult> {
    this.specs.push(spec);
    return {
      text: REPLY,
      taskKind: spec.taskKind,
      usage: { completionTokens: 20, totalTokens: 40 },
      fallbackUsed: false,
    };
  }
}

/** 记忆仓储 stub. */
class StubMemoryStore implements MemoryStore {
  readonly remembered: MemoryEntry[] = [];

  async remember(entry: MemoryEntry): Promise<void> {
    this.remembered.push(entry);
  }

  async recall(): Promise<readonly MemoryHit[]> {
    return [];
  }
}

/** 处置闸门 stub: 可控监测状态 + 可控强制探测结果. */
class StubGate implements StudentRiskGate {
  monitored = false;
  forceCalls: { text: string; handleId: string }[] = [];
  forced: StudentRiskDecision | undefined;

  isMonitored(): boolean {
    return this.monitored;
  }

  markMonitored(): void {
    this.monitored = true;
  }

  clearMonitored(): void {
    this.monitored = false;
  }

  async forceRemoteProbe(text: string, handleId: string): Promise<StudentRiskDecision | undefined> {
    this.forceCalls.push({ text, handleId });
    return this.forced;
  }
}

/** 构造门面 (全注入, 无全局状态). */
function buildOrchestrator(options: { readonly outputs?: EngineTurnOutput[]; readonly gate?: StubGate }): {
  readonly orchestrator: TurnRenderOrchestrator;
  readonly session: StubSession;
  readonly renderer: StubRenderer;
  readonly memories: StubMemoryStore;
  readonly gate: StubGate;
} {
  const session = new StubSession(options.outputs ?? [buildOutput()]);
  const renderer = new StubRenderer();
  const memories = new StubMemoryStore();
  const gate = options.gate ?? new StubGate();
  const orchestrator = new TurnRenderOrchestrator({
    session,
    renderer,
    memories,
    resolveSession: () => CONTEXT,
    now: () => CLOCK,
    idFactory: () => 'memory-visitor-1',
    studentRisk: gate,
  });
  return { orchestrator, session, renderer, memories, gate };
}

describe('WP14 · 学员心理风险处置层', () => {
  describe('① 三条边界 (纯判定)', () => {
    it('counselor_input + block + 危机类别 → block (阻断本轮)', () => {
      const verdict = buildVerdict({ level: 'block', categories: ['active_ideation'], source: 'probe' });
      expect(decideStudentRiskAction(verdict)).toBe('block');
    });

    it('counselor_input + warn + 危机类别 → toast (不阻断)', () => {
      const verdict = buildVerdict({ level: 'warn', categories: ['passive_ideation'], source: 'probe' });
      expect(decideStudentRiskAction(verdict)).toBe('toast');
    });

    it('visitor_output + block + 危机类别 → none (AI 角色台词是演练素材, 绝不处置)', () => {
      const verdict = buildVerdict({ level: 'block', side: 'visitor_output', categories: ['active_ideation'], source: 'probe' });
      expect(decideStudentRiskAction(verdict)).toBe('none');
    });

    it('counselor_input + block + 只有专业越界类别 → none (不打断正常训练)', () => {
      const verdict = buildVerdict({ level: 'block', categories: ['promise_cure'], source: 'rule' });
      expect(decideStudentRiskAction(verdict)).toBe('none');
    });

    it('pass → none; 没有判定 → none', () => {
      expect(decideStudentRiskAction(buildVerdict({ level: 'pass' }))).toBe('none');
      expect(decideStudentRiskAction()).toBe('none');
    });
  });

  describe('② 帧载荷 + 片段截断', () => {
    it('toast 帧 = medium; modal 帧 = high + 12356 / 120', () => {
      const toast = buildStudentRiskDecision(
        buildVerdict({ level: 'warn', categories: ['passive_ideation'], source: 'probe' }),
        'psyguard',
      );
      const modal = buildStudentRiskDecision(
        buildVerdict({ level: 'block', categories: ['active_ideation'], source: 'probe' }),
        'psyguard',
      );

      expect(buildCrisisToastFrame(toast)).toEqual({ type: 'crisis_toast', level: 'medium', category: 'passive_ideation' });
      expect(buildCrisisModalFrame(modal)).toEqual({
        type: 'crisis_modal',
        level: 'high',
        category: 'active_ideation',
        hotline: '12356',
        emergency: '120',
      });
    });

    it('snippet 截 200 字 (不存完整原文)', () => {
      const long = '学'.repeat(500);
      const snippet = truncateRiskSnippet(long);
      expect(snippet.length).toBe(200);
      expect(truncateRiskSnippet('  你好  ')).toBe('你好');
    });

    it('判定来源口径: 规则层 → rule; 探测 → 通道记录的来源', () => {
      expect(buildStudentRiskDecision(buildVerdict({ level: 'block', categories: ['active_ideation'] })).source).toBe('rule');
      expect(
        buildStudentRiskDecision(buildVerdict({ level: 'warn', categories: ['passive_ideation'], source: 'probe' }), 'psyguard').source,
      ).toBe('psyguard');
      expect(
        buildStudentRiskDecision(buildVerdict({ level: 'warn', categories: ['passive_ideation'], source: 'probe' }), 'local_dict').source,
      ).toBe('local_dict');
    });
  });

  describe('③ 处置决定合并 (监测场次的强制探测取更严一档)', () => {
    it('block 覆盖 toast; toast 不覆盖 block; none 不覆盖任何东西', () => {
      const toast: StudentRiskDecision = { action: 'toast', level: 'medium', category: 'passive_ideation', source: 'psyguard' };
      const block: StudentRiskDecision = { action: 'block', level: 'high', category: 'active_ideation', source: 'psyguard' };
      const none: StudentRiskDecision = { action: 'none', level: null, category: null, source: 'rule' };

      expect(mergeStudentRiskDecisions(toast, block).action).toBe('block');
      expect(mergeStudentRiskDecisions(block, toast).action).toBe('block');
      expect(mergeStudentRiskDecisions(toast, none).action).toBe('toast');
      expect(mergeStudentRiskDecisions(toast).action).toBe('toast');
    });

    it('探测结果 → 处置决定 (side 固定在学员输入面)', () => {
      const decision = buildStudentRiskDecisionFromProbe({ level: 'block', categories: ['active_ideation'] });
      expect(decision.action).toBe('block');
      expect(decision.category).toBe('active_ideation');
      expect(decision.source).toBe('psyguard');
      expect(buildStudentRiskDecisionFromProbe().action).toBe('none');
    });
  });

  describe('④ 渲染前 gate (场景 ①②③)', () => {
    it('场景① high 阻断: 不调 RenderPort.render, reply 为空, disposal=block', async () => {
      const { orchestrator, renderer, memories } = buildOrchestrator({
        outputs: [buildOutput(buildVerdict({ level: 'block', categories: ['active_ideation'], source: 'probe' }))],
      });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '我不想活了' });

      expect(renderer.specs).toHaveLength(0);
      expect(result.reply).toBe('');
      expect(result.disposal?.action).toBe('block');
      expect(result.disposal?.level).toBe('high');
      expect(result.render.usage).toEqual({ completionTokens: 0, totalTokens: 0 });
      // 本轮来访者一个字都没说 → 不写来访半边工作记忆 (写了就是造假).
      expect(memories.remembered).toHaveLength(0);
    });

    it('场景② medium 不阻断: 正常渲染 + disposal=toast', async () => {
      const { orchestrator, renderer } = buildOrchestrator({
        outputs: [buildOutput(buildVerdict({ level: 'warn', categories: ['passive_ideation'], source: 'probe' }))],
      });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '我最近总是失眠，提不起劲' });

      expect(renderer.specs).toHaveLength(1);
      expect(result.reply).toBe(REPLY);
      expect(result.disposal?.action).toBe('toast');
      expect(result.disposal?.level).toBe('medium');
    });

    it('场景③ visitor_output 不推学员: 正常渲染且结果形状不变 (无 disposal 键)', async () => {
      const { orchestrator, renderer } = buildOrchestrator({
        outputs: [buildOutput(buildVerdict({ level: 'block', side: 'visitor_output', categories: ['active_ideation'], source: 'probe' }))],
      });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '我不想活了' });

      expect(renderer.specs).toHaveLength(1);
      expect(result.reply).toBe(REPLY);
      expect(result.disposal).toBeUndefined();
    });

    it('专业越界 (promise_cure) 不处置: 正常渲染且无 disposal 键', async () => {
      const { orchestrator, renderer } = buildOrchestrator({
        outputs: [buildOutput(buildVerdict({ level: 'block', categories: ['promise_cure'], source: 'rule' }))],
      });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '我保证能治好你' });

      expect(renderer.specs).toHaveLength(1);
      expect(result.disposal).toBeUndefined();
    });

    it('流式路径与聚合路径同构: block 同样不调渲染端口', async () => {
      const { orchestrator, renderer } = buildOrchestrator({
        outputs: [buildOutput(buildVerdict({ level: 'block', categories: ['suicide_plan'], source: 'probe' }))],
      });

      const deltas: string[] = [];
      const result = await orchestrator.turnStream(HANDLE_ID, { userText: '我已经想好怎么做了' }, { onDelta: (d) => deltas.push(d) });

      expect(renderer.specs).toHaveLength(0);
      expect(deltas).toHaveLength(0);
      expect(result.disposal?.action).toBe('block');
    });
  });

  describe('⑤ 重点监测场次的强制远端探测 (场景⑤)', () => {
    it('监测中: 每轮强制问一次远端, 远端判 block → 本轮被阻断', async () => {
      const gate = new StubGate();
      gate.monitored = true;
      gate.forced = { action: 'block', level: 'high', category: 'active_ideation', source: 'psyguard' };
      const { orchestrator, renderer } = buildOrchestrator({ outputs: [buildOutput(buildVerdict({ level: 'pass' }))], gate });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '今天有点不想说话' });

      expect(gate.forceCalls).toHaveLength(1);
      expect(gate.forceCalls[0]?.handleId).toBe(HANDLE_ID);
      expect(renderer.specs).toHaveLength(0);
      expect(result.disposal?.action).toBe('block');
    });

    it('未监测: 不问远端 (不白付一次网络往返)', async () => {
      const gate = new StubGate();
      const { orchestrator, renderer } = buildOrchestrator({ outputs: [buildOutput(buildVerdict({ level: 'pass' }))], gate });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '今天有点不想说话' });

      expect(gate.forceCalls).toHaveLength(0);
      expect(renderer.specs).toHaveLength(1);
      expect(result.disposal).toBeUndefined();
    });

    it('强制探测抛错: 静默回落内核判定, 不把对练带崩', async () => {
      const gate = new StubGate();
      gate.monitored = true;
      gate.forceRemoteProbe = async () => {
        throw new Error('psyguard down');
      };
      const { orchestrator, renderer } = buildOrchestrator({
        outputs: [buildOutput(buildVerdict({ level: 'warn', categories: ['passive_ideation'], source: 'probe' }))],
        gate,
      });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '我好像耗竭了' });

      expect(renderer.specs).toHaveLength(1);
      expect(result.disposal?.action).toBe('toast');
    });
  });

  describe('⑥ D12 兜底: PsyGUARD 挂掉回落本地词典 (场景④)', () => {
    it('远端 503 → 委托本地词典 → 命中 block (源记 local_dict)', async () => {
      const failingFetch: PsyGuardFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
      const probe = new HttpPsyGuardProbe({
        baseUrl: 'http://127.0.0.1:8100',
        fetchImpl: failingFetch,
        fallback: new LocalCrisisProbe(),
      });

      const { value, source } = await runWithProbeSource(() => probe.probe('我想死', 'counselor_input'));

      expect(value.level).toBe('block');
      expect(value.categories).toContain('active_ideation');
      expect(source).toBe('local_dict');
    });

    it('远端正常 → 用远端结果, 不问本地词典 (源记 psyguard)', async () => {
      const okFetch: PsyGuardFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ level: 'medium', categories: ['passive_ideation'], score: 0.7 }),
      });
      const probe = new HttpPsyGuardProbe({
        baseUrl: 'http://127.0.0.1:8100',
        fetchImpl: okFetch,
        fallback: new LocalCrisisProbe(),
      });

      const { value, source } = await runWithProbeSource(() => probe.probe('我最近总是失眠，提不起劲', 'counselor_input'));

      expect(value.level).toBe('warn');
      expect(source).toBe('psyguard');
    });

    it('createRiskProbe 配了 baseUrl 时**不再丢弃** fallback (D12 治本)', async () => {
      const probe = createRiskProbe({ baseUrl: 'http://127.0.0.1:8100', fallback: new LocalCrisisProbe() });
      expect(probe).toBeInstanceOf(HttpPsyGuardProbe);
      // 远端不可达时它会委托本地词典, 而不是把 fallback 丢掉.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error('ECONNREFUSED');
      };
      try {
        const result = await probe.probe('我想死', 'counselor_input');
        expect(result.level).toBe('block');
        expect(result.categories).toContain('active_ideation');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('⑦ 词典: 职业倦怠 warn 级词 (只补 warn, 不补 block)', () => {
    const BURNOUT_WORDS = [
      '我怀疑自己适不适合干这行',
      '我怀疑自己不适合做咨询',
      '做咨询越久越觉得没意义',
      '我最近总是失眠，提不起劲',
      '我好像耗竭了',
      '我好像有点耗竭了',
      '有时候觉得熬不下去',
    ];

    it('7 个倦怠表达全部命中 passive_ideation (warn 级)', () => {
      for (const word of BURNOUT_WORDS) {
        expect(detectCrisisCategories(word)).toContain('passive_ideation');
      }
    });

    it('倦怠表达**不判 block** (误报代价 = 把正常训练判成危机轮)', async () => {
      const probe = new LocalCrisisProbe();
      for (const word of BURNOUT_WORDS) {
        const result = await probe.probe(word, 'counselor_input');
        expect(result.level).toBe('warn');
      }
    });

    it('block 级词仍然只收明确的自杀表达', async () => {
      const probe = new LocalCrisisProbe();
      const result = await probe.probe('我想死', 'counselor_input');
      expect(result.level).toBe('block');
    });
  });
});
