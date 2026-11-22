// AF-275：自动补备候选的凭据守卫（装配期），以及显式候选的 key 策略。
// 目标：自动补出来的对端候选缺 key 时启动失败；显式候选缺 key 默认只告警、
// REQUIRE_FAILOVER=true 时硬失败；显式 fallback 与主候选重复时先去重、仍单候选才补对端。

import { describe, expect, it } from 'vitest';

import { RenderConfigFactory } from '../../src/engine-adapters/wiring/render-config.factory.js';
import { AIProviderId, LLMTier } from '../../src/llm/common/enums/llm.enums.js';
import type { LlmRouterService } from '../../src/llm/registry/llm-router.service.js';

function stubConfig(env: Readonly<Record<string, string>>): ConstructorParameters<typeof RenderConfigFactory>[0] {
  return { get: (key: string) => env[key] } as unknown as ConstructorParameters<typeof RenderConfigFactory>[0];
}

class StubRouter {
  getDefaultModelForTier(_tier: LLMTier, providerId?: AIProviderId): string {
    return `${providerId ?? 'default'}-tier-model`;
  }
}

function build(env: Readonly<Record<string, string>>): ReturnType<RenderConfigFactory['build']> {
  return new RenderConfigFactory(stubConfig(env), new StubRouter() as unknown as LlmRouterService).build();
}

const BOTH_KEYS = {
  LLM_DOUBAO_API_KEY: 'test-doubao-key',
  MINIMAX_API_KEY: 'test-minimax-key',
} as const;

describe('AF-275 · 候选凭据装配守卫', () => {
  it('自动补的 minimax 备候选缺 key → 即使 REQUIRE_FAILOVER=false 也启动失败', () => {
    expect(() =>
      build({
        VISITOR_LLM_PROVIDER: 'doubao',
        LLM_DOUBAO_API_KEY: 'test-doubao-key',
      }),
    ).toThrow(/自动补的备候选必须可用.*MINIMAX_API_KEY/s);
  });

  it('自动补的 minimax 备候选 key 为空白 → 按缺 key 处理', () => {
    expect(() =>
      build({
        VISITOR_LLM_PROVIDER: 'doubao',
        LLM_DOUBAO_API_KEY: 'test-doubao-key',
        MINIMAX_API_KEY: ' '.repeat(3),
      }),
    ).toThrow(/MINIMAX_API_KEY/);
  });

  it('自动补备候选且两家 key 齐全 → 正常装配', () => {
    const config = build({
      ...BOTH_KEYS,
      VISITOR_LLM_PROVIDER: 'doubao',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['doubao', 'minimax']);
  });

  it('显式 fallback 缺 key、REQUIRE_FAILOVER=false → 只告警不拦启动', () => {
    const config = build({
      VISITOR_LLM_PROVIDER: 'doubao',
      ENGINE_RENDER_FALLBACK_PROVIDERS: 'minimax',
      LLM_DOUBAO_API_KEY: 'test-doubao-key',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['doubao', 'minimax']);
  });

  it('显式 fallback 缺 key、REQUIRE_FAILOVER=true → 启动失败', () => {
    expect(() =>
      build({
        VISITOR_LLM_PROVIDER: 'doubao',
        ENGINE_RENDER_FALLBACK_PROVIDERS: 'minimax',
        ENGINE_RENDER_REQUIRE_FAILOVER: 'true',
        LLM_DOUBAO_API_KEY: 'test-doubao-key',
      }),
    ).toThrow(/MINIMAX_API_KEY/);
  });

  it('显式 fallback 与主候选重复 → 去重后仍只有单候选，自动补对端', () => {
    const config = build({
      ...BOTH_KEYS,
      VISITOR_LLM_PROVIDER: 'doubao',
      ENGINE_RENDER_FALLBACK_PROVIDERS: 'doubao',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['doubao', 'minimax']);
  });

  it('显式 fallback 与主候选重复且对端缺 key → 自动补对端后启动失败', () => {
    expect(() =>
      build({
        VISITOR_LLM_PROVIDER: 'doubao',
        ENGINE_RENDER_FALLBACK_PROVIDERS: 'doubao',
        LLM_DOUBAO_API_KEY: 'test-doubao-key',
      }),
    ).toThrow(/MINIMAX_API_KEY/);
  });

  it('显式非对端 fallback（qwen）优先，不自动插入对端', () => {
    const config = build({
      VISITOR_LLM_PROVIDER: 'doubao',
      ENGINE_RENDER_FALLBACK_PROVIDERS: 'qwen',
      LLM_DOUBAO_API_KEY: 'test-doubao-key',
      LLM_QWEN_API_KEY: 'test-qwen-key',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['doubao', 'qwen']);
  });

  it('未设置 visitor 总开关时保持既有候选链，缺 key 只告警', () => {
    const config = build({
      ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['minimax']);
  });
});
