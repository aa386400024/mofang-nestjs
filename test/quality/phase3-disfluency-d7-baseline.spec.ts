// V2026-11-13 Phase3 P1 (文字层真人度 · D7 六类不流利分布 · 快照测试):
//   覆盖开工单 '4.4 的四项:
//     ① 六类计数 / events / hasEvent / normalizedLength —— 与 P0 analyzer 口径逐字一致;
//     ② 整场聚合四字段 + 五类 per_turn 数值 (批次合计口径, 与 P0 快照同源);
//     ③ 空轮次集合 → 全零、不抛错、不出 NaN / Infinity;
//     ④ 泄漏护栏 —— 夹具占位串不得出现在任何导出结构 / 报告 / 基线 JSON 中.
//   纪律: 夹具全部是**构造句**, 不含任何真实逐字稿原文 (隐私红线);
//        不复测 analyzer 分类正例 (P0 spec 已覆盖), 不依赖数据库或真实归档目录.
//   验证: pnpm exec vitest run test/quality/phase3-disfluency-d7-baseline.spec.ts

import { describe, expect, it } from 'vitest';

import {
  aggregateDisfluencyBatch,
  buildDisfluencyBaselinePayload,
  compareWithSeedRanges,
  DISFLUENCY_SEED_RANGES,
  renderD7Report,
  summarizeDisfluency,
} from '../../scripts/ops/quality/visitor-quality-disfluency.js';
import { analyzeDisfluency } from '../../src/auto-practice/metrics/disfluency-analyzer.js';

/** 固定小夹具: 7 轮 visitor 台词 (构造句). */
const FIXTURE_TEXTS: readonly string[] = [
  '嗯，我想说说最近的压力。',
  '我…不知道怎么说。',
  '不对，我想说的是工作压力。',
  '我我最近总是失眠。',
  '其实我一直在想这个……',
  '哎——我等下再打电话。',
  '',
];

/** 逐轮期望 (P0 analyzer 口径): 六类计数 / events / hasEvent / 归一化字符数. */
const FIXTURE_EXPECTED = [
  {
    counts: { filler: 1, pause: 0, repetition: 0, repair: 0, trailoff: 0, elongation: 0 },
    events: 1,
    hasEvent: true,
    normalizedLength: 10,
  },
  { counts: { filler: 0, pause: 1, repetition: 0, repair: 0, trailoff: 0, elongation: 0 }, events: 1, hasEvent: true, normalizedLength: 7 },
  {
    counts: { filler: 0, pause: 0, repetition: 0, repair: 1, trailoff: 0, elongation: 0 },
    events: 1,
    hasEvent: true,
    normalizedLength: 11,
  },
  { counts: { filler: 0, pause: 0, repetition: 1, repair: 0, trailoff: 0, elongation: 0 }, events: 1, hasEvent: true, normalizedLength: 8 },
  { counts: { filler: 1, pause: 0, repetition: 0, repair: 0, trailoff: 1, elongation: 0 }, events: 2, hasEvent: true, normalizedLength: 9 },
  { counts: { filler: 0, pause: 0, repetition: 0, repair: 0, trailoff: 0, elongation: 1 }, events: 1, hasEvent: true, normalizedLength: 8 },
  {
    counts: { filler: 0, pause: 0, repetition: 0, repair: 0, trailoff: 0, elongation: 0 },
    events: 0,
    hasEvent: false,
    normalizedLength: 0,
  },
] as const;

/** 泄漏护栏用的唯一占位串 (绝不允许出现在任何导出结构里). */
const CANARY = 'ZZ_CANARY_7F3A9C';

/**
 * 递归收集对象里的全部叶子值.
 *
 * @param node 任意节点
 * @returns 叶子值数组 (对象/数组展开到底)
 */
function leaves(node: unknown): unknown[] {
  if (node === null || typeof node !== 'object') return [node];
  if (Array.isArray(node)) return node.flatMap((item) => leaves(item));
  return Object.values(node as Record<string, unknown>).flatMap((value) => leaves(value));
}

