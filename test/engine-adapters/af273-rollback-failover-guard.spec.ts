// V2026-11-22 建立 (AF-273 · 回滚态候选链保底守卫 · 单测):
//   覆盖:
//     ① VISITOR_LLM_PROVIDER=minimax 且未配 fallback 时自动补 doubao 备候选；
//     ② 回滚态豆包备候选仍走来访者 Seed Character 模型，不退化成通用豆包型号；
//     ③ 显式 ENGINE_RENDER_FALLBACK_PROVIDERS 优先，不被自动补备覆盖；
//     ④ 未设置 VISITOR_LLM_PROVIDER 时保持既有单候选，零回归；
//     ⑤ 回滚态自动补备后 ENGINE_RENDER_REQUIRE_FAILOVER=true 不再启动失败；
//     ⑥ 正向 doubao 切流仍自动补 minimax。
//
//   边界: 只测装配期候选/模型解析，不发请求、不连依赖.
//   验证: pnpm exec vitest run test/engine-adapters/af273-rollback-failover-guard.spec.ts

import { describe, expect, it } from 'vitest';

import { RenderConfigFactory } from '../../src/engine-adapters/wiring/render-config.factory.js';
import { AIProviderId, LLMTier } from '../../src/llm/common/enums/llm.enums.js';
import type { LlmRouterService } from '../../src/llm/registry/llm-router.service.js';

function stubConfig(env: Readonly<Record<string, string>> = {}): ConstructorParameters<typeof RenderConfigFactory>[0] {
  return { get: (key: string) => env[key] } as unknown as ConstructorParameters<typeof RenderConfigFactory>[0];
}

class StubRouter {
  getDefaultModelForTier(_tier: LLMTier, providerId?: AIProviderId): string {
    return `${providerId ?? 'default'}-tier-model`;
  }
}

// AF-275: 自动补出来的备候选必须有 key；本单测只测候选链，给两把假 key 让装配通过。
const PROVIDER_KEYS = {
  LLM_DOUBAO_API_KEY: 'test-doubao-key',
  MINIMAX_API_KEY: 'test-minimax-key',
} as const;

function build(env: Readonly<Record<string, string>>): ReturnType<RenderConfigFactory['build']> {
  return new RenderConfigFactory(stubConfig(env), new StubRouter() as unknown as LlmRouterService).build();
}

function modelOf(config: ReturnType<RenderConfigFactory['build']>, id: string, kind: 'chat' | 'stable' | 'advanced'): string | undefined {
  return config.candidates.find((candidate) => candidate.id === id)?.overrides?.[kind]?.model;
}

describe('AF-273 · 回滚态候选链保底守卫', () => {
  it('① 显式回滚 minimax 且未配 fallback 时自动补 doubao', () => {
    const config = build({
      ...PROVIDER_KEYS,
      VISITOR_LLM_PROVIDER: 'minimax',
      ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['minimax', 'doubao']);
  });

  it('② 回滚态豆包备候选仍走来访者 Seed Character 模型', () => {
    const config = build({
      ...PROVIDER_KEYS,
      VISITOR_LLM_PROVIDER: 'minimax',
      ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
    });
    expect(modelOf(config, 'doubao', 'chat')).toBe('doubao-seed-character-260628');
    expect(modelOf(config, 'doubao', 'stable')).toBe('doubao-seed-character-260628');
    expect(modelOf(config, 'doubao', 'advanced')).toBe('doubao-seed-character-260628');
    expect(modelOf(config, 'minimax', 'chat')).toBe('minimax-tier-model');
  });

  it('③ 显式 fallback 列表优先，不被自动补备覆盖', () => {
    const config = build({
      VISITOR_LLM_PROVIDER: 'minimax',
      ENGINE_RENDER_FALLBACK_PROVIDERS: 'qwen',
      ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['minimax', 'qwen']);
  });

  it('④ 未设置 visitor 开关时保持既有单候选，零回归', () => {
    const config = build({
      ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['minimax']);
  });

  it('⑤ 回滚态自动补备后 REQUIRE_FAILOVER 不再启动失败', () => {
    expect(() =>
      build({
        ...PROVIDER_KEYS,
        VISITOR_LLM_PROVIDER: 'minimax',
        ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
        ENGINE_RENDER_REQUIRE_FAILOVER: 'true',
      }),
    ).not.toThrow();
  });

  it('⑥ 正向 doubao 切流仍自动补 minimax', () => {
    const config = build({
      ...PROVIDER_KEYS,
      VISITOR_LLM_PROVIDER: 'doubao',
      ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['doubao', 'minimax']);
  });
});
