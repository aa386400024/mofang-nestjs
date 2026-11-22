// AF-270：流式渲染首包超时治理。
// 真实 SDK 的 headersTimeout 约 300s，上游「连接成功但不回首包」会把主候选挂死；
// 这里用可注入的 caller 验证：config.timeoutMs 到点 abort 上游 → 切备；
// 首包到达后定时器清理，长流不被误杀；外部取消信号同样能中止挂起流。

import { LlmRenderAdapter, type ChatCaller, type ChatStreamOptions } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import { createRenderAdapterConfig, type RenderCandidate } from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type { RenderSpec } from '../../src/engine-core/index.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';
const TIMEOUT_MS = 100;

type Outcome = 'hang' | 'reply' | 'slow-reply';

/** 按候选脚本模拟流；hang 会等到 signal abort 才 reject. */
class SignalAwareCaller implements ChatCaller {
  readonly streamCalls: { request: ChatCompletionRequest; opts?: ChatStreamOptions }[] = [];

  constructor(private readonly script: readonly Outcome[]) {}

  async chat(): Promise<ChatCompletionResponse> {
    throw new Error('AF-270 只验证流式路径');
  }

  stream(request: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    this.streamCalls.push({ request, opts });
    const outcome = this.script[this.streamCalls.length - 1] ?? 'reply';
    return iterate(outcome, opts?.signal);
  }
}

async function* iterate(outcome: Outcome, signal?: AbortSignal): AsyncIterable<ChatCompletionChunk> {
  if (signal?.aborted === true) throw new Error('aborted');
  if (outcome === 'hang') {
    await waitForAbort(signal);
    throw new Error('aborted');
  }
  yield { delta: outcome === 'slow-reply' ? '第一句。' : '备选回复。', tokenCount: 5, isFinal: false };
  if (outcome === 'slow-reply') {
    // 首包已到，总时长超过 config.timeoutMs，但每块间隔都小于空闲上限：
    // 首包定时器不能误杀整轮（AF-274 另行限制了「块间停摆」）。
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS / 2));
      yield { delta: '', tokenCount: 5, isFinal: false };
    }
    yield { delta: '第二句。', tokenCount: 10, isFinal: false };
  }
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

function buildConfig(candidates: readonly RenderCandidate[]) {
  return createRenderAdapterConfig(candidates, {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model' },
      advanced: { temperature: 0.85, model: 'advanced-model' },
    },
    timeoutMs: TIMEOUT_MS,
    // AF-276: 首包等待与聚合超时解耦；本组用例只测首包治理，显式把首包预算压到测试值。
    streamFirstDeltaTimeoutMs: TIMEOUT_MS,
    streamIdleTimeoutMs: TIMEOUT_MS,
    failureThreshold: 2,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    maxBlockRegen: 1,
    fallbackUtterances: [FALLBACK_UTTERANCE],
  });
}

describe('AF-270 · 流式首包超时', () => {
  it('主候选首包挂起 → 首包预算内 abort 并切备', async () => {
    const caller = new SignalAwareCaller(['hang', 'reply']);
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }, { id: 'backup' }]) });
    const deltas: string[] = [];

    const startedAt = Date.now();
    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });
    const elapsed = Date.now() - startedAt;

    expect(outcome.providerHint).toBe('backup');
    expect(outcome.fallbackUsed).toBe(true);
    expect(outcome.degraded).toBe(false);
    expect(outcome.text).toBe('备选回复。');
    expect(deltas).toEqual(['备选回复。']);
    // AF-276: 首包预算 = max(配置下限 100ms, maxCompletionTokens 160 × 8 = 1280ms)。
    expect(elapsed).toBeLessThan(1600);
    expect(caller.streamCalls[0]?.opts?.signal).toBeDefined();
    expect(adapter.health()['primary']?.consecutiveFailures).toBe(1);
  });

  it('首包到达后清定时器，长流超过配置超时也不被误杀', async () => {
    const caller = new SignalAwareCaller(['slow-reply']);
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
    const deltas: string[] = [];

    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });

    expect(outcome.providerHint).toBe('primary');
    expect(outcome.degraded).toBe(false);
    expect(outcome.text).toBe('第一句。第二句。');
    expect(deltas).toEqual(['第一句。', '第二句。']);
  });

  it('外部 signal 取消能中止挂起首包，不把流挂到 SDK headersTimeout', async () => {
    const caller = new SignalAwareCaller(['hang']);
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }, { id: 'backup' }]) });
    const external = new AbortController();
    external.abort();

    const startedAt = Date.now();
    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: () => {
        // 外部取消场景不收集增量，只验证挂起流被中止。
      },
      signal: external.signal,
    });

    expect(Date.now() - startedAt).toBeLessThan(TIMEOUT_MS * 4);
    expect(outcome.text).toBe(FALLBACK_UTTERANCE);
    expect(outcome.providerHint).toBe('degraded');
  });
});
