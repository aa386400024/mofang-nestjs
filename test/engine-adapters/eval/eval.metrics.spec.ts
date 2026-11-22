// V2026-11-09 治本 (Phase2.5 WP-E · 指标计算单测):
//   目的: 把任务单 §4 的指标口径**逐条钉死** —— P/R/F1 的分子分母、方向 macro F1、
//         幅度 MAE 只算方向对的轮次、基线对比的差值口径、多次运行的均值/标准差.
//
//   为什么这些计算必须能不起数据库就测:
//     报告的数字要能复现, 而复现的前提是"算指标这件事没有 IO".
//     一旦计算里混进一次读时钟 / 读 env, 跨版本对比就失去意义.
//
//   边界: 纯函数 + 纯装配, 不起 Nest 容器, 不连数据库, 不发网络.
//
//   验证: npx vitest run test/engine-adapters/eval/eval.metrics.spec.ts

import { describe, expect, it } from 'vitest';

import {
  computeBaselineComparison,
  computeRunsSummary,
  computeStdDev,
  computeSuggestionQuality,
  computeTriggerQuality,
  type EvalSuggestionSample,
} from '../../../src/engine-adapters/eval/eval.metrics.js';
import { BASELINE_REGRESSION_THRESHOLD, buildEvalReport, diffEvalReports } from '../../../src/engine-adapters/eval/eval.report.js';
import { directionOf } from '../../../src/engine-adapters/eval/eval.types.js';
import type { EvalReport, EvalSuggestionQuality } from '../../../src/engine-adapters/eval/eval.types.js';

describe('computeTriggerQuality', () => {
  it('按 TP/FP/FN/TN 算 P/R/F1', () => {
    const result = computeTriggerQuality([
      { truth: true, predicted: true },
      { truth: true, predicted: false },
      { truth: false, predicted: true },
      { truth: false, predicted: false },
    ]);
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(1);
    expect(result.fn).toBe(1);
    expect(result.tn).toBe(1);
    expect(result.precision).toBeCloseTo(0.5);
    expect(result.recall).toBeCloseTo(0.5);
    expect(result.f1).toBeCloseTo(0.5);
    expect(result.support).toBe(4);
  });

  it('空输入返回 0 而不是 NaN', () => {
    const result = computeTriggerQuality([]);
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.f1).toBe(0);
    expect(result.support).toBe(0);
  });

  it('分母为 0 时不产生 NaN / Infinity', () => {
    const result = computeTriggerQuality([
      { truth: false, predicted: false },
      { truth: false, predicted: false },
    ]);
    expect(Number.isFinite(result.precision)).toBe(true);
    expect(Number.isFinite(result.f1)).toBe(true);
  });
});

