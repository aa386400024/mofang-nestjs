// V2026-10-28 治本 (MiniMax chat provider 接入 · src/llm 增补):
//   覆盖任务单 §6 单测清单 1-5:
//     1. 有 `MINIMAX_API_KEY` → 注册 minimax chat, 且 key 取的是 `MINIMAX_API_KEY`
//        (不是 `LLM_MINIMAX_API_KEY`)
//     2. 无 `MINIMAX_API_KEY` → 不注册 minimax, 不抛错, 不影响其它三家
//     3. provider id / defaultChatModel / baseUrl 归一 (无双 /v1、无缺 /v1)
//     4. deepseek / doubao / qwen 现有注册行为不受影响 (回归断言)
//     5. 零真实网络、零真实 key
//   另附 3 条**根因回归护栏** (本期真正踩到的两个坑, 必须有断言兜住):
//     6. 运行时 apiKey 解析 (defaultEnvApiKeyResolver) 对 minimax 读 `MINIMAX_API_KEY`;
//        对其它厂商仍读 `LLM_<ID>_API_KEY`.
//        —— 漏掉这条的症状是 "provider 注册成功, 一调用就报 API key not found".
//     7. `getDefaultModelForTier(RAG, MINIMAX)` 返回 **minimax 自己**的默认模型,
//        而不是默认 chat provider 的模型.
//        —— 漏掉这条的症状是 "把 deepseek-chat 发给 minimax, 上游 400, 整轮降级".
//     8. 基址归一函数的边界 (空串 / 空白 / 带尾斜杠 / 带完整端点).
//
//   全 mock, 不连真实上游, 不用真实 key:
//     配置用假 ConfigService (纯键值表); registry / router 用真实类 (它们本身不触网);
//     厂商调用一律不发起 —— 本文件只验证**装配与解析**, 不验证上游协议.
//
//   验证: npx jest test/llm/minimax-provider.spec.ts
//   时间戳: 2026-10-28 GMT+8

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';

import type { ChatCompletionRequest } from '../../src/llm/common/interfaces/chat-provider.interface';
import { AIProviderId, LLMCapability, LLMTier } from '../../src/llm/common/enums/llm.enums';
import {
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_CHAT_MODEL,
  normalizeOpenAiCompatibleBaseUrl,
  resolveMinimaxBaseUrl,
  resolveMinimaxChatModel,
  resolveProviderApiKeyEnvKey,
} from '../../src/llm/config/provider-env';
import { registerDefaultProviders } from '../../src/llm/config/llm.config';
import { MinimaxChatProvider } from '../../src/llm/providers/minimax.provider';
import { LlmRouterService, defaultEnvApiKeyResolver } from '../../src/llm/registry/llm-router.service';
import { ProviderRegistryService } from '../../src/llm/registry/provider-registry.service';

/** 假 key (测试专用, 不是真凭证). */
const FAKE_MINIMAX_KEY = 'sk-test-minimax-key';
const FAKE_LLM_MINIMAX_KEY = 'sk-test-llm-minimax-key';
const FAKE_DEEPSEEK_KEY = 'sk-test-deepseek-key';
const FAKE_DOUBAO_KEY = 'sk-test-doubao-key';
const FAKE_QWEN_KEY = 'sk-test-qwen-key';

/**
 * 假 ConfigService — 只认给定的键值表 (缺省键返回 undefined).
 */
