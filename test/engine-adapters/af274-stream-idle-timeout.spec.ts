// AF-274：流式首包之后的「块间停摆」治理。
// AF-270 只限制了首包；首包到达后上游若再也不吐块，SDK 会挂到传输层超时（约 300s）。
// 这里验证：块间空闲超过 config.timeoutMs → abort 上游并收尾降级（已出声不切备）；
// 只要持续有块（含空 delta 的心跳/用量块），整轮超过 timeout 也不误杀；
// 外部取消在锁定后仍能真正中止上游。

import { LlmRenderAdapter, type ChatCaller, type ChatStreamOptions } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import { createRenderAdapterConfig } from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type { RenderSpec } from '../../src/engine-core/index.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';
const TIMEOUT_MS = 100;

type Outcome = 'wait-first' | 'idle-after-first' | 'steady-chunks' | 'never-resolves';

class ScriptedCaller implements ChatCaller {
  readonly streamCalls: { request: ChatCompletionRequest; opts?: ChatStreamOptions }[] = [];

  constructor(private readonly outcome: Outcome) {}

  async chat(): Promise<ChatCompletionResponse> {
    throw new Error('AF-274 只验证流式路径');
  }

  stream(request: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    this.streamCalls.push({ request, opts });
    return iterate(this.outcome, opts?.signal);
  }
}

async function* iterate(outcome: Outcome, signal?: AbortSignal): AsyncIterable<ChatCompletionChunk> {
  if (signal?.aborted === true) throw new Error('aborted');
  if (outcome === 'wait-first') {
    await waitForAbort(signal);
    throw new Error('aborted');
  }
  yield { delta: '我有点累。', tokenCount: 5, isFinal: false };
  if (outcome === 'idle-after-first') {
    await waitForAbort(signal);
    throw new Error('aborted');
  }
  if (outcome === 'never-resolves') {
    // 故意忽略 signal：即使上游 SDK 不响应 abort，适配器的空闲计时也必须结束本轮。
    await new Promise<never>(() => {
      // 永不 settle；不持有任何句柄，避免吊住测试进程。
    });
  }
  // steady-chunks：总时长超过 timeout，但相邻块间隔始终小于 timeout。
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS / 2));
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

function buildConfig(timeoutMs = TIMEOUT_MS) {
  return createRenderAdapterConfig([{ id: 'primary' }, { id: 'backup' }], {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model' },
      advanced: { temperature: 0.85, model: 'advanced-model' },
    },
    timeoutMs,
    failureThreshold: 2,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    fallbackUtterances: [FALLBACK_UTTERANCE],
  });
}

describe('AF-274 · 流式块间空闲超时', () => {
  it('首包后停摆 → 超时 abort 上游并收尾降级，不切备', async () => {
    const caller = new ScriptedCaller('idle-after-first');
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig() });
    const deltas: string[] = [];

    const startedAt = Date.now();
    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: (delta) => {
        deltas.push(delta);
      },
    });
    const elapsed = Date.now() - startedAt;

    expect(outcome.degraded).toBe(true);
    expect(outcome.providerHint).toBe('degraded');
    expect(outcome.text).toBe(FALLBACK_UTTERANCE);
    expect(deltas).toEqual(['我有点累。']);
    expect(elapsed).toBeLessThan(TIMEOUT_MS * 4);
    // 已出声，不能再打备候选。
    expect(caller.streamCalls).toHaveLength(1);
    expect(adapter.health()['primary']?.consecutiveFailures).toBe(1);
  });

  it('持续有空块/心跳块 → 整轮超过 timeout 也不误杀', async () => {
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

  it('上游不响应 abort 也不会把本轮挂死', async () => {
    const caller = new ScriptedCaller('never-resolves');
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig() });

    const startedAt = Date.now();
    const outcome = await adapter.streamRender(buildSpec(), { onDelta: () => {} });

    expect(outcome.degraded).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUT_MS * 4);
  });

  it('首包前外部取消 → 不切备、不污染熔断器', async () => {
    const caller = new ScriptedCaller('wait-first');
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig(TIMEOUT_MS * 5) });
    const external = new AbortController();

    const run = adapter.streamRender(buildSpec(), {
      onDelta: () => {},
      signal: external.signal,
    });
    setTimeout(() => external.abort(), TIMEOUT_MS / 2);
    const startedAt = Date.now();
    const outcome = await run;

    expect(outcome.degraded).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUT_MS * 4);
    // 只尝试主候选；外部取消不触发备候选。
    expect(caller.streamCalls).toHaveLength(1);
    expect(adapter.health()['primary']?.consecutiveFailures ?? 0).toBe(0);
    expect(adapter.health()['backup']?.consecutiveFailures ?? 0).toBe(0);
  });

  it('外部取消在首包之后仍能真正中止上游', async () => {
    const caller = new ScriptedCaller('idle-after-first');
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig(TIMEOUT_MS * 5) });
    const external = new AbortController();

    const run = adapter.streamRender(buildSpec(), {
      onDelta: () => {},
      signal: external.signal,
    });
    setTimeout(() => external.abort(), TIMEOUT_MS / 2);
    const startedAt = Date.now();
    const outcome = await run;

    expect(outcome.degraded).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUT_MS * 4);
    expect(caller.streamCalls[0]?.opts?.signal?.aborted).toBe(true);
    // 外部取消是消费方主动结束，不是上游健康问题。
    expect(adapter.health()['primary']?.consecutiveFailures ?? 0).toBe(0);
  });
});
