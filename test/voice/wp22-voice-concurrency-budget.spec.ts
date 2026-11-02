// V2026-11-02 治本 (WP22 · voice 侧 · 语音对练限流与并发上限):
//   职责: 钉死「开会话前两道闸门」的闭环 ——
//     ① 单用户并发上限 (同一 userId 开第二场 → 拒, 且**不自动关旧会话**);
//     ② 全局日 token 预算 (超限 → 拒; env=0 → 不限制);
//     以及闸门错误到 WS `error` 帧的映射、收尾时的用量记账与占位释放.
//   边界: 全 mock; 不起 Nest 容器; 不连 Redis / 不连上游 / 不起引擎.
//
//   为什么这些必须有用例 (而不是靠人看):
//     ① 并发闸门写错方向 = 用户开不了第二场 (可用性事故);
//     ② **占位泄漏** = 用户被自己的闸门**永久**锁死 (最坏的一种 bug:
//       他明明没开成会话, 却因为占位没释放而再也开不了);
//     ③ 预算口径错 = 要么形同虚设 (Redis 挂了还放行), 要么把正常用户挡在门外;
//     ④ 帧格式与前端不一致 = 前端认不出, 用户只看到"连不上".
//
//   验证: npx vitest run test/voice/wp22-voice-concurrency-budget.spec.ts
//   时间戳: 2026-11-02 GMT+8

import { Logger } from '@nestjs/common';
// ⚠️ 值导入: ConfigService 在 DI 冒烟用例里要当 provider 的 token 用.
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Socket } from 'socket.io';
import { vi } from 'vitest';

import type { VisitorService } from '../../src/agent/visitor/visitor.service.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import { createEngineStreamBackend } from '../../src/engine-adapters/wiring/engine.providers.js';
// ⚠️ 必须**值导入**: 这里要拿 RedisService 当 DI token 用 (provide 的 token),
//   type-only 导入在运行时是 undefined.
//   直接 import 文件 (不走 barrel) —— 与 redis.service.ts 文件头的告诫同款.
import { RedisService } from '../../src/shared/infra/redis/redis.service.js';
import { buildVoiceLimitErrorFrame, VoiceSessionLimitError } from '../../src/voice/voice-session-limit.error.js';
import {
  DAILY_BUDGET_TTL_SEC,
  DEFAULT_DAILY_TOKEN_BUDGET,
  DEFAULT_MAX_CONCURRENT_PER_USER,
  VoiceSessionLimitsService,
} from '../../src/voice/voice-session-limits.service.js';
import type { VoiceTurnBackend, VoiceTurnBackendCloseResult } from '../../src/voice/voice-turn-backend.port.js';
import { VoiceGateway } from '../../src/voice/voice.gateway.js';
import { VoiceService } from '../../src/voice/voice.service.js';
import type { VoiceSessionMeta, VoiceServerMessage } from '../../src/voice/voice.types.js';

/** 会话元数据 (text 模式: 不碰 TTS). */
function metaOf(sessionId: string, userId = 'user-1'): VoiceSessionMeta {
  return {
    sessionId,
    userId,
    tenantId: 'tenant-1',
    traceId: 'trace-1',
    personaId: 'visitor-1',
    mode: 'text',
    preset: {
      difficulty: 'L1',
      style: 'cooperative',
      emotionBaseline: 0.3,
      defenseLevel: 0.2,
      visitorMode: 'fullyReal',
    },
  };
}

/**
 * 假 Redis: 只实现闸门用到的三个命令, 并记录调用.
 *
 * 为什么不用 mock 函数直接断言: 这里要验的是**key 形状**与 **TTL**,
 * 它们是运维能直接看到的产物 (redis-cli TTL / KEYS), 不是内部实现细节.
 */
class FakeRedis {
  readonly values = new Map<string, number>();
  readonly getCalls: string[] = [];
  readonly incrbyCalls: { readonly key: string; readonly amount: number }[] = [];
  readonly expireCalls: { readonly key: string; readonly ttlSec: number }[] = [];
  getError?: Error;
  incrbyError?: Error;

