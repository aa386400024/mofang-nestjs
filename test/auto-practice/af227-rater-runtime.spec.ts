// AF-227 · 评分运行时端点解析单测.
//
// 边界: 纯配置解析，不建网络请求；真实 key 用占位值。

import { describe, expect, it } from 'vitest';

import { resolveRaterConfig } from '../../bin/realism-rater-runtime.js';

const ENV = {
  MINIMAX_API_KEY: 'fake-minimax-key',
  MINIMAX_LLM_MODEL: 'MiniMax-M3.1-Flash',
  LLM_DOUBAO_API_KEY: 'fake-doubao-key',
  LLM_DOUBAO_MODEL: 'doubao-seed-2-1-pro-260915',
} as const;

describe('AF-227 评分运行时端点解析', () => {
  it('MiniMax 走历史 key，默认 low reasoning，不产生豆包 thinking 字段', () => {
    const resolved = resolveRaterConfig({ provider: 'minimax', temperature: 0.1 }, ENV);
    expect(resolved.providerId).toBe('minimax');
    expect(resolved.apiKeyEnvKey).toBe('MINIMAX_API_KEY');
    expect(resolved.apiKey).toBe('fake-minimax-key');
    expect(resolved.model).toBe('MiniMax-M3.1-Flash');
    expect(resolved.reasoningEffort).toBe('low');
    expect(resolved.modelKwargs).toBeUndefined();
  });

  it('豆包默认模型来自 LLM_DOUBAO_MODEL，thinking disabled 时不下发 reasoningEffort', () => {
    const resolved = resolveRaterConfig({ provider: 'doubao', temperature: 0.5, thinking: 'disabled' }, ENV);
    expect(resolved.providerId).toBe('doubao');
    expect(resolved.apiKeyEnvKey).toBe('LLM_DOUBAO_API_KEY');
    expect(resolved.apiKey).toBe('fake-doubao-key');
    expect(resolved.model).toBe('doubao-seed-2-1-pro-260915');
    expect(resolved.thinking).toBe('disabled');
    expect(resolved.reasoningEffort).toBeUndefined();
    expect(resolved.modelKwargs).toEqual({ thinking: { type: 'disabled' } });
  });

  it('豆包 thinking auto 时保留 low reasoning，不发 thinking 字段', () => {
    const resolved = resolveRaterConfig({ provider: 'doubao', temperature: 0.1 }, ENV);
    expect(resolved.thinking).toBe('auto');
    expect(resolved.reasoningEffort).toBe('low');
    expect(resolved.modelKwargs).toBeUndefined();
  });

  it('缺 key 显式失败，错误信息不打印密钥', () => {
    expect(() => resolveRaterConfig({ provider: 'doubao', temperature: 0.1 }, {})).toThrow(/缺少 LLM_DOUBAO_API_KEY/);
  });

  it('非豆包 provider 不接受 thinking 开关', () => {
    expect(() => resolveRaterConfig({ provider: 'minimax', temperature: 0.1, thinking: 'disabled' }, ENV)).toThrow(
      /thinking=disabled 仅支持 doubao/,
    );
  });
});
