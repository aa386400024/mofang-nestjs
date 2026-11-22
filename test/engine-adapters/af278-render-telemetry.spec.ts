import { describe, expect, it } from 'vitest';

import { LlmRenderAdapter, type ChatCaller, type ChatStreamOptions } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import {
  createRenderAdapterConfig,
  type RenderAdapterConfig,
  type RenderCandidate,
} from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type {
  RenderAttemptOutcome,
  RenderFailureCause,
  RenderStreamTimeoutPhase,
  RenderTelemetryPort,
} from '../../src/engine-adapters/rendering/render-telemetry.port.js';
import type { RenderSpec } from '../../src/engine-core/index.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

const FALLBACK = '我先缓一下，我们接着说。';

type Script =
  | { readonly kind: 'chunks'; readonly deltas: readonly string[] }
  | { readonly kind: 'error'; readonly error: Error }
  | { readonly kind: 'hang-before-delta' }
  | { readonly kind: 'stall-after-delta' };

class ScriptedCaller implements ChatCaller {
  private index = 0;

  constructor(private readonly script: readonly Script[]) {}

  async chat(_request: ChatCompletionRequest, _providerId?: string): Promise<ChatCompletionResponse> {
    return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'm', finishReason: 'stop' };
  }

  stream(_request: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    const outcome = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    return iterate(outcome, opts?.signal);
  }
}

async function* iterate(outcome: Script, signal?: AbortSignal): AsyncIterable<ChatCompletionChunk> {
  if (outcome.kind === 'error') throw outcome.error;
  if (outcome.kind === 'hang-before-delta') {
    // 模拟真实 SDK: 首包前不再吐块时, 收到 abort 才 reject (不是自己醒来返回空流).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        },
        { once: true },
      );
    });
    return;
  }
  if (outcome.kind === 'stall-after-delta') {
    yield { delta: '我在', tokenCount: 1, isFinal: false };
    await new Promise((resolve) => setTimeout(resolve, 200));
    return;
  }
  let tokenCount = 0;
  for (const delta of outcome.deltas) {
    tokenCount += 1;
    yield { delta, tokenCount, isFinal: false };
  }
  yield { delta: '', tokenCount, isFinal: true, finishReason: 'stop' };
}

class Recorder implements RenderTelemetryPort {
  attempts: string[] = [];
  outcomes: { candidate: string; outcome: RenderAttemptOutcome }[] = [];
  firstDeltas: { candidate: string; ttftMs: number }[] = [];
  timeouts: { candidate: string; phase: RenderStreamTimeoutPhase }[] = [];
  authFailures: string[] = [];
  fallbacks: { from: string; to: string; cause: RenderFailureCause }[] = [];
  degraded: RenderFailureCause[] = [];

  onAttempt(candidateId: string, model: string): void {
    this.attempts.push(`${candidateId}:${model}`);
  }

  onAttemptOutcome(candidateId: string, _model: string, outcome: RenderAttemptOutcome): void {
    this.outcomes.push({ candidate: candidateId, outcome });
  }

  onFirstDelta(candidateId: string, _model: string, ttftMs: number): void {
    this.firstDeltas.push({ candidate: candidateId, ttftMs });
  }

  onStreamTimeout(candidateId: string, phase: RenderStreamTimeoutPhase): void {
    this.timeouts.push({ candidate: candidateId, phase });
  }

  onAuthFailure(candidateId: string): void {
    this.authFailures.push(candidateId);
  }

  onFallback(from: string, to: string, cause: RenderFailureCause): void {
    this.fallbacks.push({ from, to, cause });
  }

  onDegraded(cause: RenderFailureCause): void {
    this.degraded.push(cause);
  }
}

function spec(overrides: Partial<RenderSpec> = {}): RenderSpec {
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
    tokenBudget: { maxCompletionTokens: 32, contextTokens: 512 },
    ...overrides,
  };
}

function config(candidates: readonly RenderCandidate[]): RenderAdapterConfig {
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
    fallbackUtterances: [FALLBACK],
    streamFirstDeltaTimeoutMs: 10,
    streamIdleTimeoutMs: 20,
  });
}

describe('AF-278 · 渲染遥测回调', () => {
  it('主候选成功: attempt → outcome success → firstDelta 一次, 无回退', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([{ kind: 'chunks', deltas: ['我在', '，慢慢说。'] }]),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.degraded).toBe(false);
    expect(recorder.attempts).toEqual(['primary:chat-model']);
    expect(recorder.outcomes).toEqual([{ candidate: 'primary', outcome: 'success' }]);
    expect(recorder.firstDeltas).toHaveLength(1);
    expect(recorder.firstDeltas[0]?.candidate).toBe('primary');
    expect(recorder.fallbacks).toEqual([]);
    expect(recorder.degraded).toEqual([]);
  });

  it('主候选 429 + 备成功: 记 rate-limit 回退, 不记鉴权失败', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([
        { kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) },
        { kind: 'chunks', deltas: ['我在，慢慢说。'] },
      ]),
      config: config([{ id: 'primary' }, { id: 'backup' }]),
      telemetry: recorder,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.providerHint).toBe('backup');
    expect(recorder.authFailures).toEqual([]);
    expect(recorder.outcomes.map((item) => item.outcome)).toEqual(['retry', 'success']);
    expect(recorder.fallbacks).toEqual([{ from: 'primary', to: 'backup', cause: 'rate-limit' }]);
  });

  it('主候选 401 + 备成功: 记 auth 失败与 auth 回退', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([
        { kind: 'error', error: Object.assign(new Error('unauthorized'), { status: 401 }) },
        { kind: 'chunks', deltas: ['我在，慢慢说。'] },
      ]),
      config: config([{ id: 'primary' }, { id: 'backup' }]),
      telemetry: recorder,
    });

    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.authFailures).toEqual(['primary']);
    expect(recorder.fallbacks).toEqual([{ from: 'primary', to: 'backup', cause: 'auth' }]);
  });

  it('首包无增量: 记 first-delta 超时并切备', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([{ kind: 'hang-before-delta' }, { kind: 'chunks', deltas: ['我在，慢慢说。'] }]),
      config: config([{ id: 'primary' }, { id: 'backup' }]),
      telemetry: recorder,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.providerHint).toBe('backup');
    expect(recorder.timeouts).toEqual([{ candidate: 'primary', phase: 'first-delta' }]);
    expect(recorder.fallbacks).toEqual([{ from: 'primary', to: 'backup', cause: 'first-delta' }]);
  });

  it('首包后停摆: 记 idle 超时并降级, 不切备', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([{ kind: 'stall-after-delta' }]),
      config: config([{ id: 'primary' }, { id: 'backup' }]),
      telemetry: recorder,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.degraded).toBe(true);
    expect(recorder.timeouts).toEqual([{ candidate: 'primary', phase: 'idle' }]);
    expect(recorder.fallbacks).toEqual([]);
    expect(recorder.degraded).toEqual(['idle']);
  });

  it('遥测实现抛错不影响渲染结果', async () => {
    const telemetry: RenderTelemetryPort = {
      onAttempt: () => {
        throw new Error('boom');
      },
      onAttemptOutcome: () => {
        throw new Error('boom');
      },
      onFirstDelta: () => {
        throw new Error('boom');
      },
    };
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([{ kind: 'chunks', deltas: ['我在，慢慢说。'] }]),
      config: config([{ id: 'primary' }]),
      telemetry,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.text).toBe('我在，慢慢说。');
    expect(outcome.degraded).toBe(false);
  });
});
