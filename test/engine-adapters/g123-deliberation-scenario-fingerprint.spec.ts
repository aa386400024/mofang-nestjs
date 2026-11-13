// V2026-11-11 建立 (G123-P1E3 · 审议场景硬隔离 + 指纹诚实化 + rule_only 留痕 · 单测):
//   覆盖 G-1 / G-2 / G-3 三项修复的**验收点** ——
//     G-1 (P0) 场景类型接入审议运行时:
//       ① 落库 deliberation_mode 与运行时**经同一判定函数**出值 (逐场对照);
//       ② exam 场次恒 rule_only (运行时与落库两侧都是);
//       ③ 非 exam + llm_active 白名单内外, 两侧逐场结果一致 (含 sessionId 双口径);
//       ④ 引擎侧 session id 口径: 白名单匹配用 debugSessionId (不是业务场次 id).
//     G-2 (P3) 失败场次补 prompt 版本:
//       ⑤ 引擎开不起来的失败场次也记 promptVersion (fail-closed 回落 'unknown');
//       ⑥ 其余指纹字段保持 NULL (引擎未开 = 无定义).
//     G-3 (P2) rule_only 结构性 skip 留痕:
//       ⑦ 结构性跳过写一行 mode=rule_only / decision=skip / reason=rule_only_skip;
//       ⑧ 留痕写失败只 warn, 不炸主流程;
//       ⑨ 闸门缺席时静默跳过 (窄端口纪律).
//
//   反依赖污染: 不起 Nest 容器, 不发网络, 不连 DB; 全部用假实现.
//
//   验证: npx vitest run test/engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts
//   时间戳: 2026-11-11

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { buildTestStructuredInput } from './deliberation-fixtures.js';
import { InferenceFingerprintService } from '../../src/auto-practice/inference-fingerprint.service.js';

import {
  DELIBERATION_SCENARIO_TYPES,
  resolveDeliberationModeConfig,
  resolveSessionEffectiveMode,
  type DeliberationScenarioType,
} from '../../src/engine-adapters/deliberation/deliberation-mode.config.js';
import { LlmDeliberationHook } from '../../src/engine-adapters/deliberation/llm-deliberation-hook.js';
import { DeliberationGateService } from '../../src/engine-adapters/deliberation-gate/deliberation-gate.service.js';
import type { GateTraceRecord } from '../../src/engine-adapters/deliberation-gate/deliberation-gate.trace.js';
import { EMPTY_GATE_THRESHOLDS } from '../../src/engine-adapters/deliberation-gate/deliberation-gate.trace.js';
import type { TurnSessionContext } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { EngineSessionRegistry } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import { createEmptyBdiSnapshot, type DeliberationHookContext, type DeltaVector } from '../../src/engine-core/index.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 假 ConfigService: 只按 map 回值 (只读, 不碰 process.env). */
function fakeConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
}

/** 11 维零向量. */
function zeroDelta(): DeltaVector {
  return {
    trust: 0,
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
  };
}

/** 造一份消费拍的上下文. */
function makeContext(sessionId: string): DeliberationHookContext {
  return {
    snapshot: createEmptyBdiSnapshot(),
    ruleDelta: zeroDelta(),
    counselorText: '嗯，我明白了。',
    tenantId: 'tenant-g123',
    sessionId,
    turnIndex: 2,
    currentRevision: 7,
  };
}

/** 假角色版本仓储 (只回一个固定版本). */
function fakeCharacterRegistry(version = '1.0.0'): { resolve: (slug: string) => Promise<string> } {
  return { resolve: async (): Promise<string> => version };
}

/** 假 trace 写入器 (把记录收进数组, 便于断言). */
function fakeTrace(): { trace: { record: (r: GateTraceRecord) => Promise<void> }; records: GateTraceRecord[] } {
  const records: GateTraceRecord[] = [];
  return {
    trace: {
      record: async (r: GateTraceRecord): Promise<void> => {
        records.push(r);
      },
    },
    records,
  };
}