  async get(key: string): Promise<string | null> {
    this.getCalls.push(key);
    if (this.getError) throw this.getError;
    const value = this.values.get(key);
    return value === undefined ? null : String(value);
  }

  async incrby(key: string, amount: number): Promise<number> {
    this.incrbyCalls.push({ key, amount });
    if (this.incrbyError) throw this.incrbyError;
    const next = (this.values.get(key) ?? 0) + amount;
    this.values.set(key, next);
    return next;
  }

  async expire(key: string, ttlSec: number): Promise<void> {
    this.expireCalls.push({ key, ttlSec });
  }
}

/** 假配置 (只认点号路径). */
function stubConfig(values: Readonly<Record<string, unknown>>): ConfigService {
  return { get: (key: string): unknown => values[key] } as unknown as ConfigService;
}

/** 造一个限流闸门 (env 可配). */
function buildLimits(options: { readonly budget?: number; readonly maxConcurrent?: number } = {}): {
  readonly limits: VoiceSessionLimitsService;
  readonly redis: FakeRedis;
} {
  const redis = new FakeRedis();
  const limits = new VoiceSessionLimitsService(
    redis as unknown as RedisService,
    stubConfig({
      'voice.dailyTokenBudget': options.budget ?? DEFAULT_DAILY_TOKEN_BUDGET,
      'voice.maxConcurrentPerUser': options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_PER_USER,
    }),
  );
  return { limits, redis };
}

/** 当日 key (按服务器本地自然日). */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `voice:daily-token-budget:${now.getFullYear()}-${month}-${day}`;
}

/**
 * 假 visitor (旧链路): 只实现窄接口要的那几个方法.
 *
 * `openError` 用来验"开场失败 → 释放占位" (占位泄漏防护).
 */
class FakeVisitor {
  readonly openCalls: { readonly sessionId: string }[] = [];
  readonly closed: string[] = [];
  openError?: Error;

  async openSession(opts: { readonly sessionId: string }): Promise<{
    id: string;
    name: string;
    voiceId: string;
    difficulty: string;
  }> {
    this.openCalls.push(opts);
    if (this.openError) throw this.openError;
    return { id: 'visitor-1', name: '来访者', voiceId: 'voice-1', difficulty: 'L1' };
  }

  closeSession(sessionId: string): VoiceTurnBackendCloseResult {
    this.closed.push(sessionId);
    return { finalTurnCount: 0, finalMessageCount: 0 };
  }

  transcript(): readonly never[] {
    return [];
  }
}

/** 假引擎后端 (voice 侧窄接口): close 结果可带本场用量. */
class FakeEngineBackend implements VoiceTurnBackend {
  readonly openCalls: { readonly sessionId: string }[] = [];
  readonly closed: string[] = [];
  openError?: Error;
  /** 本场累计 completion tokens (收尾时随结果返回). */
  completionTokens = 0;

  async openSession(opts: { readonly sessionId: string }): Promise<{
    id: string;
    name: string;
    voiceId: string;
    difficulty: string;
  }> {
    this.openCalls.push(opts);
    if (this.openError) throw this.openError;
    return { id: 'voice_visitor', name: '来访者', voiceId: '', difficulty: 'L1' };
  }

  closeSession(sessionId: string): VoiceTurnBackendCloseResult {
    this.closed.push(sessionId);
    return {
      finalTurnCount: 1,
      finalMessageCount: 2,
      ...(this.completionTokens > 0 ? { totalCompletionTokens: this.completionTokens } : {}),
    };
  }

  transcript(): readonly never[] {
    return [];
  }
}

