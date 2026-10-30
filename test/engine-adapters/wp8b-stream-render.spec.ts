// V2026-10-29 治本 (WP8-B · B 层 · 流式渲染状态机单测):
//   覆盖任务单 §10 清单 1-6:
//     1. 首 delta 前主候选可重试错 → markFailure → 切备成功; 鉴权失败 → 不切备直接降级
//     2. 首个非空 delta → markSuccess 锁定; 锁定后中途错误 → 不切备、收尾降级
//     3. delta 顺序原样 onDelta 转发且累计全文正确; usage 从末条 tokenCount 归约, 不编造
//     4. 全候选失败 → 兜底句 fallbackUsed=true / providerHint='degraded', 仍返回可收尾结果, 不 reject
//     5. 前置静态预检命中 → 不建流 / 直接降级; 后置 guard block → 只记信号, 不改写 / 不撤回已吐文本
//     6. caller 无 stream 能力 → 回退聚合收集, 不抛错
//   另附 (单一实现的护栏):
//     A. 主备健康状态**共享同一份** (流式成功后聚合路径立刻看到同一候选的健康)
//     B. 默认前置预检 (内核同一套规则) 对硬红线信念判 block, 对普通信念放行
//
//   全 mock, 不起 NestJS 容器, 不发网络: 调用出口用 stub, 时钟用假时钟.
//
//   为什么这组用例必须存在 (防"两套实现"回归):
//     流式与聚合共用 `runCandidateLoop` 与 `RenderFailoverRuntime` —— 一旦有人为了
//     "流式更快"在旁边再写一套候选切换, 冷却/退避/记账就会分裂成两份真相.
//     用例 ①②③ 把"切备 / 锁定 / 记账"的语义钉在**流式**路径上, 用例 A 再钉住
//     "两份路径共享同一份健康状态", 于是有人另起炉灶时这组用例会先红.
//
//   验证: npx jest test/engine-adapters/wp8b-stream-render.spec.ts
//   时间戳: 2026-10-29 GMT+8

import {
  LlmRenderAdapter,
  createVisitorPrecheck,
  type ChatCaller,
  type ChatStreamOptions,
  type RenderGuardVerdict,
} from '../../src/engine-adapters/rendering/llm-render.adapter';
import {
  createRenderAdapterConfig,
  type RenderAdapterConfig,
  type RenderCandidate,
} from '../../src/engine-adapters/rendering/render-adapter.config';
import type { RenderSpec, RenderTaskKind } from '../../src/engine-core';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface';

/** 兜底话术 (与测试配置一致). */
const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';

/** 脚本化的一次流式结果. */
type StreamOutcome =
  | { readonly kind: 'chunks'; readonly deltas: readonly string[]; readonly tokenStep?: number; readonly finishReason?: string }
  | { readonly kind: 'chunksThenError'; readonly deltas: readonly string[]; readonly error: Error }
  | { readonly kind: 'error'; readonly error: Error }
  | { readonly kind: 'empty' };

/** ChatCaller stub: 支持流式, 按脚本顺序返回; 脚本用尽后重复最后一条. */
class StubStreamCaller implements ChatCaller {
  readonly streamCalls: { readonly request: ChatCompletionRequest; readonly opts?: ChatStreamOptions }[] = [];
  readonly chatCalls: string[] = [];
  private index = 0;

  constructor(private readonly script: readonly StreamOutcome[]) {}

  async chat(_request: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse> {
    this.chatCalls.push(providerId ?? '');
    return { content: '聚合兜底文本', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }, model: 'stub', finishReason: 'stop' };
  }

  stream(request: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    this.streamCalls.push({ request, opts });
    const outcome = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    return iterate(outcome);
  }
}

/** 只有聚合能力的 ChatCaller (无 stream). */
class AggregateOnlyCaller implements ChatCaller {
  readonly chatCalls: string[] = [];

