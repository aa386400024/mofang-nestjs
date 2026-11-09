// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · 纯判定单测):
//   目的: 把任务单 §2.2 的八步决策流程**逐条钉死** —— 哪一步命中、给什么理由、跑还是不跑.
//
//   为什么判定能不起 Redis 就测:
//     闸门的 IO 层 (quotas.ts) 只读数字, **一个比较都不做**; 比较全在 evaluator.ts 的纯函数里.
//     于是整条流程可以整段单测 —— 而 Redis 抖动时的降级方向也一眼可见
//     (读失败 → 数字取最宽松缺省 → 判定自然放行).
//
//   边界: 纯函数 + 纯配置解析; 不起 Nest 容器, 不连 Redis, 不发网络.
//
//   验证: npx vitest run test/engine-adapters/deliberation-gate/

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { DELIBERATION_RULE_ALIGNED_TAGS } from '../../../src/engine-adapters/deliberation/deliberation-types.js';
import {
  GATE_UNLIMITED,
  resolveDeliberationGateConfig,
  DEFAULT_GATE_ALLIANCE_THRESHOLD_EFFECT,
  DEFAULT_GATE_ALLIANCE_THRESHOLD_SHADOW,
  DEFAULT_GATE_CALM_THRESHOLD_SHADOW,
  DEFAULT_GATE_CIRCUIT_COOLDOWN_MS,
  DEFAULT_GATE_CIRCUIT_FAIL_COUNT,
  DEFAULT_GATE_COOLDOWN_TURNS_EFFECT,
  DEFAULT_GATE_COOLDOWN_TURNS_SHADOW,
  DEFAULT_GATE_GLOBAL_RPM,
  DEFAULT_GATE_MAX_PER_SESSION_EFFECT,
  DEFAULT_GATE_RESISTANCE_THRESHOLD_EFFECT,
  DEFAULT_GATE_RESISTANCE_THRESHOLD_SHADOW,
} from '../../../src/engine-adapters/deliberation-gate/deliberation-gate.config.js';
import {
  GATE_ALLIANCE_DIMS,
  GATE_KEY_EVENT_TAGS,
  GATE_RESISTANCE_DIMS,
  computeGateDeltaSummary,
  evaluateGate,
  hasGateKeyEvent,
  isRuleConfidentEvent,
} from '../../../src/engine-adapters/deliberation-gate/deliberation-gate.evaluator.js';
import type { GateInput, GateMode, GateRuntimeState } from '../../../src/engine-adapters/deliberation-gate/deliberation-gate.types.js';
import { createEmptyBdiSnapshot } from '../../../src/engine-core/index.js';
import type { BdiSnapshot } from '../../../src/engine-core/index.js';

/** 假配置服务 (只认 env 表). */
function fakeConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
}

/**
 * 造一份输入 (缺省 = 第 5 轮 / 低风险 / 常规共情 / 状态没动).
 *
 * @param overrides 要改的字段
 * @returns 闸门输入
 */
function buildInput(overrides: Partial<GateInput> = {}): GateInput {
  const stateBefore = overrides.stateBefore ?? createEmptyBdiSnapshot();
  return {
    sessionId: 'session-1',
    turnIndex: 5,
    stateBefore,
    stateAfter: overrides.stateAfter ?? stateBefore,
    events: ['empathy'],
    safety: { riskLevel: 'low' },
    mode: 'effect',
    ...overrides,
  };
}

/**
 * 造一份运行时状态 (缺省 = 从没跑过 / 没超配额 / 没熔断).
 *
 * @param overrides 要改的字段
 * @returns 运行时状态
 */
function buildRuntime(overrides: Partial<GateRuntimeState> = {}): GateRuntimeState {
  return {
    lastTurn: null,
    sessionRunCount: 0,
    globalRunCount: 0,
    circuitOpen: false,
    ...overrides,
  };
}

/**
 * 走一次判定 (用缺省配置).
 *
 * @param inputOverrides 输入的改动
 * @param runtimeOverrides 运行时状态的改动
 * @param mode 模式
 * @returns 判定结果
 */
