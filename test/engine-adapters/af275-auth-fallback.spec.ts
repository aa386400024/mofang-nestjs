// AF-275：鉴权失败改为可切备。
// 旧口径假设「坏 key 对所有候选都坏」；现在主备是不同厂商、独立 key，
// 主 key 轮换/失效时应切到健康备候选，而不是整场直接降级。

import { describe, expect, it } from 'vitest';

import { LlmRenderAdapter, type ChatCaller, type ChatStreamOptions } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import { createRenderAdapterConfig } from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type { RenderSpec } from '../../src/engine-core/index.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';

function authError(): Error {
  return Object.assign(new Error('401 Unauthorized: invalid api key'), { status: 401 });
}

class AuthCaller implements ChatCaller {
  readonly streamAttempts: string[] = [];
  readonly chatAttempts: string[] = [];

  constructor(private readonly healthyProvider: string | null) {}

  async chat(request: ChatCompletionRequest, providerId?: string, _signal?: AbortSignal): Promise<ChatCompletionResponse> {
    const target = providerOf(request, providerId);
    this.chatAttempts.push(target);
    if (target === this.healthyProvider) {
      return {
        content: '备选回复。',
        model: `${target}-model`,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 8, totalTokens: 108 },
      };
    }
    throw authError();
  }

  stream(request: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    const target = providerOf(request, opts?.providerId);
    this.streamAttempts.push(target);
    return iterate(target, this.healthyProvider);
  }
}

function providerOf(request: ChatCompletionRequest, providerId?: string): string {
  return providerId ?? request.model?.replace(/-model$/u, '') ?? 'unknown';
}

async function* iterate(providerId: string, healthyProvider: string | null): AsyncIterable<ChatCompletionChunk> {
  if (providerId !== healthyProvider) throw authError();
  yield { delta: '备选回复。', tokenCount: 8, isFinal: false };
  yield { delta: '', tokenCount: 8, isFinal: true, finishReason: 'stop' };
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
    recentTurns: [{ role: 'counselor', text: '最近怎么样？' }],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 512 },
  };
}

function buildConfig(candidateIds: readonly string[]) {
  return createRenderAdapterConfig(
    candidateIds.map((id) => ({ id, overrides: { chat: { model: `${id}-model` } } })),
    {
      taskDefaults: {
        stable: { temperature: 0.2, model: 'stable-model' },
        chat: { temperature: 0.85, model: 'chat-model' },
        advanced: { temperature: 0.85, model: 'advanced-model' },
      },
      timeoutMs: 1000,
      failureThreshold: 2,
      cooldownBaseMs: 1000,
      cooldownMaxMs: 8000,
      fallbackUtterances: [FALLBACK_UTTERANCE],
    },
  );
}

describe('AF-275 · 鉴权失败按候选回退', () => {
  it('主候选 401 → 流式切到健康备候选，不降级', async () => {
    const caller = new AuthCaller('backup');
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig(['primary', 'backup']) });

    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: () => {
        /* 本测试不收集增量 */
      },
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.providerHint).toBe('backup');
    expect(outcome.text).toBe('备选回复。');
    expect(outcome.fallbackUsed).toBe(true);
    expect(caller.streamAttempts).toEqual(['primary', 'backup']);
    expect(adapter.health()['primary']?.consecutiveFailures).toBe(1);
  });

  it('主备都 401 → 候选耗尽后降级', async () => {
    const caller = new AuthCaller(null);
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig(['primary', 'backup']) });

    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: () => {
        /* 本测试不收集增量 */
      },
    });

    expect(outcome.degraded).toBe(true);
    expect(outcome.providerHint).toBe('degraded');
    expect(outcome.text).toBe(FALLBACK_UTTERANCE);
    expect(caller.streamAttempts).toEqual(['primary', 'backup']);
  });

  it('单候选 401 → 一次失败后降级，不无限重试', async () => {
    const caller = new AuthCaller(null);
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig(['primary']) });

    const outcome = await adapter.streamRender(buildSpec(), {
      onDelta: () => {
        /* 本测试不收集增量 */
      },
    });

    expect(outcome.degraded).toBe(true);
    expect(caller.streamAttempts).toEqual(['primary']);
  });

  it('聚合路径同样在主候选 401 后切备成功', async () => {
    const caller = new AuthCaller('backup');
    const adapter = new LlmRenderAdapter({ caller, config: buildConfig(['primary', 'backup']) });

    const outcome = await adapter.render(buildSpec());

    expect(outcome.providerHint).toBe('backup');
    expect(outcome.text).toBe('备选回复。');
    expect(caller.chatAttempts).toEqual(['primary', 'backup']);
  });
});
