import { vi } from 'vitest';
// V2026-10-28 治本 (WP8-A · B 层 · 引擎装配层单测):
//   覆盖任务单 §8 单测清单 1-9:
//     1. 调用出口透传 → RouterChatCaller 把 req / providerId 原样交给 router.chat, 响应原样返回
//     2. 渲染端口装配 → buildMessages 是 WP7 的 buildVisitorMessages; guard 是 WP4 口径的产物
//     3. 归属登记     → open 后登记表含 handleId → {tenantId, sessionId, visitorId}; turn 时能取到
//     4. 归属查不到   → resolveSession 返回 undefined → 跳过来访半边记忆写入, 不抛错、不断流
//     5. close 清理   → forgetSession + closeSession + 删归属; 未知句柄 close 不抛
//     6. 内核错误冒泡 → SESSION_NOT_FOUND 原样抛出, 不被降级吞掉
//     7. 渲染降级     → 渲染异常 / 空文本 → 兜底句 + fallbackUsed, 不 reject
//     8. 配置工厂     → env 缺省全部回种子; 覆盖项生效; 候选顺序 = 优先级
//     9. 零真实依赖   → 装配层不直连向量库 / 厂商 SDK; 单测不触网、不连向量库
//   另附 (本期装配链自证):
//     A. 装配工厂分流 → 记忆仓储按向量库地址分流; 装配非法必须炸
//     B. 调试端点     → 内核错误码 → HTTP 状态映射; 角色内核脏 payload 被净化
//     C. 端口 token   → 三个 token 互不相同 (防止静默撞车注入错依赖)
//
//   全 mock, 不起 NestJS 容器, 不发网络, 不连向量库:
//     调用出口用 stub; 记忆仓储用内存版; 配置用假 ConfigService; router 用假 LlmRouterService.
//
//   关于"为什么不直接测 @Module 的 useFactory" (断言口径):
//     useFactory 只有在 Nest 容器起来后才有意义, 而起容器意味着把 AIEngineModule
//     (TypeORM entities + UserModule + LangChain RagService) 一起拉进来 —— 于是
//     "装配对不对"这件事永远测不到, 只能等启动时炸. 所以本期把**构造逻辑**抽到
//     engine.providers.ts 的纯工厂里 (可单测), @Module 只保留 token ↔ 工厂的映射.
//     本文件测的就是那些纯工厂 + 门面 + 控制器, 断言打在**行为**而不是容器上.
//
//   验证: npx jest test/engine-adapters/wp8-wiring.spec.ts
//   时间戳: 2026-10-28 GMT+8

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { HttpException } from '@nestjs/common';

