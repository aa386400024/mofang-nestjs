// V2026-11-03 治本 (WP26 · B 层 · 单回合 delta cap 配置装配):
//   职责: 钉死"env → DeltaCapConfig 端口"这条装配链 ——
//     ① 18 个键逐个读, 缺省/非法一律回退**内核种子值** (不抛错, 行为仍然确定);
//     ② 装配结果与内核种子值一致 (没配 env 时行为与 WP15 之前逐字相同);
//     ③ 方向校验: 上向给负数 / 下向给正数 = 配反了 → 回退 (绝不让 cap 变成"放大幅度").
//
//   为什么这层要有单测:
//     env 解析是**纯配置层**, 但它决定 cap 参数 —— 配错一个符号, 就会把"砍幅"
//     变成"放大幅度", 比不砍更糟. 而 env 默认在测试环境是**没配**的, 所以
//     "配错"这条路径在别的套件里根本走不到, 只能在这里显式造出来.
//
//   边界: 不起 Nest 容器 (ConfigService 用手写桩); 不连 Redis / DB / 网络.
//
//   验证: npx vitest run test/engine-adapters/wp26-delta-cap-config.spec.ts

import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';

import { resolveDeltaCapConfig } from '../../src/engine-adapters/wiring/delta-cap.config.js';
import { DEFAULT_DELTA_CAP_CONFIG } from '../../src/engine-core/cognition/state-transition.js';

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

describe('WP26 · delta cap 配置装配 (env → DeltaCapConfig)', () => {
  it('没配任何 env → 装配结果与内核种子值逐字一致 (WP15 之前行为不变)', () => {
    const config = resolveDeltaCapConfig(configStub({}));

    expect(config).toEqual(DEFAULT_DELTA_CAP_CONFIG);
  });

  it('配了上向/下向 → 真的按 env 生效 (trust 上 0.05 / 下 -0.45)', () => {
    const config = resolveDeltaCapConfig(
      configStub({
        ENGINE_CAP_TRUST_UP: '0.05',
        ENGINE_CAP_TRUST_DOWN: '-0.45',
      }),
    );

    expect(config.trust.up).toBeCloseTo(0.05, 10);
    expect(config.trust.down).toBeCloseTo(-0.45, 10);
    // 其余维度不动 (未配 = 种子值).
    expect(config.valence).toEqual(DEFAULT_DELTA_CAP_CONFIG.valence);
  });

  it('非法值回退种子值: 非数字 / 空串 / 方向与符号不符', () => {
    const config = resolveDeltaCapConfig(
      configStub({
        ENGINE_CAP_TRUST_UP: 'abc',
        ENGINE_CAP_TRUST_DOWN: ' '.repeat(3),
        ENGINE_CAP_VALENCE_UP: '-0.2', // 上向给了负数 = 配反了
        ENGINE_CAP_VALENCE_DOWN: '0.3', // 下向给了正数 = 配反了
      }),
    );

    expect(config.trust).toEqual(DEFAULT_DELTA_CAP_CONFIG.trust);
    expect(config.valence).toEqual(DEFAULT_DELTA_CAP_CONFIG.valence);
  });

  it('负数写法在上向被拒 (cap 只能让变化更小, 不能更大)', () => {
    const config = resolveDeltaCapConfig(configStub({ ENGINE_CAP_AROUSAL_UP: '-0.5' }));

    expect(config.arousal.up).toBeCloseTo(DEFAULT_DELTA_CAP_CONFIG.arousal.up, 10);
  });

  it('22 个键一个不多一个不少 (少配一个 = 那个维度的 cap 永远配不上)', () => {
    const config = resolveDeltaCapConfig(configStub({}));

    expect(Object.keys(config).sort()).toEqual(Object.keys(DEFAULT_DELTA_CAP_CONFIG).sort());
    // WP42: 维度从 9 扩到 11 (新增 safety / bond —— 咨询同盟三维).
    expect(Object.keys(config)).toHaveLength(11);
  });

  it('读取的 env 键都是**字面量** (不走计算键 —— 计算键编译器拦不住, 属静默偏离)', () => {
    const get = vi.fn();
    resolveDeltaCapConfig({ get } as unknown as ConfigService);

    const readKeys = get.mock.calls.map((call) => call[0]).filter((key): key is string => typeof key === 'string');
    expect(readKeys).toHaveLength(22);
    expect(readKeys.every((key) => key.startsWith('ENGINE_CAP_'))).toBe(true);
    expect(new Set(readKeys).size).toBe(22);
  });
});