describe('D7 六类不流利分布 · 逐轮口径', () => {
  it('固定夹具的六类计数 / events / hasEvent / 归一化字符数与 P0 analyzer 逐字一致', () => {
    expect(FIXTURE_TEXTS).toHaveLength(FIXTURE_EXPECTED.length);
    for (const [index, text] of FIXTURE_TEXTS.entries()) {
      expect(analyzeDisfluency(text)).toEqual(FIXTURE_EXPECTED[index]);
    }
  });

  it('五类 per_turn 键齐、elongation 无 per_turn 键 (P0 偏差 5)', () => {
    const summary = summarizeDisfluency(FIXTURE_TEXTS.map((text) => analyzeDisfluency(text)));
    expect(Object.keys(summary.perTurn).toSorted()).toEqual(['filler', 'pause', 'repair', 'repetition', 'trailoff']);
    expect(summary.perTurn).not.toHaveProperty('elongation');
    // elongation 只进事件总量.
    expect(summary.typeCounts.elongation).toBe(1);
    expect(summary.events).toBe(7);
  });
});

describe('D7 整场聚合口径 (批次合计口径 · 与 P0 快照同源)', () => {
  const summary = summarizeDisfluency(FIXTURE_TEXTS.map((text) => analyzeDisfluency(text)));

  it('整场汇总四字段 + 六类计数与五类 per_turn 数值锁定', () => {
    expect(summary).toEqual({
      turns: 7,
      events: 7,
      eventTurns: 6,
      normalizedChars: 53,
      eventsPerTurn: 1,
      eventTurnRate: 0.857143,
      densityPer100Chars: 13.207547,
      typeCounts: { filler: 2, pause: 1, repetition: 1, repair: 1, trailoff: 1, elongation: 1 },
      perTurn: {
        filler: 0.285714,
        pause: 0.142857,
        repair: 0.142857,
        repetition: 0.142857,
        trailoff: 0.142857,
      },
    });
  });

  it('批次汇总与整场汇总同源 (单场批次下两套口径一致)', () => {
    const batch = aggregateDisfluencyBatch([summary]);
    expect(batch.sessions).toBe(1);
    expect(batch.turns).toBe(7);
    expect(batch.events).toBe(7);
    expect(batch.eventTurns).toBe(6);
    expect(batch.normalizedChars).toBe(53);
    expect(batch.eventsPerTurn).toBe(summary.eventsPerTurn);
    expect(batch.eventTurnRate).toBe(summary.eventTurnRate);
    expect(batch.densityPer100Chars).toBe(summary.densityPer100Chars);
    expect(batch.typeCounts).toEqual(summary.typeCounts);
    expect(batch.perTurn).toEqual(summary.perTurn);
    expect(batch.meanEventsPerTurn).toBe(summary.eventsPerTurn);
  });

  it('种子区间只作并列对照: 三列形态, 无 PASS / FAIL 判定词', () => {
    const batch = aggregateDisfluencyBatch([summary]);
    const rows = compareWithSeedRanges(batch);
    expect(rows.map((row) => row.metric)).toEqual(['event_turn_rate', 'events_per_turn', 'repair_per_turn']);
    expect(rows[0]).toEqual({ metric: 'event_turn_rate', seedLabel: '区间 [0.20, 0.55]', measured: 0.857143, inside: false });
    expect(rows[1]).toEqual({ metric: 'events_per_turn', seedLabel: '上限 ≤ 0.8', measured: 1, inside: false });
    expect(rows[2]).toEqual({ metric: 'repair_per_turn', seedLabel: '上限 ≤ 0.25', measured: 0.142857, inside: true });
    expect(DISFLUENCY_SEED_RANGES).toHaveLength(3);

    const report = renderD7Report(batch, { sessions: 1 });
    expect(report).toContain('落在区间外');
    expect(report).toContain('落在区间内');
    expect(report).not.toMatch(/PASS|FAIL|不通过|未通过|达标/);
  });
});