import {
  EngineCoreError,
  EngineErrorCode,
  MemorySource,
  MemoryTier,
  createEmptyBdiSnapshot,
  type EngineSessionHandle,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type Intention,
  type MemoryEntry,
  type MemoryHit,
  type MemoryRecallQuery,
  type MemoryStore,
  type OpenEngineSessionInput,
  type RenderPort,
  type RenderResult,
  type RenderSpec,
} from '../../src/engine-core';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';
import { AIProviderId, LLMTier } from '../../src/llm/common/enums/llm.enums';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../src/llm/common/interfaces/chat-provider.interface';
import type { LlmRouterService } from '../../src/llm/registry/llm-router.service';
import { LlmRenderAdapter, createVisitorOutputGuard, type ChatCaller } from '../../src/engine-adapters/rendering/llm-render.adapter';
import {
  DEFAULT_RENDER_COOLDOWN_BASE_MS,
  DEFAULT_RENDER_COOLDOWN_MAX_MS,
  DEFAULT_RENDER_FAILURE_THRESHOLD,
  DEFAULT_RENDER_TIMEOUT_MS,
  type RenderAdapterConfig,
} from '../../src/engine-adapters/rendering/render-adapter.config';
import { buildVisitorMessages, type TurnSessionContext } from '../../src/engine-adapters/rendering/turn-render-orchestrator';
import { createEngineMemoryStore, createEngineOrchestrator, createEngineSessionPort } from '../../src/engine-adapters/wiring/engine.providers';
import { EngineSessionRegistry, EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service';
import { ENGINE_MEMORY_STORE, ENGINE_RENDER_PORT, ENGINE_SESSION_PORT } from '../../src/engine-adapters/wiring/engine.tokens';
import {
  EngineWiringController,
  type EngineCloseDto,
  type EngineOpenDto,
  type EngineTurnDto,
} from '../../src/engine-adapters/wiring/engine-wiring.controller';
import { RenderConfigFactory, buildEngineRenderDeps, buildEngineRenderPort } from '../../src/engine-adapters/wiring/render-config.factory';
import { RouterChatCaller } from '../../src/engine-adapters/wiring/router-chat-caller';

const HANDLE_ID = 'handle-1';
const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const SESSION = 'session-1';
const USER_TEXT = '你最近睡得怎么样？';
const REPLY = '有点累，夜里老醒。';

/** 会话归属 (期望值). */
const CONTEXT: TurnSessionContext = { tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION };

// ────────────────────────────────────────────────────────────────────
// 测试替身
// ────────────────────────────────────────────────────────────────────

/** 构造一个意图. */
function buildIntention(): Intention {
  return {
    strategy: 'recounting',
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    forbiddenBehaviors: ['judge'],
  };
}

/** 构造内核一轮出参. */
function buildOutput(overrides: Partial<EngineTurnOutput> = {}): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    intention: buildIntention(),
    ...overrides,
  };
}

/** 会话端口 stub: 记录调用, 可固定出参 / 固定抛错 / open 抛错. */
class StubSession implements EngineSessionPort {
  readonly openCalls: OpenEngineSessionInput[] = [];
  readonly turnCalls: { handleId: string; input: EngineTurnInput }[] = [];
  readonly closedHandles: string[] = [];
  /** open 时抛出的错误 (不设 = 正常开会话). */
  openError?: Error;

  constructor(private readonly behavior: { output: EngineTurnOutput } | { error: Error }) {}

  openSession(input: OpenEngineSessionInput): EngineSessionHandle {
    this.openCalls.push(input);
    if (this.openError) throw this.openError;
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  async turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput> {
    this.turnCalls.push({ handleId, input });
    if ('error' in this.behavior) throw this.behavior.error;
    return this.behavior.output;
  }

  closeSession(handleId: string): void {
    this.closedHandles.push(handleId);
  }
}

/** 渲染端口 stub: 固定返回文本或固定抛错. */
class StubRenderer implements RenderPort {
  readonly specs: RenderSpec[] = [];

  constructor(private readonly behavior: { text: string; fallbackUsed?: boolean; providerHint?: string } | { error: Error }) {}

  async render(spec: RenderSpec): Promise<RenderResult> {
    this.specs.push(spec);
    if ('error' in this.behavior) throw this.behavior.error;
    return {
      text: this.behavior.text,
      taskKind: spec.taskKind,
      usage: { completionTokens: 20, totalTokens: 40 },
      fallbackUsed: this.behavior.fallbackUsed ?? false,
      ...(this.behavior.providerHint ? { providerHint: this.behavior.providerHint } : {}),
    };
  }
}

/** 记忆仓储 stub: 记录写入. */
class StubMemoryStore implements MemoryStore {
  readonly remembered: MemoryEntry[] = [];

  async remember(entry: MemoryEntry): Promise<void> {
    this.remembered.push(entry);
  }

