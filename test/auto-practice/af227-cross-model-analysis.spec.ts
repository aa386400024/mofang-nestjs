// AF-227 · 跨模型评分统计单测.
//
// 边界: 合成分数，不发网络、不读文件；重点验证阈值判定与场景方向翻转。

import { describe, expect, it } from 'vitest';

import { analyzeCrossModel, type PacketScoreSet, type RaterScoreSet } from '../../bin/realism-cross-model-analysis.js';
import { REALISM_DIMENSIONS, type RealismDimension } from '../../src/auto-practice/metrics/visitor-realism-rating.js';
import type { RealismScene } from '../../src/shared/realism/turn-shape-selector.js';

function scores(overall: number, dimensions?: Partial<Record<RealismDimension, number>>): RaterScoreSet {
  const dims = {} as Record<RealismDimension, number>;
  for (const dimension of REALISM_DIMENSIONS) dims[dimension] = dimensions?.[dimension] ?? overall;
  return { overall, dimensions: dims };
}

function rows(input: { readonly valueFor: (model: 'minimax' | 'doubao', scene: RealismScene, index: number) => number }): PacketScoreSet[] {
  const result: PacketScoreSet[] = [];
  for (const scene of ['in_person', 'online_voice', 'online_text'] as const) {
    for (let index = 0; index < 8; index += 1) {
      const mm = input.valueFor('minimax', scene, index);
      const db = input.valueFor('doubao', scene, index);
      result.push({
        packetId: `${scene}-${index}`,
        scene,
        minimax: { t01: scores(mm), t05: scores(mm) },
        doubao: { t01: scores(db), t05: scores(db) },
      });
    }
  }
  return result;
}

describe('AF-227 跨模型统计', () => {
  it('两模型完全同分：pass，κ=1，绝对差=0，场景方向不翻转', () => {
    const analysis = analyzeCrossModel(
      rows({
        valueFor: (_model, scene) => (scene === 'in_person' ? 3 : 4),
      }),
    );

    expect(analysis.packetCount).toBe(24);
    expect(analysis.ratingCount).toBe(96);
    expect(analysis.agreement.crossPrimary.overall.linearWeightedKappa).toBe(1);
    expect(analysis.absoluteDelta.meanOverall).toBe(0);
    expect(analysis.sceneDirectionFlipped).toEqual([]);
    expect(analysis.judgment.verdict).toBe('pass');
  });

  it('场景总体方向翻转：直接 fail，即使其他分数完全一致', () => {
    const analysis = analyzeCrossModel(
      rows({
        valueFor: (model, scene) => {
          if (scene === 'in_person') return 3;
          return model === 'minimax' ? 4 : 2;
        },
      }),
    );

    expect(analysis.sceneDirectionFlipped).toContain('onlineVoiceMinusInPerson');
    expect(analysis.sceneDirectionFlipped).toContain('onlineTextMinusInPerson');
    expect(analysis.judgment.verdict).toBe('fail');
    expect(analysis.judgment.reasons.join('；')).toContain('场景方向翻转');
  });

  it('系统性偏移 + 噪声时不会误判 pass', () => {
    const analysis = analyzeCrossModel(
      rows({
        valueFor: (model, scene, index) => {
          const base = scene === 'in_person' ? 3 : 4;
          if (model === 'doubao') return index % 2 === 0 ? base - 1 : base + 1;
          return base;
        },
      }),
    );

    expect(analysis.judgment.verdict).not.toBe('pass');
    expect(analysis.absoluteDelta.meanOverall).toBeGreaterThan(0.3);
  });
});
