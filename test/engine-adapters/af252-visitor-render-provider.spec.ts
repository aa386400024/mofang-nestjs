// V2026-11-22 建立 (AF-252 · visitor 渲染路由双路径切换 · 单测):
//   覆盖:
//     ① 未配置 / minimax 时，候选序列与旧配置逐字一致；
//     ② VISITOR_LLM_PROVIDER=doubao 时主候选强制豆包，并自动补 minimax 回退；
//     ③ 豆包模型默认 seed-character，可被 VISITOR_DOUBAO_MODEL 覆盖；
//     ④ ENGINE_RENDER_<KIND>_MODEL_DOUBAO 仍高于 VISITOR_DOUBAO_MODEL；
//     ⑤ 已有 fallback 列表保留并去重；
//     ⑥ 非法 provider 启动期抛错。
//
//   边界: 只测装配期候选/模型解析，不发请求、不连依赖.
//   验证: pnpm exec vitest run test/engine-adapters/af252-visitor-render-provider.spec.ts

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

// AF-275: 自动补出来的备候选必须有 key；本组用例只测候选链与模型映射，给两把假 key 让装配通过。
const PROVIDER_KEYS = {
  LLM_DOUBAO_API_KEY: 'test-doubao-key',
  MINIMAX_API_KEY: 'test-minimax-key',
} as const;

function build(env: Readonly<Record<string, string>>): ReturnType<RenderConfigFactory['build']> {
  return new RenderConfigFactory(stubConfig({ ...PROVIDER_KEYS, ...env }), new StubRouter() as unknown as LlmRouterService).build();
}

function modelOf(config: ReturnType<RenderConfigFactory['build']>, id: string, kind: 'chat' | 'stable' | 'advanced'): string | undefined {
  return config.candidates.find((candidate) => candidate.id === id)?.overrides?.[kind]?.model;
}

describe('AF-252 · VISITOR_LLM_PROVIDER 双路径切换', () => {
  it('① 未配置时沿用 ENGINE_RENDER_PRIMARY_PROVIDER + fallback', () => {
    const config = build({
      ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
      ENGINE_RENDER_FALLBACK_PROVIDERS: 'doubao',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['minimax', 'doubao']);
    expect(modelOf(config, 'minimax', 'chat')).toBe('minimax-tier-model');
    expect(modelOf(config, 'doubao', 'chat')).toBe('doubao-tier-model');
  });

  it('② doubao 开关强制主候选豆包，并自动补 minimax 回退', () => {
    const config = build({
      VISITOR_LLM_PROVIDER: 'doubao',
      ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['doubao', 'minimax']);
    expect(modelOf(config, 'doubao', 'chat')).toBe('doubao-seed-character-260628');
    expect(modelOf(config, 'doubao', 'stable')).toBe('doubao-seed-character-260628');
    expect(modelOf(config, 'doubao', 'advanced')).toBe('doubao-seed-character-260628');
    expect(modelOf(config, 'minimax', 'chat')).toBe('minimax-tier-model');
  });

  it('③ VISITOR_DOUBAO_MODEL 覆盖默认 seed-character', () => {
    const config = build({
      VISITOR_LLM_PROVIDER: 'doubao',
      VISITOR_DOUBAO_MODEL: 'doubao-seed-character-custom',
    });
    expect(modelOf(config, 'doubao', 'chat')).toBe('doubao-seed-character-custom');
    expect(modelOf(config, 'doubao', 'stable')).toBe('doubao-seed-character-custom');
  });

  it('④ ENGINE_RENDER_<KIND>_MODEL_DOUBAO 高于 VISITOR_DOUBAO_MODEL', () => {
    const config = build({
      VISITOR_LLM_PROVIDER: 'doubao',
      VISITOR_DOUBAO_MODEL: 'visitor-model',
      ENGINE_RENDER_CHAT_MODEL_DOUBAO: 'provider-chat-model',
    });
    expect(modelOf(config, 'doubao', 'chat')).toBe('provider-chat-model');
    expect(modelOf(config, 'doubao', 'advanced')).toBe('provider-chat-model');
    expect(modelOf(config, 'doubao', 'stable')).toBe('visitor-model');
    expect(modelOf(config, 'minimax', 'chat')).toBe('minimax-tier-model');
  });

  it('⑤ 已有 fallback 列表保留并去重', () => {
    const config = build({
      VISITOR_LLM_PROVIDER: 'doubao',
      ENGINE_RENDER_FALLBACK_PROVIDERS: 'qwen,doubao',
    });
    expect(config.candidates.map((candidate) => candidate.id)).toEqual(['doubao', 'qwen']);
  });

  it('⑥ 非法 provider 启动期抛错', () => {
    expect(() => build({ VISITOR_LLM_PROVIDER: 'openai' })).toThrow(/VISITOR_LLM_PROVIDER=openai/);
  });
});