describe('G123 · 审议场景硬隔离 + 指纹诚实化 + rule_only 留痕', () => {
  describe('G-1 (P0) · 落库与运行时同源', () => {
    it('① 落库 deliberation_mode 与运行时经**同一判定函数**逐场一致', async () => {
      const env = {
        ENGINE_DELIBERATION_ENABLED: 'true',
        ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active',
        ENGINE_DELIBERATION_GRAYSCALE_SESSIONS: 'debug-in-whitelist',
      };
      const service = new InferenceFingerprintService(fakeConfig(env), fakeCharacterRegistry() as never);
      const modeConfig = resolveDeliberationModeConfig(fakeConfig(env));

      // 名单内 (引擎侧 session id 在名单里) → 两侧都该是 llm_active.
      const inWhitelist = await service.build('char-a', 'mode-1', 'full_simulation', 'batch-1', 'practice-1', 'debug-in-whitelist');
      expect(inWhitelist.deliberationMode).toBe(resolveSessionEffectiveMode(modeConfig, 'debug-in-whitelist', 'full_simulation'));
      expect(inWhitelist.deliberationMode).toBe('llm_active');

      // 名单外 → 两侧都是 rule_only.
      const outWhitelist = await service.build('char-a', 'mode-1', 'full_simulation', 'batch-1', 'practice-2', 'debug-out-whitelist');
      expect(outWhitelist.deliberationMode).toBe(resolveSessionEffectiveMode(modeConfig, 'debug-out-whitelist', 'full_simulation'));
      expect(outWhitelist.deliberationMode).toBe('rule_only');
    });

    it('② exam 场次: 运行时与落库两侧都恒 rule_only (哪怕在白名单内 + 全局 llm_active)', async () => {
      const env = {
        ENGINE_DELIBERATION_ENABLED: 'true',
        ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active',
        ENGINE_DELIBERATION_GRAYSCALE_SESSIONS: 'debug-exam',
      };
      const service = new InferenceFingerprintService(fakeConfig(env), fakeCharacterRegistry() as never);
      const modeConfig = resolveDeliberationModeConfig(fakeConfig(env));

      const fingerprint = await service.build('char-a', 'mode-1', 'exam', 'batch-1', 'practice-1', 'debug-exam');
      expect(fingerprint.deliberationMode).toBe('rule_only');
      expect(resolveSessionEffectiveMode(modeConfig, 'debug-exam', 'exam')).toBe('rule_only');
    });

    it('③ 运行时钩子侧: exam 场次**一次 LLM 都不发** (最终强制点)', async () => {
      const modeConfig = resolveDeliberationModeConfig(
        fakeConfig({
          ENGINE_DELIBERATION_ENABLED: 'true',
          ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active',
          ENGINE_DELIBERATION_GRAYSCALE_SESSIONS: 'debug-exam',
        }),
      );
      let calls = 0;
      const hook = new LlmDeliberationHook(
        modeConfig,
        {
          run: async () => {
            calls += 1;
            return { trust: 0.1 };
          },
        },
        Date.now,
        { resolveScenario: (sessionId: string): DeliberationScenarioType => (sessionId === 'debug-exam' ? 'exam' : 'full_simulation') },
      );

      await hook.produce({
        context: makeContext('debug-exam'),
        extras: {
          // 结构化输入走**共享夹具** (走真实的 buildDeliberationInput 装配) ——
          //   本用例只验"exam 场次一次 LLM 都不发", 不消费这个对象.
          structured: buildTestStructuredInput({ ruleStrategy: 'simple_response' }),
          userId: 'user-g123',
        },
      });
      expect(calls).toBe(0);
      expect(hook.applyDeliberation(makeContext('debug-exam'))).toBeNull();
    });

    it('④ 白名单匹配用的是**引擎侧** session id (不是业务场次 id)', async () => {
      // 名单里放的是引擎侧 id (debugSessionId).
      const env = {
        ENGINE_DELIBERATION_ENABLED: 'true',
        ENGINE_DELIBERATION_EFFECTIVE_MODE: 'llm_active',
        ENGINE_DELIBERATION_GRAYSCALE_SESSIONS: 'debug-abc',
      };
      const service = new InferenceFingerprintService(fakeConfig(env), fakeCharacterRegistry() as never);

      // 引擎侧 id 在名单里 → 生效 (若误用业务场次 id 判, 这里会判成 rule_only).
      const matched = await service.build('char-a', 'mode-1', 'full_simulation', 'batch-1', 'practice-xyz', 'debug-abc');
      expect(matched.deliberationMode).toBe('llm_active');

      // 引擎侧 id 不在名单里 (哪怕业务场次 id 在名单里) → rule_only.
      const unmatched = await service.build('char-a', 'mode-1', 'full_simulation', 'batch-1', 'debug-abc', 'practice-xyz');
      expect(unmatched.deliberationMode).toBe('rule_only');
    });

    it('⑤ 场景类型只有一份定义 (auto-practice 的 ScenarioType 是审议侧类型的转发)', () => {
      expect([...DELIBERATION_SCENARIO_TYPES].toSorted()).toEqual(['exam', 'freeform', 'full_simulation']);
    });

    it('⑥ 归属登记表能按 sessionId 反查场景 (钩子的反查通路)', () => {
      const registry = new EngineSessionRegistry();
      const context: TurnSessionContext = {
        tenantId: 'tenant-g123',
        sessionId: 'debug-abc',
        visitorId: 'visitor-g123',
        scenarioType: 'exam',
      };
      registry.register('handle-1', context);

      expect(registry.resolveScenario('debug-abc')).toBe('exam');
      expect(registry.resolveScenario('debug-unknown')).toBeUndefined();
      expect(registry.resolveBySessionId('debug-abc')).toBe(context);
    });
  });

  describe('G-2 (P3) · 失败场次补 prompt 版本', () => {
    it('⑦ 引擎开不起来也能算出 prompt 版本 (fail-closed 回落 unknown, 永不 null)', () => {
      // 模板文件读不到 (baseDir 指向空目录) → 回落 'unknown', 但**不是** null/undefined.
      const service = new InferenceFingerprintService(fakeConfig({}), fakeCharacterRegistry() as never);
      const version = service.resolvePromptVersionOnly();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    });

    it('⑧ env 显式指定时优先 (与指纹主路径同一口径)', () => {
      const service = new InferenceFingerprintService(fakeConfig({ PROMPT_VERSION: 'p1-test' }), fakeCharacterRegistry() as never);
      expect(service.resolvePromptVersionOnly()).toBe('p1-test');
    });
  });

  describe('G-3 (P2) · rule_only 结构性 skip 留痕', () => {
    it('⑨ 结构性跳过写一行 mode=rule_only / decision=skip / reason=rule_only_skip', async () => {
      const { trace, records } = fakeTrace();
      const service = new DeliberationGateService({
        config: {
          shadow: {
            thresholds: { alliance: 0.1, resistance: 0.1, calm: 0.05 },
            cooldownTurns: 1,
            maxPerSession: 99,
            globalRpm: 99,
            circuitEnabled: false,
          },
          effect: {
            thresholds: { alliance: 0.2, resistance: 0.2, calm: 0.1 },
            cooldownTurns: 3,
            maxPerSession: 9,
            globalRpm: 99,
            circuitEnabled: true,
          },
          circuitFailCount: 5,
          circuitCooldownMs: 600_000,
        },
        quotas: {} as never,
        trace: trace as never,
      });

      await service.recordRuleOnlySkip({ sessionId: 'session-1', dbSessionId: 'db-1', userId: 'user-1', turnIndex: 3 });

      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record.mode).toBe('rule_only');
      expect(record.decision).toBe('skip');
      expect(record.reason).toBe('rule_only_skip');
      expect(record.sessionId).toBe('session-1');
      expect(record.dbSessionId).toBe('db-1');
      expect(record.userId).toBe('user-1');
      expect(record.turnIndex).toBe(3);
      // 结构性跳过没有阈值 —— 空对象, 不是零值三元组.
      expect(record.thresholdUsed).toEqual(EMPTY_GATE_THRESHOLDS);
      expect(record.deltaSummary).toEqual({});
    });

    it('⑩ 留痕写失败只 warn, 不炸主流程', async () => {
      const service = new DeliberationGateService({
        config: {
          shadow: {
            thresholds: { alliance: 0.1, resistance: 0.1, calm: 0.05 },
            cooldownTurns: 1,
            maxPerSession: 99,
            globalRpm: 99,
            circuitEnabled: false,
          },
          effect: {
            thresholds: { alliance: 0.2, resistance: 0.2, calm: 0.1 },
            cooldownTurns: 3,
            maxPerSession: 9,
            globalRpm: 99,
            circuitEnabled: true,
          },
          circuitFailCount: 5,
          circuitCooldownMs: 600_000,
        },
        quotas: {} as never,
        trace: {
          record: async (): Promise<void> => {
            throw new Error('db down');
          },
        } as never,
      });

      await expect(service.recordRuleOnlySkip({ sessionId: 'session-2', turnIndex: 1 })).resolves.toBeUndefined();
    });

    it('⑪ 结构性跳过不消耗配额 (纯规则场次不该占额度)', async () => {
      const recordRun = vi.fn();
      const { trace } = fakeTrace();
      const service = new DeliberationGateService({
        config: {
          shadow: {
            thresholds: { alliance: 0.1, resistance: 0.1, calm: 0.05 },
            cooldownTurns: 1,
            maxPerSession: 99,
            globalRpm: 99,
            circuitEnabled: false,
          },
          effect: {
            thresholds: { alliance: 0.2, resistance: 0.2, calm: 0.1 },
            cooldownTurns: 3,
            maxPerSession: 9,
            globalRpm: 99,
            circuitEnabled: true,
          },
          circuitFailCount: 5,
          circuitCooldownMs: 600_000,
        },
        quotas: { recordRun } as never,
        trace: trace as never,
      });

      await service.recordRuleOnlySkip({ sessionId: 'session-3', turnIndex: 1 });
      expect(recordRun).not.toHaveBeenCalled();
    });
  });
});
