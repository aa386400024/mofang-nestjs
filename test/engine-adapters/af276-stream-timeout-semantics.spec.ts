// AF-276：流式超时语义拆分。
// - 聚合总超时（timeoutMs）不再约束流式首包与块间空闲；
// - 块间空闲只读 streamIdleTimeoutMs；
// - 首包预算 = max(streamFirstDeltaTimeoutMs, maxCompletionTokens × 8)。

import { LlmRenderAdapter, type ChatCaller, type ChatStreamOptions } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import { createRenderAdapterConfig, resolveStreamFirstDeltaTimeoutMs } from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type { RenderSpec } from '../../src/engine-core/index.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';

type Outcome = 'slow-first' | 'idle-after-first' | 'steady-chunks';

class ScriptedCaller implements ChatCaller {
  readonly streamCalls: { request: ChatCompletionRequest; opts?: ChatStreamOptions }[] = [];

  constructor(private readonly outcome: Outcome) {}

  async chat(): Promise<ChatCompletionResponse> {
    throw new Error('AF-276 只验证流式路径');
  }

  stream(request: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    this.streamCalls.push({ request, opts });
    return iterate(this.outcome, opts?.signal);
  }
}

async function* iterate(outcome: Outcome, signal?: AbortSignal): AsyncIterable<ChatCompletionChunk> {
  if (signal?.aborted === true) throw new Error('aborted');
  if (outcome === 'slow-first') {
    await new Promise((resolve) => setTimeout(resolve, 200));
    yield { delta: '我有点累。', tokenCount: 5, isFinal: false };
    yield { delta: '第二句。', tokenCount: 10, isFinal: false };
    yield { delta: '', tokenCount: 10, isFinal: true, finishReason: 'stop' };
    return;
  }
  yield { delta: '我有点累。', tokenCount: 5, isFinal: false };
  if (outcome === 'idle-after-first') {
    await waitForAbort(signal);
    throw new Error('aborted');
  }
  // steady-chunks：相邻块间隔 20ms，总时长超过聚合 timeoutMs=10ms。
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    yield { delta: '', tokenCount: 5, isFinal: false };
  }
  yield { delta: '第二句。', tokenCount: 10, isFinal: false };
  yield { delta: '', tokenCount: 10, isFinal: true, finishReason: 'stop' };
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) {
      reject(new Error('caller 未收到 signal'));
      return;
    }
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function buildSpec(): RenderSpec {
  return {
    taskKind: 'chat',
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
  };
}

function buildConfig(
  overrides: {
    readonly timeoutMs?: number;
    readonly streamIdleTimeoutMs?: number;
    readonly streamFirstDeltaTimeoutMs?: number;
  } = {},
) {
  return createRenderAdapterConfig([{ id: 'primary' }, { id: 'backup' }], {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model' },
      advanced: { temperature: 0.85, model: 'advanced-model' },
    },
    timeoutMs: overrides.timeoutMs ?? 10,
    streamIdleTimeoutMs: overrides.streamIdleTimeoutMs ?? 500,
    streamFirstDeltaTimeoutMs: overrides.streamFirstDeltaTimeoutMs ?? 8000,
    failureThreshold: 2,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    fallbackUtterances: [FALLBACK_UTTERANCE],
  });
}

describe('AF-276 · 流式超时语义拆分', () => {
  describe('首包预算纯函数', () => {
    it('低输出上限 → 只取下限', () => {
      expect(resolveStreamFirstDeltaTimeoutMs(8000, 160)).toBe(8000);
    });

    it('高输出上限 → 按 maxTokens×8 放大', () => {
      expect(resolveStreamFirstDeltaTimeoutMs(8000, 4096)).toBe(32_768);
    });

    it('缺省 / 非法输出上限 → 只取下限', () => {
      expect(resolveStreamFirstDeltaTimeoutMs(8000)).toBe(8000);
      expect(resolveStreamFirstDeltaTimeoutMs(8000, 0)).toBe(8000);
      expect(resolveStreamFirstDeltaTimeoutMs(8000, Number.NaN)).toBe(8000);
    });

    it('非法下限 → 回落种子下限', () => {
      expect(resolveStreamFirstDeltaTimeoutMs(0, 160)).toBe(8000);
      expect(resolveStreamFirstDeltaTimeoutMs(Number.NaN, 160)).toBe(8000);
    });
  });

  it('聚合总超时不再约束块间空闲：timeout=10ms、idle=500ms、20ms 一块 → 不误杀', async () => {
    const caller = new ScriptedCaller('steady-chunks');
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig() });
    const deltas: string[] = [];

    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.providerHint).toBe('primary');
    expect(outcome.text).toBe('我有点累。第二句。');
    expect(deltas).toEqual(['我有点累。', '第二句。']);
    expect(caller.streamCalls).toHaveLength(1);
  });

  it('块间停摆只按 idle 键降级：aggregate=5000ms、idle=100ms → 快速收尾', async () => {
    const caller = new ScriptedCaller('idle-after-first');
    const adapter = new LlmRenderAdapter({
      caller,
      config: buildConfig({ timeoutMs: 5000, streamIdleTimeoutMs: 100 }),
    });

    const startedAt = Date.now();
    const outcome = await adapter.streamRender(buildSpec(), { onDelta: () => {} });
    const elapsed = Date.now() - startedAt;

    expect(outcome.degraded).toBe(true);
    expect(outcome.providerHint).toBe('degraded');
    expect(outcome.text).toBe(FALLBACK_UTTERANCE);
    expect(elapsed).toBeLessThan(1000);
    expect(caller.streamCalls).toHaveLength(1);
  });

  it('首包预算按 maxCompletionTokens 放大：下限 100ms、上限 160 → 200ms 首包仍成功', async () => {
    const caller = new ScriptedCaller('slow-first');
    const adapter = new LlmRenderAdapter({
      caller,
      config: buildConfig({ timeoutMs: 10, streamFirstDeltaTimeoutMs: 100, streamIdleTimeoutMs: 500 }),
    });
    const deltas: string[] = [];

    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.providerHint).toBe('primary');
    expect(outcome.text).toBe('我有点累。第二句。');
    expect(deltas).toEqual(['我有点累。', '第二句。']);
  });
});
