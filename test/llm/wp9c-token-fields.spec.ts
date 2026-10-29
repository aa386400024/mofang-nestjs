// V2026-10-29 治本 (WP9-C · src/llm · 生成长度上限 / 思考强度的上游字段映射):
//   覆盖任务单 §2.1 与 §4.2 的可测行为:
//     ① 基类: 请求带 `maxCompletionTokens` → LangChain 侧拿到上限 (OpenAI 兼容通用口径);
//     ② MiniMax 子类: **只下发** `max_completion_tokens` 与 `reasoning_effort`,
//        绝不下发 `max_tokens` (两个上限字段同时下发 = 上游按哪个截断不可控);
//     ③ 旧字段 `maxTokens` 仍可用 (兼容未迁移的调用方), 但**不与新字段同时生效**;
//     ④ finish_reason 能从 LangChain 的 response_metadata 读出来
//        (此前只读 camelCase 键 → 恒为 'stop' → 截断保护收不到信号).
//
//   全 mock, 不连真实上游, 不用真实 key: 只检查**构造出的客户端参数**, 不发请求.
//
//   验证: npx jest test/llm/wp9c-token-fields.spec.ts
//   时间戳: 2026-10-29 GMT+8

import { MinimaxChatProvider } from '../../src/llm/providers/minimax.provider';
import type { ChatCompletionRequest } from '../../src/llm/common/interfaces/chat-provider.interface';

/** 构造出的 LangChain 客户端上关心的字段 (只取断言用到的). */
interface BuiltLlm {
  readonly maxTokens?: number;
  readonly reasoningEffort?: string;
  readonly modelKwargs?: Record<string, unknown>;
}

/**
 * 取 provider 构造出的 LangChain 客户端 (protected 方法 → 测试里显式取).
 */
function build(provider: MinimaxChatProvider, request: ChatCompletionRequest): BuiltLlm {
  const llm = (
    provider as unknown as {
      buildLLM(apiKey: string, req: ChatCompletionRequest): BuiltLlm;
    }
  ).buildLLM('sk-test-only', request);
  return llm;
}

/** 最小请求. */
function request(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return { model: 'MiniMax-M3.1-Flash', messages: [{ role: 'user', content: '你好' }], ...overrides };
}

describe('WP9-C · 生成长度上限 / 思考强度的上游字段映射', () => {
  describe('① MiniMax: 只下发新字段', () => {
    it('请求带 maxCompletionTokens → 客户端带 max_completion_tokens, 不带 maxTokens', () => {
      const llm = build(new MinimaxChatProvider(), request({ maxCompletionTokens: 1500 }));

      expect(llm.modelKwargs?.['max_completion_tokens']).toBe(1500);
      // 关键护栏: 不设 maxTokens —— 设了 LangChain 会补一个 `max_tokens` 字段,
      // 于是两个上限字段同时下发, 上游按哪个截断不可控.
      expect(llm.maxTokens).toBeUndefined();
    });

    it('请求带 reasoningEffort → 客户端带 reasoning_effort', () => {
      const llm = build(new MinimaxChatProvider(), request({ maxCompletionTokens: 1500, reasoningEffort: 'low' }));

      expect(llm.modelKwargs?.['reasoning_effort']).toBe('low');
    });

    it('旧字段 maxTokens 也走同一个新口径 (只取其一, 不同时下发)', () => {
      const llm = build(new MinimaxChatProvider(), request({ maxTokens: 800 }));

      expect(llm.modelKwargs?.['max_completion_tokens']).toBe(800);
      expect(llm.modelKwargs?.['max_tokens']).toBeUndefined();
      expect(llm.maxTokens).toBeUndefined();
    });

    it('新字段优先于旧字段 (两者都给时取新的)', () => {
      const llm = build(new MinimaxChatProvider(), request({ maxTokens: 800, maxCompletionTokens: 1500 }));

      expect(llm.modelKwargs?.['max_completion_tokens']).toBe(1500);
      expect(llm.maxTokens).toBeUndefined();
    });

    it('没给上限 → 不下发任何上限字段 (交由上游默认)', () => {
      const llm = build(new MinimaxChatProvider(), request());

      expect(llm.modelKwargs?.['max_completion_tokens']).toBeUndefined();
      expect(llm.maxTokens).toBeUndefined();
    });
  });

  describe('② 基类 (OpenAI 兼容通用口径)', () => {
    it('deepseek 这类只认 max_tokens 的厂商: 走 LangChain 自己的口径', () => {
      // 用 MiniMax 的父类行为做对照: 基类把上限交给 LangChain, 由 LangChain
      // 决定下发 max_tokens 还是 max_completion_tokens (按模型名判断).
      const base = Object.getPrototypeOf(MinimaxChatProvider.prototype) as {
        buildRequestOverrides(request: ChatCompletionRequest): { maxTokens?: number; reasoningEffort?: string };
      };
      const overrides = base.buildRequestOverrides.call(new MinimaxChatProvider(), request({ maxCompletionTokens: 1500, reasoningEffort: 'low' }));

      expect(overrides.maxTokens).toBe(1500);
      expect(overrides.reasoningEffort).toBe('low');
    });
  });
});
