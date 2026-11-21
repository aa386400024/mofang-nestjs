// AF-229 · 锚点校准与 thinking 对照纯函数测试.
//
// 边界: 合成分数，不发网络、不读文件；重点验证校准可逆性、留一法、判据与建议规则。

import { describe, expect, it } from 'vitest';

import {
  CALIBRATION_THRESHOLDS,
  bootstrapCalibration,
  compareThinkingArms,
  evaluateCalibration,
  fitAffineCalibration,
  leaveOneOutCalibration,
  type CalibrationRow,
} from '../../bin/realism-calibration-analysis.js';
import { analyzeCrossModel, type RaterScoreSet } from '../../bin/realism-cross-model-analysis.js';
import { createRaterEndpoint } from '../../bin/realism-rater-runtime.js';
import { REALISM_DIMENSIONS, type RealismDimension } from '../../src/auto-practice/metrics/visitor-realism-rating.js';
import type { RealismScene } from '../../src/shared/realism/turn-shape-selector.js';

function scores(overall: number, dimensions?: Partial<Record<RealismDimension, number>>): RaterScoreSet {
  const dims = {} as Record<RealismDimension, number>;
  for (const dimension of REALISM_DIMENSIONS) dims[dimension] = Math.min(5, Math.max(1, dimensions?.[dimension] ?? overall));
  return { overall: Math.min(5, Math.max(1, overall)), dimensions: dims };
}

function makeRows(input: {
  readonly split: 'eval' | 'anchor';
  readonly disabledFor: (base: number) => number;
  readonly autoFor: (base: number) => number;
  readonly onlyScene?: RealismScene;
}): CalibrationRow[] {
  const rows: CalibrationRow[] = [];
  for (const scene of ['in_person', 'online_voice', 'online_text'] as const) {
    if (input.onlyScene !== undefined && input.onlyScene !== scene) continue;
    for (let index = 0; index < 8; index += 1) {
      const base = (scene === 'in_person' ? 3 : 4) + (index % 2);
      const disabled = input.disabledFor(base);
      const auto = input.autoFor(base);
      rows.push({
        packetId: `${input.split}-${scene}-${index}`,
        scene,
        split: input.split,
        minimax: { t01: scores(base), t05: scores(base) },
        doubao: {
          disabled: { t01: scores(disabled), t05: scores(disabled) },
          auto: { t01: scores(auto), t05: scores(auto) },
        },
      });
    }
  }
  return rows;
}

describe('AF-229 锚点校准', () => {
  it('仿射校准能恢复固定零点偏移', () => {
    const fit = fitAffineCalibration([
      { source: 2, reference: 3 },
      { source: 3, reference: 4 },
      { source: 2, reference: 3 },
      { source: 3, reference: 4 },
    ]);
    expect(fit.slope).toBe(1);
    expect(fit.intercept).toBe(1);
    expect(fit.r2).toBe(1);
    expect(fit.mae).toBe(0);
  });

  it('留出锚点拟合、评测集独立评估：固定偏移被校准后 pass', () => {
    const anchor = makeRows({ split: 'anchor', disabledFor: (base) => base - 1, autoFor: (base) => base - 1 });
    const evaluationRows = makeRows({ split: 'eval', disabledFor: (base) => base - 1, autoFor: (base) => base - 1 });
    const evaluation = evaluateCalibration(anchor, evaluationRows, 'disabled');

    expect(evaluation.pre.absoluteDelta.meanOverall).toBe(1);
    expect(evaluation.post.absoluteDelta.meanOverall).toBe(0);
    expect(evaluation.loo.overallMae).toBe(0);
    expect(evaluation.judgment.verdict).toBe('pass');
    expect(evaluation.post.agreement.crossPrimary.overall.linearWeightedKappa).toBeGreaterThanOrEqual(CALIBRATION_THRESHOLDS.overallKappa);
  });

  it('锚点留一法输出稳定区间，偏移为 1 时 MAE 为 0', () => {
    const anchor = makeRows({ split: 'anchor', disabledFor: (base) => base - 1, autoFor: (base) => base - 1 });
    const loo = leaveOneOutCalibration(anchor, 'disabled');
    expect(loo.overallMae).toBe(0);
    expect(loo.slopeMin).toBe(1);
    expect(loo.slopeMax).toBe(1);
    expect(loo.interceptMin).toBe(1);
    expect(loo.interceptMax).toBe(1);
  });

  it('不可校准的双向噪声不会误判 pass', () => {
    const anchor = makeRows({ split: 'anchor', disabledFor: (base) => base - 1, autoFor: (base) => base - 1 });
    const evaluationRows = makeRows({
      split: 'eval',
      disabledFor: (base) => (base >= 4 ? base + 1 : base - 2),
      autoFor: (base) => base,
    });
    const evaluation = evaluateCalibration(anchor, evaluationRows, 'disabled');
    expect(evaluation.judgment.verdict).not.toBe('pass');
    expect(evaluation.post.absoluteDelta.meanOverall).toBeGreaterThan(CALIBRATION_THRESHOLDS.overallMeanAbsDelta);
  });

  it('把分数压成常量的退化解不能通过', () => {
    const anchor = makeRows({ split: 'anchor', disabledFor: (base) => base, autoFor: (base) => base }).map((row) => ({
      ...row,
      minimax: { t01: scores(3), t05: scores(3) },
    }));
    const evaluationRows = makeRows({ split: 'eval', disabledFor: (base) => base, autoFor: (base) => base }).map((row) => ({
      ...row,
      minimax: { t01: scores(3), t05: scores(3) },
    }));
    const evaluation = evaluateCalibration(anchor, evaluationRows, 'disabled');
    expect(evaluation.judgment.verdict).not.toBe('pass');
    expect(evaluation.judgment.reasons.join('；')).toContain('区分度保留');
    expect(evaluation.discriminationRetention).toBe(0);
  });

  it('评测 packet 不足 24 直接 fail', () => {
    const anchor = makeRows({ split: 'anchor', disabledFor: (base) => base - 1, autoFor: (base) => base - 1 });
    const evaluationRows = makeRows({
      split: 'eval',
      onlyScene: 'in_person',
      disabledFor: (base) => base - 1,
      autoFor: (base) => base - 1,
    });
    expect(evaluationRows.length).toBeLessThan(CALIBRATION_THRESHOLDS.minPackets);
    const evaluation = evaluateCalibration(anchor, evaluationRows, 'disabled');
    expect(evaluation.judgment.verdict).toBe('fail');
    expect(evaluation.judgment.reasons.join('；')).toContain('评测 packet 不足');
  });

  it('Bootstrap 对完全对齐的评测集返回 0 区间', () => {
    const anchor = makeRows({ split: 'anchor', disabledFor: (base) => base - 1, autoFor: (base) => base - 1 });
    const evaluationRows = makeRows({ split: 'eval', disabledFor: (base) => base - 1, autoFor: (base) => base - 1 });
    const fit = evaluateCalibration(anchor, evaluationRows, 'disabled').fit;
    const summary = bootstrapCalibration(evaluationRows, fit, 200);
    expect(summary.meanAbsDeltaP025).toBe(0);
    expect(summary.meanAbsDeltaP50).toBe(0);
    expect(summary.meanAbsDeltaP975).toBe(0);
    expect(summary.crossKappaP025).toBe(1);
    expect(summary.crossKappaP975).toBe(1);
  });
});

