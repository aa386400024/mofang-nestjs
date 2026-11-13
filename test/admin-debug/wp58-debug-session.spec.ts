// V2026-11-05 治本 (WP58 · 引擎调试面板 · 单测):
//   覆盖任务单 §8 的 16 条用例:
//     ① 创建调试会话 (3 例) —— 合法 slug / 角色不存在 / 角色代号必填
//     ② 发一轮对话 (5 例) —— 完整 trace / BDI 三维 / delta / 审议 trace / 会话不存在
//     ③ 关闭调试会话 (2 例) —— 正常关闭 + 内存清干净 / 不存在 → 404
//     ④ 开关与鉴权 (3 例) —— 开关关 → 403 / 非 admin → 403 / admin → 放行
//     ⑤ 边界 (3 例) —— 不落库 / engine-core 零依赖 / 心理内容不进日志
//   额外覆盖 (WP58 特有, 防漂移):
//     · prompt 全文通道 —— 门面**按需**带出 (`includePromptFull`), 默认不带;
//     · 模块装配 —— 无循环依赖 + 中间件挂载 + class 级守卫;
//     · 契约字段 —— `sessionId` / `debugSessionId` 同值; 入参 `counselorText` / `userText` 同义.
//
//   边界: 全 mock, 不起 Nest 容器, 不连 DB, 不发网络 ——
//     引擎门面 / 角色解析端口 / Redis / 配置服务全是极小替身.
//
//   验证: npx vitest run test/admin-debug/wp58-debug-session.spec.ts

import { Logger, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminBasicAuthMiddleware } from '../../src/admin-debug/admin-basic-auth.middleware.js';
import { AdminDebugChatModule } from '../../src/admin-debug/admin-debug-chat.module.js';
import type { DebugSessionMessage, DebugSessionRecord, DebugSessionSummary } from '../../src/admin-debug/debug-session-store.js';
import { DebugSessionController } from '../../src/admin-debug/debug-session.controller.js';
import {
  DEBUG_CHAT_TENANT_ID,
  DebugSessionService,
  resolveDebugChatDeliberationWaitMs,
  resolveDebugChatEnabled,
} from '../../src/admin-debug/debug-session.service.js';
import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import {
  buildDeliberationTraceKey,
  type DeliberationTraceRecord,
} from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { buildPromptFull } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import type { StreamingRenderPort } from '../../src/engine-adapters/rendering/streaming-render.port.js';
import { TurnRenderOrchestrator, type TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { CharacterPoolModule } from '../../src/engine-adapters/wiring/character/character-pool.module.js';
import type { ResolvedCharacter } from '../../src/engine-adapters/wiring/character/character-profile.resolver.js';
import { EngineWiringModule } from '../../src/engine-adapters/wiring/engine.module.js';
import {
  createEmptyBdiSnapshot,
  type BdiSnapshot,
  type CharacterProfile,
  type EngineSessionPort,
  type MemoryStore,
} from '../../src/engine-core/index.js';
import { UserModule } from '../../src/user/index.js';

/** 已知角色代号 (解析器只认它). */
const KNOWN_SLUG = 'vpt_intimate_avoidance_l1';

/** 咨询师这一轮说的话 (隐私断言里要盯住它不能进日志). */
const COUNSELOR_TEXT = '我今天感觉不太好';

/** 来访者的回应 (同样不能进日志). */
const VISITOR_REPLY = '（叹了口气）嗯……怎么了？';

/**
 * 假配置服务 (只回 env 字典).
 */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

/**
 * 剥掉源码里的注释 (只留可执行代码).
 *
 * 为什么需要: 边界断言要区分"注释里提到了某个表名"与"代码真的碰了那个表" ——
 * 前者是边界说明, 后者是落库行为.
 *
 * ⚠️ 手写扫描而不是正则: 正则剥注释 (`/\\*[\s\S]*?\\*\\//`) 在长文本上会**回溯**
 * (sonarjs/super-linear-regex 红线), 源码越长越明显.
 */
function stripComments(source: string): string {
  let result = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      result += ' ';
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end;
      result += ' ';
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

/**
 * 造一份可控的 BDI 快照.
 */
function makeSnapshot(
  overrides: {
    readonly trust?: number;
    readonly safety?: number;
    readonly bond?: number;
    readonly valence?: number;
    readonly arousal?: number;
    readonly verbal?: number;
    readonly depth?: number;
    readonly style?: number;
  } = {},
): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    trust: overrides.trust ?? 0.5,
    safety: overrides.safety ?? 0.4,
    bond: overrides.bond ?? 0.1,
    emotion: {
      ...base.emotion,
      valence: overrides.valence ?? 0.5,
      arousal: overrides.arousal ?? 0.5,
      label: 'neutral',
    },
    resistance: {
      verbal: overrides.verbal ?? 0.3,
      depth: overrides.depth ?? 0.3,
      style: overrides.style ?? 0.3,
    },
  };
}

