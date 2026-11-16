// V2026-11-03 WP34 (B 层 · 人格调节系数装配):
//   职责: 钉死"env → PersonalityModulatorConfig 端口"这条装配链 ——
//     ① 18 个键逐个读, 缺省/非法一律回退**内核种子值** (不抛错, 行为仍然确定);
//     ② 装配结果与内核种子值一致 (没配 env 时行为与种子值逐字相同);
//     ③ 方向校验: 增益型系数不得为负; 阻抗系数是**除数**, 必须 > 0; 阈值必须落在 [0,1].
//
//   V2026-11-04 WP53 (人格调节算子扩展到同盟三维):
//     依恋系数从 2 列扩到 4 列 (trust / resistance / safety / bond), env 键
//     从 10 个增到 18 个. 新增的 8 个键同样走"字面量读 + 非法回退"这一套.
//
//   为什么这层要有单测:
//     env 解析是**纯配置层**, 但它决定人格系数 —— 配错一个符号, "回避型阻抗倍率"
//     就会被写成 0 (除出 Infinity) 或负数 (阻抗往反方向走). 而 env 默认在测试环境是
//     **没配**的, 所以"配错"这条路径在别的套件里根本走不到, 只能在这里显式造出来.
//
//   边界: 不起 Nest 容器 (ConfigService 用手写桩); 不连 Redis / DB / 网络.
//
//   验证: npx vitest run test/engine-adapters/wp34-personality-modulator-config.spec.ts

import { ConfigService } from '@nestjs/config';

import { resolvePersonalityModulatorConfig } from '../../src/engine-adapters/wiring/personality-modulator.config.js';
import { DEFAULT_PERSONALITY_MODULATOR_CONFIG } from '../../src/engine-core/cognition/personality-modulator.js';

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

