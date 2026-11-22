// AF-282 · 渲染遥测语义修正回归:
//   P0-1 barge-in 不是降级: 外部取消只记 cancelled, 不记 degraded / attempts{degrade};
//   P0-2 候选级失败原因不塌缩: 单候选 429、末次候选 5xx 都要保留真实 cause;
//   P1 安全拦截 cause 统一为 guard; 锁定后 401 记 auth 并归因 auth.
//
// 这些用例锁的都是"看板数字会不会反号", 不涉及渲染主流程的成功/失败语义:
// barge-in 依然返回兜底 (已出声不能撤回), 只是不再算进降级率.

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

type StreamStep =
  | { readonly kind: 'delta'; readonly delta: string }
  | { readonly kind: 'error'; readonly error: Error }
  | { readonly kind: 'wait-for-abort' };

type ChatStep = { readonly kind: 'content'; readonly content: string } | { readonly kind: 'error'; readonly error: Error };

class ScriptedCaller implements ChatCaller {
  private streamIndex = 0;
  private chatIndex = 0;

  constructor(
    private readonly streams: readonly (readonly StreamStep[])[] = [],
    private readonly chats: readonly ChatStep[] = [],
  ) {}

  async chat(_request: ChatCompletionRequest, _providerId?: string): Promise<ChatCompletionResponse> {
    const step = this.chats[Math.min(this.chatIndex, this.chats.length - 1)];
    this.chatIndex += 1;
    if (step?.kind === 'error') throw step.error;
    return {
      content: step?.kind === 'content' ? step.content : '我在，慢慢说。',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'm',
      finishReason: 'stop',
    };
  }

  stream(_request: ChatCompletionRequest, opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    const steps = this.streams[Math.min(this.streamIndex, this.streams.length - 1)] ?? [];
    this.streamIndex += 1;
    return iterate(steps, opts?.signal);
  }
}

async function* iterate(steps: readonly StreamStep[], signal?: AbortSignal): AsyncIterable<ChatCompletionChunk> {
  let tokenCount = 0;
  for (const step of steps) {
    if (step.kind === 'error') throw step.error;
    if (step.kind === 'wait-for-abort') {
      // 模拟真实 SDK: 停摆时只有收到 abort 才 reject. 若 abort 在进入等待前已发生,
      // 事件不会再触发一次, 必须直接以 AbortError 结束.
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1000);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
          },
          { once: true },
        );
      });
      continue;
    }
    tokenCount += 1;
    yield { delta: step.delta, tokenCount, isFinal: false };
  }
  yield { delta: '', tokenCount, isFinal: true, finishReason: 'stop' };
}

class Recorder implements RenderTelemetryPort {
  attempts: string[] = [];
  outcomes: { candidate: string; outcome: RenderAttemptOutcome }[] = [];
  firstDeltas: string[] = [];
  timeouts: { candidate: string; phase: RenderStreamTimeoutPhase }[] = [];
  authFailures: string[] = [];
  failures: { candidate: string; model: string; cause: RenderFailureCause }[] = [];
  cancelled: string[] = [];
  fallbacks: { from: string; to: string; cause: RenderFailureCause }[] = [];
  degraded: RenderFailureCause[] = [];

  onAttempt(candidateId: string, model: string): void {
    this.attempts.push(`${candidateId}:${model}`);
  }

  onAttemptOutcome(candidateId: string, _model: string, outcome: RenderAttemptOutcome): void {
    this.outcomes.push({ candidate: candidateId, outcome });
  }

  onFirstDelta(candidateId: string): void {
    this.firstDeltas.push(candidateId);
  }

  onStreamTimeout(candidateId: string, phase: RenderStreamTimeoutPhase): void {
    this.timeouts.push({ candidate: candidateId, phase });
  }

  onAuthFailure(candidateId: string): void {
    this.authFailures.push(candidateId);
  }

  onFailure(candidateId: string, model: string, cause: RenderFailureCause): void {
    this.failures.push({ candidate: candidateId, model, cause });
  }