  async chat(_request: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse> {
    this.chatCalls.push(providerId ?? '');
    return {
      content: '我最近有点累，夜里老醒。',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'stub',
      finishReason: 'stop',
    };
  }
}

/** 把脚本化结果展开成 chunk 流. */
async function* iterate(outcome: StreamOutcome): AsyncIterable<ChatCompletionChunk> {
  if (outcome.kind === 'error') throw outcome.error;
  if (outcome.kind === 'empty') return;
  const step = outcome.kind === 'chunks' ? (outcome.tokenStep ?? 5) : 5;
  const deltas = outcome.deltas;
  let tokenCount = 0;
  for (let i = 0; i < deltas.length; i += 1) {
    tokenCount += step;
    yield { delta: deltas[i] as string, tokenCount, isFinal: false };
  }
  if (outcome.kind === 'chunksThenError') throw outcome.error;
  // V2026-10-29 治本 (WP9-C): 终局 chunk 带上游 finish_reason (截断保护要用).
  yield {
    delta: '',
    tokenCount,
    isFinal: true,
    ...(outcome.kind === 'chunks' && outcome.finishReason ? { finishReason: outcome.finishReason } : {}),
  };
}

/** 收集增量. */
function collector(): { deltas: string[]; onDelta: (delta: string) => void } {
  const deltas: string[] = [];
  return { deltas, onDelta: (delta: string) => deltas.push(delta) };
}

/** 构造一份渲染规格. */
function buildSpec(overrides: Partial<RenderSpec> = {}): RenderSpec {
  return {
    taskKind: 'chat' as RenderTaskKind,
    intention: {
      strategy: 'recounting',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: ['judge'],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.3,
    coreBeliefs: [],
    forbiddenBehaviors: ['judge'],
    recall: [],
    recentTurns: [{ role: 'counselor', text: '最近睡得怎么样？' }],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 512 },
    ...overrides,
  };
}

/** 构造测试用配置. */
function buildConfig(candidates: readonly RenderCandidate[]): RenderAdapterConfig {
  return createRenderAdapterConfig(candidates, {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model' },
      advanced: { temperature: 0.85, model: 'advanced-model' },
    },
    timeoutMs: 100,
    failureThreshold: 2,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    maxBlockRegen: 1,
    fallbackUtterances: [FALLBACK_UTTERANCE],
  });
}