  async recall(_query: MemoryRecallQuery): Promise<readonly MemoryHit[]> {
    return [];
  }
}

/** 固定响应. */
const RESPONSE: ChatCompletionResponse = {
  content: '来访者的一句话',
  usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
  model: 'deepseek-chat',
  finishReason: 'stop',
};

/** 假 ConfigService: 只认给定的键值表. */
function stubConfig(env: Readonly<Record<string, string>>): { get: (key: string) => string | undefined } {
  return { get: (key: string) => env[key] };
}

/** 假 router: 记录 chat 调用, 返回固定响应; 模型名映射走自己的表. */
class StubRouter {
  readonly chatCalls: { req: ChatCompletionRequest; opts: { providerId?: AIProviderId; uid?: string } }[] = [];
  readonly tierCalls: { tier: LLMTier; providerId?: AIProviderId }[] = [];

  constructor(
    private readonly response: ChatCompletionResponse,
    private readonly modelForProvider: Readonly<Record<string, string>> = { deepseek: 'deepseek-chat' },
  ) {}

  async chat(
    req: ChatCompletionRequest,
    opts: { providerId?: AIProviderId; uid?: string } = {},
  ): Promise<ChatCompletionResponse> {
    this.chatCalls.push({ req, opts });
    return this.response;
  }

  getDefaultModelForTier(tier: LLMTier, providerId?: AIProviderId): string {
    this.tierCalls.push({ tier, providerId });
    const id = providerId ?? AIProviderId.DEEPSEEK;
    return this.modelForProvider[id] ?? `${id}-default`;
  }
}

/** 假调用出口 (不发网络). */
class StubCaller implements ChatCaller {
  readonly calls: { req: ChatCompletionRequest; providerId?: string }[] = [];