function stubConfig(env: Readonly<Record<string, string>>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

/**
 * 跑一次启动注册, 返回注册后的 registry.
 */
function register(env: Readonly<Record<string, string>>): ProviderRegistryService {
  const registry = new ProviderRegistryService();
  registerDefaultProviders(registry, stubConfig(env));
  return registry;
}

describe('MiniMax · chat provider 接入', () => {
  // ── §6-1 有 key 就注册, 且取的是 MINIMAX_API_KEY ──────────────────
  describe('§6-1 有 MINIMAX_API_KEY 时注册 minimax chat', () => {
    it('注册成功, 且 apiKey 取自 MINIMAX_API_KEY (不是 LLM_MINIMAX_API_KEY)', () => {
      // 两个键都给不同值 —— 若实现取错了键, 断言立刻红.
      const registry = register({
        MINIMAX_API_KEY: FAKE_MINIMAX_KEY,
        LLM_MINIMAX_API_KEY: FAKE_LLM_MINIMAX_KEY,
      });

      const resolved = registry.resolveChat(AIProviderId.MINIMAX);
      expect(resolved).not.toBeNull();
      expect(resolved?.config.apiKey).toBe(FAKE_MINIMAX_KEY);
      expect(resolved?.config.apiKey).not.toBe(FAKE_LLM_MINIMAX_KEY);
      expect(resolved?.config.enabled).toBe(true);
    });

    it('只注册 CHAT 能力 (MiniMax embedding 未核, 不占位)', () => {
      const registry = register({ MINIMAX_API_KEY: FAKE_MINIMAX_KEY });

      const resolved = registry.resolveChat(AIProviderId.MINIMAX);
      expect(resolved?.config.capabilities).toEqual([LLMCapability.CHAT]);
      expect(resolved?.config.capabilities).not.toContain(LLMCapability.EMBEDDING);
      expect(registry.resolveEmbedding(AIProviderId.MINIMAX)).toBeNull();
    });

    it('运行时 apiKey 解析也读 MINIMAX_API_KEY (护栏 6)', async () => {
      const resolve = defaultEnvApiKeyResolver(
        stubConfig({ MINIMAX_API_KEY: FAKE_MINIMAX_KEY, LLM_MINIMAX_API_KEY: FAKE_LLM_MINIMAX_KEY }),
      );

      await expect(resolve(AIProviderId.MINIMAX)).resolves.toBe(FAKE_MINIMAX_KEY);
      // 其它厂商仍走 LLM_<ID>_API_KEY 规律 (回归).
      await expect(resolve(AIProviderId.DEEPSEEK)).resolves.toBeNull();
    });

    it('apiKey env 键名映射: minimax 走历史命名, 其它厂商走规律', () => {
      expect(resolveProviderApiKeyEnvKey(AIProviderId.MINIMAX)).toBe('MINIMAX_API_KEY');
      expect(resolveProviderApiKeyEnvKey(AIProviderId.DEEPSEEK)).toBe('LLM_DEEPSEEK_API_KEY');
      expect(resolveProviderApiKeyEnvKey(AIProviderId.QWEN)).toBe('LLM_QWEN_API_KEY');
    });
  });

  // ── §6-2 无 key 不注册 ───────────────────────────────────────────
  describe('§6-2 无 MINIMAX_API_KEY 时不注册, 不抛错', () => {
    it('minimax 缺席, 且注册过程不抛错', () => {
      const registry = register({});

      expect(registry.resolveChat(AIProviderId.MINIMAX)).toBeNull();
      expect(registry.listIds()).not.toContain(AIProviderId.MINIMAX);
    });

    it('minimax 缺席不影响其它三家注册', () => {
      const registry = register({
        LLM_DEEPSEEK_API_KEY: FAKE_DEEPSEEK_KEY,
        LLM_DOUBAO_API_KEY: FAKE_DOUBAO_KEY,
        LLM_QWEN_API_KEY: FAKE_QWEN_KEY,
      });

      expect(registry.resolveChat(AIProviderId.DEEPSEEK)?.config.apiKey).toBe(FAKE_DEEPSEEK_KEY);
      expect(registry.resolveChat(AIProviderId.DOUBAO)?.config.apiKey).toBe(FAKE_DOUBAO_KEY);
      expect(registry.resolveChat(AIProviderId.QWEN)?.config.apiKey).toBe(FAKE_QWEN_KEY);
      expect(registry.resolveChat(AIProviderId.MINIMAX)).toBeNull();
    });
  });

  // ── §6-3 provider 属性与基址归一 ─────────────────────────────────
  describe('§6-3 provider id / 模型名 / 基址归一', () => {
    it('id = minimax, defaultChatModel 来自 MINIMAX_LLM_MODEL', () => {
      const registry = register({ MINIMAX_API_KEY: FAKE_MINIMAX_KEY, MINIMAX_LLM_MODEL: 'MiniMax-M3.1-Flash' });

      const resolved = registry.resolveChat(AIProviderId.MINIMAX);
      expect(resolved?.provider.id).toBe(AIProviderId.MINIMAX);
      expect(resolved?.provider.name).toBe('MiniMax');
      expect(resolved?.provider.defaultChatModel).toBe('MiniMax-M3.1-Flash');
      expect(resolved?.config.defaultChatModel).toBe('MiniMax-M3.1-Flash');
      expect(resolved?.config.defaultModels[LLMCapability.CHAT]).toBe('MiniMax-M3.1-Flash');
    });

    it('基址归一到 /v1 (env 不带 /v1 时补上)', () => {
      const registry = register({
        MINIMAX_API_KEY: FAKE_MINIMAX_KEY,
        MINIMAX_BASE_URL: 'https://api.minimax.cn',
      });

      expect(registry.resolveChat(AIProviderId.MINIMAX)?.config.baseUrl).toBe('https://api.minimax.cn/v1');
    });

    it('基址归一到 /v1 (env 已带 /v1 时不双写)', () => {
      const registry = register({
        MINIMAX_API_KEY: FAKE_MINIMAX_KEY,
        MINIMAX_BASE_URL: 'https://api.minimax.cn/v1',
      });

      expect(registry.resolveChat(AIProviderId.MINIMAX)?.config.baseUrl).toBe('https://api.minimax.cn/v1');
    });

    it('env 未配基址时用国内站默认 (并归一)', () => {
      const registry = register({ MINIMAX_API_KEY: FAKE_MINIMAX_KEY });

      expect(registry.resolveChat(AIProviderId.MINIMAX)?.config.baseUrl).toBe(`${DEFAULT_MINIMAX_BASE_URL}/v1`);
    });

    it('归一函数的边界 (空串 / 尾斜杠 / 完整端点 / 缺模型名)', () => {
      expect(resolveMinimaxBaseUrl(undefined)).toBe('https://api.minimax.cn/v1');
      expect(resolveMinimaxBaseUrl('   ')).toBe('https://api.minimax.cn/v1');
      expect(resolveMinimaxBaseUrl('https://api.minimax.cn/')).toBe('https://api.minimax.cn/v1');
      expect(resolveMinimaxBaseUrl('https://api.minimax.cn/v1/')).toBe('https://api.minimax.cn/v1');
      expect(resolveMinimaxBaseUrl('https://api.minimax.cn/v1/chat/completions')).toBe('https://api.minimax.cn/v1');
      expect(normalizeOpenAiCompatibleBaseUrl('https://x.example.com')).toBe('https://x.example.com/v1');

      expect(resolveMinimaxChatModel(undefined)).toBe(DEFAULT_MINIMAX_CHAT_MODEL);
      expect(resolveMinimaxChatModel('  ')).toBe(DEFAULT_MINIMAX_CHAT_MODEL);
      expect(resolveMinimaxChatModel('MiniMax-M3.1-Flash')).toBe('MiniMax-M3.1-Flash');
    });
  });

  // ── §6-4 既有三家回归 ────────────────────────────────────────────
  describe('§6-4 既有 deepseek / doubao / qwen 注册行为不受影响', () => {
    it('三家的 key / 基址 / 默认模型保持原样', () => {
      const registry = register({
        LLM_DEEPSEEK_API_KEY: FAKE_DEEPSEEK_KEY,
        LLM_DOUBAO_API_KEY: FAKE_DOUBAO_KEY,
        LLM_QWEN_API_KEY: FAKE_QWEN_KEY,
      });

      const deepseek = registry.resolveChat(AIProviderId.DEEPSEEK);
      expect(deepseek?.config.apiKey).toBe(FAKE_DEEPSEEK_KEY);
      expect(deepseek?.config.baseUrl).toBe('https://api.deepseek.com/v1');
      expect(deepseek?.config.defaultChatModel).toBe('deepseek-chat');
      expect(deepseek?.config.capabilities).toContain(LLMCapability.EMBEDDING);

      const doubao = registry.resolveChat(AIProviderId.DOUBAO);
      expect(doubao?.config.apiKey).toBe(FAKE_DOUBAO_KEY);
      expect(doubao?.config.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3');
      expect(doubao?.config.defaultChatModel).toBe('doubao-pro-32k');

      const qwen = registry.resolveChat(AIProviderId.QWEN);
      expect(qwen?.config.apiKey).toBe(FAKE_QWEN_KEY);
      expect(qwen?.config.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
      expect(qwen?.config.defaultChatModel).toBe('qwen-plus');
    });

    it('tier 映射表既有条目不受影响', () => {
      const registry = register({ LLM_DEEPSEEK_API_KEY: FAKE_DEEPSEEK_KEY });
      const router = new LlmRouterService(registry, stubConfig({}));

      expect(router.getDefaultModelForTier(LLMTier.RAG, AIProviderId.DEEPSEEK)).toBe('deepseek-chat');
      expect(router.getDefaultModelForTier(LLMTier.ADVANCED, AIProviderId.DEEPSEEK)).toBe('deepseek-reasoner');
      expect(router.getDefaultModelForTier(LLMTier.RAG, AIProviderId.QWEN)).toBe('qwen-plus');
    });
  });

  // ── §6-5 零真实网络 / 零真实 key ─────────────────────────────────
  describe('§6-5 零真实网络、零真实 key', () => {
    it('provider 源码不引入任何网络客户端 (继承 OpenAI 兼容基类, 由基类统一处理)', () => {
      const source = readFileSync(join(__dirname, '..', '..', 'src', 'llm', 'providers', 'minimax.provider.ts'), 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');

      for (const specifier of specifiers) {
        expect(specifier).not.toBe('axios');
        expect(specifier).not.toBe('node-fetch');
        expect(specifier).not.toBe('openai');
      }
      // 不允许自己发 fetch —— 协议由基类的 LangChain ChatOpenAI 统一处理.
      expect(source).not.toMatch(/\bfetch\s*\(/);
    });

    it('本套件不读真实 env 里的 key (只用测试专用假 key)', () => {
      const registry = register({ MINIMAX_API_KEY: FAKE_MINIMAX_KEY });

      const apiKey = registry.resolveChat(AIProviderId.MINIMAX)?.config.apiKey ?? '';
      expect(apiKey).toBe(FAKE_MINIMAX_KEY);
      // 若开发机 .env 里存在真实 key, 注册进来的必须是测试假 key ——
      // 证明本套件没有把真实凭证带进断言输出 (真 key 长度也远大于此).
      const realKey = process.env['MINIMAX_API_KEY'];
      if (realKey) {
        expect(apiKey).not.toBe(realKey);
        expect(apiKey.length).toBeLessThan(32);
      }
    });
  });

  // ── 护栏 7: tier 模型回落必须落在被请求的 provider 上 ────────────
  describe('护栏 7 · tier 模型回落落在被请求的 provider 上', () => {
    it('问 minimax 就回 minimax 的模型 (env 优先, 不是默认 provider 的模型)', () => {
      const env = {
        MINIMAX_API_KEY: FAKE_MINIMAX_KEY,
        MINIMAX_LLM_MODEL: 'MiniMax-M3.1-Flash',
        LLM_DEEPSEEK_API_KEY: FAKE_DEEPSEEK_KEY,
        LLM_DEFAULT_CHAT_PROVIDER: 'deepseek',
      };
      const registry = register(env);
      const router = new LlmRouterService(registry, stubConfig(env));

      const model = router.getDefaultModelForTier(LLMTier.RAG, AIProviderId.MINIMAX);

      expect(model).toBe('MiniMax-M3.1-Flash');
      expect(model).not.toBe('deepseek-chat');
    });

    it('provider 还没注册时也能拿到正确模型名 (启动期冻结配置的场景)', () => {
      // 这条护栏钉的是**启动顺序**陷阱: WP8 的渲染配置在 DI 实例化期就被冻结,
      // 而 provider 注册发生在 onModuleInit —— 那时注册表还是空的.
      // 若回落依赖注册表, 冻结进配置里的模型名会变成 "默认 provider 的模型"
      // (本机 = 'gpt-4o-mini'), 上游直接 400 → 整轮降级兜底.
      const emptyRegistry = new ProviderRegistryService();
      const router = new LlmRouterService(
        emptyRegistry,
        stubConfig({ MINIMAX_LLM_MODEL: 'MiniMax-M3.1-Flash', LLM_DEFAULT_CHAT_PROVIDER: 'deepseek' }),
      );

      expect(router.getDefaultModelForTier(LLMTier.RAG, AIProviderId.MINIMAX)).toBe('MiniMax-M3.1-Flash');
      expect(router.getDefaultModelForTier(LLMTier.RAG, AIProviderId.MINIMAX)).not.toBe('gpt-4o-mini');
    });

    it('被请求的 provider 既无 env 模型名也未注册时, 仍回落到默认 chat provider 的模型 (原行为不变)', () => {
      const env = { LLM_DEEPSEEK_API_KEY: FAKE_DEEPSEEK_KEY, LLM_DEFAULT_CHAT_PROVIDER: 'deepseek' };
      const registry = register(env);
      const router = new LlmRouterService(registry, stubConfig(env));

      expect(router.getDefaultModelForTier(LLMTier.RAG, AIProviderId.MOONSHOT)).toBe('deepseek-chat');
    });
  });

  // ── provider 自身是纯类 ──────────────────────────────────────────
  describe('provider 本身', () => {
    it('不传参数时用默认基址与默认模型', () => {
      const provider = new MinimaxChatProvider();

      expect(provider.id).toBe(AIProviderId.MINIMAX);
      expect(provider.name).toBe('MiniMax');
      expect(provider.baseUrl).toBe('https://api.minimax.cn/v1');
      expect(provider.defaultChatModel).toBe(DEFAULT_MINIMAX_CHAT_MODEL);
      expect(provider.capabilities).toEqual([LLMCapability.CHAT]);
    });

    it('构造参数可覆盖基址与模型', () => {
      const provider = new MinimaxChatProvider({
        baseUrl: 'https://custom.example.com',
        defaultChatModel: 'MiniMax-M3.1-Flash',
      });

      expect(provider.baseUrl).toBe('https://custom.example.com/v1');
      expect(provider.defaultChatModel).toBe('MiniMax-M3.1-Flash');
    });
  });

  // ── 护栏 9: LangChain 1.x 凭据字段 (存量缺陷回归护栏) ────────────
  describe('护栏 9 · 共享基类必须把 apiKey 交到 LangChain 1.x 认的字段上', () => {
    it('构造出的 ChatOpenAI 带着传入的 apiKey', () => {
      // 背景: `@langchain/openai` 1.x 的 BaseChatOpenAI 取凭据只认 `apiKey`
      // (旧字段名 `openAIApiKey` 在 chat 模型上被忽略) —— 只传旧的会让所有
      // OpenAI 兼容 provider 调用即报 "Missing credentials".
      // 本护栏钉住"凭据真的交到客户端上", 防止将来回退成旧字段名.
      const provider = new MinimaxChatProvider();
      const llm = (
        provider as unknown as {
          buildLLM(apiKey: string, request: ChatCompletionRequest): { apiKey?: string };
        }
      ).buildLLM('sk-test-only', { model: 'MiniMax-M3.1-Flash', messages: [] });

      expect(llm.apiKey).toBe('sk-test-only');
    });

    it('基址走 configuration.baseURL (LangChain 自己拼 /chat/completions)', () => {
      const provider = new MinimaxChatProvider({ baseUrl: 'https://api.minimax.cn' });
      const llm = (
        provider as unknown as {
          buildLLM(apiKey: string, request: ChatCompletionRequest): { clientConfig?: { baseURL?: string } };
        }
      ).buildLLM('sk-test-only', { model: 'MiniMax-M3.1-Flash', messages: [] });

      expect(llm.clientConfig?.baseURL).toBe('https://api.minimax.cn/v1');
    });
  });
});
