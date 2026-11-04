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
//
// V2026-11-04 WP50 (B 层 · 渲染层接入同盟三维):
//   覆盖 RenderSpec 新增的两个可选字段 (safety / bond) 在**适配层**的落地:
//     ① spec-assembler 把 snapshot.safety / snapshot.bond 传进 RenderSpec;
//     ② prompt 组装: 提供了就显示对应两行;
//     ③ prompt 组装: 没提供就**逐字不变** (零回归) —— 且新 prompt 减去那两行
//        后与旧 prompt **逐字相同** (证明只多了这两行, 别处一个字没动);
//     ④ safety / bond 低**不改变**轮次长短 (本期只加数据, 不调策略).
//
//   关于第 ③ 条的断言口径 (为什么用"减去那两行"而不是直接比对整段 prompt):
//     "逐字不变"的真正含义是"新 prompt = 旧 prompt + 恰好那两行".
//     只断言"没有安全感三个字"太弱 —— 万一实现顺手改了别处的措辞, 它照样绿.
//     所以这里**双向**断言: 缺省时不含这两行, 且有这两行时减去它们等于缺省版.
//
// V2026-11-04 WP56 (B 层 · 长期记忆召回进渲染上下文):
//   覆盖召回结果进 prompt 的口径 ——
//     ① recall 有内容 → 显示"你还记得这些事"那一段与各条记忆;
//     ② recall 为空数组 → prompt **逐字不变** (零回归, 双向断言);
//     ③ recall 有 5 条 → 只渲染 Top3 (不全部塞进去);
//     ④ recall 内容在"内在状态"块里 (硬规则之前);
//     ⑤ 记忆正文原样渲染 (不被改写 / 不截断);
//     ⑥ 召回内容只在系统消息里, 不掺进历史消息.
//
//   关于第 ② 条的断言口径 (同上, 双向):
//     "逐字不变" = "新 prompt = 旧 prompt + 恰好这一段".
//     减去的方式是滤掉 '- 你还记得这些事' 开头行与 '  - ' 开头的子项行 ——
//     '  - ' (两空格 + 破折号) 这个前缀**只有召回子项会用**, 其余行都是
//     '- ' 开头或纯文本, 所以这个滤法不会误伤别的内容 (用例 ③ 顺带钉住"恰好 3 个子项").