/** 装配一个被测的 VoiceService (端口全 stub). */
function buildService(options: {
  readonly env?: Readonly<Record<string, string>>;
  readonly engine?: FakeEngineBackend | null;
  readonly limits?: VoiceSessionLimitsService;
}): { readonly service: VoiceService; readonly visitor: FakeVisitor; readonly engine: FakeEngineBackend | null } {
  const visitor = new FakeVisitor();
  const engine = options.engine ?? null;
  const supervisor = { enqueue: async () => true, processSync: async () => {} };
  const bridges = { appendTurn: async () => {}, close: async () => null };
  const tts = { startSession: async () => null };
  const service = new VoiceService(
    visitor as unknown as VisitorService,
    supervisor as never,
    tts as never,
    bridges as never,
    stubConfig(options.env ?? {}),
    (engine as unknown as VoiceTurnBackend | undefined) ?? undefined,
    options.limits,
  );
  return { service, visitor, engine };
}

/** 引擎门面 stub: turnStream 吐一个增量再返回渲染元信息 (与真实门面同形). */
function buildEngineStub(render: TurnRenderResult['render']): EngineTurnService {
  return {
    open: () => ({ handleId: 'handle-1', sessionId: 'session-1' }),
    close: () => {},
    turnStream: async (
      _handleId: string,
      _input: unknown,
      handlers: { readonly onDelta?: (delta: string) => void | Promise<void> },
    ): Promise<TurnRenderResult> => {
      await handlers.onDelta?.('我最近有点睡不着。');
      return {
        reply: '我最近有点睡不着。',
        snapshot: {} as TurnRenderResult['snapshot'],
        turnIndex: 1,
        render,
      };
    },
  } as unknown as EngineTurnService;
}

