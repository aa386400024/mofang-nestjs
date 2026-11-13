// V2026-11-09 治本 (Phase2.5 WP-H · 改动 1/2/3/4): 渲染可用性单测.
//
// 为什么要有这组测试: 三批 1034 场自动对练里 926 场 (89.8%) 整场 0 token,
// 来访者 91.8% 的发言是渲染兜底池那 4 句 —— 根因是"熔断一开就是全损 +
// 没有备份候选 + 冷却 5 分钟". 这组测试把每一处修复都钉成**可断言的契约**.
//
// 边界: 全部用假时钟 / stub, 不发真实请求, 不连 Redis/MySQL.
//
// 验证: npx vitest run test/engine-adapters/wp-h-render-availability.spec.ts

import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { resolveAutoPracticeConcurrency } from '../../src/auto-practice/practice-queue.service.js';
import { LlmRenderAdapter, type ChatCaller } from '../../src/engine-adapters/rendering/llm-render.adapter.js';
import {
  DEFAULT_RENDER_COOLDOWN_MAX_MS,
  DEFAULT_RENDER_HALF_OPEN_AFTER_MS,
  createRenderAdapterConfig,
  type RenderAdapterConfig,
  type RenderCandidate,
} from '../../src/engine-adapters/rendering/render-adapter.config.js';
import { RenderFailoverRuntime } from '../../src/engine-adapters/rendering/render-failover.runtime.js';
import { RenderConfigFactory } from '../../src/engine-adapters/wiring/render-config.factory.js';
import type { RenderSpec, RenderTaskKind } from '../../src/engine-core/index.js';
import type { ChatCompletionResponse } from '../../src/llm/common/interfaces/chat-provider.interface.js';
import type { LlmRouterService } from '../../src/llm/registry/llm-router.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

// TD-10 · T-2: 真实 bullmq 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('bullmq', async () => {
  const { createBullmqStub } = await import('../helpers/sdk-stubs.js');
  return createBullmqStub();
});

/** 假时钟: 手动推进, 不等真实时间. */
class FakeClock {
  constructor(private current: number) {}

  readonly now = (): number => this.current;

  advance(ms: number): void {
    this.current += ms;
  }
}

/** 构造渲染配置 (走工厂, 与生产同一条构造路径). */
function buildConfig(
  candidates: readonly RenderCandidate[],
  overrides: Partial<Parameters<typeof createRenderAdapterConfig>[1]> = {},
): RenderAdapterConfig {
  return createRenderAdapterConfig(candidates, {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model' },
      advanced: { temperature: 0.85, model: 'advanced-model' },
    },
    timeoutMs: 100,
    failureThreshold: 2,
    cooldownBaseMs: 1000,
    cooldownMaxMs: DEFAULT_RENDER_COOLDOWN_MAX_MS,
    ...overrides,
  });
}

/** ConfigService stub: 按 env 表取值. */
function stubConfig(env: Record<string, string>): { get: (key: string) => string | undefined } {
  return { get: (key: string) => env[key] };
}

/** Router stub: 只回答"某候选某分层的默认模型名". */
function stubRouter(): { getDefaultModelForTier: () => string } {
  return { getDefaultModelForTier: () => 'stub-model' };
}

/** 构造一份渲染规格. */
function buildSpec(taskKind: RenderTaskKind): RenderSpec {
  return {
    taskKind,
    intention: {
      strategy: 'recounting',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: ['judge'],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.3,
    coreBeliefs: [],
    forbiddenBehaviors: ['judge'],
    recall: [],
    recentTurns: [{ role: 'counselor', text: '最近睡得怎么样？' }],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 512 },
  };
}

