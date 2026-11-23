// AF-357 · 信念生成运行时解析 (adapter spec):
//   覆盖开工单 successCriteria 的"配置通道"部分:
//     ① 只配任一信念键 → 构造 beliefConfig，以内核 DEFAULT 为底;
//     ② 合法值原样进入内核端口;
//     ③ 非法值逐项回退内核种子并告警（布尔 / 比例 / 整数各一条，不静默吞）;
//     ④ minChars > maxChars 的自相矛盾配置 → 回退到合法区间;
//     ⑤ 缺省不配置 → beliefConfig 不出现（内核不走这一步 = 逐字零回归）.
//   边界: 纯函数；ConfigService 用最小读值替身，不读真实 env、不起 Nest 容器.
//
//   验证: pnpm exec vitest run test/engine-adapters/af357-bdi-runtime-config.spec.ts

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { resolveBdiRuntimeConfig, resolveBdiRuntimeConfigFromEnv } from '../../src/engine-adapters/wiring/bdi-runtime.config.js';
import {
  DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE,
  DEFAULT_BELIEF_FORMATION_MAX_CHARS,
  DEFAULT_BELIEF_FORMATION_MAX_PER_TURN,
  DEFAULT_BELIEF_FORMATION_MIN_CHARS,
  DEFAULT_BELIEF_FORMATION_REINFORCEMENT,
} from '../../src/engine-core/cognition/state-transition.js';

/** ConfigService 最小替身：只实现 get. */
function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get<T = string>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  } as unknown as ConfigService;
}

describe('AF-357 · ① 缺省不注入', () => {
  it('不配任何信念键 → beliefConfig undefined', () => {
    expect(resolveBdiRuntimeConfigFromEnv({}).beliefConfig).toBeUndefined();
  });

  it('信念键全为空串 → 按未配置处理', () => {
    const result = resolveBdiRuntimeConfigFromEnv({
      beliefFormationEnabled: '',
      beliefFormationBaseConfidence: ' ',
      beliefFormationReinforcement: '',
      beliefFormationMaxPerTurn: '',
      beliefFormationMinChars: '',
      beliefFormationMaxChars: '',
    });
    expect(result.beliefConfig).toBeUndefined();
  });
});

describe('AF-357 · ② 合法值进入端口', () => {
  it('只开开关 → 其余字段取内核种子', () => {
    const result = resolveBdiRuntimeConfigFromEnv({ beliefFormationEnabled: 'true' });
    expect(result.beliefConfig).toMatchObject({
      formationEnabled: true,
      formationBaseConfidence: DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE,
      formationReinforcement: DEFAULT_BELIEF_FORMATION_REINFORCEMENT,
      formationMaxPerTurn: DEFAULT_BELIEF_FORMATION_MAX_PER_TURN,
      formationMinChars: DEFAULT_BELIEF_FORMATION_MIN_CHARS,
      formationMaxChars: DEFAULT_BELIEF_FORMATION_MAX_CHARS,
    });
  });

  it('六个键全部合法 → 原样进入端口', () => {
    const result = resolveBdiRuntimeConfigFromEnv({
      beliefFormationEnabled: '1',
      beliefFormationBaseConfidence: '0.6',
      beliefFormationReinforcement: '0.2',
      beliefFormationMaxPerTurn: '3',
      beliefFormationMinChars: '4',
      beliefFormationMaxChars: '120',
    });
    expect(result.beliefConfig).toMatchObject({
      formationEnabled: true,
      formationBaseConfidence: 0.6,
      formationReinforcement: 0.2,
      formationMaxPerTurn: 3,
      formationMinChars: 4,
      formationMaxChars: 120,
    });
  });

  it('显式关闭 → formationEnabled=false（不等于不注入）', () => {
    const result = resolveBdiRuntimeConfigFromEnv({ beliefFormationEnabled: 'false' });
    expect(result.beliefConfig?.formationEnabled).toBe(false);
  });

  it('ConfigService 入口读到同名 env 键', () => {
    const result = resolveBdiRuntimeConfig(
      fakeConfig({
        ENGINE_BELIEF_FORMATION_ENABLED: 'true',
        ENGINE_BELIEF_FORMATION_BASE_CONFIDENCE: '0.5',
      }),
    );
    expect(result.beliefConfig?.formationEnabled).toBe(true);
    expect(result.beliefConfig?.formationBaseConfidence).toBe(0.5);
  });
});

describe('AF-357 · ③ 非法值逐项回退', () => {
  it('布尔 / 比例 / 整数非法 → 回退种子并逐条告警', () => {
    const warnings: string[] = [];
    const result = resolveBdiRuntimeConfigFromEnv(
      {
        beliefFormationEnabled: 'maybe',
        beliefFormationBaseConfidence: '1.5',
        beliefFormationReinforcement: '-0.2',
        beliefFormationMaxPerTurn: '2.5',
        beliefFormationMinChars: '0',
        beliefFormationMaxChars: '999',
      },
      (message) => warnings.push(message),
    );

    expect(result.beliefConfig).toMatchObject({
      formationEnabled: false,
      formationBaseConfidence: DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE,
      formationReinforcement: DEFAULT_BELIEF_FORMATION_REINFORCEMENT,
      formationMaxPerTurn: DEFAULT_BELIEF_FORMATION_MAX_PER_TURN,
      formationMinChars: DEFAULT_BELIEF_FORMATION_MIN_CHARS,
      formationMaxChars: DEFAULT_BELIEF_FORMATION_MAX_CHARS,
    });
    expect(warnings).toHaveLength(6);
  });

  it('maxPerTurn=0 是合法值（显式停生成），不告警', () => {
    const warnings: string[] = [];
    const result = resolveBdiRuntimeConfigFromEnv({ beliefFormationEnabled: 'true', beliefFormationMaxPerTurn: '0' }, (message) =>
      warnings.push(message),
    );
    expect(result.beliefConfig?.formationMaxPerTurn).toBe(0);
    expect(warnings).toHaveLength(0);
  });
});

describe('AF-357 · ④ 区间自洽', () => {
  it('minChars > 默认 maxChars → maxChars 取 max(min, 默认)，不产生倒挂区间', () => {
    const result = resolveBdiRuntimeConfigFromEnv({
      beliefFormationEnabled: 'true',
      beliefFormationMinChars: '200',
    });
    expect(result.beliefConfig?.formationMinChars).toBe(200);
    expect(result.beliefConfig?.formationMaxChars).toBe(200);
  });

  it('maxChars < minChars → 回退到合法种子（不低于 minChars）并告警', () => {
    const warnings: string[] = [];
    const result = resolveBdiRuntimeConfigFromEnv(
      { beliefFormationEnabled: 'true', beliefFormationMinChars: '20', beliefFormationMaxChars: '10' },
      (message) => warnings.push(message),
    );
    expect(result.beliefConfig?.formationMinChars).toBe(20);
    // 回退值 = max(minChars, 默认 80) = 80，区间仍自洽; 不接受 10 这种倒挂值.
    expect(result.beliefConfig?.formationMaxChars).toBe(80);
    expect(warnings.some((message) => message.includes('ENGINE_BELIEF_FORMATION_MAX_CHARS'))).toBe(true);
  });
});