  onCancelled(candidateId: string): void {
    this.cancelled.push(candidateId);
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

function config(candidates: readonly RenderCandidate[], overrides: { firstDeltaMs?: number; idleMs?: number } = {}): RenderAdapterConfig {
  return createRenderAdapterConfig(candidates, {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model' },
      advanced: { temperature: 0.85, model: 'advanced-model' },
    },
    timeoutMs: 200,
    failureThreshold: 2,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    maxBlockRegen: 1,
    fallbackUtterances: [FALLBACK],
    // 取消用例不能用 10ms 首包超时, 否则取消与超时赛跑.
    streamFirstDeltaTimeoutMs: overrides.firstDeltaMs ?? 10,
    streamIdleTimeoutMs: overrides.idleMs ?? 20,
  });
}

describe('AF-282 · 渲染遥测语义修正', () => {
  it('P0-1 首包后外部取消 (barge-in): 只记 cancelled, 不记 degraded / attempts{degrade} / failure', async () => {
    const recorder = new Recorder();
    const controller = new AbortController();
    const caller = new ScriptedCaller([[{ kind: 'delta', delta: '我在，慢慢说。' }, { kind: 'wait-for-abort' }]]);
    const adapter = new LlmRenderAdapter({
      caller,
      config: config([{ id: 'primary' }], { firstDeltaMs: 500, idleMs: 500 }),
      telemetry: recorder,
    });

    const outcome = await adapter.streamRender(spec(), {
      signal: controller.signal,
      onDelta: () => {
        // 第一句已出声 → 用户打断.
        controller.abort();
      },
    });

    expect(outcome.degraded).toBe(true);
    expect(outcome.text).toBe(FALLBACK);
    expect(recorder.cancelled).toEqual(['primary']);
    expect(recorder.degraded).toEqual([]);
    expect(recorder.outcomes.map((item) => item.outcome)).toEqual([]);
    expect(recorder.failures).toEqual([]);
    expect(recorder.fallbacks).toEqual([]);
    expect(recorder.timeouts).toEqual([]);
  });

  it('P0-1 首包前外部取消: 不切备 / 不记超时, 只记 cancelled', async () => {
    const recorder = new Recorder();
    const controller = new AbortController();
    const caller = new ScriptedCaller([[{ kind: 'wait-for-abort' }]]);
    const adapter = new LlmRenderAdapter({
      caller,
      config: config([{ id: 'primary' }, { id: 'backup' }], { firstDeltaMs: 500 }),
      telemetry: recorder,
    });

    const pending = adapter.streamRender(spec(), { signal: controller.signal, onDelta: () => {} });
    setTimeout(() => controller.abort(), 20);
    const outcome = await pending;

    expect(outcome.degraded).toBe(true);
    expect(recorder.cancelled).toEqual(['primary']);
    expect(recorder.timeouts).toEqual([]);
    expect(recorder.fallbacks).toEqual([]);
    expect(recorder.degraded).toEqual([]);
    expect(recorder.attempts).toEqual(['primary:chat-model']);
  });

  it('P0-2 单候选 429: failure 保留 rate-limit, degraded 才记 exhausted', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([[{ kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) }]]),
      config: config([{ id: 'primary' }]),
      telemetry: recorder,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.degraded).toBe(true);
    expect(recorder.failures).toEqual([{ candidate: 'primary', model: 'chat-model', cause: 'rate-limit' }]);
    // attempts 记的是"这次尝试可重试"(retry), 与 failure 的 cause 分工不同.
    expect(recorder.outcomes).toEqual([{ candidate: 'primary', outcome: 'retry' }]);
    expect(recorder.degraded).toEqual(['exhausted']);
    expect(recorder.fallbacks).toEqual([]);
  });

  it('P0-2 末次候选 5xx: failure 保留 server, 不塌缩成 exhausted', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([
        [{ kind: 'error', error: Object.assign(new Error('too many requests'), { status: 429 }) }],
        [{ kind: 'error', error: Object.assign(new Error('bad gateway'), { status: 502 }) }],
      ]),
      config: config([{ id: 'primary' }, { id: 'backup' }]),
      telemetry: recorder,
    });

    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.failures).toEqual([
      { candidate: 'primary', model: 'chat-model', cause: 'rate-limit' },
      { candidate: 'backup', model: 'chat-model', cause: 'server' },
    ]);
    expect(recorder.fallbacks).toEqual([{ from: 'primary', to: 'backup', cause: 'rate-limit' }]);
    expect(recorder.degraded).toEqual(['exhausted']);
  });

  it('P0-2 连接层失败: failure/fallback 归因 network, 不再落 other', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([
        [{ kind: 'error', error: new Error('Connection error.') }],
        [{ kind: 'error', error: new Error('socket hang up ECONNRESET') }],
      ]),
      config: config([{ id: 'primary' }, { id: 'backup' }]),
      telemetry: recorder,
    });

    await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(recorder.failures).toEqual([
      { candidate: 'primary', model: 'chat-model', cause: 'network' },
      { candidate: 'backup', model: 'chat-model', cause: 'network' },
    ]);
    expect(recorder.fallbacks).toEqual([{ from: 'primary', to: 'backup', cause: 'network' }]);
    expect(recorder.degraded).toEqual(['exhausted']);
    expect(recorder.timeouts).toEqual([]);
  });

  it('P1 安全拦截: block 降级统一归因 guard', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller(
        [],
        [
          { kind: 'content', content: '我要去死。' },
          { kind: 'content', content: '我要去死。' },
        ],
      ),
      config: config([{ id: 'primary' }]),
      guard: async () => ({ level: 'block', categories: ['active_ideation'] }),
      telemetry: recorder,
    });

    const result = await adapter.render(spec());

    expect(result.text).toBe(FALLBACK);
    expect(recorder.degraded).toEqual(['guard']);
    expect(recorder.failures).toEqual([{ candidate: 'primary', model: 'chat-model', cause: 'guard' }]);
  });

  it('P1 锁定后 401: 记 authFailure, failure/degraded 都归因 auth', async () => {
    const recorder = new Recorder();
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([
        [
          { kind: 'delta', delta: '我在，慢慢说。' },
          { kind: 'error', error: Object.assign(new Error('unauthorized'), { status: 401 }) },
        ],
      ]),
      config: config([{ id: 'primary' }, { id: 'backup' }], { firstDeltaMs: 500, idleMs: 500 }),
      telemetry: recorder,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.degraded).toBe(true);
    expect(recorder.authFailures).toEqual(['primary']);
    expect(recorder.failures).toEqual([{ candidate: 'primary', model: 'chat-model', cause: 'auth' }]);
    expect(recorder.degraded).toEqual(['auth']);
    expect(recorder.fallbacks).toEqual([]);
  });

  it('遥测新回调抛错不影响渲染结果', async () => {
    const telemetry: RenderTelemetryPort = {
      onFailure: () => {
        throw new Error('boom');
      },
      onCancelled: () => {
        throw new Error('boom');
      },
    };
    const adapter = new LlmRenderAdapter({
      caller: new ScriptedCaller([[{ kind: 'error', error: new Error('boom') }]]),
      config: config([{ id: 'primary' }]),
      telemetry,
    });

    const outcome = await adapter.streamRender(spec(), { onDelta: () => {} });

    expect(outcome.degraded).toBe(true);
    expect(outcome.text).toBe(FALLBACK);
  });
});
