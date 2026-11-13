// V2026-11-03 WP36 (B 层 · 跨会话间隔衰减半衰期装配):
//   职责: 钉死"env → SessionDecayConfig 端口"这条装配链 ——
//     ① 3 个键逐个读, 没配 env → 装配结果与内核种子值逐字一致;
//     ② 配了真的按 env 生效 (单位: 毫秒);
//     ③ 非法值 (空串 / 非数字 / ≤0) 一律回退内核种子值, 不抛错.
//
//   为什么这层要有单测:
//     env 解析是**纯配置层**, 但它决定三组半衰期 —— 而 env 默认在测试环境是**没配**的,
//     所以"配错"这条路径在别的套件里根本走不到, 只能在这里显式造出来.
//
//   边界: 不起 Nest 容器 (ConfigService 用手写桩); 不连 Redis / DB / 网络.
//
//   验证: npx vitest run test/engine-adapters/wp36-session-decay-config.spec.ts

import { ConfigService } from '@nestjs/config';

import { resolveSessionDecayConfig } from '../../src/engine-adapters/wiring/session-decay.config.js';
import { DEFAULT_SESSION_DECAY_CONFIG } from '../../src/engine-core/cognition/session-decay.js';

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

const DAY_MS = 24 * 3600 * 1000;

describe('WP36 · 跨会话间隔衰减装配 (env → SessionDecayConfig)', () => {
  it('没配任何 env → 装配结果与内核种子值逐字一致', () => {
    const config = resolveSessionDecayConfig(configStub({}));

    expect(config).toEqual(DEFAULT_SESSION_DECAY_CONFIG);
    expect(config.emotionHalfLifeMs).toBe(7 * DAY_MS);
    expect(config.resistanceHalfLifeMs).toBe(14 * DAY_MS);
    expect(config.allianceHalfLifeMs).toBe(30 * DAY_MS);
  });

  it('配了半衰期 → 真的按 env 生效 (单位: 毫秒)', () => {
    const config = resolveSessionDecayConfig(
      configStub({
        ENGINE_DECAY_EMOTION_HALF_LIFE_MS: '86400000',
        ENGINE_DECAY_RESISTANCE_HALF_LIFE_MS: '172800000',
        ENGINE_DECAY_ALLIANCE_HALF_LIFE_MS: '2592000000',
      }),
    );

    expect(config.emotionHalfLifeMs).toBe(1 * DAY_MS);
    expect(config.resistanceHalfLifeMs).toBe(2 * DAY_MS);
    expect(config.allianceHalfLifeMs).toBe(30 * DAY_MS);
  });

  it('只配一个键 → 其余两个仍走内核种子值 (逐项回退)', () => {
    const config = resolveSessionDecayConfig(
      configStub({
        ENGINE_DECAY_EMOTION_HALF_LIFE_MS: '3600000',
      }),
    );

    expect(config.emotionHalfLifeMs).toBe(3_600_000);
    expect(config.resistanceHalfLifeMs).toBe(DEFAULT_SESSION_DECAY_CONFIG.resistanceHalfLifeMs);
    expect(config.allianceHalfLifeMs).toBe(DEFAULT_SESSION_DECAY_CONFIG.allianceHalfLifeMs);
  });

  it('非法值 (空串 / 非数字 / 0 / 负数) 一律回退内核种子值, 不抛错', () => {
    const config = resolveSessionDecayConfig(
      configStub({
        ENGINE_DECAY_EMOTION_HALF_LIFE_MS: '',
        ENGINE_DECAY_RESISTANCE_HALF_LIFE_MS: '不是数字',
        ENGINE_DECAY_ALLIANCE_HALF_LIFE_MS: '-1',
      }),
    );

    expect(config).toEqual(DEFAULT_SESSION_DECAY_CONFIG);
  });

  it('半衰期为 0 → 回退种子值 (0 会让衰减因子变成 Infinity)', () => {
    const config = resolveSessionDecayConfig(
      configStub({
        ENGINE_DECAY_EMOTION_HALF_LIFE_MS: '0',
      }),
    );

    expect(config.emotionHalfLifeMs).toBe(DEFAULT_SESSION_DECAY_CONFIG.emotionHalfLifeMs);
  });

  it('带空白的值按 trim 后解析 (运维手抖多打一个空格不该静默失效)', () => {
    const config = resolveSessionDecayConfig(
      configStub({
        ENGINE_DECAY_EMOTION_HALF_LIFE_MS: ' 86400000 ',
      }),
    );

    expect(config.emotionHalfLifeMs).toBe(1 * DAY_MS);
  });
});
