// V2026-11-20 建立 (AF-208 · R2 真人度):
//   覆盖聚合渲染的真人度重试边界：
//     active 明确违约最多重试一次；重试仍违约接受可读文本；
//     off / audit 零额外调用；流式只审计不重试。
//
//   全 mock；不起 NestJS / 不发网络。

import { afterEach, describe, expect, it } from 'vitest';

import { LlmRenderAdapter, type ChatCaller, type ChatStreamOptions } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import { createRenderAdapterConfig } from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';

const TOO_LONG =
  '我今天其实想了很多，我觉得我应该把最近发生的事情都跟您说清楚，从我小时候一直到工作以后，包括家里那些一直没处理完的事，还有我最近睡不好、吃不下、上班也总是拖着，这样可能对我有帮助，也免得我下次还要再重新讲一遍，虽然我也不知道从哪里开始，但我想试一试。';
const GOOD_SHORT = '嗯……就是有点累。';

afterEach(() => {
  delete process.env['RENDER_REALISM_MODE'];
});

function setMode(mode: string | undefined): void {
  if (mode === undefined) delete process.env['RENDER_REALISM_MODE'];
  else process.env['RENDER_REALISM_MODE'] = mode;
}

class ScriptedCaller implements ChatCaller {
  readonly calls: ChatCompletionRequest[] = [];
  private index = 0;

  constructor(
    private readonly contents: readonly string[],
    private readonly streamDeltas?: readonly string[],
  ) {}

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.calls.push(request);
    const content = this.contents[Math.min(this.index, this.contents.length - 1)] ?? '';
    this.index += 1;
    return {
      content,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'stub',
      finishReason: 'stop',
    };
  }

  stream(request: ChatCompletionRequest, _opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    this.calls.push(request);
    return iterateStream(this.streamDeltas ?? []);
  }
}

async function* iterateStream(deltas: readonly string[]): AsyncIterable<ChatCompletionChunk> {
  let tokenCount = 0;
  for (const delta of deltas) {
    tokenCount += 5;
    yield { delta, tokenCount, isFinal: false };
  }
  yield { delta: '', tokenCount, isFinal: true, finishReason: 'stop' };
}

function buildAdapter(
  caller: ChatCaller,
  guard: () => Promise<{ level: 'pass' | 'warn' | 'block' }> = async () => ({ level: 'pass' }),
): LlmRenderAdapter {
  return new LlmRenderAdapter({
    caller,
    config: createRenderAdapterConfig([{ id: 'primary' }], {
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
      fallbackUtterances: [FALLBACK_UTTERANCE],
    }),
    guard,
  });
}

function buildSpec(overrides: Partial<AdaptiveRenderSpec> = {}): AdaptiveRenderSpec {
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'recounting',
      emotion: { label: 'neutral', valence: 0, arousal: 0.4 },
      resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: ['judge'],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.4 },
    resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.6,
    coreBeliefs: [],
    forbiddenBehaviors: ['judge'],
    recall: [],
    recentTurns: [{ role: 'counselor', text: '最近睡得怎么样？' }],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 512 },
    ...overrides,
  };
}

describe('AF-208 · 聚合渲染真人度重试', () => {
  it('active + 明确过长 → 同一候选重说一次，返回合规文本并合并 usage', async () => {
    setMode('active');
    const caller = new ScriptedCaller([TOO_LONG, GOOD_SHORT]);
    const adapter = buildAdapter(caller);
    const spec = buildSpec();

    const result = await adapter.render(spec);

    expect(caller.calls).toHaveLength(2);
    expect(result.text).toBe(GOOD_SHORT);
    expect(result.fallbackUsed).toBe(true);
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 40, totalTokens: 60 });
    const retrySystem = caller.calls[1]?.messages[0]?.content;
    expect(retrySystem).toContain('【本轮重说要求】');
    expect(retrySystem).toContain('最多两句');
  });

  it('active + 配额超限 → 重说时把痕迹压回上限', async () => {
    setMode('active');
    const caller = new ScriptedCaller(['嗯……我我那个……', GOOD_SHORT]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(2);
    expect(result.text).toBe(GOOD_SHORT);
    expect(caller.calls[1]?.messages[0]?.content).toContain('六类合计控制在 2 处以内');
  });

  it('off → 不审计不重试，一次调用原样返回', async () => {
    setMode('off');
    const caller = new ScriptedCaller([TOO_LONG]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(1);
    expect(result.text).toBe(TOO_LONG);
    expect(result.fallbackUsed).toBe(false);
  });

  it('audit → 只审计不重试，一次调用原样返回', async () => {
    setMode('audit');
    const caller = new ScriptedCaller([TOO_LONG]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(1);
    expect(result.text).toBe(TOO_LONG);
  });

  it('重试仍违约 → 接受可读文本，不降级成兜底句', async () => {
    setMode('active');
    const caller = new ScriptedCaller([TOO_LONG, TOO_LONG]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(2);
    expect(result.text).toBe(TOO_LONG);
    expect(result.text).not.toBe(FALLBACK_UTTERANCE);
  });

  it('安全 block 重生成后仍走真人度审计，不留下绕过路径', async () => {
    setMode('active');
    const caller = new ScriptedCaller(['这一段不该说。', TOO_LONG, GOOD_SHORT]);
    let guardCalls = 0;
    const guard = async (): Promise<{ level: 'pass' | 'warn' | 'block' }> => {
      guardCalls += 1;
      return guardCalls === 1 ? { level: 'block' } : { level: 'pass' };
    };
    const adapter = buildAdapter(caller, guard);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(3);
    expect(result.text).toBe(GOOD_SHORT);
    expect(result.fallbackUsed).toBe(true);
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 40, totalTokens: 60 });
  });

  it('流式只审计不重试：已经出声的文本不改写、不撤回', async () => {
    setMode('active');
    const caller = new ScriptedCaller([], ['我在，慢慢说。']);
    const adapter = buildAdapter(caller);
    const spec = buildSpec({ trust: 0.3 });

    const outcome = await adapter.streamRender(spec, { onDelta: () => {} });

    expect(caller.calls).toHaveLength(1);
    expect(outcome.text).toBe('我在，慢慢说。');
    expect(outcome.degraded).toBe(false);
  });
});