// V2026-11-04 WP35 (B 层 · 渲染四手法):
//   覆盖"这一轮怎么说"从话量三档升级到四手法的口径 ——
//     ① 语气疏离度三档 (distant / neutral / warm): 阻抗优先, 同盟三维齐全才亲近;
//     ② 情绪表现方式: 标签 + 唤醒 → 怎么表现 (焦虑 / 愤怒各有高低唤醒两种说法);
//     ③ 表达层轻量随机: prompt 里有一句"你可以有一点变化";
//     ④ 口语化 / 非语言: "说话方式"后面补了非语言表达那一行;
//     ⑤ 零回归: 没有 safety / bond → **不渲染**语气疏离度那一行;
//     ⑥ 零回归: 情绪是 neutral → 不给额外的情绪表现指令;
//     ⑦ 话量三档的判定口径 (resolveTurnVerbosity) **一个字没改**.
//
//   关于第 ⑤ 条对 WP50 那条零回归断言的影响 (为什么"恰好只多两行"变成三行):
//     WP50 的断言口径是"同盟三维带来的 prompt 差异 = 恰好那几行". WP35 的语气疏离度
//     **也由同盟三维驱动** (缺省不渲染) —— 所以同盟维度带来的差异从 2 行变成 3 行.
//     这是**口径的自然延伸**, 不是把断言放宽: 扣掉那三行后仍要求与缺省版**逐字相同**.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import { buildRenderSpec } from '../../src/engine-adapters/rendering/spec-assembler.js';
import {
  DEFAULT_TURN_FALLBACK_UTTERANCE,
  TurnRenderOrchestrator,
  buildVisitorMessages,
  type TurnSessionContext,
} from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
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
  type EmotionLabel,
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
} from '../../src/engine-core/index.js';

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

  describe('⑨ WP50 · 渲染层接入同盟三维 (safety / bond)', () => {
    it('spec-assembler 把 snapshot.safety / snapshot.bond 一起传进 RenderSpec', () => {
      const snapshot = { ...createEmptyBdiSnapshot(), trust: 0.3, safety: 0.2, bond: 0.4 };
      const spec = buildRenderSpec({ output: buildOutput({ snapshot }), recentTurns: [], tokenBudget: BUDGET });

      expect(spec.trust).toBe(0.3);
      expect(spec.safety).toBe(0.2);
      expect(spec.bond).toBe(0.4);
    });

    it('prompt 组装: 提供了 safety / bond 就显示对应两行', () => {
      const snapshot = { ...createEmptyBdiSnapshot(), trust: 0.3, safety: 0.2, bond: 0.4 };
      const spec = buildRenderSpec({ output: buildOutput({ snapshot }), recentTurns: [], tokenBudget: BUDGET });

      const systemText = buildVisitorMessages(spec)[0]?.content ?? '';

      expect(systemText).toContain('- 安全感：0.20（越低越不敢说真话、越试探性）');
      expect(systemText).toContain('- 联结感：0.40（越低越疏离、越像问诊）');
      // 三维各自成行, 不合并成一行 (合并了就看不出是哪一维在起作用).
      expect(systemText).toContain('- 信任：0.30');
      expect(systemText).toContain('- 安全感：0.20');
      expect(systemText).toContain('- 联结感：0.40');
    });

    it('prompt 组装: 不提供 safety / bond 时逐字不变 (零回归)', () => {
      const spec = buildRenderSpec({ output: buildOutput(), recentTurns: [], tokenBudget: BUDGET });
      const withAlliance = buildVisitorMessages(spec)[0]?.content ?? '';
      const withoutAlliance = buildVisitorMessages(withoutAllianceDimensions(spec))[0]?.content ?? '';

      // 缺省 = 不显示 = 这两行整个不出现.
      expect(withoutAlliance).not.toContain('安全感');
      expect(withoutAlliance).not.toContain('联结感');
      // WP35 起, 同盟三维还驱动"语气疏离度"那一行 —— 缺省时同样整个不出现.
      expect(withoutAlliance).not.toContain('语气有点疏离');
      expect(warmthLine(withoutAlliance)).toBe('');
      // 新 prompt 减去那几行 = 旧 prompt —— 证明只多了这几行, 别处一个字没动.
      const stripped = withAlliance
        .split('\n')
        .filter((line) => !line.startsWith('- 安全感：') && !line.startsWith('- 联结感：') && !line.startsWith('语气'))
        .join('\n');
      expect(stripped).toBe(withoutAlliance);
      // 且恰好只多三行 (WP50 两行 + WP35 的语气疏离度一行).
      expect(withAlliance.split('\n').length - withoutAlliance.split('\n').length).toBe(3);
    });

    it('safety / bond 低**不改变**轮次长短 (本期只加数据, 不调策略)', () => {
      const baseline = buildRenderSpec({ output: buildOutput(), recentTurns: [], tokenBudget: BUDGET });
      const lowAlliance = buildRenderSpec({
        output: buildOutput({ snapshot: { ...createEmptyBdiSnapshot(), safety: 0.05, bond: 0 } }),
        recentTurns: [],
        tokenBudget: BUDGET,
      });

      const baselineText = buildVisitorMessages(baseline)[0]?.content ?? '';
      const lowText = buildVisitorMessages(lowAlliance)[0]?.content ?? '';

      // "这一轮怎么说"那一段逐字相同 —— safety / bond 低了不会让模型自动变话少.
      expect(verbosityLine(lowText)).toBe(verbosityLine(baselineText));
      expect(verbosityLine(baselineText)).not.toBe('');
      // 但状态本身确实传进去了 (数据接到了, 只是不参与策略).
      expect(lowText).toContain('- 安全感：0.05');
    });

    it('不带 safety / bond 的普通 RenderSpec 仍是合法的 AdaptiveRenderSpec (零回归)', () => {
      // 编译期保证: 别的生产者可以只造内核 RenderSpec, 不必补这两个可选字段.
      const plain: AdaptiveRenderSpec = {
        taskKind: 'chat',
        intention: buildIntention(),
        emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
        resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
        transference: { positive: 0, negative: 0, dependency: 0 },
        trust: 0.3,
        coreBeliefs: [],
        forbiddenBehaviors: ['judge'],
        recall: [],
        recentTurns: [],
        tokenBudget: BUDGET,
      };

      expect('safety' in plain).toBe(false);
      expect('bond' in plain).toBe(false);
    });
  });

  describe('⑩ WP56 · 长期记忆召回进渲染上下文', () => {
    /** 造 N 条召回命中 (按召回顺序 —— 内核已按相关度/重要度/时间排好序). */
    function buildRecallHits(count: number): MemoryHit[] {
      return Array.from({ length: count }, (_, index) => ({
        entry: { ...buildMemoryEntry(), id: `memory-${index + 1}`, content: `长期记忆第${index + 1}条` },
        score: 0.9 - index * 0.1,
      }));
    }

    /** 造一份带 recall 的规格. */
    function buildSpecWithRecall(hits: readonly MemoryHit[]): AdaptiveRenderSpec {
      return buildRenderSpec({
        output: buildOutput({ openingContext: hits }),
        recentTurns: [],
        tokenBudget: BUDGET,
      });
    }

    it('recall 有内容 → prompt 显示"你还记得这些事"那一段与各条记忆', () => {
      const spec = buildSpecWithRecall(buildRecallHits(2));

      const systemText = buildVisitorMessages(spec)[0]?.content ?? '';

      expect(systemText).toContain('- 你还记得这些事（背景，不要说出口）：');
      expect(systemText).toContain('  - 长期记忆第1条');
      expect(systemText).toContain('  - 长期记忆第2条');
    });

    it('recall 为空数组 → prompt 逐字不变 (零回归)', () => {
      const withRecall = buildVisitorMessages(buildSpecWithRecall(buildRecallHits(3)))[0]?.content ?? '';
      const withoutRecall = buildVisitorMessages(buildSpecWithRecall([]))[0]?.content ?? '';

      // 空召回 = 这一段整个不出现.
      expect(withoutRecall).not.toContain('你还记得这些事');
      expect(withoutRecall).not.toContain('长期记忆第1条');
      // 有召回的版本减去这一段 == 空召回版本 —— 证明只多了这一段, 别处一个字没动.
      //   ('  - ' 开头的行只有召回子项会用, 其余行都是 '- ' 或纯文本).
      const stripped = withRecall
        .split('\n')
        .filter((line) => !line.startsWith('- 你还记得这些事') && !line.startsWith('  - '))
        .join('\n');
      expect(stripped).toBe(withoutRecall);
    });

    it('recall 有 5 条 → 只渲染 Top3 (不全部塞进去)', () => {
      const spec = buildSpecWithRecall(buildRecallHits(5));

      const systemText = buildVisitorMessages(spec)[0]?.content ?? '';

      expect(systemText).toContain('  - 长期记忆第1条');
      expect(systemText).toContain('  - 长期记忆第2条');
      expect(systemText).toContain('  - 长期记忆第3条');
      expect(systemText).not.toContain('长期记忆第4条');
      expect(systemText).not.toContain('长期记忆第5条');
      // 恰好 3 个子项.
      expect(systemText.split('\n').filter((line) => line.startsWith('  - '))).toHaveLength(3);
    });

    it('recall 内容放在"内在状态"块里 (在硬规则之前)', () => {
      const systemText = buildVisitorMessages(buildSpecWithRecall(buildRecallHits(1)))[0]?.content ?? '';

      const stateIdx = systemText.indexOf('你此刻的内在状态');
      const recallIdx = systemText.indexOf('- 你还记得这些事');
      const hardRuleIdx = systemText.indexOf('硬规则：');

      expect(stateIdx).toBeGreaterThanOrEqual(0);
      expect(recallIdx).toBeGreaterThan(stateIdx);
      expect(recallIdx).toBeLessThan(hardRuleIdx);
    });

    it('记忆正文原样渲染 (不被改写 / 不截断)', () => {
      const hits: MemoryHit[] = [{ entry: { ...buildMemoryEntry(), content: '我小时候被父母抛弃过。' }, score: 0.9 }];

      const systemText = buildVisitorMessages(buildSpecWithRecall(hits))[0]?.content ?? '';

      expect(systemText).toContain('  - 我小时候被父母抛弃过。');
    });

    it('recall 出现在系统消息里, 不掺进历史消息', () => {
      const spec = buildRenderSpec({
        output: buildOutput({ openingContext: buildRecallHits(1) }),
        recentTurns: [{ role: 'counselor', text: USER_TEXT }],
        tokenBudget: BUDGET,
      });

      const messages = buildVisitorMessages(spec);

      expect(messages[0]?.content).toContain('你还记得这些事');
      // 历史消息只有原话, 不含召回内容.
      expect(messages[1]?.content).toBe(USER_TEXT);
    });
  });

  describe('⑪ WP35 · 渲染四手法 (语气疏离度 / 情绪表现 / 轻量随机 / 非语言)', () => {
    /**
     * 造一份**完全可控**的规格 (情绪 / 阻抗 / 同盟三维都显式给, 不吃默认值).
     *
     * 为什么不用 buildRenderSpec 那条路径: 它的默认值 (trust 0.3 / safety 0.5 / bond 0 /
     * 情绪中性) 会让判定口径互相干扰 —— 断言"疏离是因为**风格阻抗**高"时, 就不该
     * 同时被"信任低"那条命中. 显式给全, 一条用例只验一条信号.
     */
    function buildSpecForRender(overrides: Partial<AdaptiveRenderSpec> = {}): AdaptiveRenderSpec {
      return {
        taskKind: 'chat',
        intention: {
          strategy: 'simple_response',
          emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
          resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
          transference: { positive: 0, negative: 0, dependency: 0 },
          forbiddenBehaviors: [],
        },
        emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
        resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
        transference: { positive: 0, negative: 0, dependency: 0 },
        trust: 0.5,
        safety: 0.5,
        bond: 0.5,
        coreBeliefs: [],
        forbiddenBehaviors: [],
        recall: [],
        recentTurns: [],
        tokenBudget: BUDGET,
        ...overrides,
      };
    }

    /** 造一份情绪可控的规格 (标签 + 唤醒显式给). */
    function buildSpecWithEmotion(label: EmotionLabel, arousal: number, overrides: Partial<AdaptiveRenderSpec> = {}): AdaptiveRenderSpec {
      return buildSpecForRender({ emotion: { label, valence: 0, arousal }, ...overrides });
    }

    it('语气疏离度: 表达风格阻抗高 → 疏离', () => {
      const systemText = buildVisitorMessages(buildSpecForRender({ resistance: { verbal: 0.4, depth: 0.4, style: 0.7 } }))[0]?.content;

      expect(warmthLine(systemText ?? '')).toBe('语气有点疏离：像在应付、像隔着一层，不太愿意真正投入。');
    });

    it('语气疏离度: 信任低 → 疏离', () => {
      const systemText = buildVisitorMessages(buildSpecForRender({ trust: 0.2 }))[0]?.content;

      expect(warmthLine(systemText ?? '')).toContain('语气有点疏离');
    });

    it('语气疏离度: 安全感低 → 疏离', () => {
      const systemText = buildVisitorMessages(buildSpecForRender({ safety: 0.2 }))[0]?.content;

      expect(warmthLine(systemText ?? '')).toContain('语气有点疏离');
    });

    it('语气疏离度: 信任 + 安全感 + 联结感都高 → 亲近', () => {
      const systemText = buildVisitorMessages(buildSpecForRender({ trust: 0.7, safety: 0.7, bond: 0.5 }))[0]?.content;

      expect(warmthLine(systemText ?? '')).toBe('语气放松一点：没那么防备，愿意流露一点真实感受。');
    });

    it('语气疏离度: 其余 → 中性', () => {
      const systemText = buildVisitorMessages(buildSpecForRender())[0]?.content;

      expect(warmthLine(systemText ?? '')).toBe('语气按平时的样子，不刻意亲近也不刻意疏远。');
    });

    it('语气疏离度: 阻抗优先 (同盟三维都高但风格阻抗高 → 仍是疏离)', () => {
      const systemText = buildVisitorMessages(
        buildSpecForRender({ trust: 0.7, safety: 0.7, bond: 0.5, resistance: { verbal: 0.4, depth: 0.4, style: 0.7 } }),
      )[0]?.content;

      expect(warmthLine(systemText ?? '')).toContain('语气有点疏离');
    });

    it('情绪表现: 焦虑分高唤醒 / 低唤醒两种说法', () => {
      const high = buildVisitorMessages(buildSpecWithEmotion('anxious', 0.8))[0]?.content ?? '';
      const low = buildVisitorMessages(buildSpecWithEmotion('anxious', 0.4))[0]?.content ?? '';

      expect(high).toContain('这轮你有点焦虑：语速偏快、容易犹豫、可能反复确认对方的意思。');
      expect(high).not.toContain('这轮你有点不安');
      expect(low).toContain('这轮你有点不安：话里带着不确定，可能会停顿一下再说。');
      expect(low).not.toContain('这轮你有点焦虑');
    });

    it('情绪表现: 愤怒分高唤醒 / 低唤醒两种说法', () => {
      const high = buildVisitorMessages(buildSpecWithEmotion('angry', 0.8))[0]?.content ?? '';
      const low = buildVisitorMessages(buildSpecWithEmotion('angry', 0.4))[0]?.content ?? '';

      expect(high).toContain('这轮你有点恼火：语气冲一点、有点不耐烦。');
      expect(high).not.toContain('这轮你有点不爽');
      expect(low).toContain('这轮你有点不爽：语气有点硬，不太想多解释。');
      expect(low).not.toContain('这轮你有点恼火');
    });

    it('情绪表现: 其余七个情绪标签各自有表现方式', () => {
      const expected: Readonly<Record<string, string>> = {
        sad: '这轮你情绪低落：语速偏慢、声音轻，可能会叹气或停顿。',
        hurt: '这轮你有点受伤：话里带着委屈，可能会停顿一下、声音轻一点。',
        guarded: '这轮你有点戒备：话里带着试探，不太愿意说真话。',
        relieved: '这轮你松了口气：语气放松、语速正常。',
        hopeful: '这轮你有点期待：语气放松一点，话里带点盼头。',
        ashamed: '这轮你有点羞愧：不太想被人细看，话会绕着说。',
        empty: '这轮你有点空：情绪淡淡的，回答起来有点费劲。',
      };

      for (const [label, expression] of Object.entries(expected)) {
        const systemText = buildVisitorMessages(buildSpecWithEmotion(label as EmotionLabel, 0.3))[0]?.content ?? '';

        expect(systemText).toContain(expression);
      }
    });

    it('零回归: 没有 safety / bond → 不渲染语气疏离度那一行', () => {
      const spec = withoutAllianceDimensions(buildSpecForRender());

      const systemText = buildVisitorMessages(spec)[0]?.content ?? '';

      expect(warmthLine(systemText)).toBe('');
      // 但缺的是**同盟维度**, 不是别的维度 —— 话量那一行照常在.
      expect(verbosityLine(systemText)).not.toBe('');
    });

    it('零回归: 情绪是 neutral → 不给额外的情绪表现指令', () => {
      const systemText = buildVisitorMessages(buildSpecWithEmotion('neutral', 0.3))[0]?.content ?? '';

      // "这一轮怎么说"块里只有话量 + 语气 + 随机提示三行 —— **没有**情绪表现那一行.
      // (断言整块而不是单行: 单行只能证明"某行在", 证明不了"没有多出情绪那一行".)
      expect(howToSayLines(systemText)).toEqual([
        '这轮你按平时的样子说话，不刻意多讲，也不刻意收着。',
        '语气按平时的样子，不刻意亲近也不刻意疏远。',
        '你可以有一点变化：不是每轮都用一样的句式，可以有时候停顿一下、有时候用短回应、有时候多说一点。',
      ]);
    });

    it('表达层轻量随机: prompt 里有一句"你可以有一点变化"', () => {
      const systemText = buildVisitorMessages(buildSpecForRender())[0]?.content ?? '';

      expect(systemText).toContain('你可以有一点变化：不是每轮都用一样的句式');
    });

    it('口语化 / 非语言: "说话方式"后面补了非语言表达那一行', () => {
      const systemText = buildVisitorMessages(buildSpecForRender())[0]?.content ?? '';
      const lines = systemText.split('\n');
      const speechIdx = lines.findIndex((line) => line.startsWith('说话方式：'));

      expect(speechIdx).toBeGreaterThanOrEqual(0);
      expect(lines[speechIdx + 1]).toBe('可以有一点非语言的表达：比如停顿、叹气、犹豫，但不要写括号里的动作描写。');
    });

    it('话量三档的判定口径没被改 (resolveTurnVerbosity 一个字没动)', () => {
      // 短: 话量阻抗高.
      const short = buildVisitorMessages(buildSpecForRender({ resistance: { verbal: 0.8, depth: 0.6, style: 0.35 } }))[0]?.content;
      // 长: 话量阻抗低 + 信任高 + 探索策略.
      const long = buildVisitorMessages(
        buildSpecForRender({
          intention: {
            strategy: 'cognitive_exploration',
            emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
            resistance: { verbal: 0.1, depth: 0.2, style: 0.2 },
            transference: { positive: 0, negative: 0, dependency: 0 },
            forbiddenBehaviors: [],
          },
          emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
          resistance: { verbal: 0.1, depth: 0.2, style: 0.2 },
          transference: { positive: 0, negative: 0, dependency: 0 },
          trust: 0.8,
        }),
      )[0]?.content;
      // 中: 其余.
      const medium = buildVisitorMessages(buildSpecForRender())[0]?.content;

      expect(verbosityLine(short ?? '')).toContain('这轮你不太想多说');
      expect(verbosityLine(long ?? '')).toContain('这轮你愿意多说一点');
      expect(verbosityLine(medium ?? '')).toContain('这轮你按平时的样子说话');
    });

    it('四个手法都在"这一轮怎么说"块里 (硬规则之前)', () => {
      const systemText = buildVisitorMessages(buildSpecWithEmotion('anxious', 0.8))[0]?.content ?? '';
      const block = howToSayLines(systemText);

      expect(block).toHaveLength(4);
      // 顺序: 话量 → 语气疏离度 → 情绪表现 → 轻量随机.
      expect(block[0]).toContain('这轮你');
      expect(block[1]).toContain('语气');
      expect(block[2]).toContain('这轮你有点焦虑');
      expect(block[3]).toContain('你可以有一点变化');

      const hardRuleIdx = systemText.indexOf('硬规则：');
      expect(systemText.indexOf('你可以有一点变化')).toBeLessThan(hardRuleIdx);
    });
  });
});

