// AF-210 · 渲染候选模型覆盖单测.
//
// 为什么要有这组测试: 原 modelFor 只有全局键 (ENGINE_RENDER_CHAT_MODEL 等).
//   主候选是 MiniMax 时, 想单独给豆包备候选换型号只能改全局键 —— 那会把
//   MiniMax 也一起改掉, 主链行为被误伤. 本单加 provider 维度键
//   (ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>), 并保持既有优先级:
//   全局显式键 > provider 维度键 > 档位表.
//
// 边界: 只测装配期的模型解析, 不发请求、不连依赖.
//
// 验证: npx vitest run test/engine-adapters/af210-render-model-override.spec.ts

import { describe, expect, it } from 'vitest';

import { RenderConfigFactory } from '../../src/engine-adapters/wiring/render-config.factory.js';
import { AIProviderId, LLMTier } from '../../src/llm/common/enums/llm.enums.js';
import type { LlmRouterService } from '../../src/llm/registry/llm-router.service.js';

/** 假 ConfigService: 只按传入 env 查表. */
function stubConfig(env: Readonly<Record<string, string>> = {}): ConstructorParameters<typeof RenderConfigFactory>[0] {
  return { get: (key: string) => env[key] } as unknown as ConstructorParameters<typeof RenderConfigFactory>[0];
}

/** 假 router: 档位表按 provider 回一个可辨识的名字, 便于断言走了哪条分支. */
class StubRouter {
  getDefaultModelForTier(_tier: LLMTier, providerId?: AIProviderId): string {
    return `${providerId ?? 'default'}-tier-model`;
  }
}

/** 取某候选的 chat 模型. */
function chatModelOf(factory: RenderConfigFactory, candidateId: string): string | undefined {
  const config = factory.build();
  return config.candidates.find((candidate) => candidate.id === candidateId)?.overrides?.chat?.model;
}

describe('AF-210 渲染候选模型覆盖', () => {
  it('缺省时按各候选自己的档位表取模型', () => {
    const factory = new RenderConfigFactory(
      stubConfig({ ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax', ENGINE_RENDER_FALLBACK_PROVIDERS: 'doubao' }),
      new StubRouter() as unknown as LlmRouterService,
    );

    expect(chatModelOf(factory, 'minimax')).toBe('minimax-tier-model');
    expect(chatModelOf(factory, 'doubao')).toBe('doubao-tier-model');
  });

  it('provider 维度键只改目标候选, 主候选不受影响', () => {
    const factory = new RenderConfigFactory(
      stubConfig({
        ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
        ENGINE_RENDER_FALLBACK_PROVIDERS: 'doubao',
        ENGINE_RENDER_CHAT_MODEL_DOUBAO: 'doubao-overridden',
      }),
      new StubRouter() as unknown as LlmRouterService,
    );

    expect(chatModelOf(factory, 'minimax')).toBe('minimax-tier-model');
    expect(chatModelOf(factory, 'doubao')).toBe('doubao-overridden');
  });

  it('全局显式键仍保持最高优先级', () => {
    const factory = new RenderConfigFactory(
      stubConfig({
        ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
        ENGINE_RENDER_FALLBACK_PROVIDERS: 'doubao',
        ENGINE_RENDER_CHAT_MODEL: 'global-model',
        ENGINE_RENDER_CHAT_MODEL_DOUBAO: 'doubao-overridden',
      }),
      new StubRouter() as unknown as LlmRouterService,
    );

    expect(chatModelOf(factory, 'minimax')).toBe('global-model');
    expect(chatModelOf(factory, 'doubao')).toBe('global-model');
  });

  it('advanced 未单独配置时回退到该 provider 的 chat 覆盖', () => {
    const factory = new RenderConfigFactory(
      stubConfig({
        ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
        ENGINE_RENDER_FALLBACK_PROVIDERS: 'doubao',
        ENGINE_RENDER_CHAT_MODEL_DOUBAO: 'doubao-chat-override',
      }),
      new StubRouter() as unknown as LlmRouterService,
    );

    const config = factory.build();
    const doubao = config.candidates.find((candidate) => candidate.id === 'doubao');
    expect(doubao?.overrides?.advanced?.model).toBe('doubao-chat-override');
  });

  it('主 + 备两个候选即满足熔断冗余', () => {
    const factory = new RenderConfigFactory(
      stubConfig({ ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax', ENGINE_RENDER_FALLBACK_PROVIDERS: 'doubao' }),
      new StubRouter() as unknown as LlmRouterService,
    );

    expect(factory.build().candidates.map((candidate) => candidate.id)).toEqual(['minimax', 'doubao']);
  });
});