describe('WP22 · 语音对练限流与并发上限', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('① 单用户并发上限', () => {
    it('同一 userId 开第二场 → 拒 (session_already_active), 且**不自动关旧会话**', async () => {
      const { limits } = buildLimits();
      await limits.acquire('user-1', 'session-1');

      await expect(limits.acquire('user-1', 'session-2')).rejects.toThrow(VoiceSessionLimitError);
      await expect(limits.acquire('user-1', 'session-2')).rejects.toMatchObject({
        code: 'session_already_active',
        message: '您已有一场进行中的训练，请先结束再开始新的',
        retryable: true,
      });
    });

    it('拒绝时**不碰**第一场 (不自动关旧会话, 避免用户丢进度)', async () => {
      const { limits } = buildLimits();
      await limits.acquire('user-1', 'session-1');
      await expect(limits.acquire('user-1', 'session-2')).rejects.toThrow(VoiceSessionLimitError);

      // 第一场仍然占着名额: 放掉第一场之前, 第二场依旧开不了.
      await expect(limits.acquire('user-1', 'session-2')).rejects.toThrow(VoiceSessionLimitError);
    });

    it('不同 userId 互不影响', async () => {
      const { limits } = buildLimits();
      await limits.acquire('user-1', 'session-1');
      await expect(limits.acquire('user-2', 'session-2')).resolves.toBeUndefined();
    });

    it('同一个 sessionId 重开 (前端重连) → 不算第二场, 放行', async () => {
      const { limits } = buildLimits();
      await limits.acquire('user-1', 'session-1');
      await expect(limits.acquire('user-1', 'session-1')).resolves.toBeUndefined();
    });

    it('第一场结束后 → 同 userId 可以开第二场 (验收 #2)', async () => {
      const { limits } = buildLimits();
      await limits.acquire('user-1', 'session-1');
      limits.release('user-1', 'session-1');
      await expect(limits.acquire('user-1', 'session-2')).resolves.toBeUndefined();
    });

    it('并发上限 env 可配 (本期恒为 1, 但 N=2 时两场都能开)', async () => {
      const { limits } = buildLimits({ maxConcurrent: 2 });
      await limits.acquire('user-1', 'session-1');
      await expect(limits.acquire('user-1', 'session-2')).resolves.toBeUndefined();
      await expect(limits.acquire('user-1', 'session-3')).rejects.toThrow(VoiceSessionLimitError);
    });

    it('非法 env → 回退默认 (填错 env 不该让服务起不来)', async () => {
      const redis = new FakeRedis();
      const limits = new VoiceSessionLimitsService(
        redis as unknown as RedisService,
        stubConfig({ 'voice.dailyTokenBudget': 'abc', 'voice.maxConcurrentPerUser': -5 }),
      );
      await limits.acquire('user-1', 'session-1');
      // maxConcurrent 回退到 1 → 第二场仍被拒.
      await expect(limits.acquire('user-1', 'session-2')).rejects.toThrow(VoiceSessionLimitError);
    });

    it('DI 能装出闸门 (Nest 容器里构造得出来, 不留启动炸弹)', async () => {
      // 为什么要有这条: 本仓有前科 —— WP8-B 的 `EngineStreamBackend` 之所以变成启动炸弹,
      //   就是因为"只跑 tsc/eslint/jest, 从没真起过服务", 依赖注入的问题没人看见.
      //   这里把闸门放进真容器里装一次, 让"能不能装出来"变成**可断言**的事实.
      const moduleRef = await Test.createTestingModule({
        providers: [
          VoiceSessionLimitsService,
          { provide: RedisService, useValue: new FakeRedis() },
          {
            provide: ConfigService,
            useValue: stubConfig({
              'voice.dailyTokenBudget': DEFAULT_DAILY_TOKEN_BUDGET,
              'voice.maxConcurrentPerUser': DEFAULT_MAX_CONCURRENT_PER_USER,
            }),
          },
        ],
      }).compile();

      const limits = moduleRef.get(VoiceSessionLimitsService);
      expect(limits).toBeInstanceOf(VoiceSessionLimitsService);
      await expect(limits.acquire('user-1', 'session-1')).resolves.toBeUndefined();
      await moduleRef.close();
    });
  });

  describe('② 全局日 token 预算', () => {
    it('当日累计超限 → 拒 (daily_budget_exceeded) (验收 #3)', async () => {
      const { limits, redis } = buildLimits({ budget: 500 });
      redis.values.set(todayKey(), 600);

      await expect(limits.acquire('user-1', 'session-1')).rejects.toMatchObject({
        code: 'daily_budget_exceeded',
        message: '今日额度已用完，请明天再来',
        retryable: false,
      });
    });

    it('恰好用尽 (= 预算) → 也拒 (预算用完就没有下一场的额度了)', async () => {
      const { limits, redis } = buildLimits({ budget: 500 });
      redis.values.set(todayKey(), 500);
      await expect(limits.acquire('user-1', 'session-1')).rejects.toThrow(VoiceSessionLimitError);
    });

    it('未超限 → 放行', async () => {
      const { limits, redis } = buildLimits({ budget: 500 });
      redis.values.set(todayKey(), 499);
      await expect(limits.acquire('user-1', 'session-1')).resolves.toBeUndefined();
    });

    it('env = 0 → 不限制, 且**连 Redis 都不读** (验收 #4)', async () => {
      const { limits, redis } = buildLimits({ budget: 0 });
      redis.values.set(todayKey(), 9_999_999);
      await expect(limits.acquire('user-1', 'session-1')).resolves.toBeUndefined();
      expect(redis.getCalls).toHaveLength(0);
    });

    it('读的是**当日** key (按自然日分桶)', async () => {
      const { limits, redis } = buildLimits({ budget: 500 });
      await limits.acquire('user-1', 'session-1');
      expect(redis.getCalls).toEqual([todayKey()]);
    });

    it('Redis 读失败 → 放行 (fail-open: 额度闸门不该让所有对练开不起来)', async () => {
      const { limits, redis } = buildLimits({ budget: 500 });
      redis.getError = new Error('redis 连不上');
      await expect(limits.acquire('user-1', 'session-1')).resolves.toBeUndefined();
    });

    it('预算没过 → **不占并发名额** (否则用户明明没开成, 却把自己锁死)', async () => {
      const { limits, redis } = buildLimits({ budget: 500 });
      redis.values.set(todayKey(), 600);
      await expect(limits.acquire('user-1', 'session-1')).rejects.toThrow(VoiceSessionLimitError);

      // 额度放开后, 同一用户能正常开 (说明上一步没有留下占位).
      redis.values.set(todayKey(), 0);
      await expect(limits.acquire('user-1', 'session-1')).resolves.toBeUndefined();
    });
  });

  describe('收尾记账 (closeSession → 当日累计)', () => {
    it('累加到当日 key, TTL 48h, 金额是本场 completion tokens', async () => {
      const { limits, redis } = buildLimits();
      await limits.recordUsage(120);

      expect(redis.incrbyCalls).toEqual([{ key: todayKey(), amount: 120 }]);
      expect(redis.expireCalls).toEqual([{ key: todayKey(), ttlSec: DAILY_BUDGET_TTL_SEC }]);
      expect(DAILY_BUDGET_TTL_SEC).toBe(172_800);
    });

    it('0 / 负数 / 非数字 → 不记账 (没有花钱 ≠ 记一笔 0)', async () => {
      const { limits, redis } = buildLimits();
      await limits.recordUsage(0);
      await limits.recordUsage(-5);
      await limits.recordUsage(Number.NaN);
      expect(redis.incrbyCalls).toHaveLength(0);
    });

    it('Redis 写失败 → 只记 warn, 不抛 (收尾不能因为记账失败而失败)', async () => {
      const { limits, redis } = buildLimits();
      redis.incrbyError = new Error('redis 写失败');
      await expect(limits.recordUsage(50)).resolves.toBeUndefined();
    });
  });

  describe('VoiceService 接线 (端到端)', () => {
    it('同 userId 开第二场 → startSession 抛闸门错误 (第二场开不起来)', async () => {
      const { limits } = buildLimits();
      const { service } = buildService({ limits });

      await service.startSession(metaOf('session-1'));
      await expect(service.startSession(metaOf('session-2'))).rejects.toMatchObject({
        code: 'session_already_active',
      });
    });

    it('第一场结束后 → 同 userId 可以开第二场 (验收 #2)', async () => {
      const { limits } = buildLimits();
      const { service } = buildService({ limits });

      await service.startSession(metaOf('session-1'));
      service.endSession('session-1');
      await expect(service.startSession(metaOf('session-2'))).resolves.toBeUndefined();
    });

    it('开场失败 → 释放占位 (不留占位泄漏, 用户不会被自己的闸门锁死)', async () => {
      const { limits } = buildLimits();
      const { service, visitor } = buildService({ limits });
      visitor.openError = new Error('没有可用人设');

      await expect(service.startSession(metaOf('session-1'))).rejects.toThrow('没有可用人设');
      // 换掉失败原因再开一次: 若占位泄漏, 这次会撞上 session_already_active.
      visitor.openError = undefined;
      await expect(service.startSession(metaOf('session-1'))).resolves.toBeUndefined();
    });

    it('收尾把本场用量累加到当日预算 (钱花了要记账)', async () => {
      const { limits, redis } = buildLimits();
      const engine = new FakeEngineBackend();
      engine.completionTokens = 42;
      const { service } = buildService({ env: { ENGINE_VOICE_ENABLED: 'true' }, engine, limits });

      await service.startSession(metaOf('session-1'));
      service.endSession('session-1');

      await vi.waitFor(() => {
        expect(redis.incrbyCalls).toHaveLength(1);
      });
      expect(redis.incrbyCalls[0]).toEqual({ key: todayKey(), amount: 42 });
    });

    it('没装配闸门 → 会话照常开 (可选增强, 装配缺席 ≠ 开不了会话)', async () => {
      const { service } = buildService({});
      await expect(service.startSession(metaOf('session-1'))).resolves.toBeUndefined();
    });
  });

  describe('引擎适配器: 收尾结果带出本场用量', () => {
    it('closeSession 返回 totalCompletionTokens (给上层记账用)', async () => {
      const backend = createEngineStreamBackend({
        engine: buildEngineStub({
          fallbackUsed: false,
          usage: { promptTokens: 180, completionTokens: 120, totalTokens: 300 },
          model: 'abab6.5s-chat',
        }),
      });

      await backend.openSession({
        sessionId: 'sess-budget-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
      });
      const { stream } = await backend.streamTurn({
        sessionId: 'sess-budget-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
        userText: '我最近有点睡不着。',
      });
      for await (const _chunk of stream) {
        // 消费整条流 (usage 在流跑完时结算)
      }

      const closed = backend.closeSession('sess-budget-1');
      expect(closed.totalCompletionTokens).toBe(120);
    });

    it('closeSession 被调两次 (voice 侧会各关一次) → 第二次没有用量 (不重复计费)', async () => {
      const backend = createEngineStreamBackend({
        engine: buildEngineStub({
          fallbackUsed: false,
          usage: { completionTokens: 20, totalTokens: 20 },
        }),
      });
      await backend.openSession({
        sessionId: 'sess-budget-2',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
      });
      const { stream } = await backend.streamTurn({
        sessionId: 'sess-budget-2',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
        userText: '在吗',
      });
      for await (const _chunk of stream) {
        // 消费整条流
      }

      expect(backend.closeSession('sess-budget-2').totalCompletionTokens).toBe(20);
      expect(backend.closeSession('sess-budget-2').totalCompletionTokens).toBeUndefined();
    });
  });

  describe('闸门错误 → WS error 帧', () => {
    it('帧形状沿用仓库既有格式 (前端已能解析)', () => {
      const frame = buildVoiceLimitErrorFrame(
        new VoiceSessionLimitError('session_already_active', '您已有一场进行中的训练，请先结束再开始新的', true),
      );
      expect(frame).toEqual({
        type: 'error',
        error: {
          code: 'session_already_active',
          message: '您已有一场进行中的训练，请先结束再开始新的',
          retryable: true,
        },
      });
    });

    it('网关把闸门错误映射成专属 error 帧 (不是通用的 session_start_failed)', async () => {
      const frames: VoiceServerMessage[] = [];
      const disconnected: unknown[] = [];
      const removed: string[] = [];
      const client = {
        data: { sessionId: 'session-1', userId: 'user-1' },
        emit: (_event: string, payload: VoiceServerMessage): void => {
          frames.push(payload);
        },
        disconnect: (reason?: boolean): void => {
          disconnected.push(reason);
        },
      } as unknown as Socket;

      const voice = {
        startSession: async (): Promise<void> => {
          throw new VoiceSessionLimitError('daily_budget_exceeded', '今日额度已用完，请明天再来', false);
        },
      };
      const gateway = new VoiceGateway(
        voice as unknown as VoiceService,
        {} as never,
        stubConfig({}),
        {} as never,
        { remove: (sessionId: string): void => void removed.push(sessionId) } as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const started = await (
        gateway as unknown as {
          startVoiceSession: (client: Socket, data: unknown, preset: unknown, visitorCard: unknown) => Promise<boolean>;
        }
      ).startVoiceSession.call(gateway, client, client.data, {}, null);

      expect(started).toBe(false);
      expect(frames).toEqual([
        {
          type: 'error',
          error: { code: 'daily_budget_exceeded', message: '今日额度已用完，请明天再来', retryable: false },
        },
      ]);
      expect(disconnected).toEqual([true]);
      expect(removed).toEqual(['session-1']);
    });

    it('闸门错误**不是**通用启动失败 (不冒泡成 500 / session_start_failed)', () => {
      const error = new VoiceSessionLimitError('session_already_active', '您已有一场进行中的训练，请先结束再开始新的', true);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('session_already_active');
      expect(error.retryable).toBe(true);
    });
  });
});
