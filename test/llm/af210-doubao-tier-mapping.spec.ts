// AF-210 · 豆包档位映射单测.
//
// 为什么要有这组测试: 2026-11-14 的选型结论是「豆包备候选零代码接入」, 但
//   2026-11-20 实测方舟已把 doubao-lite / doubao-pro-32k / doubao-pro-128k
//   三个旧别名全部下线 (404). 熔断切到备候选会每次都 404, 等于没接, 还会把
//   失败计数一直打满.
//
// 边界: 只测纯映射表, 不发请求、不连 Redis/MySQL.
//
// 验证: npx vitest run test/llm/af210-doubao-tier-mapping.spec.ts

import { describe, expect, it } from 'vitest';

import { AIProviderId, LLMTier } from '../../src/llm/common/enums/llm.enums.js';
import { LlmRouterService } from '../../src/llm/registry/llm-router.service.js';

/** 构造 router (只替换 registry / config, 走真实映射逻辑). */
function buildRouter(env: Readonly<Record<string, string>> = {}): LlmRouterService {
  const config = { get: (key: string) => env[key] } as unknown as ConstructorParameters<typeof LlmRouterService>[1];
  const registry = {} as unknown as ConstructorParameters<typeof LlmRouterService>[0];
  return new LlmRouterService(registry, config);
}

describe('AF-210 豆包档位映射', () => {
  it('三档全部指向方舟当前有效型号', () => {
    const router = buildRouter();

    expect(router.getDefaultModelForTier(LLMTier.BASIC, AIProviderId.DOUBAO)).toBe('doubao-seed-2-1-lite-260915');
    expect(router.getDefaultModelForTier(LLMTier.RAG, AIProviderId.DOUBAO)).toBe('doubao-seed-2-1-pro-260628');
    expect(router.getDefaultModelForTier(LLMTier.ADVANCED, AIProviderId.DOUBAO)).toBe('doubao-seed-2-1-pro-260628');
  });

  it('已下线旧别名不再出现在任何档位', () => {
    const router = buildRouter();
    const models = [LLMTier.BASIC, LLMTier.RAG, LLMTier.ADVANCED].map((tier) => router.getDefaultModelForTier(tier, AIProviderId.DOUBAO));

    for (const retired of ['doubao-lite', 'doubao-pro-32k', 'doubao-pro-128k']) {
      expect(models).not.toContain(retired);
    }
  });

  it('不改变其他厂商的档位映射', () => {
    const router = buildRouter();

    expect(router.getDefaultModelForTier(LLMTier.BASIC, AIProviderId.OPENAI)).toBe('gpt-4o-mini');
    expect(router.getDefaultModelForTier(LLMTier.RAG, AIProviderId.QWEN)).toBe('qwen-plus');
    expect(router.getDefaultModelForTier(LLMTier.ADVANCED, AIProviderId.QWEN)).toBe('qwen-max');
  });
});
