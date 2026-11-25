import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { AIProviderId, LLMCapability } from '../../src/llm/common/enums/llm.enums.js';
import { registerDefaultProviders } from '../../src/llm/config/llm.config.js';
import { ProviderRegistryService } from '../../src/llm/registry/provider-registry.service.js';

/**
 * AF-506：自定义 OpenAI 兼容 embedding provider（TEI / 私有网关）注册契约。
 *
 * 为什么单独测注册层而不是打真 TEI：启动注册是"配置错就整条记忆链路静默降级"的地方，
 * 不能等真容器起来才发现 custom 根本没注册。这里只验证 env → provider 的映射。
 */
describe('AF-506 custom embedding provider registration', () => {
  function buildConfig(overrides: Record<string, string> = {}): ConfigService {
    return new ConfigService({
      // 显式清空真实进程里的厂商 key：ConfigService 找不到内部键时会回落到 process.env，
      // 不清空就会把本机 .env 的 doubao/minimax 带进单测，断言被环境污染。
      LLM_DOUBAO_API_KEY: '',
      LLM_QWEN_API_KEY: '',
      LLM_OPENAI_API_KEY: '',
      MINIMAX_API_KEY: '',
      LLM_CUSTOM_BASE_URL: 'http://127.0.0.1:8080',
      LLM_CUSTOM_API_KEY: 'tei-local',
      LLM_CUSTOM_DEFAULT_MODEL_EMBED: 'BAAI/bge-small-zh-v1.5',
      LLM_CUSTOM_DIMENSION: '512',
      ...overrides,
    });
  }

  function register(config: ConfigService): ProviderRegistryService {
    const registry = new ProviderRegistryService();
    registerDefaultProviders(registry, config);
    return registry;
  }

  it('baseUrl + 模型配置齐全时注册 custom embedding，并把 baseUrl 归一为 /v1', () => {
    const registry = register(buildConfig());
    expect(registry.listIds(LLMCapability.EMBEDDING)).toContain(AIProviderId.CUSTOM);

    const resolved = registry.resolveEmbedding(AIProviderId.CUSTOM);
    expect(resolved).not.toBeNull();
    expect(resolved?.provider.baseUrl).toBe('http://127.0.0.1:8080/v1');
    expect(resolved?.provider.defaultEmbeddingModel).toBe('BAAI/bge-small-zh-v1.5');
    expect(resolved?.provider.defaultDimension).toBe(512);
  });

  it('baseUrl 已经带 /v1 时不重复拼接', () => {
    const registry = register(buildConfig({ LLM_CUSTOM_BASE_URL: 'http://127.0.0.1:8080/v1' }));
    expect(registry.resolveEmbedding(AIProviderId.CUSTOM)?.provider.baseUrl).toBe('http://127.0.0.1:8080/v1');
  });

  it('缺模型或 baseUrl 时不注册，不产生半配置 provider', () => {
    const noModel = register(buildConfig({ LLM_CUSTOM_DEFAULT_MODEL_EMBED: '' }));
    expect(noModel.listIds(LLMCapability.EMBEDDING)).not.toContain(AIProviderId.CUSTOM);

    const noBase = register(buildConfig({ LLM_CUSTOM_BASE_URL: '' }));
    expect(noBase.listIds(LLMCapability.EMBEDDING)).not.toContain(AIProviderId.CUSTOM);
  });

  it('LLM_CUSTOM_ENABLED=false 时显式禁用', () => {
    const registry = register(buildConfig({ LLM_CUSTOM_ENABLED: 'false' }));
    expect(registry.listIds(LLMCapability.EMBEDDING)).not.toContain(AIProviderId.CUSTOM);
  });

  it('维度非法时回落到 1024，不让启动期因一个 env 崩掉', () => {
    const registry = register(buildConfig({ LLM_CUSTOM_DIMENSION: 'not-a-number' }));
    expect(registry.resolveEmbedding(AIProviderId.CUSTOM)?.provider.defaultDimension).toBe(1024);
  });
});