/**
 * 去掉规格里的同盟三维两个键 (模拟"别的生产者不带这两个可选字段").
 *
 * 为什么用解构省略而不是 delete: 解构后的 rest **类型上就没有**这两个键,
 * 与"键不存在"这件事一致; delete 依赖运行期行为, 类型上仍是"键存在但值为 undefined".
 */
function withoutAllianceDimensions(spec: AdaptiveRenderSpec): AdaptiveRenderSpec {
  const { safety: _safety, bond: _bond, ...rest } = spec;
  return rest;
}

/**
 * 取 prompt 里"这一轮怎么说"那一段 (话量权重的指令行).
 *
 * 为什么单独抽出来: 要断言的是"**轮次长短没被 safety / bond 改变**" ——
 * 直接比整段 prompt 会把状态行的差异也混进来, 断言就变得不精确.
 *
 * 为什么按**位置**取 (块头下一行), 而不是按"以'这轮你'开头"找:
 *   WP35 起, 情绪表现那一行也是"这轮你有点X：…" —— 按前缀找会认错行
 *   (情绪表现排在话量之后, 找到的第一个虽然仍是话量, 但那是**碰巧**).
 *   块头下一行是话量那一行, 这是模板的结构不变量.
 */
function verbosityLine(systemText: string): string {
  const lines = systemText.split('\n');
  const headerIdx = lines.indexOf('这一轮怎么说：');
  return headerIdx === -1 ? '' : (lines[headerIdx + 1] ?? '');
}