/**
 * 造一份门面结算结果.
 */
function makeTurnResult(snapshot: BdiSnapshot, turnIndex: number): TurnRenderResult {
  return {
    reply: VISITOR_REPLY,
    snapshot,
    turnIndex,
    intention: {
      strategy: 'simple_response',
      emotion: snapshot.emotion,
      resistance: snapshot.resistance,
      transference: snapshot.transference,
      forbiddenBehaviors: [],
    },
    render: {
      fallbackUsed: false,
      providerHint: 'minimax',
      usage: { completionTokens: 120, totalTokens: 300, promptTokens: 180, reasoningTokens: 60 },
      model: 'MiniMax-M3.1-Flash',
      spec: { taskKind: 'chat', promptPreview: '你是一个来访者…', maxCompletionTokens: 1500, reasoningEffort: 'medium' },
      finishReason: 'stop',
      ttftMs: 420,
      promptFull: '你是一个来访者……(完整 system prompt)',
    },
  };
}

/**
 * 引擎门面替身 (只记调用 + 按队列返回结算结果).
 */
class StubEngineTurnService {
  readonly opened: { readonly sessionId: string; readonly tenantId: string; readonly visitorId: string; readonly options: unknown }[] = [];
  readonly turns: { readonly handleId: string; readonly userText: string; readonly options: unknown }[] = [];
  readonly closed: string[] = [];
  /** 按顺序吐出的结算结果. */
  readonly queue: TurnRenderResult[] = [];

  open(
    input: { readonly sessionId: string; readonly tenantId: string; readonly visitorId: string },
    options?: unknown,
  ): { handleId: string; sessionId: string } {
    this.opened.push({ sessionId: input.sessionId, tenantId: input.tenantId, visitorId: input.visitorId, options });
    return { handleId: `handle-${input.sessionId}`, sessionId: input.sessionId };
  }

  async turnStream(
    handleId: string,
    input: { readonly userText: string },
    _handlers: unknown,
    options?: unknown,
  ): Promise<TurnRenderResult> {
    this.turns.push({ handleId, userText: input.userText, options });
    const next = this.queue.shift();
    if (!next) throw new Error('测试未预置结算结果');
    return next;
  }

  close(handleId: string): void {
    this.closed.push(handleId);
  }
}

/**
 * 角色解析端口替身.
 */
class StubCharacterResolver {
  readonly calls: { readonly templateId?: string }[] = [];
  /** 已知的角色 slug (其余解析不到 → null). */
  readonly known = new Set<string>([KNOWN_SLUG]);

  async resolve(request: { readonly templateId?: string }): Promise<ResolvedCharacter | null> {
    this.calls.push({ templateId: request.templateId });
    if (!request.templateId || !this.known.has(request.templateId)) return null;
    return { characterProfile: makeCharacterProfile(), seed: 42, displayName: '亲密回避型 L1' };
  }
}

/**
 * 角色内核基线 (只需结构对 —— 调试服务只读 attachmentStyle / personalityTraits).
 */
