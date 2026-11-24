// AF-471 · 延迟归因纯函数单测：不读真实评测目录、不发网络、不落原文。

import { expect, it } from 'vitest';

import {
  bootstrapQuantile,
  describeDistribution,
  extractSpeechRegisterBlock,
  linearRegression,
  oddEvenP95RelativeDiff,
  pairedTurnDeltas,
  percentile,
  summarizeRolePair,
  tailConcentration,
} from '../latency-attribution.mjs';

function turn(index, overrides = {}) {
  return {
    role: 'vpt_fixture',
    mode: 'base',
    turn: index,
    wallMs: 100 + index * 10,
    ttftMs: 50 + index,
    postMs: 50 + index * 9,
    promptTokens: 1000 + index,
    completionTokens: 10,
    reasoningTokens: 0,
    promptChars: 2000,
    block: { chars: 0, startChar: null, startLine: null, position: null },
    elapsedSec: index,
    ...overrides,
  };
}

it('分位数与分布统计按线性插值', () => {
  expect(percentile([100, 200, 300, 400], 0.5)).toBe(250);
  expect(percentile([], 0.95)).toBe(0);
  const distribution = describeDistribution([100, 200, 300, 400]);
  expect(distribution.n).toBe(4);
  expect(distribution.p50).toBe(250);
  expect(distribution.p95).toBe(385);
});

it('只测语域块长度与位置，不返回块内容', () => {
  const base = ['system', '## 接触方式', '', 'history'].join('\n');
  expect(extractSpeechRegisterBlock(base)).toEqual({ chars: 0, startChar: null, startLine: null, position: null });

  const active = [
    'system',
    '## 接触方式',
    '你说话的样子（只影响用词，不改内容和情绪）：',
    '你说话更靠具体的事。',
    '你嘴边常挂着夜班。',
    '',
    '## 接触防御',
    'history',
  ].join('\n');
  const block = extractSpeechRegisterBlock(active);
  expect(block.chars).toBe(
    '你说话的样子（只影响用词，不改内容和情绪）：'.length + '你说话更靠具体的事。'.length + '你嘴边常挂着夜班。'.length + 3,
  );
  expect(block.position).toBeGreaterThan(0);
  expect(block.startLine).toBe(2);
});

it('最小二乘回归能恢复线性系数', () => {
  const columns = [0, 1, 2, 3, 4].map((value) => [value, value ** 2]);
  const target = columns.map(([x, square]) => 10 + 3 * x + 2 * square);
  const result = linearRegression(columns, target, ['x', 'square']);
  expect(result.coefficients.intercept).toBe(10);
  expect(result.coefficients.x).toBe(3);
  expect(result.coefficients.square).toBe(2);
  expect(result.r2).toBe(1);
});

it('bootstrap 同 seed 可复现且包住原始分位数', () => {
  const values = Array.from({ length: 30 }, (_, index) => 100 + index * 10);
  const first = bootstrapQuantile(values, 0.95, { reps: 500, seed: 7 });
  const second = bootstrapQuantile(values, 0.95, { reps: 500, seed: 7 });
  expect(first).toEqual(second);
  expect(first.low).toBeLessThanOrEqual(first.mean);
  expect(first.high).toBeGreaterThanOrEqual(first.mean);
  expect(first.cv).toBeGreaterThan(0);
});

it('配对轮差按 turn 对齐，缺失轮不硬补', () => {
  const base = [turn(1), turn(2), turn(3)];
  const active = [turn(1, { wallMs: 150 }), turn(2, { wallMs: 250 }), turn(4, { wallMs: 400 })];
  const deltas = pairedTurnDeltas(base, active);
  expect(deltas).toHaveLength(2);
  expect(deltas[0]).toMatchObject({ turn: 1, deltaMs: 40 });
  expect(deltas[1]).toMatchObject({ turn: 2, deltaMs: 130 });
});

it('尾部集中度只统计超出基线中位的部分', () => {
  const result = tailConcentration([100, 200, 300, 400, 500], 100, 0.2);
  expect(result.totalExcessMs).toBe(1000);
  expect(result.topExcessMs).toBe(400);
  expect(result.topShare).toBe(0.4);
});

it('奇偶切半给出可复算的相对差', () => {
  const values = Array.from({ length: 30 }, (_, index) => (index === 29 ? 9000 : 100 + index * 10));
  expect(oddEvenP95RelativeDiff(values)).toBeGreaterThan(0);
  expect(oddEvenP95RelativeDiff([100, 100, 100, 100])).toBe(0);
});

it('角色对聚合保留分位数与配对差', () => {
  const base = Array.from({ length: 30 }, (_, index) => turn(index + 1, { wallMs: 1000 + index * 10 }));
  const active = Array.from({ length: 30 }, (_, index) => turn(index + 1, { wallMs: 1100 + index * 20 }));
  const pair = summarizeRolePair('vpt_fixture', base, active, 'base>active');
  expect(pair.base.wall.p95).toBeGreaterThan(pair.base.wall.p50);
  expect(pair.active.wall.p95).toBeGreaterThan(pair.base.wall.p95);
  expect(pair.ratios.p95).toBeGreaterThan(1);
  expect(pair.paired.n).toBe(30);
});