describe('D7 空态 (零轮次)', () => {
  it('整场空态全零、不抛错、不出 NaN / Infinity', () => {
    const summary = summarizeDisfluency([]);
    expect(summary).toEqual({
      turns: 0,
      events: 0,
      eventTurns: 0,
      normalizedChars: 0,
      eventsPerTurn: 0,
      eventTurnRate: 0,
      densityPer100Chars: 0,
      typeCounts: { filler: 0, pause: 0, repetition: 0, repair: 0, trailoff: 0, elongation: 0 },
      perTurn: { filler: 0, pause: 0, repair: 0, repetition: 0, trailoff: 0 },
    });
    for (const leaf of leaves(summary)) {
      expect(typeof leaf).toBe('number');
      expect(Number.isFinite(leaf as number)).toBe(true);
    }
  });

  it('批次空态全零、跨场均值为 0', () => {
    const batch = aggregateDisfluencyBatch([]);
    expect(batch.sessions).toBe(0);
    expect(batch.turns).toBe(0);
    expect(batch.eventsPerTurn).toBe(0);
    expect(batch.eventTurnRate).toBe(0);
    expect(batch.densityPer100Chars).toBe(0);
    expect(batch.meanEventsPerTurn).toBe(0);
    expect(batch.meanEventTurnRate).toBe(0);
    expect(batch.meanDensityPer100Chars).toBe(0);
    for (const leaf of leaves(batch)) {
      expect(Number.isFinite(leaf as number)).toBe(true);
    }
  });

  it('全空夹具的报告与基线 JSON 仍是合法数值载荷', () => {
    const batch = aggregateDisfluencyBatch([]);
    const report = renderD7Report(batch, { sessions: 0 });
    expect(report).toContain('[D7] 不流利分布');
    const payload = buildDisfluencyBaselinePayload('empty-batch', 'debug-sessions-empty-batch', batch);
    expect(JSON.stringify(payload)).not.toMatch(/NaN|Infinity|null/);
  });
});

describe('D7 泄漏护栏 (隐私红线)', () => {
  const canaryTexts: readonly string[] = ['嗯，' + CANARY + '。', CANARY, '不对，' + CANARY + '。'];
  const summary = summarizeDisfluency(canaryTexts.map((text) => analyzeDisfluency(text)));
  const batch = aggregateDisfluencyBatch([summary]);

  it('整场 / 批次汇总结构里不出现台词占位串', () => {
    expect(JSON.stringify(summary)).not.toContain(CANARY);
    expect(JSON.stringify(batch)).not.toContain(CANARY);
  });

  it('D7 报告文本里不出现台词占位串', () => {
    expect(renderD7Report(batch, { sessions: 1 })).not.toContain(CANARY);
  });

  it('基线 JSON 载荷里不出现台词占位串, 且只有数字与批次 id', () => {
    const payload = buildDisfluencyBaselinePayload('canary-batch', 'debug-sessions-canary-batch', batch);
    expect(JSON.stringify(payload)).not.toContain(CANARY);
    expect(payload['batchId']).toBe('canary-batch');
    expect(payload['batchDir']).toBe('debug-sessions-canary-batch');
    const leavesOfPayload = leaves(payload);
    for (const leaf of leavesOfPayload) {
      if (typeof leaf === 'number') {
        expect(Number.isFinite(leaf)).toBe(true);
        continue;
      }
      if (typeof leaf === 'boolean') {
        // 种子对照第三列「是否落在区间内」是布尔标志位, 不是解释文本.
        continue;
      }
      // 只允许批次 id / 批次目录名这类标识符, 不允许任何台词片段.
      expect(typeof leaf).toBe('string');
      const text = leaf as string;
      expect(text).not.toContain(CANARY);
      expect(text.length).toBeLessThan(64);
    }
  });

  it('SessionAudit.disfluency 形态: 只有数值叶子, 无字符串叶子', () => {
    for (const leaf of leaves(summary)) {
      expect(typeof leaf).toBe('number');
      expect(Number.isFinite(leaf as number)).toBe(true);
    }
    expect(Object.keys(summary).toSorted()).toEqual([
      'densityPer100Chars',
      'eventTurnRate',
      'eventTurns',
      'events',
      'eventsPerTurn',
      'normalizedChars',
      'perTurn',
      'turns',
      'typeCounts',
    ]);
  });
});