describe('computeSuggestionQuality', () => {
  const samples: EvalSuggestionSample[] = [
    { predicted: { trust: 0.05 }, truth: { trust: 0.04 } },
    { predicted: { trust: -0.05 }, truth: { trust: -0.03 } },
    { predicted: { trust: 0.05 }, truth: { trust: -0.02 } },
  ];

  it('方向 macro F1 按三分类算, 命中率单独给出', () => {
    const result = computeSuggestionQuality(samples);
    expect(result.available).toBe(true);
    const trust = result.perDimension.trust;
    expect(trust).not.toBeNull();
    expect(trust?.support).toBe(3);
    expect(trust?.accuracy).toBeCloseTo(2 / 3);
    // up 类: 真值 1 条 / 预测 2 条 / 命中 1 条 → precision 0.5, recall 1 → F1 0.667;
    // down 类: 真值 2 条 / 预测 1 条 / 命中 1 条 → precision 1, recall 0.5 → F1 0.667;
    // macro = (0.667 + 0.667) / 2 = 0.667.
    expect(trust?.macroF1).toBeCloseTo(2 / 3, 5);
    expect(result.directionAccuracy.trust).toBeCloseTo(2 / 3, 5);
    expect(result.macroAverage).toBeCloseTo(2 / 3, 5);
  });

  it('幅度 MAE 只统计方向对的轮次', () => {
    const result = computeSuggestionQuality(samples);
    // 方向对的两轮: |0.05-0.04| = 0.01, |-0.05-(-0.03)| = 0.02 → 均值 0.015.
    // 其余五维真值恒为 0 (无信号) → 不进 MAE, 否则 0 值会把均值稀释成 0.0025.
    expect(result.amplitudeMAE).toBeCloseTo(0.015);
    expect(result.perDimension.bond?.signalTurns).toBe(0);
    expect(result.directionAccuracy.bond).toBeNull();
  });

  it('没有人类真值时标记不可算, 而不是给 0 分', () => {
    const result = computeSuggestionQuality([{ predicted: { trust: 0.05 }, truth: null }]);
    expect(result.available).toBe(false);
    expect(result.unavailableReason).toBeTruthy();
    expect(result.macroAverage).toBeNull();
    expect(result.directionAccuracy.trust).toBeNull();
  });

  it('没有审议输出样本时标记不可算', () => {
    const result = computeSuggestionQuality([{ predicted: null, truth: { trust: 0.05 } }]);
    expect(result.available).toBe(false);
    expect(result.comparedTurns).toBe(0);
  });
});

describe('computeBaselineComparison', () => {
  it('差值 = 被测对象 - 基线', () => {
    const truth: EvalSuggestionSample[] = [{ predicted: { trust: 0.05 }, truth: { trust: 0.04 } }];
    const baseline = computeSuggestionQuality([{ predicted: { trust: -0.05 }, truth: { trust: 0.04 } }]);
    const subject = computeSuggestionQuality(truth);
    const comparison = computeBaselineComparison(baseline, subject);
    expect(comparison.available).toBe(true);
    expect(comparison.subjectDirectionAccuracy).toBeCloseTo(1);
    expect(comparison.baselineDirectionAccuracy).toBeCloseTo(0);
    expect(comparison.directionAccuracyDelta).toBeCloseTo(1);
  });

  it('任一侧不可算时整体不可算', () => {
    const unavailable = computeSuggestionQuality([]);
    const available = computeSuggestionQuality([{ predicted: { trust: 0.05 }, truth: { trust: 0.04 } }]);
    const comparison = computeBaselineComparison(unavailable, available);
    expect(comparison.available).toBe(false);
    expect(comparison.directionAccuracyDelta).toBeNull();
  });
});

describe('computeRunsSummary / computeStdDev', () => {
  it('多次运行给均值与标准差', () => {
    const summary = computeRunsSummary([
      { triggerF1: 0.6, precision: 0.7, recall: 0.5, directionAccuracy: 0.8, amplitudeMAE: 0.03 },
      { triggerF1: 0.8, precision: 0.9, recall: 0.7, directionAccuracy: 0.8, amplitudeMAE: 0.03 },
    ]);
    expect(summary.count).toBe(2);
    expect(summary.mean.triggerF1).toBeCloseTo(0.7);
    expect(summary.stdDev.triggerF1).toBeCloseTo(0.1);
  });

  it('单次运行标准差为 0', () => {
    expect(computeStdDev([0.5])).toBe(0);
    expect(computeStdDev([])).toBeNull();
  });
});