describe('AF-229 thinking 对照', () => {
  it('auto 与 disabled 完全一致：κ 相同、区分度无提升，建议 inconclusive', () => {
    const rows = makeRows({ split: 'eval', disabledFor: (base) => base, autoFor: (base) => base });
    const disabled = analyzeCrossModel(
      rows.map((row) => ({
        packetId: row.packetId,
        scene: row.scene,
        minimax: row.minimax,
        doubao: row.doubao.disabled,
      })),
    );
    const auto = analyzeCrossModel(
      rows.map((row) => ({
        packetId: row.packetId,
        scene: row.scene,
        minimax: row.minimax,
        doubao: row.doubao.auto,
      })),
    );
    const comparison = compareThinkingArms(disabled, auto, rows);
    expect(comparison.recommendation).toBe('inconclusive');
    expect(comparison.discriminationDelta).toBe(0);
    expect(comparison.auto.crossT01Kappa).toBe(comparison.disabled.crossT01Kappa);
  });

  it('auto 系统性偏移过大：即使分数更分散也建议 keep-disabled', () => {
    const rows = makeRows({ split: 'eval', disabledFor: (base) => base, autoFor: (base) => base + 2 });
    const disabled = analyzeCrossModel(
      rows.map((row) => ({ packetId: row.packetId, scene: row.scene, minimax: row.minimax, doubao: row.doubao.disabled })),
    );
    const auto = analyzeCrossModel(
      rows.map((row) => ({ packetId: row.packetId, scene: row.scene, minimax: row.minimax, doubao: row.doubao.auto })),
    );
    const comparison = compareThinkingArms(disabled, auto, rows);
    expect(comparison.recommendation).toBe('keep-disabled');
    expect(comparison.auto.meanAbsDelta).toBeGreaterThan(0.4);
  });
});

describe('AF-229 · 评分端点透传', () => {
  it('豆包把 service_tier 与 thinking 合并进 modelKwargs，MiniMax 拒绝越界字段', () => {
    const env = { LLM_DOUBAO_API_KEY: 'test-key', MINIMAX_API_KEY: 'test-key' };
    const endpoint = createRaterEndpoint(
      { provider: 'doubao', temperature: 0.1, thinking: 'disabled', modelKwargs: { service_tier: 'flex' } },
      { timeoutMs: 1000, env },
    );
    expect(endpoint.modelKwargs).toEqual({ service_tier: 'flex', thinking: { type: 'disabled' } });
    expect(() =>
      createRaterEndpoint({ provider: 'minimax', temperature: 0.1, modelKwargs: { service_tier: 'flex' } }, { timeoutMs: 1000, env }),
    ).toThrow('modelKwargs 仅支持 doubao');
  });

  it('promptVariant 默认 shared，豆包可显式切 lite-v1，MiniMax 拒绝 lite-v1', () => {
    const env = { LLM_DOUBAO_API_KEY: 'test-key', MINIMAX_API_KEY: 'test-key' };
    expect(createRaterEndpoint({ provider: 'doubao', temperature: 0.1 }, { timeoutMs: 1000, env }).promptVariant).toBe('shared');
    expect(
      createRaterEndpoint({ provider: 'doubao', temperature: 0.1, promptVariant: 'lite-v1' }, { timeoutMs: 1000, env }).promptVariant,
    ).toBe('lite-v1');
    expect(() =>
      createRaterEndpoint({ provider: 'minimax', temperature: 0.1, promptVariant: 'lite-v1' }, { timeoutMs: 1000, env }),
    ).toThrow('lite-v1 prompt 仅支持 doubao');
  });
});
