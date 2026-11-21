import { describe, expect, it } from 'vitest';

import { DEFAULT_VISITOR_DOUBAO_MODEL, resolveVisitorRuntime } from '../../src/agent/visitor/visitor.runtime.js';

describe('AF-248 visitor 运行时配置', () => {
  it('未配置任何开关时默认 minimax + shared，不触碰豆包', () => {
    const runtime = resolveVisitorRuntime({});
    expect(runtime).toEqual({ llmProvider: 'minimax', promptVariant: 'shared' });
  });

  it('显式开启 doubao + seed-v5 时返回豆包模型默认值', () => {
    const runtime = resolveVisitorRuntime({
      provider: 'doubao',
      promptVariant: 'seed-v5',
      doubaoApiKey: 'key-1',
    });
    expect(runtime).toEqual({
      llmProvider: 'doubao',
      promptVariant: 'seed-v5',
      doubaoModel: DEFAULT_VISITOR_DOUBAO_MODEL,
    });
  });

  it('允许用 VISITOR_DOUBAO_MODEL 覆盖豆包模型', () => {
    expect(resolveVisitorRuntime({ provider: 'doubao', doubaoApiKey: 'key-1', doubaoModel: 'custom-model' }).doubaoModel).toBe(
      'custom-model',
    );
  });

  it('空串与纯空白按未配置处理，回落到默认值', () => {
    expect(resolveVisitorRuntime({ provider: '  ', promptVariant: '' })).toEqual({
      llmProvider: 'minimax',
      promptVariant: 'shared',
    });
  });

  it('非法 provider / variant 直接抛错，不静默回退', () => {
    expect(() => resolveVisitorRuntime({ provider: 'openai' })).toThrow('VISITOR_LLM_PROVIDER');
    expect(() => resolveVisitorRuntime({ promptVariant: 'seed-v51' })).toThrow('VISITOR_PROMPT_VARIANT');
  });

  it('切 doubao 但缺 key 时启动失败', () => {
    expect(() => resolveVisitorRuntime({ provider: 'doubao' })).toThrow('LLM_DOUBAO_API_KEY');
  });
});
