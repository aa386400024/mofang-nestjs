// AF-289 · 候选冷却当前状态:
//   进入冷却/延长时上报到期时刻, 从冷却恢复时上报 0.
//   只看事件流 (AF-287) 只能知道"进过几次", 这里补"此刻还在不在冷却".

import { describe, expect, it } from 'vitest';

import { LlmRenderAdapter, type ChatCaller, type ChatStreamOptions } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import {
  createRenderAdapterConfig,
  type RenderAdapterConfig,
  type RenderCandidate,
} from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type { RenderTelemetryPort } from '../../src/engine-adapters/rendering/render-telemetry.port.js';
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
  states: { candidate: string; model: string; untilMs: number }[] = [];

  onCandidateCooldownState(candidateId: string, model: string, cooldownUntilMs: number): void {
    this.states.push({ candidate: candidateId, model, untilMs: cooldownUntilMs });
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

const RATE_LIMIT = { kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) } as const;
const SERVER_ERROR = { kind: 'error', error: Object.assign(new Error('server error'), { status: 500 }) } as const;

describe('AF-289 · 候选冷却当前状态', () => {
  it('进入冷却时上报到期时刻', async () => {
    const now = 0;
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([[RATE_LIMIT]]),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
      now: () => now,
    });

    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.states).toEqual([{ candidate: 'primary', model: 'chat-model', untilMs: 1000 }]);
    expect(adapter.health()['primary']?.inCooldown).toBe(true);
  });

  it('半开探测成功恢复时上报 0', async () => {
    let now = 0;
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([[RATE_LIMIT], [{ kind: 'delta', delta: '嗯' }]]),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
      now: () => now,
    });

    await adapter.streamRender(spec(), { onDelta: () => {} });
    now = 300;
    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.states).toEqual([
      { candidate: 'primary', model: 'chat-model', untilMs: 1000 },
      { candidate: 'primary', model: 'chat-model', untilMs: 0 },
    ]);
    expect(adapter.health()['primary']?.inCooldown).toBe(false);
  });

  it('生产默认参数下探测失败也上报新的到期时刻（duration 被 clamp 不变）', async () => {
    let now = 0;
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([[SERVER_ERROR], [SERVER_ERROR], [SERVER_ERROR], [SERVER_ERROR]]),
      config: config([{ id: 'primary' }], {
        failureThreshold: 3,
        cooldownBaseMs: 30_000,
        cooldownMaxMs: 60_000,
        halfOpenAfterMs: 30_000,
      }),
      telemetry: recorder,
      now: () => now,
    });

    // 第 3 次失败才进冷却: 60000ms.
    await adapter.streamRender(spec(), { onDelta: () => {} });
    await adapter.streamRender(spec(), { onDelta: () => {} });
    await adapter.streamRender(spec(), { onDelta: () => {} });
    // 到半开时点, 探测失败: duration 仍被 clamp 到 60000, 但 until 被推到 90000.
    now = 30_000;
    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.states).toEqual([
      { candidate: 'primary', model: 'chat-model', untilMs: 60_000 },
      { candidate: 'primary', model: 'chat-model', untilMs: 90_000 },
    ]);
  });
});