describe('WP8-B · 流式渲染状态机 (单一实现)', () => {
  describe('① 候选选择窗口 (首 delta 前)', () => {
    it('主候选可重试错 → markFailure → 切备成功, providerHint=备id / fallbackUsed=true', async () => {
      const caller = new StubStreamCaller([
        { kind: 'error', error: new Error('upstream 502') },
        { kind: 'chunks', deltas: ['我在', '，慢慢说。'] },
      ]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }, { id: 'backup' }]) });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(outcome.text).toBe('我在，慢慢说。');
      expect(outcome.providerHint).toBe('backup');
      expect(outcome.fallbackUsed).toBe(true);
      expect(outcome.degraded).toBe(false);
      // V2026-10-29 治本 (WP9-C): 增量按**句边界**转发 (只有已闭合的句子才下发),
      //   所以两个 delta 合成一句 —— 半句绝不能进 TTS 队列.
      expect(deltas).toEqual(['我在，慢慢说。']);
      // 主候选确实被记了失败 (切备前记账), 备候选被记成功.
      expect(adapter.health()['primary']?.consecutiveFailures).toBe(1);
      expect(adapter.health()['backup']?.consecutiveFailures).toBe(0);
    });

    it('鉴权失败 → 不切备, 直接降级 (坏 key 对所有候选都坏)', async () => {
      const caller = new StubStreamCaller([{ kind: 'error', error: new Error('invalid api key') }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }, { id: 'backup' }]) });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(outcome.providerHint).toBe('degraded');
      expect(outcome.fallbackUsed).toBe(true);
      expect(outcome.degraded).toBe(true);
      expect(outcome.text).toBe(FALLBACK_UTTERANCE);
      expect(deltas).toEqual([]);
      // 备候选**没有被试**: 逐个尝试只放大延迟.
      expect(caller.streamCalls).toHaveLength(1);
    });

    it('空流 (首 delta 前无内容) → 视为失败并切备', async () => {
      const caller = new StubStreamCaller([{ kind: 'empty' }, { kind: 'chunks', deltas: ['还在。'] }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }, { id: 'backup' }]) });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(outcome.text).toBe('还在。');
      expect(outcome.providerHint).toBe('backup');
      expect(deltas).toEqual(['还在。']);
    });
  });

  describe('② 锁定语义 (首 token 之后不切备)', () => {
    it('首个非空 delta 到达 → markSuccess (候选健康被清零)', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['嗯，', '我想想。'] }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const { onDelta } = collector();

      await adapter.streamRender(buildSpec(), { onDelta });

      expect(adapter.health()['primary']?.consecutiveFailures).toBe(0);
      expect(adapter.health()['primary']?.inCooldown).toBe(false);
    });

    it('锁定后中途错误 → 不切备, 收尾降级 (已出声无法撤回)', async () => {
      const caller = new StubStreamCaller([
        { kind: 'chunksThenError', deltas: ['我最近有点累。', '后来'], error: new Error('stream reset') },
      ]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }, { id: 'backup' }]) });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(outcome.degraded).toBe(true);
      expect(outcome.providerHint).toBe('degraded');
      expect(outcome.fallbackUsed).toBe(true);
      // 已出声的**完整句**原样保留 (不撤回), 未闭合的尾句随降级一起丢弃 (不进 TTS),
      // 且**没有**切到备候选.
      expect(deltas).toEqual(['我最近有点累。']);
      expect(caller.streamCalls).toHaveLength(1);
    });
  });

  describe('③ 增量与用量口径', () => {
    it('增量按句边界按序转发, 累计全文正确', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['我', '最近有点累。', '还好。'] }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      // V2026-10-29 治本 (WP9-C): 只有**已闭合**的句子才下发 (半句不进 TTS 队列).
      expect(deltas).toEqual(['我最近有点累。', '还好。']);
      expect(outcome.text).toBe('我最近有点累。还好。');
    });

    it('未闭合尾句在正常收尾时照常发出 (不误判成半句)', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['嗯'] }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(deltas).toEqual(['嗯']);
      expect(outcome.text).toBe('嗯');
    });

    it('usage 从末条 tokenCount 归约, 两个口径同源 (不编造 prompt/completion 拆分)', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['一', '二', '三'], tokenStep: 7 }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const { onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(outcome.usage.completionTokens).toBe(21);
      expect(outcome.usage.totalTokens).toBe(21);
    });

    it('providerId 显式透传给调用出口 (不依赖默认 provider)', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['好。'] }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const { onDelta } = collector();

      await adapter.streamRender(buildSpec(), { onDelta });

      expect(caller.streamCalls[0]?.opts?.providerId).toBe('primary');
      expect(caller.streamCalls[0]?.request.model).toBe('chat-model');
    });
  });

  describe('④ 全挂 → 兜底句 (不 reject, 可收尾)', () => {
    it('全部候选失败 → 兜底句 + fallbackUsed + degraded, 正常返回', async () => {
      const caller = new StubStreamCaller([
        { kind: 'error', error: new Error('boom') },
        { kind: 'error', error: new Error('boom again') },
      ]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }, { id: 'backup' }]) });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(outcome.text).toBe(FALLBACK_UTTERANCE);
      expect(outcome.fallbackUsed).toBe(true);
      expect(outcome.providerHint).toBe('degraded');
      expect(outcome.degraded).toBe(true);
      expect(deltas).toEqual([]);
    });

    it('流式路径永不 reject (调用出口全炸也返回结果)', async () => {
      const caller = new StubStreamCaller([{ kind: 'error', error: new Error('nope') }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const { onDelta } = collector();

      await expect(adapter.streamRender(buildSpec(), { onDelta })).resolves.toBeDefined();
    });
  });

  describe('⑤ guard 拆两层', () => {
    it('前置静态预检命中 block → 不建流, 直接降级', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['我不该被说出来。'] }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        precheck: () => ({ level: 'block', categories: ['suicide_plan'] }),
      });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(caller.streamCalls).toHaveLength(0);
      expect(deltas).toEqual([]);
      expect(outcome.degraded).toBe(true);
      expect(outcome.providerHint).toBe('degraded');
    });

    it('前置预检异常 → 放行 (预检是优化, 不是安全边界), 不阻断主路径', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['还在。'] }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        precheck: () => {
          throw new Error('预检挂了');
        },
      });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(outcome.text).toBe('还在。');
      expect(deltas).toEqual(['还在。']);
    });

    it('后置全文 guard 判 block → 只记信号, 不改写 / 不撤回已吐文本', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['我要去死。'] }]);
      const signals: { level: string; categories: readonly string[] }[] = [];
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        guard: async (): Promise<RenderGuardVerdict> => ({ level: 'block', categories: ['active_ideation'] }),
        onSafetySignal: (_text, level, categories) => signals.push({ level, categories }),
      });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      // 已吐出的文本原样保留 (流式不可撤回), 但信号被记录下来.
      expect(deltas).toEqual(['我要去死。']);
      expect(outcome.text).toBe('我要去死。');
      expect(outcome.guardVerdict?.level).toBe('block');
      expect(signals).toEqual([{ level: 'block', categories: ['active_ideation'] }]);
    });

    it('默认前置预检 (内核同一套规则): 硬红线信念判 block, 普通信念放行', () => {
      const precheck = createVisitorPrecheck();

      const blocked = precheck(
        buildSpec({
          coreBeliefs: [{ theme: 'hopeless', statement: '我准备自杀, 今晚就结束。', activationTags: [] }],
        }),
      );
      const passed = precheck(
        buildSpec({
          coreBeliefs: [{ theme: 'unlovable', statement: '我觉得自己不值得被爱。', activationTags: [] }],
        }),
      );

      expect(blocked.level).toBe('block');
      expect(passed.level).toBe('pass');
    });
  });

  describe('⑥ 调用出口无流式能力', () => {
    it('回退聚合收集成流, 不抛错', async () => {
      const caller = new AggregateOnlyCaller();
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const { deltas, onDelta } = collector();

      const outcome = await adapter.streamRender(buildSpec(), { onDelta });

      expect(caller.chatCalls).toEqual(['primary']);
      expect(outcome.text).toBe('我最近有点累，夜里老醒。');
      expect(outcome.degraded).toBe(false);
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.join('')).toBe(outcome.text);
    });
  });

  describe('A. 单一实现的护栏: 主备健康状态共享同一份', () => {
    it('流式成功后, 聚合路径立刻看到同一候选的健康状态', async () => {
      const caller = new StubStreamCaller([{ kind: 'chunks', deltas: ['嗯。'] }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const { onDelta } = collector();

      await adapter.streamRender(buildSpec(), { onDelta });

      const health = adapter.health();
      expect(health['primary']?.consecutiveFailures).toBe(0);
      expect(health['primary']?.inCooldown).toBe(false);
    });

    it('流式切备后, 主候选的失败计数同样体现在共享的健康快照上', async () => {
      const caller = new StubStreamCaller([
        { kind: 'error', error: new Error('boom') },
        { kind: 'chunks', deltas: ['好。'] },
      ]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }, { id: 'backup' }]) });
      const { onDelta } = collector();

      await adapter.streamRender(buildSpec(), { onDelta });

      expect(adapter.health()['primary']?.consecutiveFailures).toBe(1);
      expect(adapter.health()['backup']?.consecutiveFailures).toBe(0);
    });
  });
});
