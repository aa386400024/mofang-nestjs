// AF-287 · 候选级熔断归因:
//   只有候选"新进入冷却"或"冷却时长被延长"时才上报, 普通失败与成功路径都不上报.
//
// 这条链路补的是 AF-286 全损计数的盲区: 全损只知道"整轮没有候选可用",
// 这里才知道"谁被熔了、熔多久、因为什么".

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

interface CooldownEvent {
  readonly candidate: string;
  readonly model: string;
  readonly cause: RenderFailureCause;
  readonly cooldownMs: number;
}

class Recorder implements RenderTelemetryPort {
  attempts: string[] = [];
  outcomes: { candidate: string; outcome: RenderAttemptOutcome }[] = [];
  failures: { candidate: string; model: string; cause: RenderFailureCause }[] = [];
  cooldowns: CooldownEvent[] = [];
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

  onCandidateCooldown(candidateId: string, model: string, cause: RenderFailureCause, cooldownMs: number): void {
    this.cooldowns.push({ candidate: candidateId, model, cause, cooldownMs });
  }

  reset(): void {
    this.attempts = [];
    this.outcomes = [];
    this.failures = [];
    this.cooldowns = [];
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

function config(candidates: readonly RenderCandidate[], overrides: Partial<RenderAdapterConfig> = {}): RenderAdapterConfig {
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
    halfOpenAfterMs: 200,
    maxBlockRegen: 1,
    fallbackUtterances: [FALLBACK],
    streamFirstDeltaTimeoutMs: 500,
    streamIdleTimeoutMs: 500,
    ...overrides,
  });
}

describe('AF-287 · 候选级熔断归因', () => {
  it('候选首次进入冷却时上报一次, 带 cause 与本次冷却时长', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([[{ kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) }]]),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
    });

    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.failures).toEqual([{ candidate: 'primary', model: 'chat-model', cause: 'rate-limit' }]);
    expect(recorder.cooldowns).toEqual([{ candidate: 'primary', model: 'chat-model', cause: 'rate-limit', cooldownMs: 1000 }]);
  });

  it('未达失败阈值的普通失败不产生冷却事件', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([[{ kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) }]]),
      config: config([{ id: 'primary' }], { failureThreshold: 2 }),
      telemetry: recorder,
    });

    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.failures).toHaveLength(1);
    expect(recorder.cooldowns).toEqual([]);
  });

  it('半开探测失败导致冷却延长时再次上报, 时长为翻倍后的值', async () => {
    let now = 0;
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([
        [{ kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) }],
        [{ kind: 'error', error: Object.assign(new Error('server error'), { status: 500 }) }],
      ]),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
      now: () => now,
    });

    // 第一次: 429 -> 冷却 1000ms.
    await adapter.streamRender(spec(), { onDelta: () => {} });
    expect(recorder.cooldowns).toEqual([{ candidate: 'primary', model: 'chat-model', cause: 'rate-limit', cooldownMs: 1000 }]);

    // 到达半开时点: 放一次探测, 500 -> 冷却翻倍到 2000ms.
    now = 300;
    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.attempts).toEqual(['primary:chat-model', 'primary:chat-model']);
    expect(recorder.cooldowns).toEqual([
      { candidate: 'primary', model: 'chat-model', cause: 'rate-limit', cooldownMs: 1000 },
      { candidate: 'primary', model: 'chat-model', cause: 'server', cooldownMs: 2000 },
    ]);
  });
});
