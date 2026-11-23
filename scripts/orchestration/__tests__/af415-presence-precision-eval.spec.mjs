// AF-415 · A′ 精确率评估器单测:
//   ① 分层抽样每场配额与总量封顶 ② 按 sessionId 排序且确定性
//   ③ CSV 表头固定、只含四列 ④ 标签 CSV 跳过空标签
//   ⑤ 非法标签拒绝 ⑥ 混淆矩阵与 precision/recall/F1 计算
//   ⑦ 逐场分解 ⑧ 未匹配标签计数
//
//   验证: pnpm exec vitest run scripts/orchestration/__tests__/af415-presence-precision-eval.spec.mjs
//   时间戳: 2026-11-24 GMT+8
import { describe, expect, it } from 'vitest';

import {
  buildPrecisionSample,
  computeBinaryMetrics,
  evaluatePrecision,
  parseLabelsCsv,
  SAMPLE_CSV_HEADER,
  toSampleCsv,
} from '../../ops/quality/af415-presence-precision-eval.mjs';

/**
 * 构造预测行.
 *
 * @param {string} sessionId 会话 id
 * @param {number} turnIndex 轮次
 * @param {string} predicted 预测标签
 * @returns {{sessionId:string,turnIndex:number,predicted:string}} 预测行
 */
const row = (sessionId, turnIndex, predicted) => ({ sessionId, turnIndex, predicted });

describe('AF-415 A′ 精确率评估', () => {
  it('分层抽样：每场 holding 最多 3、非 holding 最多 2，总量封顶', () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((turn) => row('s-a', turn, 'holding_present')),
      row('s-a', 6, 'cold_absent'),
      row('s-a', 7, 'neutral'),
      row('s-a', 8, 'neutral'),
      ...[1, 2].map((turn) => row('s-b', turn, 'holding_present')),
    ];
    const sample = buildPrecisionSample(rows, { maxTotal: 6 });
    expect(sample.filter((item) => item.sessionId === 's-a' && item.predicted === 'holding_present')).toHaveLength(3);
    expect(sample.filter((item) => item.sessionId === 's-a' && item.predicted !== 'holding_present')).toHaveLength(2);
    expect(sample).toHaveLength(6);
  });

  it('抽样确定性：同一输入两次结果一致，且按 sessionId 排序', () => {
    const rows = [row('s-z', 1, 'neutral'), row('s-a', 1, 'holding_present')];
    const first = buildPrecisionSample(rows, { maxTotal: 10 });
    const second = buildPrecisionSample(rows, { maxTotal: 10 });
    expect(first).toEqual(second);
    expect(first[0].sessionId).toBe('s-a');
  });

  it('CSV 表头固定为四列，样本不含对话原文', () => {
    const csv = toSampleCsv(buildPrecisionSample([row('s-a', 3, 'holding_present')], { maxTotal: 10 }));
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(SAMPLE_CSV_HEADER.join(','));
    expect(lines[1]).toBe('s-a,3,holding_present,');
    expect(lines[1]).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('标签 CSV：跳过空标签，保留合法标签', () => {
    const csv = 'sessionId,turnIndex,predicted,humanLabel\ns-a,1,holding_present,holding\ns-a,2,neutral,\ns-b,3,cold_absent,COLD\n';
    const labels = parseLabelsCsv(csv);
    expect(labels).toEqual([
      { sessionId: 's-a', turnIndex: 1, humanLabel: 'holding' },
      { sessionId: 's-b', turnIndex: 3, humanLabel: 'cold' },
    ]);
  });

  it('非法标签直接拒绝，不静默计入精确率', () => {
    expect(() => parseLabelsCsv('sessionId,turnIndex,predicted,humanLabel\ns-a,1,holding_present,maybe\n')).toThrow(/人工标签非法/);
  });

  it('混淆矩阵与指标：TP2 FP1 FN1 TN3', () => {
    const metrics = computeBinaryMetrics(2, 1, 1, 3);
    expect(metrics.precision).toBeCloseTo(2 / 3, 5);
    expect(metrics.recall).toBeCloseTo(2 / 3, 5);
    expect(metrics.f1).toBeCloseTo(2 / 3, 5);
    expect(metrics.accuracy).toBeCloseTo(5 / 7, 5);
    expect(metrics.coldRecall).toBeCloseTo(3 / 4, 5);
  });

  it('逐场分解按 sessionId 排序并各自计算指标', () => {
    const predictions = [row('s-b', 1, 'holding_present'), row('s-a', 1, 'holding_present'), row('s-a', 2, 'neutral')];
    const labels = [
      { sessionId: 's-b', turnIndex: 1, humanLabel: 'holding' },
      { sessionId: 's-a', turnIndex: 1, humanLabel: 'neutral' },
      { sessionId: 's-a', turnIndex: 2, humanLabel: 'cold' },
    ];
    const report = evaluatePrecision(predictions, labels);
    expect(report.perSession.map((item) => item.sessionId)).toEqual(['s-a', 's-b']);
    expect(report.perSession[0].precision).toBe(0);
    expect(report.perSession[1].precision).toBe(1);
    expect(report.precision).toBeCloseTo(1 / 2, 5);
  });

  it('未匹配标签单独计数，不污染混淆矩阵', () => {
    const report = evaluatePrecision(
      [row('s-a', 1, 'holding_present')],
      [
        { sessionId: 's-a', turnIndex: 1, humanLabel: 'holding' },
        { sessionId: 'ghost', turnIndex: 9, humanLabel: 'neutral' },
      ],
    );
    expect(report.labeled).toBe(1);
    expect(report.unmatched).toBe(1);
    expect(report.tp).toBe(1);
    expect(report.precision).toBe(1);
  });
});