describe('WP-H 第一波 · 渲染可用性 (冷却 / 半开探测 / 候选校验 / 并发 / 超时中止)', () => {
  describe('① 冷却参数 (改动 2)', () => {
    it('冷却上限从 300s 降到 60s (三次抖动不再等于五分钟静默)', () => {
      expect(DEFAULT_RENDER_COOLDOWN_MAX_MS).toBe(60_000);
    });

    it('半开等待缺省 30s (冷却窗的一半)', () => {
      expect(DEFAULT_RENDER_HALF_OPEN_AFTER_MS).toBe(30_000);
    });

    it('连续失败再多, 冷却时长也不超过 60s', () => {
      const clock = new FakeClock(0);
      const config = buildConfig([{ id: 'p' }], { failureThreshold: 3, cooldownBaseMs: 30_000 });
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      for (let index = 0; index < 10; index += 1) {
        runtime.markFailure('p', config);
        clock.advance(1000);
      }

      const health = runtime.health()['p'];
      expect(health).toBeDefined();
      expect((health?.cooldownUntil ?? 0) - clock.now()).toBeLessThanOrEqual(DEFAULT_RENDER_COOLDOWN_MAX_MS);
    });
  });

  describe('② 半开探测 (改动 2)', () => {
    it('生产同构参数: 冷却窗 60s 内, 第 30s 放一次探测 (冷却期不再是全损)', () => {
      const clock = new FakeClock(0);
      // 与生产缺省同构: 基数 30s / 阈值 3 次 → 冷却 60s (封顶), 半开点 30s.
      const config = buildConfig([{ id: 'p' }], {
        failureThreshold: 3,
        cooldownBaseMs: 30_000,
        cooldownMaxMs: DEFAULT_RENDER_COOLDOWN_MAX_MS,
        halfOpenAfterMs: DEFAULT_RENDER_HALF_OPEN_AFTER_MS,
      });
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      runtime.markFailure('p', config);
      runtime.markFailure('p', config);
      runtime.markFailure('p', config);

      // 冷却中, 未到半开时点 → 无候选可用 (记一次全损兜底).
      expect(runtime.next([])).toBeNull();
      expect(runtime.stats().cooldownServed).toBe(1);

      // 推进到半开时点 → 放一次探测 (此时**仍在冷却期内**).
      clock.advance(DEFAULT_RENDER_HALF_OPEN_AFTER_MS);
      expect(runtime.health()['p']?.inCooldown).toBe(true);
      expect(runtime.next([])?.id).toBe('p');
      expect(runtime.stats().probeAttempts).toBe(1);

      // 探测在途时不再放第二个 (并发下只探一次).
      expect(runtime.next([])).toBeNull();
    });

    it('探测失败 → 冷却时长与半开间隔都翻倍', () => {
      const clock = new FakeClock(0);
      // 冷却时长 1000ms / 半开点 500ms —— 翻倍才观察得到 (生产缺省会被 60s 上限夹住).
      const config = buildConfig([{ id: 'p' }], {
        failureThreshold: 1,
        cooldownBaseMs: 1000,
        cooldownMaxMs: DEFAULT_RENDER_COOLDOWN_MAX_MS,
        halfOpenAfterMs: 500,
      });
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      runtime.markFailure('p', config);
      expect(runtime.health()['p']?.cooldownDurationMs).toBe(1000);

      clock.advance(500);
      expect(runtime.next([])?.id).toBe('p');

      runtime.markFailure('p', config);

      const health = runtime.health()['p'];
      expect(health?.cooldownDurationMs).toBe(2000);
      expect(health?.halfOpenAfterMs).toBe(1000);
      expect(health?.inCooldown).toBe(true);
    });

    it('探测失败时冷却时长翻倍但**不超过 60s 上限**', () => {
      const clock = new FakeClock(0);
      const config = buildConfig([{ id: 'p' }], {
        failureThreshold: 3,
        cooldownBaseMs: 30_000,
        cooldownMaxMs: DEFAULT_RENDER_COOLDOWN_MAX_MS,
        halfOpenAfterMs: DEFAULT_RENDER_HALF_OPEN_AFTER_MS,
      });
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      runtime.markFailure('p', config);
      runtime.markFailure('p', config);
      runtime.markFailure('p', config);
      clock.advance(DEFAULT_RENDER_HALF_OPEN_AFTER_MS);
      runtime.next([]);
      runtime.markFailure('p', config);

      const health = runtime.health()['p'];
      expect(health?.cooldownDurationMs).toBe(DEFAULT_RENDER_COOLDOWN_MAX_MS);
      expect(health?.halfOpenAfterMs).toBe(DEFAULT_RENDER_COOLDOWN_MAX_MS);
    });

    it('探测成功 → 完全恢复 (失败计数与冷却全部清零)', () => {
      const clock = new FakeClock(0);
      const config = buildConfig([{ id: 'p' }], {
        failureThreshold: 1,
        cooldownBaseMs: 1000,
        cooldownMaxMs: DEFAULT_RENDER_COOLDOWN_MAX_MS,
        halfOpenAfterMs: 500,
      });
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      runtime.markFailure('p', config);
      clock.advance(500);
      runtime.next([]);

      runtime.markSuccess('p');

      const health = runtime.health()['p'];
      expect(health?.inCooldown).toBe(false);
      expect(health?.consecutiveFailures).toBe(0);
      expect(runtime.next([])?.id).toBe('p');
    });

    it('shouldProbe 对外可查 (观测用)', () => {
      const clock = new FakeClock(0);
      const config = buildConfig([{ id: 'p' }], {
        failureThreshold: 1,
        cooldownBaseMs: 1000,
        cooldownMaxMs: DEFAULT_RENDER_COOLDOWN_MAX_MS,
        halfOpenAfterMs: 500,
      });
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      runtime.markFailure('p', config);
      expect(runtime.shouldProbe('p')).toBe(false);

      clock.advance(500);
      expect(runtime.shouldProbe('p')).toBe(true);
    });
  });

  describe('③ 候选序列校验 (改动 1)', () => {
    it('单候选 → 启动期告警 (默认不拦启动, 零回归)', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        const factory = new RenderConfigFactory(
          stubConfig({}) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
          stubRouter() as unknown as LlmRouterService,
        );

        const config = factory.build();

        expect(config.candidates).toHaveLength(1);
        expect(warn).toHaveBeenCalled();
        expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('ENGINE_RENDER_FALLBACK_PROVIDERS');
      } finally {
        warn.mockRestore();
      }
    });

    it('REQUIRE_FAILOVER=true + 单候选 → 装配期直接抛错 (别跑到一半才发现)', () => {
      const factory = new RenderConfigFactory(
        stubConfig({ ENGINE_RENDER_REQUIRE_FAILOVER: 'true' }) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
        stubRouter() as unknown as LlmRouterService,
      );

      expect(() => factory.build()).toThrow(/ENGINE_RENDER_FALLBACK_PROVIDERS/);
    });

    it('配了备候选 → 候选数 ≥2, 不告警, 也不抛错', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        const factory = new RenderConfigFactory(
          stubConfig({
            ENGINE_RENDER_PRIMARY_PROVIDER: 'minimax',
            ENGINE_RENDER_FALLBACK_PROVIDERS: 'deepseek',
            ENGINE_RENDER_REQUIRE_FAILOVER: 'true',
          }) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
          stubRouter() as unknown as LlmRouterService,
        );

        const config = factory.build();

        expect(config.candidates.map((candidate) => candidate.id)).toEqual(['minimax', 'deepseek']);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('半开等待可由 env 覆盖', () => {
      const factory = new RenderConfigFactory(
        stubConfig({ ENGINE_RENDER_HALF_OPEN_AFTER_MS: '15000' }) as unknown as ConstructorParameters<typeof RenderConfigFactory>[0],
        stubRouter() as unknown as LlmRouterService,
      );

      expect(factory.build().halfOpenAfterMs).toBe(15_000);
    });
  });

  describe('④ 批量并发 (改动 4)', () => {
    it('缺省 2 (从 3 降下来)', () => {
      expect(resolveAutoPracticeConcurrency(void 0)).toBe(2);
    });

    it('显式配 1 → 1 (金丝雀验证用串行档)', () => {
      expect(resolveAutoPracticeConcurrency('1')).toBe(1);
    });

    it('范围 1~5: 越界自动夹到边界', () => {
      expect(resolveAutoPracticeConcurrency('5')).toBe(5);
      expect(resolveAutoPracticeConcurrency('99')).toBe(5);
      expect(resolveAutoPracticeConcurrency('0')).toBe(2);
    });

    it('非法值 → 回落缺省 2 (不抛错)', () => {
      expect(resolveAutoPracticeConcurrency('')).toBe(2);
      expect(resolveAutoPracticeConcurrency('abc')).toBe(2);
      expect(resolveAutoPracticeConcurrency('-1')).toBe(2);
    });
  });

  describe('⑤ 渲染超时 → 中止上游请求 (改动 3 的"幽灵重试"解药)', () => {
    it('超时时 signal 被中止 (退避重试不会在后台继续打上游)', async () => {
      let captured: AbortSignal | undefined;
      const caller: ChatCaller = {
        chat: (_req, _providerId, signal) => {
          captured = signal;
          // 永不返回: 逼适配器走超时分支.
          return new Promise<ChatCompletionResponse>(() => {});
        },
      };

      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }], { timeoutMs: 30 }),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.providerHint).toBe('degraded');
      expect(captured, '调用方必须拿到 signal 才能中止上游').toBeDefined();
      expect(captured?.aborted).toBe(true);
    });
  });
});