  async chat(req: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse> {
    this.calls.push({ req, providerId });
    return RESPONSE;
  }
}

/** 构造门面服务 (真实 registry + 真实 orchestrator, 只替换端口). */
function buildService(options: {
  readonly session?: StubSession;
  readonly renderer?: StubRenderer;
  readonly memories?: StubMemoryStore;
}): {
  readonly service: EngineTurnService;
  readonly registry: EngineSessionRegistry;
  readonly orchestrator: ReturnType<typeof createEngineOrchestrator>;
  readonly session: StubSession;
  readonly renderer: StubRenderer;
  readonly memories: StubMemoryStore;
} {
  const session = options.session ?? new StubSession({ output: buildOutput() });
  const renderer = options.renderer ?? new StubRenderer({ text: REPLY });
  const memories = options.memories ?? new StubMemoryStore();
  const registry = new EngineSessionRegistry();
  const orchestrator = createEngineOrchestrator({ session, renderer, memories, registry });
  const service = new EngineTurnService(session, orchestrator, registry);
  return { service, registry, orchestrator, session, renderer, memories };
}

/** 最小渲染配置 (只给一个候选). */
function stubRenderConfig(): RenderAdapterConfig {
  return {
    candidates: [{ id: AIProviderId.DEEPSEEK }],
    taskDefaults: {
      chat: { temperature: 0.85 },
      stable: { temperature: 0.2 },
      advanced: { temperature: 0.85 },
    },
    timeoutMs: DEFAULT_RENDER_TIMEOUT_MS,
    failureThreshold: DEFAULT_RENDER_FAILURE_THRESHOLD,
    cooldownBaseMs: DEFAULT_RENDER_COOLDOWN_BASE_MS,
    cooldownMaxMs: DEFAULT_RENDER_COOLDOWN_MAX_MS,
    maxBlockRegen: 1,
    fallbackUtterances: ['……我先缓一下，我们接着说。'],
  };
}

describe('WP8-A · 引擎装配层 (DI + 聚合接线)', () => {
  // ── §8-1 调用出口透传 ────────────────────────────────────────────
  describe('§8-1 RouterChatCaller 透传给 router.chat', () => {
    it('req 与 providerId 原样透传, 响应原样返回', async () => {
      const router = new StubRouter(RESPONSE);
      const caller = new RouterChatCaller(router as unknown as LlmRouterService);
      const req: ChatCompletionRequest = { model: 'deepseek-chat', messages: [{ role: 'user', content: '你好' }] };

      const response = await caller.chat(req, AIProviderId.DEEPSEEK);

      expect(router.chatCalls).toHaveLength(1);
      expect(router.chatCalls[0]?.req).toBe(req);
      expect(router.chatCalls[0]?.opts).toEqual({ providerId: AIProviderId.DEEPSEEK });
      expect(response).toBe(RESPONSE);
    });

    it('未指定 providerId 时不塞 providerId (由 router 走自己的默认)', async () => {
      const router = new StubRouter(RESPONSE);
      const caller = new RouterChatCaller(router as unknown as LlmRouterService);

      await caller.chat({ model: 'deepseek-chat', messages: [] });

      expect(router.chatCalls[0]?.opts).toEqual({});
    });
  });

  // ── §8-2 渲染端口装配 ────────────────────────────────────────────
  describe('§8-2 渲染端口装配 (prompt 缝 + 输出 guard)', () => {
    it('buildMessages 就是 WP7 的 buildVisitorMessages', () => {
      const deps = buildEngineRenderDeps(new StubCaller(), stubRenderConfig());
      expect(deps.buildMessages).toBe(buildVisitorMessages);
    });

    it('guard 是 WP4 口径的产物 (与 createVisitorOutputGuard 行为一致)', async () => {
      const deps = buildEngineRenderDeps(new StubCaller(), stubRenderConfig());
      const guard = deps.guard;
      if (!guard) throw new Error('guard 未装配');

      // 行为等价: 对同一条高危文本, 装配出的 guard 与 WP6 导出的工厂判定完全一致.
      const text = '我要去死';
      expect(await guard(text)).toEqual(await createVisitorOutputGuard()(text));
      expect((await guard(text)).level).toBe('block');
      // 正常文本不应被拦.
      expect((await guard(REPLY)).level).toBe('pass');
    });

    it('buildEngineRenderPort 产出 WP6 适配器 (实现内核 RenderPort)', () => {
      const port = buildEngineRenderPort(new StubCaller(), stubRenderConfig());
      expect(port).toBeInstanceOf(LlmRenderAdapter);
    });
  });

  // ── §8-3 归属登记 ────────────────────────────────────────────────
  describe('§8-3 open 登记归属, turn 时能取到', () => {
    it('open 后登记表含 handleId → {tenantId, sessionId, visitorId}', () => {
      const { service, registry } = buildService({});

      const opened = service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR });

      expect(opened).toEqual({ handleId: HANDLE_ID, sessionId: SESSION });
      expect(registry.resolve(HANDLE_ID)).toEqual(CONTEXT);
      expect(registry.size()).toBe(1);
    });

    it('turn 时 resolveSession 能取到归属 → 来访半边记忆按该归属写入', async () => {
      const { service, registry, memories } = buildService({});
      service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR });

      await service.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(memories.remembered).toHaveLength(1);
      expect(memories.remembered[0]).toMatchObject({
        tenantId: TENANT,
        visitorId: VISITOR,
        sessionId: SESSION,
        tier: MemoryTier.WORKING,
        source: MemorySource.TURN,
        content: REPLY,
      });
      expect(registry.resolve(HANDLE_ID)).toEqual(CONTEXT);
    });

