// AF-286 · 熔断全损可观测回归:
//   全员冷却且未到半开时点 => 本轮不产生任何候选尝试/失败, 只记一次 cooldownServed.
//
// 锁的是"exhausted 的两个来源能不能分清": 候选试完败仍然记 failure;
// 熔断挡掉必须是独立的 cooldown 计数, 不能被当成本轮又试了一次.

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
  RenderTelemetryPort,
} from '../../src/engine-adapters/rendering/render-telemetry.port.js';
import type { RenderSpec } from '../../src/engine-core/index.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

const FALLBACK = '我先缓一下，我们接着说。';

type StreamStep = { readonly kind: 'delta'; readonly delta: string } | { readonly kind: 'error'; readonly error: Error };

class ScriptedCaller implements ChatCaller {
  private streamIndex = 0;

  constructor(private readonly streams: readonly (readonly StreamStep[])[] = []) {}

  async chat(_request: ChatCompletionRequest, _providerId?: string): Promise<ChatCompletionResponse> {
    return {
      content: '我在，慢慢说。',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'm',
      finishReason: 'stop',
    };
  }

  stream(_request: ChatCompletionRequest, _opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    const steps = this.streams[Math.min(this.streamIndex, this.streams.length - 1)] ?? [];
    this.streamIndex += 1;
    return iterate(steps);
  }
}

async function* iterate(steps: readonly StreamStep[]): AsyncIterable<ChatCompletionChunk> {
  let tokenCount = 0;
  for (const step of steps) {
    if (step.kind === 'error') throw step.error;
    tokenCount += 1;
    yield { delta: step.delta, tokenCount, isFinal: false };
  }
  yield { delta: '', tokenCount, isFinal: true, finishReason: 'stop' };
}

class Recorder implements RenderTelemetryPort {
  attempts: string[] = [];
  outcomes: { candidate: string; outcome: RenderAttemptOutcome }[] = [];
  failures: { candidate: string; model: string; cause: RenderFailureCause }[] = [];
  fallbacks: { from: string; to: string; cause: RenderFailureCause }[] = [];
  cooldownServed = 0;

  onAttempt(candidateId: string, model: string): void {
    this.attempts.push(`${candidateId}:${model}`);
  }

  onAttemptOutcome(candidateId: string, _model: string, outcome: RenderAttemptOutcome): void {
    this.outcomes.push({ candidate: candidateId, outcome });
  }

  onFailure(candidateId: string, model: string, cause: RenderFailureCause): void {
    this.failures.push({ candidate: candidateId, model, cause });
  }

  onCooldownServed(): void {
    this.cooldownServed += 1;
  }

  onFallback(from: string, to: string, cause: RenderFailureCause): void {
    this.fallbacks.push({ from, to, cause });
  }

  reset(): void {
    this.attempts = [];
    this.outcomes = [];
    this.failures = [];
    this.fallbacks = [];
    this.cooldownServed = 0;
  }
}

function spec(): RenderSpec {
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
  };
}

// 一次失败就进冷却, 让第二次渲染必然撞上"全员冷却".
function config(candidates: readonly RenderCandidate[]): RenderAdapterConfig {
  return createRenderAdapterConfig(candidates, {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model' },
      advanced: { temperature: 0.85, model: 'advanced-model' },
    },
    timeoutMs: 200,
    failureThreshold: 1,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    maxBlockRegen: 1,
    fallbackUtterances: [FALLBACK],
    streamFirstDeltaTimeoutMs: 500,
    streamIdleTimeoutMs: 500,
  });
}

describe('AF-286 · 熔断全损可观测', () => {
  it('全员冷却: 第二次渲染零尝试、零失败, 只记一次 cooldownServed', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([[{ kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) }]]),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
    });

    // 第一轮: 429 触发冷却, 本轮末尾因无候选可用已记一次全损.
    const first = await adapter.streamRender(spec(), { onDelta: () => {} });
    expect(first.degraded).toBe(true);
    expect(recorder.attempts).toEqual(['primary:chat-model']);
    expect(recorder.failures).toEqual([{ candidate: 'primary', model: 'chat-model', cause: 'rate-limit' }]);
    expect(recorder.cooldownServed).toBe(1);

    // 第二轮: 直接撞上冷却, 不该再出现候选尝试或失败.
    recorder.reset();
    const second = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(second.degraded).toBe(true);
    expect(second.text).toBe(FALLBACK);
    expect(recorder.attempts).toEqual([]);
    expect(recorder.outcomes).toEqual([]);
    expect(recorder.failures).toEqual([]);
    expect(recorder.cooldownServed).toBe(1);
  });

  it('有备候选可用时不算熔断全损', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([
        [{ kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) }],
        [{ kind: 'delta', delta: '我在，慢慢说。' }],
      ]),
      config: config([{ id: 'primary' }, { id: 'backup' }]),
      telemetry: recorder,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.degraded).toBe(false);
    expect(recorder.fallbacks).toHaveLength(1);
    expect(recorder.cooldownServed).toBe(0);
  });
});