describe('buildEvalReport', () => {
  const baseInput = {
    reportId: 'eval-test-001',
    createdAt: '2026-11-09T00:00:00.000Z',
    config: {
      model: 'test-model',
      promptVersion: 'v1.0',
      gateThresholds: { alliance: 0.05, resistance: 0.08, calm: 0.03, cooldown: 4 },
      datasetVersion: 'test-v1',
      mode: 'offline' as const,
      runs: 1,
      split: 'validation' as const,
      groundTruthKind: 'supervisor' as const,
      synthetic: false,
    },
    dataQuality: {
      totalSessions: 2,
      validSessions: 2,
      droppedSessions: 0,
      dropReasons: { too_short: 0, has_error: 0, bdi_anomaly: 0, missing_gate_trace: 0 },
      turnsWithMissingGateTrace: 0,
    },
    triggerQuality: { precision: 0.7, recall: 0.6, f1: 0.65, tp: 6, fp: 2, fn: 4, tn: 8, support: 20 },
    suggestionQuality: computeSuggestionQuality([{ predicted: { trust: 0.05 }, truth: { trust: 0.04 } }]),
    baselineComparison: computeBaselineComparison(
      computeSuggestionQuality([{ predicted: { trust: -0.05 }, truth: { trust: 0.04 } }]),
      computeSuggestionQuality([{ predicted: { trust: 0.05 }, truth: { trust: 0.04 } }]),
    ),
    runs: computeRunsSummary([{ triggerF1: 0.65, precision: 0.7, recall: 0.6, directionAccuracy: 1, amplitudeMAE: 0.01 }]),
    cost: { totalTokens: 1000, estimatedCostCny: 0.006 },
    durationSec: 1.5,
    sampleIds: ['s1#1'],
    notes: [],
  };

  it('报告字段齐全 (任务单 §4.4)', () => {
    const report = buildEvalReport(baseInput);
    expect(report.reportId).toBe('eval-test-001');
    expect(report.config.datasetVersion).toBe('test-v1');
    expect(report.dataQuality.totalSessions).toBe(2);
    expect(report.triggerQuality.f1).toBeCloseTo(0.65);
    expect(report.suggestionQuality.available).toBe(true);
    expect(report.baselineComparison.available).toBe(true);
    expect(report.runs.count).toBe(1);
    expect(report.cost.totalTokens).toBe(1000);
    expect(report.durationSec).toBe(1.5);
    expect(report.sampleIds).toEqual(['s1#1']);
  });

  it('合成数据集必须带告警', () => {
    const report = buildEvalReport({ ...baseInput, config: { ...baseInput.config, synthetic: true } });
    expect(report.warnings.some((warning) => warning.includes('合成数据'))).toBe(true);
  });

  it('建议质量不可算时带告警', () => {
    const unavailable: EvalSuggestionQuality = {
      available: false,
      unavailableReason: '没有督导真值',
      directionAccuracy: { trust: null, safety: null, bond: null, verbal: null, depth: null, style: null },
      macroAverage: null,
      perDimension: { trust: null, safety: null, bond: null, verbal: null, depth: null, style: null },
      amplitudeMAE: null,
      comparedTurns: 0,
    };
    const report = buildEvalReport({ ...baseInput, suggestionQuality: unavailable });
    expect(report.warnings.some((warning) => warning.includes('建议质量不可算'))).toBe(true);
    expect(report.status).toBe('degraded');
  });

  it('基线跌超过阈值时标红告警', () => {
    const previous = buildEvalReport({
      ...baseInput,
      baselineComparison: {
        available: true,
        unavailableReason: null,
        baselineDirectionAccuracy: 0.8,
        subjectDirectionAccuracy: 0.85,
        directionAccuracyDelta: 0.05,
        baselineAmplitudeMAE: 0.02,
        subjectAmplitudeMAE: 0.01,
        amplitudeMAEDelta: -0.01,
      },
    });
    const current = buildEvalReport({
      ...baseInput,
      baselineComparison: {
        available: true,
        unavailableReason: null,
        baselineDirectionAccuracy: 0.8 - BASELINE_REGRESSION_THRESHOLD - 0.02,
        subjectDirectionAccuracy: 0.8,
        directionAccuracyDelta: 0,
        baselineAmplitudeMAE: 0.02,
        subjectAmplitudeMAE: 0.02,
        amplitudeMAEDelta: 0,
      },
      previous,
    });
    expect(current.warnings.some((warning) => warning.includes('基线回归'))).toBe(true);
  });
});