    it('open 不静默复用旧句柄: 内核 SESSION_ALREADY_OPEN 原样冒泡, 且不登记归属', () => {
      const error = new EngineCoreError(EngineErrorCode.SESSION_ALREADY_OPEN, '会话已存在');
      const session = new StubSession({ output: buildOutput() });
      session.openError = error;
      const { service, registry } = buildService({ session });

      expect(() => service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR })).toThrow(error);
      expect(registry.size()).toBe(0);
    });
  });

  // ── §8-4 归属查不到 ──────────────────────────────────────────────
  describe('§8-4 未登记归属: 跳过来访半边记忆写入, 不抛错', () => {
    it('resolveSession 返回 undefined 时不写记忆, 本轮照常返回 reply', async () => {
      const { service, memories } = buildService({});

      // 未 open → 登记表里没有该句柄.
      const result = await service.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(result.reply).toBe(REPLY);
      expect(result.render.fallbackUsed).toBe(false);
      expect(memories.remembered).toHaveLength(0);
    });
  });

  // ── §8-5 close 清理 ─────────────────────────────────────────────
  describe('§8-5 close 清理 (历史 + 内核句柄 + 归属)', () => {
    it('close 后 forgetSession / closeSession 被调, 归属条目被删', () => {
      const { service, registry, orchestrator, session } = buildService({});
      service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR });
      const forgetSpy = vi.spyOn(orchestrator, 'forgetSession');

      service.close(HANDLE_ID);

      expect(forgetSpy).toHaveBeenCalledWith(HANDLE_ID);
      expect(session.closedHandles).toContain(HANDLE_ID);
      expect(registry.resolve(HANDLE_ID)).toBeUndefined();
      expect(registry.size()).toBe(0);
    });

    it('未知句柄 close 不抛错 (内核 close 幂等)', () => {
      const memories = new InMemoryMemoryStore();
      const session = createEngineSessionPort(memories);
      const registry = new EngineSessionRegistry();
      const scoped = new EngineTurnService(
        session,
        createEngineOrchestrator({ session, renderer: new StubRenderer({ text: REPLY }), memories, registry }),
        registry,
      );

      expect(() => scoped.close('never-opened-handle')).not.toThrow();
      expect(registry.size()).toBe(0);
    });

    it('内核 close 抛错时归属仍被清掉 (finally 保证不残留)', () => {
      const { service, registry, session } = buildService({});
      service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR });
      vi.spyOn(session, 'closeSession').mockImplementation(() => {
        throw new Error('内核关闭失败');
      });

      expect(() => service.close(HANDLE_ID)).toThrow('内核关闭失败');
      expect(registry.resolve(HANDLE_ID)).toBeUndefined();
    });
  });

  // ── §8-6 内核错误冒泡 ────────────────────────────────────────────
  describe('§8-6 内核错误原样冒泡 (不被降级吞掉)', () => {
    it('SESSION_NOT_FOUND 原样抛出', async () => {
      const error = new EngineCoreError(EngineErrorCode.SESSION_NOT_FOUND, '会话不存在');
      const { service } = buildService({ session: new StubSession({ error }) });

      await expect(service.turn(HANDLE_ID, { userText: USER_TEXT })).rejects.toBe(error);
    });

    it('INVALID_INPUT (空白 userText) 原样抛出', async () => {
      const error = new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'userText 不能为空');
      const { service } = buildService({ session: new StubSession({ error }) });

      await expect(service.turn(HANDLE_ID, { userText: '   ' })).rejects.toBe(error);
    });
  });

  // ── §8-7 渲染降级 ────────────────────────────────────────────────
  describe('§8-7 渲染层异常 / 空文本 → 兜底句, 不 reject', () => {
    it('渲染抛异常: 返回非空兜底句 + fallbackUsed=true', async () => {
      const { service } = buildService({ renderer: new StubRenderer({ error: new Error('厂商 500') }) });

      const result = await service.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(result.reply).not.toHaveLength(0);
      expect(result.render.fallbackUsed).toBe(true);
      expect(result.render.providerHint).toBe('degraded');
    });

    it('渲染返回空文本: 同样降级为兜底句', async () => {
      const { service } = buildService({ renderer: new StubRenderer({ text: '   ' }) });

      const result = await service.turn(HANDLE_ID, { userText: USER_TEXT });

      expect(result.reply).not.toHaveLength(0);
      expect(result.render.fallbackUsed).toBe(true);
    });
  });

  // ── §8-8 配置工厂 ────────────────────────────────────────────────
  describe('§8-8 配置工厂 (env → RenderAdapterConfig)', () => {
    it('env 全缺省时全部回 WP6 种子', () => {
      const router = new StubRouter(RESPONSE);
      const factory = new RenderConfigFactory(
        stubConfig({}) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
        router as unknown as LlmRouterService,
      );

      const config = factory.build();

      expect(config.candidates).toHaveLength(1);
      expect(config.candidates[0]?.id).toBe(AIProviderId.DEEPSEEK);
      expect(config.taskDefaults.chat.temperature).toBe(0.85);
      expect(config.taskDefaults.stable.temperature).toBe(0.2);
      expect(config.taskDefaults.advanced.temperature).toBe(0.85);
      expect(config.timeoutMs).toBe(DEFAULT_RENDER_TIMEOUT_MS);
      expect(config.failureThreshold).toBe(DEFAULT_RENDER_FAILURE_THRESHOLD);
      expect(config.cooldownBaseMs).toBe(DEFAULT_RENDER_COOLDOWN_BASE_MS);
      expect(config.cooldownMaxMs).toBe(DEFAULT_RENDER_COOLDOWN_MAX_MS);
      expect(config.fallbackUtterances.length).toBeGreaterThan(0);
    });

    it('ENGINE_RENDER_CHAT_TEMPERATURE 覆盖到 config', () => {
      const router = new StubRouter(RESPONSE);
      const factory = new RenderConfigFactory(
        stubConfig({ ENGINE_RENDER_CHAT_TEMPERATURE: '0.42' }) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
        router as unknown as LlmRouterService,
      );

      const config = factory.build();

      expect(config.taskDefaults.chat.temperature).toBe(0.42);
      // 其余分层不受影响 (别把 chat 的温度漏到 stable 上).
      expect(config.taskDefaults.stable.temperature).toBe(0.2);
    });

    it('主候选 + 备候选按顺序组成候选序列 (顺序即优先级, 去重)', () => {
      const router = new StubRouter(RESPONSE, { deepseek: 'deepseek-chat', qwen: 'qwen-plus', doubao: 'doubao-pro' });
      const factory = new RenderConfigFactory(
        stubConfig({
          ENGINE_RENDER_PRIMARY_PROVIDER: 'qwen',
          ENGINE_RENDER_FALLBACK_PROVIDERS: 'deepseek, doubao ,qwen',
        }) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
        router as unknown as LlmRouterService,
      );

      const config = factory.build();

      expect(config.candidates.map((candidate) => candidate.id)).toEqual(['qwen', 'deepseek', 'doubao']);
    });

    it('模型名缺省向 router 问 (装配层不硬编码模型名表)', () => {
      const router = new StubRouter(RESPONSE, { deepseek: 'deepseek-chat' });
      const factory = new RenderConfigFactory(
        stubConfig({}) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
        router as unknown as LlmRouterService,
      );

      const config = factory.build();

      expect(config.candidates[0]?.overrides?.chat?.model).toBe('deepseek-chat');
      expect(router.tierCalls.length).toBeGreaterThan(0);
      expect(router.tierCalls[0]?.tier).toBe(LLMTier.RAG);
    });

    it('显式配置的模型名优先于 router 默认', () => {
      const router = new StubRouter(RESPONSE, { deepseek: 'deepseek-chat' });
      const factory = new RenderConfigFactory(
        stubConfig({ ENGINE_RENDER_CHAT_MODEL: 'deepseek-reasoner' }) as unknown as ConstructorParameters<
          typeof RenderConfigFactory
        >[0],
        router as unknown as LlmRouterService,
      );

      const config = factory.build();

      expect(config.candidates[0]?.overrides?.chat?.model).toBe('deepseek-reasoner');
    });

    it('非法数值回落种子 (不把 NaN 带进退避计算)', () => {
      const router = new StubRouter(RESPONSE);
      const factory = new RenderConfigFactory(
        stubConfig({
          ENGINE_RENDER_TIMEOUT_MS: 'abc',
          ENGINE_RENDER_FAILURE_THRESHOLD: '-1',
        }) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
        router as unknown as LlmRouterService,
      );

      const config = factory.build();

      expect(config.timeoutMs).toBe(DEFAULT_RENDER_TIMEOUT_MS);
      expect(config.failureThreshold).toBe(DEFAULT_RENDER_FAILURE_THRESHOLD);
    });
  });

  // ── §8-9 零真实依赖 ──────────────────────────────────────────────
  describe('§8-9 不出现真实向量库 / 真实 LLM 连接依赖', () => {
    it('装配层不依赖向量库 SDK / 厂商 SDK / ORM (按包名判定, 相对路径不算)', () => {
      const dir = join(__dirname, '..', '..', 'src', 'engine-adapters', 'wiring');
      const forbiddenPackages = ['@qdrant/js-client-rest', '@nestjs/typeorm', 'typeorm', 'axios', 'node-fetch', 'openai'];
      const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));

      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const source = readFileSync(join(dir, file), 'utf8');
        const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
        for (const specifier of specifiers) {
          // 相对路径是仓库内模块 (复用既有实现), 不算第三方依赖.
          if (specifier.startsWith('.')) continue;
          const pkg = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : (specifier.split('/')[0] ?? '');
          expect(forbiddenPackages).not.toContain(pkg);
        }
      }
    });

    it('未配置向量库时记忆仓储是纯内存实现 (不建任何客户端)', () => {
      const store = createEngineMemoryStore({});
      expect(store).toBeInstanceOf(InMemoryMemoryStore);
    });
  });

  // ── 附加 A: 装配工厂 ─────────────────────────────────────────────
  describe('附加 A · 装配工厂分流', () => {
    it('配了向量库 → Qdrant 版 (内置内存回落仓)', () => {
      // V2026-10-30 (WP12): 窄面扩到 4 个方法 (加 setPayload / scroll) —— 桩必须跟上,
      //   否则"配了向量库"这一条会在**类型**上就挂掉 (而不是测装配逻辑).
      const qdrant = {
        upsert: async () => undefined,
        search: async () => [],
        setPayload: async () => undefined,
        scroll: async () => [],
      };
      const embedder = { embed: async () => [] };

      const store = createEngineMemoryStore({ qdrantUrl: 'http://qdrant:6333', qdrant, embedder });

      expect(store).not.toBeInstanceOf(InMemoryMemoryStore);
    });

    it('配了向量库却缺客户端 → 装配期直接炸 (不静默回落成纯内存)', () => {
      expect(() => createEngineMemoryStore({ qdrantUrl: 'http://qdrant:6333' })).toThrow(/装配非法/);
    });

    it('会话端口是内核实现, open/turn/close 走通且 close 幂等', async () => {
      const memories = new InMemoryMemoryStore();
      const session = createEngineSessionPort(memories);

      const handle = session.openSession({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR });
      expect(handle.handleId).not.toHaveLength(0);

      const output = await session.turn(handle.handleId, { userText: USER_TEXT });
      expect(output.turnIndex).toBe(1);
      expect(output.reply).toBe('');

      expect(() => session.closeSession(handle.handleId)).not.toThrow();
      expect(() => session.closeSession(handle.handleId)).not.toThrow();
    });
  });

  // ── 附加 B: 调试端点 ─────────────────────────────────────────────
  describe('附加 B · 调试端点 (错误映射 + 角色内核净化)', () => {
    /** 造一个只按脚本抛错的门面替身. */
    function stubService(openError?: Error): { open: vi.Mock; turn: vi.Mock; close: vi.Mock } {
      return {
        open: vi.fn(() => {
          if (openError) throw openError;
          return { handleId: HANDLE_ID, sessionId: SESSION };
        }),
        turn: vi.fn(),
        close: vi.fn(),
      };
    }

    it('内核错误码 → 对应 HTTP 状态 (不吞错)', () => {
      const cases: { code: EngineErrorCode; status: number }[] = [
        { code: EngineErrorCode.INVALID_INPUT, status: 400 },
        { code: EngineErrorCode.UNSUPPORTED, status: 400 },
        { code: EngineErrorCode.SESSION_NOT_FOUND, status: 404 },
        { code: EngineErrorCode.SESSION_ALREADY_OPEN, status: 409 },
        { code: EngineErrorCode.STATE_CONFLICT, status: 409 },
        { code: EngineErrorCode.ABORTED, status: 409 },
      ];

      const errors: unknown[] = [];
      for (const item of cases) {
        const service = stubService(new EngineCoreError(item.code, '内核错误'));
        const controller = new EngineWiringController(service as unknown as EngineTurnService);
        try {
          controller.open(TENANT, { sessionId: SESSION, visitorId: VISITOR } as EngineOpenDto);
          errors.push(null);
        } catch (error) {
          errors.push(error);
        }
      }

      expect(errors).toHaveLength(cases.length);
      errors.forEach((error, index) => {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(cases[index]?.status);
      });
    });

    it('非内核异常原样上抛 (交给全局异常过滤器兜底)', () => {
      const service = stubService(new Error('未知异常'));
      const controller = new EngineWiringController(service as unknown as EngineTurnService);

      expect(() => controller.open(TENANT, { sessionId: SESSION, visitorId: VISITOR } as EngineOpenDto)).toThrow('未知异常');
    });

    it('角色内核形状非法 → 整体丢弃回中性基线 (不让整场会话 500)', () => {
      const service = stubService();
      const controller = new EngineWiringController(service as unknown as EngineTurnService);

      controller.open(TENANT, {
        sessionId: SESSION,
        visitorId: VISITOR,
        characterProfile: { coreBeliefs: '这不是数组', forbiddenBehaviors: [], sensitiveTopics: [] },
      } as EngineOpenDto);

      const passed = service.open.mock.calls[0]?.[0] as { characterProfile?: unknown };
      expect(passed.characterProfile).toBeUndefined();
    });

    it('角色内核形状合法 → 透传给内核', () => {
      const service = stubService();
      const controller = new EngineWiringController(service as unknown as EngineTurnService);

      controller.open(TENANT, {
        sessionId: SESSION,
        visitorId: VISITOR,
        characterProfile: {
          coreBeliefs: [{ theme: '自我评价', statement: '我不够好', activationTags: ['被否定'] }],
          forbiddenBehaviors: ['评判咨询师'],
          sensitiveTopics: ['创伤'],
          attachmentStyle: 'anxious',
        },
      } as EngineOpenDto);

      const passed = service.open.mock.calls[0]?.[0] as { characterProfile?: { coreBeliefs: unknown[] } };
      expect(passed.characterProfile?.coreBeliefs).toHaveLength(1);
    });

    it('close 端点固定返回 ok', () => {
      const service = stubService();
      const controller = new EngineWiringController(service as unknown as EngineTurnService);

      expect(controller.close({ handleId: HANDLE_ID } as EngineCloseDto)).toEqual({ ok: true });
      expect(service.close).toHaveBeenCalledWith(HANDLE_ID);
    });

    it('turn 端点透传 handleId / userText / traceId', async () => {
      const service = stubService();
      const controller = new EngineWiringController(service as unknown as EngineTurnService);

      await controller.turn({ handleId: HANDLE_ID, userText: USER_TEXT, traceId: 'trace-1' } as EngineTurnDto);

      expect(service.turn).toHaveBeenCalledWith(HANDLE_ID, { userText: USER_TEXT, traceId: 'trace-1' });
    });
  });

  // ── 附加 C: 端口 token ───────────────────────────────────────────
  describe('附加 C · 端口 token 互不相同', () => {
    it('三个 token 是不同的 symbol (防止静默撞车注入错依赖)', () => {
      const tokens = [ENGINE_SESSION_PORT, ENGINE_MEMORY_STORE, ENGINE_RENDER_PORT];
      for (const token of tokens) expect(typeof token).toBe('symbol');
      expect(new Set(tokens).size).toBe(3);
    });
  });
});

