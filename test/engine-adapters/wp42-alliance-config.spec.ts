// V2026-11-03 WP42 (B 层 · 咨询同盟三维系数装配):
//   职责: 钉死"env → AllianceConfig 端口"这条装配链 ——
//     ① 25 个键逐个读, 没配 env → 装配结果与内核种子值逐字一致;
//     ② 系数覆写真的按 env 生效, 且**按维度**生效 (只配 safety 时 bond 仍走基础值);
//     ③ 非法值 (空串 / 非数字 / 门槛不在 [0,1]) 一律不覆写 = 回退内核种子值;
//     ④ 没配的键**不产生覆写项** (端口里不留空壳条目).
//
//   为什么这层要有单测:
//     env 解析是**纯配置层**, 但它决定同盟三维的系数与门槛 —— 而 env 默认在测试环境
//     是**没配**的, 所以"配错"这条路径在别的套件里根本走不到, 只能在这里显式造出来.
//
//   边界: 不起 Nest 容器 (ConfigService 用手写桩); 不连 Redis / DB / 网络.
//
//   验证: npx vitest run test/engine-adapters/wp42-alliance-config.spec.ts

import { ConfigService } from '@nestjs/config';

import { resolveAllianceConfig } from '../../src/engine-adapters/wiring/alliance-config.js';
import { DEFAULT_ALLIANCE_CONFIG } from '../../src/engine-core/index.js';

/**
 * 造一个 ConfigService 桩 (只实现 get).
 *
 * 为什么不 new 真 ConfigService: 它要连整个配置加载链 (dotenv / 校验), 而本用例
 * 要验的是"**拿到什么值 → 装配成什么**", 与配置怎么加载无关.
 */
function configStub(env: Readonly<Record<string, string>>): ConfigService {
  return {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
}

describe('WP42 · 咨询同盟三维装配 (env → AllianceConfig)', () => {
  it('没配任何 env → 装配结果与内核种子值逐字一致', () => {
    const config = resolveAllianceConfig(configStub({}));

    expect(config).toEqual(DEFAULT_ALLIANCE_CONFIG);
    expect(config.deltas).toEqual({});
  });

  it('配了系数覆写 → 真的按 env 生效', () => {
    const config = resolveAllianceConfig(
      configStub({
        ENGINE_ALLIANCE_EMPATHY_SAFETY: '0.05',
        ENGINE_ALLIANCE_EMPATHY_BOND: '0.03',
        ENGINE_ALLIANCE_JUDGMENT_SAFETY: '-0.06',
        ENGINE_ALLIANCE_JUDGMENT_BOND: '-0.04',
      }),
    );

    expect(config.deltas.empathy).toEqual({ safety: 0.05, bond: 0.03 });
    expect(config.deltas.judgment).toEqual({ safety: -0.06, bond: -0.04 });
  });

  it('只配一个维度 → 另一个维度不产生覆写项 (缺项回内核基础值)', () => {
    const config = resolveAllianceConfig(
      configStub({
        ENGINE_ALLIANCE_EMPATHY_SAFETY: '0.05',
      }),
    );

    expect(config.deltas.empathy).toEqual({ safety: 0.05 });
    expect(config.deltas.empathy?.bond).toBeUndefined();
  });

  it('门槛覆写 → 真的按 env 生效', () => {
    const config = resolveAllianceConfig(
      configStub({
        ENGINE_ALLIANCE_OPEN_THRESHOLD: '0.5',
        ENGINE_ALLIANCE_RESIST_TRUST_THRESHOLD: '0.35',
        ENGINE_ALLIANCE_RESIST_SAFETY_THRESHOLD: '0.25',
      }),
    );

    expect(config.thresholds).toEqual({
      open: 0.5,
      resistanceTrust: 0.35,
      resistanceSafety: 0.25,
      // S-1: 深度门槛不接 env, 固定透传内核种子 0.35.
      openDepth: 0.35,
    });
  });

  it('非法值一律不覆写 (空串 / 非数字 → 回退内核种子值, 不抛错)', () => {
    const config = resolveAllianceConfig(
      configStub({
        ENGINE_ALLIANCE_EMPATHY_SAFETY: 'abc',
        ENGINE_ALLIANCE_EMPATHY_BOND: ' '.repeat(3),
        ENGINE_ALLIANCE_JUDGMENT_SAFETY: '0.03',
      }),
    );

    // empathy 两个维度都非法 → 该事件完全走内核基础值 (不留空壳条目).
    expect(config.deltas.empathy).toBeUndefined();
    // judgment 只配了一个维度 → 只有那一项被覆写.
    expect(config.deltas.judgment).toEqual({ safety: 0.03 });
    expect(config.thresholds).toEqual(DEFAULT_ALLIANCE_CONFIG.thresholds);
  });

  it('门槛非法 (不在 [0,1]) → 回退内核种子值', () => {
    const config = resolveAllianceConfig(
      configStub({
        ENGINE_ALLIANCE_OPEN_THRESHOLD: '1.5',
        ENGINE_ALLIANCE_RESIST_TRUST_THRESHOLD: '-0.1',
        ENGINE_ALLIANCE_RESIST_SAFETY_THRESHOLD: 'x',
      }),
    );

    expect(config.thresholds).toEqual(DEFAULT_ALLIANCE_CONFIG.thresholds);
  });

  it('11 种事件 × 2 维 = 22 个系数键全部可配 (逐个显式读, 漏一个断言会红)', () => {
    const env: Record<string, string> = {};
    const kinds = [
      'EMPATHY',
      'ACCEPTANCE',
      'NORMALIZATION',
      'OPEN_PROBE',
      'AFFIRMATION',
      'JUDGMENT',
      'PREACHING',
      'MINIMIZING',
      'BOUNDARY_CROSS',
      'SENSITIVE_TOUCH',
      'NEUTRAL',
    ];
    for (const kind of kinds) {
      env[`ENGINE_ALLIANCE_${kind}_SAFETY`] = '0.011';
      env[`ENGINE_ALLIANCE_${kind}_BOND`] = '0.022';
    }

    const config = resolveAllianceConfig(configStub(env));

    expect(Object.keys(config.deltas)).toHaveLength(kinds.length);
    for (const kind of kinds) {
      const key = kind.toLowerCase() as keyof typeof config.deltas;
      expect(config.deltas[key]).toEqual({ safety: 0.011, bond: 0.022 });
    }
  });
});
