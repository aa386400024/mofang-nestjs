// AF-322 (2026-11-23 · BDI 决策层残留闭合 · 适配层装配):
//   目的: 守住新增 env 门槛的“只装配、不污染内核”边界，以及非法值必须回退种子值.
//
//   覆盖:
//     ① ENGINE_ALLIANCE_INSIGHT_MIN_TURN / ENGINE_ALLIANCE_PLAN_MIN_TURN 合法值生效；
//     ② 非法 / 空 / 越界（1..20）回退 8 / 12；
//     ③ ENGINE_DECAY_TRANSFERENCE_HALF_LIFE_MS 缺省 = 90 天；显式 0 保留 0；非法回退；
//     ④ 内核源文件不含 process.env（由既有 boundary 套件守，这里只做本单回归）.

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { resolveAllianceConfig } from '../../src/engine-adapters/wiring/alliance-config.js';
import { resolveSessionDecayConfig } from '../../src/engine-adapters/wiring/session-decay.config.js';

const DAY_MS = 24 * 3600 * 1000;

function configOf(env: Record<string, string>): ConfigService {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  } as ConfigService;
}

describe('AF-322 · 适配层环境装配', () => {
  describe('同盟后段门槛', () => {
    it('合法整数生效', () => {
      const config = resolveAllianceConfig(configOf({ ENGINE_ALLIANCE_INSIGHT_MIN_TURN: '9', ENGINE_ALLIANCE_PLAN_MIN_TURN: '14' }));
      expect(config.thresholds?.insightMinTurn).toBe(9);
      expect(config.thresholds?.planMinTurn).toBe(14);
    });

    it('非法 / 空 / 越界值回退 8 / 12', () => {
      for (const raw of ['', '0', '21', 'abc', '-3', '8.5']) {
        const config = resolveAllianceConfig(configOf({ ENGINE_ALLIANCE_INSIGHT_MIN_TURN: raw, ENGINE_ALLIANCE_PLAN_MIN_TURN: raw }));
        expect(config.thresholds?.insightMinTurn).toBe(8);
        expect(config.thresholds?.planMinTurn).toBe(12);
      }
    });
  });

  describe('移情衰减半衰期', () => {
    it('未配置时取内核种子 90 天', () => {
      expect(resolveSessionDecayConfig(configOf({})).transferenceHalfLifeMs).toBe(90 * DAY_MS);
    });

    it('显式 0 保留 0（显式禁用）', () => {
      expect(resolveSessionDecayConfig(configOf({ ENGINE_DECAY_TRANSFERENCE_HALF_LIFE_MS: '0' })).transferenceHalfLifeMs).toBe(0);
    });

    it('非法值回退内核种子 90 天', () => {
      for (const raw of ['', 'abc', '-1', 'NaN']) {
        expect(resolveSessionDecayConfig(configOf({ ENGINE_DECAY_TRANSFERENCE_HALF_LIFE_MS: raw })).transferenceHalfLifeMs).toBe(
          90 * DAY_MS,
        );
      }
    });

    it('合法正整数生效', () => {
      expect(
        resolveSessionDecayConfig(configOf({ ENGINE_DECAY_TRANSFERENCE_HALF_LIFE_MS: String(45 * DAY_MS) })).transferenceHalfLifeMs,
      ).toBe(45 * DAY_MS);
    });
  });
});
