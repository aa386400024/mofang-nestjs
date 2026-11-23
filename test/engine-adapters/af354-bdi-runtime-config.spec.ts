// AF-354 · BDI 运行时开关解析 (adapter spec):
//   覆盖开工单 successCriteria 的"启用通道"部分:
//     ① 不配任何键 → 三族配置都不出现（内核不走那一步 = 逐字零回归）;
//     ② 三族分别可配，数值原样进入内核端口;
//     ③ 非法值逐项回退内核种子并告警（不是照着越界值装配）;
//     ④ timing kind=none / 枚举外 → 不注入（等价于不折损）;
//     ⑤ 内核意图锁解析与审议侧共用同一口径（isKernelIntentionLockEnabled）.
//   边界: 纯函数；ConfigService 用最小读值替身，不起 Nest 容器、不读真实 env.
//
//   验证: pnpm exec vitest run test/engine-adapters/af354-bdi-runtime-config.spec.ts

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import {
  isKernelIntentionLockEnabled,
  resolveBdiRuntimeConfigFromEnv,
  type BdiRuntimeConfigEnv,
} from '../../src/engine-adapters/wiring/bdi-runtime.config.js';

/** ConfigService 最小替身：只实现 get. */
function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get<T = string>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  } as unknown as ConfigService;
}

describe('AF-354 · ① 缺省不注入', () => {
  it('空 env → 三族配置全部 undefined', () => {
    const result = resolveBdiRuntimeConfigFromEnv({});
    expect(result.desireEvolutionConfig).toBeUndefined();
    expect(result.intentionLockConfig).toBeUndefined();
    expect(result.timingWeightConfig).toBeUndefined();
  });

  it('空串按未配置处理（不是"配了个空值"）', () => {
    const env: BdiRuntimeConfigEnv = {
      desireEvolutionEnabled: '',
      desireMaxDeltaPerTurn: '  ',
      intentionLockEnabled: '',
      timingWeightKind: '',
    };
    const result = resolveBdiRuntimeConfigFromEnv(env);
    expect(result.desireEvolutionConfig).toBeUndefined();
    expect(result.intentionLockConfig).toBeUndefined();
    expect(result.timingWeightConfig).toBeUndefined();
  });
});

describe('AF-354 · ② 三族可配', () => {
  it('愿望演化：开关 + 四个数值原样进入端口', () => {
    const result = resolveBdiRuntimeConfigFromEnv({
      desireEvolutionEnabled: 'true',
      desireMaxDeltaPerTurn: '0.05',
      desireBaselinePullPerTurn: '0.02',
      desireSituationalTtlTurns: '4',
      desireSituationalPriorityFloor: '0.5',
    });
    expect(result.desireEvolutionConfig).toEqual({
      enabled: true,
      maxUnderlyingDeltaPerTurn: 0.05,
      baselinePullPerTurn: 0.02,
      situationalTtlTurns: 4,
      situationalPriorityFloor: 0.5,
    });
  });

  it('意图锁：开关 + TTL 原样进入端口', () => {
    const result = resolveBdiRuntimeConfigFromEnv({ intentionLockEnabled: '1', intentionLockTtlTurns: '5' });
    expect(result.intentionLockConfig).toEqual({ enabled: true, ttlTurns: 5 });
  });

  it('时序权重：window 形态 + 合法参数进入端口', () => {
    const result = resolveBdiRuntimeConfigFromEnv({
      timingWeightKind: 'window',
      timingWeightSlope: '0.2',
      timingWeightWindowTurns: '4',
    });
    expect(result.timingWeightConfig).toEqual({ kind: 'window', slope: 0.2, windowTurns: 4 });
  });

  it('ConfigService 入口与纯函数口径一致', () => {
    const result = resolveBdiRuntimeConfigFromEnv({ intentionLockEnabled: 'yes' });
    expect(result.intentionLockConfig?.enabled).toBe(true);
    expect(isKernelIntentionLockEnabled(fakeConfig({ ENGINE_INTENTION_LOCK_ENABLED: 'yes' }))).toBe(true);
    expect(isKernelIntentionLockEnabled(fakeConfig({ ENGINE_INTENTION_LOCK_ENABLED: 'false' }))).toBe(false);
    expect(isKernelIntentionLockEnabled(fakeConfig({}))).toBe(false);
  });
});

describe('AF-354 · ③ 非法值逐项回退并告警', () => {
  it('布尔 / 数值 / 轮次非法 → 回退内核种子，且给出对应告警', () => {
    const warnings: string[] = [];
    const result = resolveBdiRuntimeConfigFromEnv(
      {
        desireEvolutionEnabled: 'maybe',
        desireMaxDeltaPerTurn: '1.5',
        desireBaselinePullPerTurn: '-0.1',
        desireSituationalTtlTurns: '3.5',
        desireSituationalPriorityFloor: 'NaN',
      },
      (message) => warnings.push(message),
    );

    expect(result.desireEvolutionConfig).toEqual({
      enabled: false,
      maxUnderlyingDeltaPerTurn: 0.02,
      baselinePullPerTurn: 0.01,
      situationalTtlTurns: 3,
      situationalPriorityFloor: 0.4,
    });
    // 五个键都非法 → 五条告警（一条都不许静默吞掉）.
    expect(warnings).toHaveLength(5);
  });

  it('意图锁 TTL 越界 → 回退 3，开关仍按合法值生效', () => {
    const warnings: string[] = [];
    const result = resolveBdiRuntimeConfigFromEnv({ intentionLockEnabled: 'true', intentionLockTtlTurns: '99' }, (message) =>
      warnings.push(message),
    );
    expect(result.intentionLockConfig).toEqual({ enabled: true, ttlTurns: 3 });
    expect(warnings).toHaveLength(1);
  });
});

describe('AF-354 · ④ 时序权重形态', () => {
  it('kind=none → 不注入（等价于不折损）', () => {
    const result = resolveBdiRuntimeConfigFromEnv({ timingWeightKind: 'none' });
    expect(result.timingWeightConfig).toBeUndefined();
  });

  it('枚举外的 kind → 不注入并告警（不退化成某种折损曲线）', () => {
    const warnings: string[] = [];
    const result = resolveBdiRuntimeConfigFromEnv({ timingWeightKind: 'decay' }, (message) => warnings.push(message));
    expect(result.timingWeightConfig).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('合法 kind + slope=0 → slope 回退正数种子（0 不能把整条曲线压死）', () => {
    const result = resolveBdiRuntimeConfigFromEnv({ timingWeightKind: 'linear_decay', timingWeightSlope: '0' });
    expect(result.timingWeightConfig?.slope).toBe(0.1);
  });
});