/**
 * 取 prompt 里"语气疏离度"那一行 (WP35 手法一).
 *
 * 为什么用"以'语气'开头"认这一行, 而不是硬编码三段文案:
 *   这是 prompt 里**唯一**以"语气"开头的行 (其余行要么以"- "开头, 要么以
 *   "你正在扮演" / "说话方式" / "可以有一点" / "这轮你" / "说完" / "你可以"开头),
 *   所以这个前缀足以唯一认出它 —— 而且改文案时这个认法不会失效
 *   (硬编码文案会随措辞调整一起过期).
 */
function warmthLine(systemText: string): string {
  return systemText.split('\n').find((line) => line.startsWith('语气')) ?? '';
}

/**
 * 取 prompt 里"这一轮怎么说"块的全部行 (块头与"说完就停"之间).
 *
 * 为什么按**块**取而不是按单行: WP35 起这一块有四行 (话量 / 语气 / 情绪 / 随机),
 * 要断言的是"这一块里**恰好**有哪几行" —— 逐行找只能证明"某行在", 证明不了
 * "没有多出行" (那才是零回归的关键).
 */
function howToSayLines(systemText: string): string[] {
  const lines = systemText.split('\n');
  const start = lines.indexOf('这一轮怎么说：');
  if (start === -1) return [];
  const end = lines.indexOf('说完一两句就停下来，把话头交还给咨询师 —— 真人对话不是独白。');
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

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