function makeCharacterProfile(): CharacterProfile {
  // ⚠️ 故意不填 forbiddenBehaviors / sensitiveTopics (内核契约里的**必填**字段) ——
  //   这两个调试服务只读 attachmentStyle / personalityTraits;
  //   用类型断言而不是补值: 补空数组会改变运行时行为 (零变化红线).
  return { coreBeliefs: [], attachmentStyle: 'avoidant', personalityTraits: { agreeableness: 0.4 } } as unknown as CharacterProfile;
}

/**
 * Redis 替身 (只回 get).
 */
class StubRedis {
  readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
}

/**
 * 造一条审议 trace 记录 (内容形状对齐 DeliberationTraceRecord).
 */
function makeDeliberationRecord(sessionId: string, turnIndex: number): DeliberationTraceRecord {
  return {
    tenantId: DEBUG_CHAT_TENANT_ID,
    sessionId,
    turnIndex,
    // WP65: 本次审议对应的快照版本号 (切灰度时判断有没有过期).
    baseRevision: 7,
    // V2026-11-07: 过期判定结果 (新字段必填 —— 与生产 trace 形状保持一致).
    stale: false,
    currentRevision: 7,
    // 约束校验层: 逐维 delta cap 砍幅明细 (没被砍 = 空).
    capEntries: [],
    // V2026-11-07: 临床合理性标记 (观测版) —— 必填字段, 这里没有可疑轮次.
    clinicalFlags: [],
    timestamp: '2026-11-05T10:00:00.000Z',
    ok: true,
    errorCode: null,
    retryCount: 0,
    durationMs: 1234,
    mode: 'freeform',
    tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    ruleDelta: {
      trust: 0.05,
      safety: 0.02,
      bond: 0.01,
      valence: 0,
      arousal: 0,
      verbal: 0,
      depth: 0,
      style: 0,
      positive: 0,
      negative: 0,
      dependency: 0,
    },
    deliberationDelta: { trust: 0.06 },
    deltaDiff: {
      trust: 0.01,
      safety: 0,
      bond: 0,
      valence: 0,
      arousal: 0,
      verbal: 0,
      depth: 0,
      style: 0,
      positive: 0,
      negative: 0,
      dependency: 0,
    },
    operatorTags: [],
    reason: '审议认为信任可以再抬一点',
    confidence: 0.8,
    summary: '整体可推进',
    entries: [],
    rejectedEntries: [],
    ruleStrategy: 'simple_response',
    llmIntentionShift: null,
    lockedStrategy: 'simple_response',
    llmIntentionAccepted: false,
  };
}

/**
 * 内存版调试会话存储 (替身).
 *
 * 为什么**用替身而不是真文件存储**: WP58 这套单测验的是**引擎侧行为**
 * (开关 / 角色解析 / delta / 审议 trace / 边界), 落盘是另一件事.
 * 真存储 (临时目录 + 文件 + 淘汰) 由 `debug-session-persistence.spec.ts` 单独覆盖.
 */
class StubDebugSessionStore {
  readonly records = new Map<string, DebugSessionRecord>();

  directory(): string {
    return '(stub)';
  }

  async create(record: DebugSessionRecord): Promise<DebugSessionRecord> {
    this.records.set(record.id, record);
    return record;
  }