function decide(inputOverrides: Partial<GateInput> = {}, runtimeOverrides: Partial<GateRuntimeState> = {}, mode: GateMode = 'effect') {
  const config = resolveDeliberationGateConfig(fakeConfig({}));
  const policy = mode === 'effect' ? config.effect : config.shadow;
  return evaluateGate({
    input: buildInput({ ...inputOverrides, mode }),
    runtime: buildRuntime(runtimeOverrides),
    policy,
  });
}

/**
 * 造一份只改了某几个字段的快照.
 *
 * @param overrides 要改的字段
 * @returns 快照
 */
function snapshotWith(overrides: Partial<BdiSnapshot>): BdiSnapshot {
  return { ...createEmptyBdiSnapshot(), ...overrides };
}

describe('WP-C · 触发式审议闸门 · 纯判定', () => {
  describe('① 硬红线: 危机轮次永远不跑', () => {
    it('high 风险 → skip(crisis_skip)', () => {
      const result = decide({ safety: { riskLevel: 'high' } });
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('crisis_skip');
    });

    it('medium 风险 (危机意念层) → skip(crisis_skip)', () => {
      const result = decide({ safety: { riskLevel: 'medium' } });
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('crisis_skip');
    });

    it('危机优先于首轮基线 (① 在 ② 之前)', () => {
      const result = decide({ turnIndex: 1, safety: { riskLevel: 'high' } });
      expect(result.reason).toBe('crisis_skip');
    });

    it('危机优先于关键事件硬触发 (① 在 ③ 之前)', () => {
      const result = decide({ events: ['boundary_cross'], safety: { riskLevel: 'high' } });
      expect(result.reason).toBe('crisis_skip');
    });
  });

  describe('② 首轮强制跑 (建立基线)', () => {
    it('turnIndex === 1 → run(first_turn_baseline)', () => {
      const result = decide({ turnIndex: 1 });
      expect(result.decision).toBe('run');
      expect(result.reason).toBe('first_turn_baseline');
    });

    it('首轮不受冷却/配额限制', () => {
      const result = decide({ turnIndex: 1 }, { lastTurn: 1, sessionRunCount: 99, globalRunCount: 99, circuitOpen: true });
      expect(result.decision).toBe('run');
      expect(result.reason).toBe('first_turn_baseline');
    });
  });

  describe('③ 关键事件硬触发 (越界 / 评判 / 触碰敏感议题)', () => {
    for (const tag of ['boundary_cross', 'judgment', 'sensitive_touch'] as const) {
      it(`${tag} → run(key_event)`, () => {
        const result = decide({ events: [tag] });
        expect(result.decision).toBe('run');
        expect(result.reason).toBe('key_event');
      });
    }

    it('关键事件硬触发不受冷却限制 (③ 在 ④ 之前)', () => {
      const result = decide({ events: ['judgment'] }, { lastTurn: 4 });
      expect(result.reason).toBe('key_event');
    });

    it('关键事件清单映射到内核既有事件口径 (不另立一套标签)', () => {
      expect(GATE_KEY_EVENT_TAGS).toEqual(['boundary_cross', 'judgment', 'sensitive_touch']);
      for (const tag of GATE_KEY_EVENT_TAGS) {
        expect(DELIBERATION_RULE_ALIGNED_TAGS).toContain(tag);
      }
    });

    it('hasGateKeyEvent 对普通共情不触发', () => {
      expect(hasGateKeyEvent(['empathy'])).toBe(false);
      expect(hasGateKeyEvent(['boundary_cross'])).toBe(true);
    });
  });

  describe('④ 冷却', () => {
    it('距上次跑 1 轮 → skip(cooldown)', () => {
      const result = decide({ turnIndex: 5 }, { lastTurn: 4 });
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('cooldown');
    });

    it('距上次跑 5 轮 (> 冷却 4) → 不再冷却', () => {
      const result = decide({ turnIndex: 9 }, { lastTurn: 4 });
      expect(result.reason).not.toBe('cooldown');
    });

    it('影子模式冷却 1 轮 (隔一轮跑一次)', () => {
      const blocked = decide({ turnIndex: 5 }, { lastTurn: 4 }, 'shadow');
      expect(blocked.reason).toBe('cooldown');
      const allowed = decide({ turnIndex: 6 }, { lastTurn: 4 }, 'shadow');
      expect(allowed.reason).not.toBe('cooldown');
    });

    it('从没跑过 (lastTurn = null) → 不在冷却里', () => {
      const result = decide({ turnIndex: 5 }, { lastTurn: null });
      expect(result.reason).not.toBe('cooldown');
    });
  });

  describe('⑤ 配额', () => {
    it('本会话已跑满 6 次 → skip(quota_exceeded)', () => {
      const result = decide({}, { sessionRunCount: DEFAULT_GATE_MAX_PER_SESSION_EFFECT });
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('quota_exceeded');
    });

    it('全局本分钟已跑满 20 次 → skip(quota_exceeded)', () => {
      const result = decide({}, { globalRunCount: DEFAULT_GATE_GLOBAL_RPM });
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('quota_exceeded');
    });

    it('影子模式不限配额 (会话次数与全局 RPM 都是哨兵值)', () => {
      const result = decide({}, { sessionRunCount: 999, globalRunCount: 999 }, 'shadow');
      expect(result.reason).not.toBe('quota_exceeded');
    });
  });

  describe('⑥ 熔断 (仅生效模式)', () => {
    it('熔断中 → skip(circuit_open)', () => {
      const result = decide({}, { circuitOpen: true });
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('circuit_open');
    });

    it('影子模式不看熔断状态', () => {
      const result = decide({}, { circuitOpen: true }, 'shadow');
      expect(result.reason).not.toBe('circuit_open');
    });
  });

  describe('⑦ 不确定性评估 (规则算不准才跑)', () => {
    it('LLM 专属标签 (规则算不准) → run(unknown_event_type)', () => {
      const result = decide({ events: ['micro_expression'] });
      expect(result.decision).toBe('run');
      expect(result.reason).toBe('unknown_event_type');
    });

    it('内核 neutral (规则一条都没命中) → run(unknown_event_type)', () => {
      const result = decide({ events: ['neutral'] });
      expect(result.decision).toBe('run');
      expect(result.reason).toBe('unknown_event_type');
    });

    it('同盟三维 delta 超阈值 → run(alliance_delta_high)', () => {
      const before = createEmptyBdiSnapshot();
      const after = snapshotWith({ trust: before.trust + 0.1 });
      const result = decide({ stateBefore: before, stateAfter: after });
      expect(result.decision).toBe('run');
      expect(result.reason).toBe('alliance_delta_high');
    });

    it('阻抗三维 delta 超阈值 → run(resistance_delta_high)', () => {
      const before = createEmptyBdiSnapshot();
      const after = snapshotWith({ resistance: { ...before.resistance, verbal: before.resistance.verbal + 0.2 } });
      const result = decide({ stateBefore: before, stateAfter: after });
      expect(result.decision).toBe('run');
      expect(result.reason).toBe('resistance_delta_high');
    });

    it('全平静 (所有维度都没动) → skip(calm_turn)', () => {
      const before = createEmptyBdiSnapshot();
      const result = decide({ stateBefore: before, stateAfter: before });
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('calm_turn');
    });

    it('常规 empathic + 中等变化 → skip(rule_confident)', () => {
      const before = createEmptyBdiSnapshot();
      const after = snapshotWith({ trust: before.trust + 0.04 });
      const result = decide({ events: ['empathy'], stateBefore: before, stateAfter: after });
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('rule_confident');
    });

    it('规则置信清单 = WP63 的规则对齐标签 (不复制一份)', () => {
      expect(isRuleConfidentEvent('empathy')).toBe(true);
      expect(isRuleConfidentEvent('micro_expression')).toBe(false);
      expect(isRuleConfidentEvent('neutral')).toBe(false);
    });

    it('同盟三维 / 阻抗三维就是 11 维里的那 6 个', () => {
      expect(GATE_ALLIANCE_DIMS).toEqual(['trust', 'safety', 'bond']);
      expect(GATE_RESISTANCE_DIMS).toEqual(['verbal', 'depth', 'style']);
    });

    it('delta 摘要是 11 维全量 (观测用)', () => {
      const before = createEmptyBdiSnapshot();
      const summary = computeGateDeltaSummary(before, before);
      expect(Object.keys(summary)).toHaveLength(11);
      expect(summary.trust).toBe(0);
    });
  });

  describe('配置解析 (env → 策略)', () => {
    it('缺省值 = 任务单 §2.1 参数表', () => {
      const config = resolveDeliberationGateConfig(fakeConfig({}));
      expect(config.effect.thresholds.alliance).toBe(DEFAULT_GATE_ALLIANCE_THRESHOLD_EFFECT);
      expect(config.shadow.thresholds.alliance).toBe(DEFAULT_GATE_ALLIANCE_THRESHOLD_SHADOW);
      expect(config.effect.thresholds.resistance).toBe(DEFAULT_GATE_RESISTANCE_THRESHOLD_EFFECT);
      expect(config.shadow.thresholds.resistance).toBe(DEFAULT_GATE_RESISTANCE_THRESHOLD_SHADOW);
      expect(config.shadow.thresholds.calm).toBe(DEFAULT_GATE_CALM_THRESHOLD_SHADOW);
      expect(config.effect.cooldownTurns).toBe(DEFAULT_GATE_COOLDOWN_TURNS_EFFECT);
      expect(config.shadow.cooldownTurns).toBe(DEFAULT_GATE_COOLDOWN_TURNS_SHADOW);
      expect(config.effect.maxPerSession).toBe(DEFAULT_GATE_MAX_PER_SESSION_EFFECT);
      expect(config.effect.globalRpm).toBe(DEFAULT_GATE_GLOBAL_RPM);
      expect(config.circuitFailCount).toBe(DEFAULT_GATE_CIRCUIT_FAIL_COUNT);
      expect(config.circuitCooldownMs).toBe(DEFAULT_GATE_CIRCUIT_COOLDOWN_MS);
      // 影子模式: 不限配额 / 不熔断.
      expect(config.shadow.maxPerSession).toBe(GATE_UNLIMITED);
      expect(config.shadow.globalRpm).toBe(GATE_UNLIMITED);
      expect(config.shadow.circuitEnabled).toBe(false);
      expect(config.effect.circuitEnabled).toBe(true);
    });

    it('env 覆盖生效', () => {
      const config = resolveDeliberationGateConfig(
        fakeConfig({
          ENGINE_DELIBERATION_GATE_ALLIANCE_THRESHOLD_EFFECT: '0.2',
          ENGINE_DELIBERATION_GATE_COOLDOWN_EFFECT: '7',
          ENGINE_DELIBERATION_GATE_MAX_PER_SESSION_EFFECT: '2',
          ENGINE_DELIBERATION_GATE_CIRCUIT_FAIL_COUNT: '9',
        }),
      );
      expect(config.effect.thresholds.alliance).toBe(0.2);
      expect(config.effect.cooldownTurns).toBe(7);
      expect(config.effect.maxPerSession).toBe(2);
      expect(config.circuitFailCount).toBe(9);
    });

    it('非法值一律回退缺省 (不抛错)', () => {
      const config = resolveDeliberationGateConfig(
        fakeConfig({
          ENGINE_DELIBERATION_GATE_ALLIANCE_THRESHOLD_EFFECT: 'abc',
          ENGINE_DELIBERATION_GATE_COOLDOWN_EFFECT: '-3',
          ENGINE_DELIBERATION_GATE_CIRCUIT_FAIL_COUNT: '0',
        }),
      );
      expect(config.effect.thresholds.alliance).toBe(DEFAULT_GATE_ALLIANCE_THRESHOLD_EFFECT);
      expect(config.effect.cooldownTurns).toBe(DEFAULT_GATE_COOLDOWN_TURNS_EFFECT);
      expect(config.circuitFailCount).toBe(DEFAULT_GATE_CIRCUIT_FAIL_COUNT);
    });
  });
});
