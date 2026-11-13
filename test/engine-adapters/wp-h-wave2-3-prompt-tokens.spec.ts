// V2026-11-10 治本 (Phase2.5 WP-H · 改动 7 — prompt_tokens 归约链 · 单测):
//   背景: 三批数据的 `prompt_tokens` 全库最大值为 0, `cost_basis` 恒 `output_only` ——
//   全库成本被严重低估. 任务单原描述是"链路没带", 但真实根因是**本仓在归约链上把它丢了**:
//     上游一直报着输入侧用量 (OpenAI 兼容 usage.prompt_tokens → LangChain usage_metadata.input_tokens),
//     但 provider 的 `applyChunkUsage` 只把 input+output 合成 `tokenCount`, **丢掉了 input 拆分**;
//     chunk 契约里又没有 prompt/completion 字段 → 流式路径的输入侧用量就此消失.
//   这组用例把"输入侧用量必须能穿透到渲染结果"钉成契约:
//     ① provider 层: 输入 / 输出拆分不被合并掉;
//     ② 适配层: 流式路径的 usage 带出 promptTokens;
//     ③ 上游没报 → 缺省 (undefined), 不是 0 (不拿 0 冒充"输入侧免费").
//
//   全 mock: 不发网络, 不连 Redis/MySQL, 不起 NestJS 容器.
//
//   验证: npx vitest run test/engine-adapters/wp-h-wave2-3-prompt-tokens.spec.ts
//   时间戳: 2026-11-10 GMT+8

import { describe, expect, it, vi } from 'vitest';

import { LlmRenderAdapter, type ChatCaller, type ChatStreamOptions } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import {
  createRenderAdapterConfig,
  type RenderAdapterConfig,
  type RenderCandidate,
} from '../../src/engine-adapters/rendering/render-adapter.config.js';
import type { RenderSpec } from '../../src/engine-core/index.js';
import { resolveChunkUsageSplit } from '../../src/llm/common/base/openai-compatible-chat.provider.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface.js';

// TD-10 · T-2: 真实 @langchain/openai 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('@langchain/openai', async () => {
  const { createLangchainOpenAiStub } = await import('../helpers/sdk-stubs.js');
  return createLangchainOpenAiStub();
});

// TD-10 · T-2: 真实 @langchain/core/messages 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('@langchain/core/messages', async () => {
  const { createLangchainMessagesStub } = await import('../helpers/sdk-stubs.js');
  return createLangchainMessagesStub();
});

/** 兜底话术 (与测试配置一致). */
const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';

/**
 * ChatCaller stub: 按脚本产出 chunk 流.
 *
 * 关键: 上游的 usage 通常在**收尾那块**才到齐 (甚至那块没有 delta) ——
 *   所以脚本里专门放一条"无 delta 但带用量"的收尾 chunk.
 */
class ScriptedCaller implements ChatCaller {
  constructor(private readonly chunks: readonly ChatCompletionChunk[]) {}

  async chat(_request: ChatCompletionRequest, _providerId?: string): Promise<ChatCompletionResponse> {
    return {
      content: '聚合兜底文本',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      model: 'stub',
      finishReason: 'stop',
    };
  }

  stream(_request: ChatCompletionRequest, _opts?: ChatStreamOptions): AsyncIterable<ChatCompletionChunk> {
    const chunks = this.chunks;
    return (async function* iterate(): AsyncIterable<ChatCompletionChunk> {
      for (const chunk of chunks) yield chunk;
    })();
  }
}

/** 构造测试用配置. */
function buildConfig(candidates: readonly RenderCandidate[]): RenderAdapterConfig {
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
    fallbackUtterances: [FALLBACK_UTTERANCE],
  });
}

/** 构造一份渲染规格. */
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

describe('WP-H · 改动 7 · prompt_tokens 归约链', () => {
  describe('① provider 层: 输入 / 输出拆分不被合并掉', () => {
    it('上游报了输入侧 → 拆分保留 (promptTokens = input_tokens)', () => {
      const split = resolveChunkUsageSplit({ input_tokens: 120, output_tokens: 30 });

      expect(split.promptTokens).toBe(120);
      expect(split.completionTokens).toBe(30);
      expect(split.totalTokens).toBe(150);
    });

    it('上游没报 → 缺省 (undefined), 不是 0', () => {
      const split = resolveChunkUsageSplit(void 0);

      expect(split.promptTokens).toBeUndefined();
      expect(split.completionTokens).toBeUndefined();
      expect(split.totalTokens).toBe(0);
    });

    it('只报了输出侧 → 输入侧仍然缺省 (不编造)', () => {
      const split = resolveChunkUsageSplit({ output_tokens: 42 });

      expect(split.promptTokens).toBeUndefined();
      expect(split.completionTokens).toBe(42);
    });
  });

  describe('② 适配层: 流式路径把输入侧用量带出来', () => {
    it('收尾 chunk 带 usage → outcome.usage.promptTokens 非 0', async () => {
      const caller = new ScriptedCaller([
        { delta: '我最近有点累。', tokenCount: 0, isFinal: false },
        // 上游的 usage 在收尾才到齐 (这块没有 delta) —— 必须也能读到.
        { delta: '', tokenCount: 150, isFinal: true, promptTokens: 120, completionTokens: 30 },
      ]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      const outcome = await adapter.streamRender(buildSpec(), { onDelta: () => {} });

      expect(outcome.usage.promptTokens).toBe(120);
      expect(outcome.usage.completionTokens).toBe(30);
      expect(outcome.usage.totalTokens).toBe(150);
    });

    it('中途的 chunk 也带 usage → 取最后一条 (上游是累计口径)', async () => {
      const caller = new ScriptedCaller([
        { delta: '嗯，', tokenCount: 100, isFinal: false, promptTokens: 80, completionTokens: 20 },
        { delta: '我想想。', tokenCount: 150, isFinal: false, promptTokens: 120, completionTokens: 30 },
        { delta: '', tokenCount: 150, isFinal: true },
      ]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      const outcome = await adapter.streamRender(buildSpec(), { onDelta: () => {} });

      expect(outcome.usage.promptTokens).toBe(120);
      expect(outcome.usage.completionTokens).toBe(30);
    });

    it('上游没报拆分 → promptTokens 缺省, 输出侧回落累计 tokenCount (旧口径, 不编造)', async () => {
      const caller = new ScriptedCaller([
        { delta: '我最近有点累。', tokenCount: 0, isFinal: false },
        { delta: '', tokenCount: 90, isFinal: true },
      ]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      const outcome = await adapter.streamRender(buildSpec(), { onDelta: () => {} });

      expect(outcome.usage.promptTokens).toBeUndefined();
      expect(outcome.usage.completionTokens).toBe(90);
      expect(outcome.usage.totalTokens).toBe(90);
    });

    it('流式路径的兜底形态 (聚合收集成流) 仍带 promptTokens', async () => {
      const adapter = new LlmRenderAdapter({
        caller: {
          chat: async (): Promise<ChatCompletionResponse> => ({
            content: '我最近有点累。',
            usage: { promptTokens: 55, completionTokens: 25, totalTokens: 80 },
            model: 'stub',
            finishReason: 'stop',
          }),
        },
        config: buildConfig([{ id: 'primary' }]),
      });

      const outcome = await adapter.streamRender(buildSpec(), { onDelta: () => {} });

      expect(outcome.usage.promptTokens).toBe(55);
      expect(outcome.usage.completionTokens).toBe(25);
    });
  });
});