describe('WP34 · 人格调节系数装配 (env → PersonalityModulatorConfig)', () => {
  it('没配任何 env → 装配结果与内核种子值逐字一致', () => {
    const config = resolvePersonalityModulatorConfig(configStub({}));

    expect(config).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG);
  });

  it('配了 18 个键 → 真的按 env 生效', () => {
    const config = resolvePersonalityModulatorConfig(
      configStub({
        ENGINE_MOD_SECURE_TRUST_SCALE: '1.05',
        ENGINE_MOD_SECURE_RESIST_SCALE: '0.95',
        ENGINE_MOD_SECURE_SAFETY_SCALE: '1.08',
        ENGINE_MOD_SECURE_BOND_SCALE: '1.02',
        ENGINE_MOD_AVOIDANT_TRUST_SCALE: '0.5',
        ENGINE_MOD_AVOIDANT_RESIST_SCALE: '1.4',
        ENGINE_MOD_AVOIDANT_SAFETY_SCALE: '0.45',
        ENGINE_MOD_AVOIDANT_BOND_SCALE: '0.55',
        ENGINE_MOD_ANXIOUS_TRUST_SCALE: '1.3',
        ENGINE_MOD_ANXIOUS_RESIST_SCALE: '0.75',
        ENGINE_MOD_ANXIOUS_SAFETY_SCALE: '0.65',
        ENGINE_MOD_ANXIOUS_BOND_SCALE: '1.35',
        ENGINE_MOD_DISORGANIZED_TRUST_SCALE: '0.85',
        ENGINE_MOD_DISORGANIZED_RESIST_SCALE: '1.15',
        ENGINE_MOD_DISORGANIZED_SAFETY_SCALE: '0.55',
        ENGINE_MOD_DISORGANIZED_BOND_SCALE: '0.75',
        ENGINE_MOD_AGREEABLENESS_TRUST_SCALE: '1.2',
        ENGINE_MOD_AGREEABLENESS_HIGH_THRESHOLD: '0.6',
      }),
    );

    // I-20: 情绪两维系数已进端口类型 —— 本单**不接 env 键**, 一律取内核种子值 1.0.
    expect(config.attachment.secure).toEqual({
      trustScale: 1.05,
      resistanceScale: 0.95,
      safetyScale: 1.08,
      bondScale: 1.02,
      valenceScale: 1,
      arousalScale: 1,
    });
    expect(config.attachment.avoidant).toEqual({
      trustScale: 0.5,
      resistanceScale: 1.4,
      safetyScale: 0.45,
      bondScale: 0.55,
      valenceScale: 1,
      arousalScale: 1,
    });
    expect(config.attachment.anxious).toEqual({
      trustScale: 1.3,
      resistanceScale: 0.75,
      safetyScale: 0.65,
      bondScale: 1.35,
      valenceScale: 1,
      arousalScale: 1,
    });
    expect(config.attachment.disorganized).toEqual({
      trustScale: 0.85,
      resistanceScale: 1.15,
      safetyScale: 0.55,
      bondScale: 0.75,
      valenceScale: 1,
      arousalScale: 1,
    });
    expect(config.agreeableness).toEqual({ trustScale: 1.2, highThreshold: 0.6 });
  });

  it('非法值回退种子值: 非数字 / 空串 / 增益系数为负 / 阻抗为 0 或负 / 阈值越界', () => {
    const config = resolvePersonalityModulatorConfig(
      configStub({
        ENGINE_MOD_SECURE_TRUST_SCALE: 'abc',
        ENGINE_MOD_SECURE_RESIST_SCALE: ' '.repeat(3),
        ENGINE_MOD_SECURE_SAFETY_SCALE: 'not-a-number',
        ENGINE_MOD_SECURE_BOND_SCALE: '-0.1',
        ENGINE_MOD_AVOIDANT_TRUST_SCALE: '-0.5',
        ENGINE_MOD_AVOIDANT_RESIST_SCALE: '0', // 除数 = 0 → 非法
        ENGINE_MOD_AVOIDANT_SAFETY_SCALE: 'Infinity',
        ENGINE_MOD_AVOIDANT_BOND_SCALE: '-2',
        ENGINE_MOD_ANXIOUS_TRUST_SCALE: 'Infinity',
        ENGINE_MOD_ANXIOUS_RESIST_SCALE: '-1', // 负的阻抗倍率 → 非法
        ENGINE_MOD_AGREEABLENESS_TRUST_SCALE: '-0.2',
        ENGINE_MOD_AGREEABLENESS_HIGH_THRESHOLD: '1.5', // 阈值越界
      }),
    );

    expect(config.attachment.secure).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.secure);
    expect(config.attachment.avoidant).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.avoidant);
    expect(config.attachment.anxious).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.anxious);
    expect(config.attachment.disorganized).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.disorganized);
    expect(config.agreeableness).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG.agreeableness);
  });

  it('只配一个键 → 其余逐项回退种子值 (不连坐)', () => {
    const config = resolvePersonalityModulatorConfig(configStub({ ENGINE_MOD_ANXIOUS_TRUST_SCALE: '1.25' }));

    expect(config.attachment.anxious.trustScale).toBeCloseTo(1.25, 10);
    expect(config.attachment.anxious.resistanceScale).toBe(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.anxious.resistanceScale);
    expect(config.attachment.anxious.safetyScale).toBe(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.anxious.safetyScale);
    expect(config.attachment.anxious.bondScale).toBe(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.anxious.bondScale);
    expect(config.attachment.secure).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.secure);
    expect(config.attachment.avoidant).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.avoidant);
    expect(config.attachment.disorganized).toEqual(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.disorganized);
  });

  it('只配新同盟系数 → 该系数生效, 同组另一个系数回退种子值 (WP53)', () => {
    const config = resolvePersonalityModulatorConfig(configStub({ ENGINE_MOD_AVOIDANT_SAFETY_SCALE: '0.4' }));

    expect(config.attachment.avoidant.safetyScale).toBeCloseTo(0.4, 10);
    expect(config.attachment.avoidant.bondScale).toBe(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.avoidant.bondScale);
    expect(config.attachment.avoidant.trustScale).toBe(DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment.avoidant.trustScale);
  });
});
