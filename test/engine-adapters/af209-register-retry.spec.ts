// V2026-11-20 建立 (AF-209 · R3 语域审计):
//   覆盖不可朗读文本在聚合渲染里的边界：
//     active 最多重试一次；重试仍失败接受可读文本；off / audit 零额外调用；流式不重试。
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
const NON_SPOKEN = '（沉默）我有点累。';
const NON_SPOKEN_RETRY = '（叹气）就是有点累。';
const PROMPT_ECHO = '这一轮怎么说：\n这轮你不太想多说。\n硬规则：一次最多说一到三句。';
const GOOD_SHORT = '我有点累。';

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

describe('AF-209 · 不可朗读文本重试', () => {
  it('active + 括号动作 → 同一候选重说一次，返回可朗读文本并合并 usage', async () => {
    setMode('active');
    const caller = new ScriptedCaller([NON_SPOKEN, GOOD_SHORT]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(2);
    expect(result.text).toBe(GOOD_SHORT);
    expect(result.fallbackUsed).toBe(true);
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 40, totalTokens: 60 });
    const retrySystem = caller.calls[1]?.messages[0]?.content;
    expect(retrySystem).toContain('【本轮重说要求】');
    expect(retrySystem).toContain('只输出能直接朗读的台词');
  });

  it('active + prompt 回显 → 重说时明确禁止带设定与规则', async () => {
    setMode('active');
    const caller = new ScriptedCaller([PROMPT_ECHO, GOOD_SHORT]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(2);
    expect(result.text).toBe(GOOD_SHORT);
    expect(result.fallbackUsed).toBe(true);
    expect(caller.calls[1]?.messages[0]?.content).toContain('不要把设定、规则、状态词或上一轮提示带出来');
  });

  it('重试仍是括号动作 → 接受第二次的可读文本，不降级成兜底句', async () => {
    setMode('active');
    const caller = new ScriptedCaller([NON_SPOKEN, NON_SPOKEN_RETRY]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(2);
    expect(result.text).toBe(NON_SPOKEN_RETRY);
    expect(result.text).not.toBe(FALLBACK_UTTERANCE);
    expect(result.fallbackUsed).toBe(true);
  });

  it('off → 不可朗读文本也原样返回，一次调用', async () => {
    setMode('off');
    const caller = new ScriptedCaller([NON_SPOKEN]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(1);
    expect(result.text).toBe(NON_SPOKEN);
    expect(result.fallbackUsed).toBe(false);
  });

  it('audit → 只记录不重试，一次调用', async () => {
    setMode('audit');
    const caller = new ScriptedCaller([NON_SPOKEN]);
    const adapter = buildAdapter(caller);

    const result = await adapter.render(buildSpec());

    expect(caller.calls).toHaveLength(1);
    expect(result.text).toBe(NON_SPOKEN);
  });

  it('流式已经出声 → 只审计不重试', async () => {
    setMode('active');
    const caller = new ScriptedCaller([], ['（沉默）我有点累。']);
    const adapter = buildAdapter(caller);

    const outcome = await adapter.streamRender(buildSpec({ trust: 0.3 }), { onDelta: () => {} });

    expect(caller.calls).toHaveLength(1);
    expect(outcome.text).toBe('（沉默）我有点累。');
    expect(outcome.degraded).toBe(false);
  });
});