describe('diffEvalReports', () => {
  it('给出逐项差值', () => {
    const previous: EvalReport = buildEvalReport({
      reportId: 'eval-a',
      createdAt: '2026-11-09T00:00:00.000Z',
      config: {
        model: 'm',
        promptVersion: 'v',
        gateThresholds: { alliance: 0.05, resistance: 0.08, calm: 0.03, cooldown: 4 },
        datasetVersion: 'test-v1',
        mode: 'offline',
        runs: 1,
        split: 'validation',
        groundTruthKind: 'supervisor',
        synthetic: false,
      },
      dataQuality: {
        totalSessions: 1,
        validSessions: 1,
        droppedSessions: 0,
        dropReasons: { too_short: 0, has_error: 0, bdi_anomaly: 0, missing_gate_trace: 0 },
        turnsWithMissingGateTrace: 0,
      },
      triggerQuality: { precision: 0.6, recall: 0.5, f1: 0.55, tp: 5, fp: 3, fn: 5, tn: 7, support: 20 },
      suggestionQuality: computeSuggestionQuality([{ predicted: { trust: 0.05 }, truth: { trust: 0.04 } }]),
      baselineComparison: computeBaselineComparison(
        computeSuggestionQuality([{ predicted: { trust: -0.05 }, truth: { trust: 0.04 } }]),
        computeSuggestionQuality([{ predicted: { trust: 0.05 }, truth: { trust: 0.04 } }]),
      ),
      runs: computeRunsSummary([{ triggerF1: 0.55, precision: 0.6, recall: 0.5, directionAccuracy: 1, amplitudeMAE: 0.01 }]),
      cost: { totalTokens: 10, estimatedCostCny: 0 },
      durationSec: 1,
      sampleIds: [],
      notes: [],
    });
    const current: EvalReport = { ...previous, reportId: 'eval-b', triggerQuality: { ...previous.triggerQuality, f1: 0.65 } };
    const diff = diffEvalReports(previous, current);
    expect(diff.reportId).toBe('eval-b');
    expect(diff.previousReportId).toBe('eval-a');
    expect(diff.triggerQuality.f1).toBeCloseTo(0.1);
  });

  it('没有上一版时差值全为空', () => {
    const diff = diffEvalReports(null, {
      reportId: 'eval-x',
      createdAt: '2026-11-09T00:00:00.000Z',
      config: {
        model: 'm',
        promptVersion: 'v',
        gateThresholds: { alliance: 0, resistance: 0, calm: 0, cooldown: 0 },
        datasetVersion: 'v1',
        mode: 'offline',
        runs: 1,
        split: 'train',
        groundTruthKind: 'rule_diff',
        synthetic: true,
      },
      dataQuality: {
        totalSessions: 0,
        validSessions: 0,
        droppedSessions: 0,
        dropReasons: { too_short: 0, has_error: 0, bdi_anomaly: 0, missing_gate_trace: 0 },
        turnsWithMissingGateTrace: 0,
      },
      triggerQuality: { precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 0, tn: 0, support: 0 },
      suggestionQuality: computeSuggestionQuality([]),
      baselineComparison: computeBaselineComparison(computeSuggestionQuality([]), computeSuggestionQuality([])),
      runs: computeRunsSummary([]),
      cost: { totalTokens: 0, estimatedCostCny: 0 },
      durationSec: 0,
      warnings: [],
      sampleIds: [],
      status: 'degraded',
    });
    expect(diff.previousReportId).toBeNull();
    expect(diff.triggerQuality.f1).toBeNull();
  });
});

describe('directionOf', () => {
  it('按 0.01 中性带分三方向', () => {
    expect(directionOf(0.02)).toBe('up');
    expect(directionOf(-0.02)).toBe('down');
    expect(directionOf(0.005)).toBe('flat');
    expect(directionOf(0)).toBe('flat');
    expect(directionOf(Number.NaN)).toBe('flat');
  });
});
