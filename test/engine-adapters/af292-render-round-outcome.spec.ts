// AF-292 · 轮次终局分母:
//   每个 render/streamRender 恰好记一次 rounds{outcome}; guard/exhausted 从普通 degrade 拆开.
//   这是降级率/回退率/取消率的统一分母, 防止 attempts 随重试膨胀与"全员冷却直接返回"漏计.

import { describe, expect, it } from 'vitest';

import {
  LlmRenderAdapter,
  toRoundOutcome,
  type ChatCaller,
  type ChatStreamOptions,
} from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import {
  createRenderAdapterConfig,
  type RenderAdapterConfig,
  type RenderCandidate,
} from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type { RenderRoundOutcome, RenderTelemetryPort } from '../../src/engine-adapters/rendering/render-telemetry.port.js';
import type { RenderSpec } from '../../src/engine-core/index.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

const FALLBACK = '我先缓一下，我们接着说。';

class FailingCaller implements ChatCaller {
  calls = 0;

  async chat(_request: ChatCompletionRequest, _providerId?: string): Promise<ChatCompletionResponse> {
    this.calls += 1;
    throw Object.assign(new Error('too many requests'), { status: 429 });
  }

  stream(_request: ChatCompletionRequest, _opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    return failingStream();
  }
}

class SuccessCaller implements ChatCaller {
  async chat(_request: ChatCompletionRequest, _providerId?: string): Promise<ChatCompletionResponse> {
    return {
      content: '我在，慢慢说。',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'm',
      finishReason: 'stop',
    };
  }
}

function failingStream(): AsyncIterable<ChatCompletionChunk> {
  const error = Object.assign(new Error('too many requests'), { status: 429 });
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw error;
        },
      };
    },
  };
}

class RoundRecorder implements RenderTelemetryPort {
  rounds: RenderRoundOutcome[] = [];

  onRoundOutcome(outcome: RenderRoundOutcome): void {
    this.rounds.push(outcome);
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
    timeoutMs: 200,
    failureThreshold: 1,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    halfOpenAfterMs: 200,
    maxBlockRegen: 1,
    fallbackUtterances: [FALLBACK],
    streamFirstDeltaTimeoutMs: 500,
    streamIdleTimeoutMs: 500,
  });
}

describe('AF-292 · 轮次终局分母', () => {
  it('聚合成功只记一次 rounds{success}', async () => {
    const recorder = new RoundRecorder();
    const adapter = new LlmRenderAdapter({
      caller: new SuccessCaller(),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
    });

    await adapter.render(spec());

    expect(recorder.rounds).toEqual(['success']);
  });

  it('两候选都 429 → 只记一次 rounds{exhausted}, 不随重试膨胀', async () => {
    const recorder = new RoundRecorder();
    const caller = new FailingCaller();
    const adapter = new LlmRenderAdapter({
      caller,
      config: config([{ id: 'primary' }, { id: 'backup' }]),
      telemetry: recorder,
    });

    await adapter.render(spec());

    expect(caller.calls).toBe(2);
    expect(recorder.rounds).toEqual(['exhausted']);
  });

  it('流式前置 guard block 记 rounds{guard}, 与普通降级分开', async () => {
    const recorder = new RoundRecorder();
    const adapter = new LlmRenderAdapter({
      caller: new SuccessCaller(),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
      precheck: () => ({ level: 'block', categories: ['test'] }),
    });

    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.rounds).toEqual(['guard']);
  });

  it('空上下文提前降级记 rounds{degrade}, 不漏轮次', async () => {
    const recorder = new RoundRecorder();
    const adapter = new LlmRenderAdapter({
      caller: new SuccessCaller(),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
    });

    await adapter.render(spec({ recentTurns: [] }));

    expect(recorder.rounds).toEqual(['degrade']);
  });

  it('取消/守卫/耗尽的原因映射到独立结局', () => {
    expect(toRoundOutcome('cancelled')).toBe('cancelled');
    expect(toRoundOutcome('guard')).toBe('guard');
    expect(toRoundOutcome('exhausted')).toBe('exhausted');
    expect(toRoundOutcome('rate-limit')).toBe('degrade');
  });
});