  async appendTurn(
    id: string,
    message: DebugSessionMessage,
    reply: DebugSessionMessage,
    trace: unknown,
  ): Promise<DebugSessionRecord | null> {
    const current = this.records.get(id);
    if (!current) return null;
    const updated: DebugSessionRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      turnCount: current.turnCount + 1,
      messages: [...current.messages, message, reply],
      traces: [...current.traces, trace],
    };
    this.records.set(id, updated);
    return updated;
  }

  async updateTitle(id: string, title: string, source: 'llm' | 'manual'): Promise<DebugSessionRecord | null> {
    const current = this.records.get(id);
    if (!current) return null;
    if (source === 'llm' && current.titleSource === 'manual') return current;
    const updated: DebugSessionRecord = { ...current, title, titleSource: source, updatedAt: new Date().toISOString() };
    this.records.set(id, updated);
    return updated;
  }

  async markCompleted(id: string): Promise<DebugSessionRecord | null> {
    const current = this.records.get(id);
    if (!current) return null;
    const updated: DebugSessionRecord = { ...current, status: 'completed', updatedAt: new Date().toISOString() };
    this.records.set(id, updated);
    return updated;
  }

  async list(): Promise<DebugSessionSummary[]> {
    return [...this.records.values()]
      .map((record) => ({
        id: record.id,
        title: record.title,
        characterSlug: record.characterSlug,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        turnCount: record.turnCount,
        status: record.status,
        resumable: record.kernelState !== null,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<DebugSessionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async remove(id: string): Promise<boolean> {
    return this.records.delete(id);
  }
}

/**
 * 标题生成器替身 (固定标题).
 */
class StubTitleGenerator {
  readonly calls: unknown[] = [];

  async generate(input: unknown): Promise<string> {
    this.calls.push(input);
    return '来访者初始访谈';
  }
}

/**
 * 造一套调试服务 (替身全注入).
 */
function buildService(env: Record<string, string> = {}): {
  service: DebugSessionService;
  engine: StubEngineTurnService;
  resolver: StubCharacterResolver;
  redis: StubRedis;
  store: StubDebugSessionStore;
  titleGenerator: StubTitleGenerator;
} {
  const engine = new StubEngineTurnService();
  const resolver = new StubCharacterResolver();
  const redis = new StubRedis();
  const store = new StubDebugSessionStore();
  const titleGenerator = new StubTitleGenerator();
  const service = new DebugSessionService(
    engine as unknown as ConstructorParameters<typeof DebugSessionService>[0],
    resolver,
    redis as unknown as ConstructorParameters<typeof DebugSessionService>[2],
    stubConfig(env) as unknown as ConstructorParameters<typeof DebugSessionService>[3],
    store as unknown as ConstructorParameters<typeof DebugSessionService>[4],
    titleGenerator,
    {
      restoreBdiState: async () => 'restored' as const,
      restoreMemories: async () => 0,
    } as unknown as ConstructorParameters<typeof DebugSessionService>[6],
  );
  return { service, engine, resolver, redis, store, titleGenerator };
}

describe('WP58 · 引擎调试面板', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── ① 创建调试会话 ───────────────────────────────────────────────────────
  describe('① 创建调试会话', () => {
    it('合法 characterSlug → 返回 sessionId (且与 debugSessionId 同值)', async () => {
      const { service, engine } = buildService();
      const created = await service.createSession(KNOWN_SLUG);

      expect(created.sessionId).toMatch(/^debug_/);
      expect(created.debugSessionId).toBe(created.sessionId);
      expect(created.characterSlug).toBe(KNOWN_SLUG);
      expect(created.characterLabel).toBe('亲密回避型 L1');
      expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // 内核会话用**同一个 id** —— 审议 trace 的 key 要靠它.
      expect(engine.opened).toHaveLength(1);
      expect(engine.opened[0]?.sessionId).toBe(created.sessionId);
      expect(engine.opened[0]?.tenantId).toBe(DEBUG_CHAT_TENANT_ID);
      expect(engine.opened[0]?.visitorId).toBe('debug-admin');
    });

    it('角色不存在 → 400 (角色不存在), 且不开会话', async () => {
      const { service, engine } = buildService();
      await expect(service.createSession('no-such-role')).rejects.toMatchObject({
        code: BizCode.InvalidParameter,
        message: '角色不存在',
      });
      expect(engine.opened).toHaveLength(0);
    });

    it('不传 characterSlug → 400 (角色代号必填)', async () => {
      const { service, engine } = buildService();
      await expect(service.createSession(void 0)).rejects.toMatchObject({
        code: BizCode.InvalidParameter,
        message: '角色代号必填',
      });
      expect(engine.opened).toHaveLength(0);
    });
  });

  // ── ② 发一轮对话 ─────────────────────────────────────────────────────────
  describe('② 发一轮对话', () => {
    it('合法会话 + 输入 → 返回完整调试 trace', async () => {
      const { service, engine } = buildService();
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(makeSnapshot(), 1));

      const result = await service.runTurn(created.sessionId, COUNSELOR_TEXT);

      expect(result.reply).toBe(VISITOR_REPLY);
      expect(result.trace.turnIndex).toBe(1);
      expect(result.trace.characterSlug).toBe(KNOWN_SLUG);
      expect(result.trace.renderSpec.promptFull).toBe('你是一个来访者……(完整 system prompt)');
      expect(result.trace.renderSpec.taskKind).toBe('chat');
      expect(result.trace.llmUsage.completionTokens).toBe(120);
      expect(result.trace.crisis.detected).toBe(false);
      expect(result.trace.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // 门面用的是**流式**出口 (唯一能拿到 prompt 全文的路径), 且显式要了全文.
      expect(engine.turns[0]?.options).toEqual({ includePromptFull: true });
    });

    it('BDI 快照含 safety / bond 三维 + 阻抗三维', async () => {
      const { service, engine } = buildService();
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(makeSnapshot({ trust: 0.55, safety: 0.45, bond: 0.2, verbal: 0.31, depth: 0.32, style: 0.33 }), 1));

      const { trace } = await service.runTurn(created.sessionId, COUNSELOR_TEXT);

      expect(trace.bdiSnapshot.trust).toBe(0.55);
      expect(trace.bdiSnapshot.safety).toBe(0.45);
      expect(trace.bdiSnapshot.bond).toBe(0.2);
      expect(trace.bdiSnapshot.resistanceVerbal).toBe(0.31);
      expect(trace.bdiSnapshot.resistanceDepth).toBe(0.32);
      expect(trace.bdiSnapshot.resistanceStyle).toBe(0.33);
      // 标量 resistance 口径 = 话量阻抗 (与 WP19-R 留痕同款).
      expect(trace.bdiSnapshot.resistance).toBe(0.31);
      expect(trace.bdiSnapshot.anxiousSecure).toBe('neutral');
    });

    it('delta = 前后快照差 (第 1 轮 null, 第 2 轮有值)', async () => {
      const { service, engine } = buildService();
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(
        makeTurnResult(makeSnapshot({ trust: 0.5, safety: 0.4, bond: 0.1 }), 1),
        makeTurnResult(makeSnapshot({ trust: 0.55, safety: 0.42, bond: 0.11 }), 2),
      );

      const first = await service.runTurn(created.sessionId, COUNSELOR_TEXT);
      expect(first.trace.delta).toBeNull();
      expect(first.trace.deltaDetail).toBeNull();

      const second = await service.runTurn(created.sessionId, COUNSELOR_TEXT);
      expect(second.trace.delta?.trust).toBeCloseTo(0.05, 6);
      expect(second.trace.delta?.safety).toBeCloseTo(0.02, 6);
      expect(second.trace.delta?.bond).toBeCloseTo(0.01, 6);
      // 前端投影: 8 维 + events (内核事件明细不对外 → 空数组).
      expect(second.trace.deltaDetail?.trust).toBeCloseTo(0.05, 6);
      expect(second.trace.deltaDetail?.events).toEqual([]);
    });

    it('审议 trace 从 Redis 读出来 (第 2 轮)', async () => {
      const { service, engine, redis } = buildService({ ENGINE_DELIBERATION_ENABLED: 'true' });
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(makeSnapshot(), 1), makeTurnResult(makeSnapshot({ trust: 0.55 }), 2));
      const key = buildDeliberationTraceKey(DEBUG_CHAT_TENANT_ID, created.sessionId, 2);
      redis.store.set(key, JSON.stringify(makeDeliberationRecord(created.sessionId, 2)));

      await service.runTurn(created.sessionId, COUNSELOR_TEXT);
      const second = await service.runTurn(created.sessionId, COUNSELOR_TEXT);

      expect(second.trace.deliberationTrace?.ok).toBe(true);
      expect(second.trace.deliberationTrace?.turnIndex).toBe(2);
      expect(second.trace.deliberationTrace?.summary).toBe('整体可推进');
    });

    it('第 1 轮没有审议 trace (门面首轮跳过影子审议)', async () => {
      const { service, engine } = buildService({ ENGINE_DELIBERATION_ENABLED: 'true' });
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(makeSnapshot(), 1));

      const { trace } = await service.runTurn(created.sessionId, COUNSELOR_TEXT);

      expect(trace.deliberationTrace).toBeNull();
    });

    it('不存在的 debugSessionId → 404', async () => {
      const { service } = buildService();
      await expect(service.runTurn('debug_not_exist', COUNSELOR_TEXT)).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
        message: '调试会话不存在',
      });
    });

    it('空输入 → 400', async () => {
      const { service } = buildService();
      const created = await service.createSession(KNOWN_SLUG);
      await expect(service.runTurn(created.sessionId, ' '.repeat(3))).rejects.toMatchObject({
        code: BizCode.InvalidParameter,
        message: '咨询师输入不能为空',
      });
    });
  });

  // ── ③ 关闭调试会话 ───────────────────────────────────────────────────────
  describe('③ 关闭调试会话', () => {
    it('合法会话 → 关内核句柄 + 内存清干净', async () => {
      const { service, engine } = buildService();
      const created = await service.createSession(KNOWN_SLUG);
      expect(service.size()).toBe(1);

      service.closeSession(created.sessionId);

      expect(service.size()).toBe(0);
      expect(engine.closed).toEqual([`handle-${created.sessionId}`]);
      // 关掉之后再发一轮 → 404.
      await expect(service.runTurn(created.sessionId, COUNSELOR_TEXT)).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });

    it('不存在的 debugSessionId → 404', () => {
      const { service } = buildService();
      expect(() => service.closeSession('debug_not_exist')).toThrow(BizException);
      try {
        service.closeSession('debug_not_exist');
      } catch (error) {
        expect((error as BizException).code).toBe(BizCode.ResourceNotFound);
      }
    });
  });

  // ── ④ 开关与鉴权 ──────────────────────────────────────────────────────────
  describe('④ 开关与鉴权', () => {
    it('ENGINE_DEBUG_CHAT_ENABLED=false → 403', async () => {
      const { service, engine } = buildService({ ENGINE_DEBUG_CHAT_ENABLED: 'false' });
      await expect(service.createSession(KNOWN_SLUG)).rejects.toMatchObject({ code: BizCode.Forbidden });
      expect(engine.opened).toHaveLength(0);
    });

    it('开关口径: 显式配了按配的来 / 没配则非生产开、生产关', () => {
      expect(resolveDebugChatEnabled(stubConfig({ ENGINE_DEBUG_CHAT_ENABLED: 'true' }) as never)).toBe(true);
      expect(resolveDebugChatEnabled(stubConfig({ ENGINE_DEBUG_CHAT_ENABLED: 'false' }) as never)).toBe(false);
      expect(resolveDebugChatEnabled(stubConfig({ NODE_ENV: 'development' }) as never)).toBe(true);
      expect(resolveDebugChatEnabled(stubConfig({ NODE_ENV: 'production' }) as never)).toBe(false);
      expect(resolveDebugChatEnabled(stubConfig({ NODE_ENV: 'production', ENGINE_DEBUG_CHAT_ENABLED: 'true' }) as never)).toBe(true);
    });

    it('等待上限口径: 缺省 5000 / 非法值回退 / 0 = 不等', () => {
      expect(resolveDebugChatDeliberationWaitMs(stubConfig({}) as never)).toBe(5000);
      expect(resolveDebugChatDeliberationWaitMs(stubConfig({ ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS: 'abc' }) as never)).toBe(5000);
      expect(resolveDebugChatDeliberationWaitMs(stubConfig({ ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS: '-5' }) as never)).toBe(5000);
      expect(resolveDebugChatDeliberationWaitMs(stubConfig({ ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS: '0' }) as never)).toBe(0);
      expect(resolveDebugChatDeliberationWaitMs(stubConfig({ ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS: '1200' }) as never)).toBe(1200);
    });

    it('class 级挂 AdminRoleGuard (非 admin → 403 由此拦)', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, DebugSessionController) as unknown[] | undefined;
      expect(guards).toContain(AdminRoleGuard);
    });

    it('非 admin 学员 → 守卫 403; admin → 放行', async () => {
      const repo = {
        findOne: vi.fn(async () => ({ adminRole: 'editor' })),
      };
      const guard = new AdminRoleGuard(repo as never);
      const context = (request: unknown): Parameters<typeof guard.canActivate>[0] =>
        ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;

      await expect(guard.canActivate(context({ user: { userId: 'u-1' } }))).rejects.toMatchObject({
        code: BizCode.Forbidden,
      });

      repo.findOne.mockResolvedValue({ adminRole: 'admin' });
      await expect(guard.canActivate(context({ user: { userId: 'u-1' } }))).resolves.toBe(true);

      // 运维 basic 凭据 = 独立身份 → 直接放行 (不查 DB).
      await expect(guard.canActivate(context({ adminBasicAuth: true }))).resolves.toBe(true);
    });
  });

  // ── ⑤ 边界 ───────────────────────────────────────────────────────────────
  describe('⑤ 边界', () => {
    it('调试会话不落库 (服务层零 TypeORM / 零 training_sessions)', () => {
      // 只扫**代码**: 注释里出现 "turn_debug_trace" 是**边界说明** (说明我们不写它),
      // 那不是落库行为 —— 所以先把注释剥掉再断言.
      const code = stripComments(readFileSync(path.join(__dirname, '../../src/admin-debug/debug-session.service.ts'), 'utf8'));
      expect(code).not.toContain('@nestjs/typeorm');
      expect(code).not.toContain('InjectRepository');
      expect(code).not.toContain('TrainingSession');
      expect(code).not.toContain('turn_debug_trace');
    });

    it('engine-core 零运行时依赖 (只 type-only import)', () => {
      const source = readFileSync(path.join(__dirname, '../../src/admin-debug/debug-session.service.ts'), 'utf8');
      const kernelImports = source.split('\n').filter((line) => line.includes('engine-core/index.js'));
      expect(kernelImports.length).toBeGreaterThan(0);
      for (const line of kernelImports) {
        expect(line.trimStart().startsWith('import type')).toBe(true);
      }
    });

    it('心理内容不进日志 (只打定位信息)', async () => {
      const logs: string[] = [];
      for (const level of ['log', 'warn', 'error'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
          logs.push(String(message));
        });
      }
      const { service, engine } = buildService();
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(makeSnapshot(), 1));
      await service.runTurn(created.sessionId, COUNSELOR_TEXT);
      service.closeSession(created.sessionId);

      expect(logs.length).toBeGreaterThan(0);
      const joined = logs.join('\n');
      expect(joined).not.toContain(COUNSELOR_TEXT);
      expect(joined).not.toContain(VISITOR_REPLY);
      // 只出定位信息.
      expect(joined).toContain(created.sessionId);
    });
  });

  // ── ⑥ 模块装配 (防循环依赖 / 中间件 / 路由) ───────────────────────────────
  describe('⑥ 模块装配', () => {
    it('无循环依赖: 引擎装配层不反向 import 调试模块', () => {
      const engineImports = (Reflect.getMetadata('imports', EngineWiringModule) ?? []) as unknown[];
      expect(engineImports).not.toContain(AdminDebugChatModule);
    });

    it('依赖声明齐全 (引擎门面 + 角色解析端口 + 身份解析 + User 实体)', () => {
      const imports = (Reflect.getMetadata('imports', AdminDebugChatModule) ?? []) as unknown[];
      expect(imports).toContain(EngineWiringModule);
      expect(imports).toContain(CharacterPoolModule);
      expect(imports).toContain(UserModule);
    });

    it('中间件挂到调试控制器上', () => {
      const apply = vi.fn(() => ({ forRoutes: vi.fn() }));
      new AdminDebugChatModule().configure({ apply } as never);
      expect(apply).toHaveBeenCalledWith(AdminBasicAuthMiddleware);
    });

    it('三个端点的路径与方法 (前端契约)', () => {
      const pathOf = (method: string): string | undefined =>
        Reflect.getMetadata(PATH_METADATA, DebugSessionController.prototype[method as keyof DebugSessionController]);

      expect(pathOf('createSession')).toBe('session');
      expect(pathOf('turn')).toBe('session/:id/turn');
      expect(pathOf('closeSession')).toBe('session/:id');
      expect(Reflect.getMetadata(METHOD_METADATA, DebugSessionController.prototype.createSession)).toBeDefined();
      expect(Reflect.getMetadata(METHOD_METADATA, DebugSessionController.prototype.turn)).toBeDefined();
      expect(Reflect.getMetadata(METHOD_METADATA, DebugSessionController.prototype.closeSession)).toBeDefined();
    });

    it('历史会话四个端点的路径与方法 (V2026-11-05 持久化)', () => {
      const pathOf = (method: string): string | undefined =>
        Reflect.getMetadata(PATH_METADATA, DebugSessionController.prototype[method as keyof DebugSessionController]);
      const methodOf = (method: string): number | undefined =>
        Reflect.getMetadata(METHOD_METADATA, DebugSessionController.prototype[method as keyof DebugSessionController]);

      expect(pathOf('listSessions')).toBe('sessions');
      expect(pathOf('getSession')).toBe('sessions/:id');
      expect(pathOf('updateSessionTitle')).toBe('sessions/:id');
      expect(pathOf('deleteSession')).toBe('sessions/:id');
      expect(methodOf('listSessions')).toBe(RequestMethod.GET);
      expect(methodOf('getSession')).toBe(RequestMethod.GET);
      expect(methodOf('updateSessionTitle')).toBe(RequestMethod.PATCH);
      expect(methodOf('deleteSession')).toBe(RequestMethod.DELETE);
    });

    it('入参两个名字同义 (counselorText / userText)', async () => {
      const { service, engine } = buildService();
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(makeSnapshot(), 1));

      await service.runTurn(created.sessionId, COUNSELOR_TEXT);

      expect(engine.turns[0]?.userText).toBe(COUNSELOR_TEXT);
    });
  });

  // ── ⑦ prompt 全文通道 (渲染链) ───────────────────────────────────────────
  describe('⑦ prompt 全文通道', () => {
    it('buildPromptFull 返回完整 system 消息 (不截断)', () => {
      const long = 'x'.repeat(900);
      const full = buildPromptFull([
        { role: 'system', content: long },
        { role: 'user', content: '你好' },
      ]);
      expect(full).toHaveLength(900);
    });

    it('门面按需带出全文: 要了才有, 默认不带', async () => {
      const snapshot = makeSnapshot();
      const output = { reply: '', snapshot, turnIndex: 1 };
      const session = {
        turn: async () => output,
        openSession: async () => ({ handleId: 'h', sessionId: 's' }),
        closeSession: async () => {},
      };
      const renderer = {
        render: async () => ({ text: '', taskKind: 'chat', usage: { completionTokens: 0, totalTokens: 0 }, fallbackUsed: false }),
        streamRender: async () => ({
          text: VISITOR_REPLY,
          taskKind: 'chat' as const,
          usage: { completionTokens: 10, totalTokens: 20 },
          fallbackUsed: false,
          degraded: false,
          promptPreview: '前 500 字',
          promptFull: '完整 system prompt 全文',
          maxCompletionTokens: 1500,
          reasoningEffort: 'medium',
        }),
      };
      const memories = { remember: async () => {} };
      const orchestrator = new TurnRenderOrchestrator({
        session: session as unknown as EngineSessionPort,
        renderer: renderer as unknown as StreamingRenderPort,
        memories: memories as unknown as MemoryStore,
        resolveSession: () => ({ tenantId: 't', sessionId: 's', visitorId: 'v' }),
      });

      const withFull = await orchestrator.turnStream('h', { userText: COUNSELOR_TEXT }, { onDelta: () => {} }, { includePromptFull: true });
      expect(withFull.render.promptFull).toBe('完整 system prompt 全文');

      const withoutFull = await orchestrator.turnStream('h', { userText: COUNSELOR_TEXT }, { onDelta: () => {} });
      expect(withoutFull.render.promptFull).toBeUndefined();
    });
  });
});
