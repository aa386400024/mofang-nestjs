// V2026-11-12 Phase3 P0 (文字层真人度 · 不流利分析器单测):
//   覆盖蓝图 §6 P0 与本单 §5.6: 六类识别 / 消歧优先级 / 叠词白名单 / 连接词排除 /
//   聚合口径 / 边界 (空文本 · 纯标点 · 超长句) / 确定性.
//   纯函数测试: 不起 Nest, 不连 DB, 不读任何真实逐字稿.

import { describe, expect, it } from 'vitest';

import { analyzeDisfluency } from '../../../src/auto-practice/metrics/disfluency-analyzer.js';
import {
  aggregateDisfluency,
  EMPTY_DISFLUENCY_METRICS,
  normalizeForDetection,
  normalizeForLength,
} from '../../../src/auto-practice/metrics/disfluency-lexicon.js';

describe('Phase3 P0 · 不流利分类 (六类正例)', () => {
  it('filler: 句首填充词命中', () => {
    const result = analyzeDisfluency('嗯，我有点不知道怎么说');
    expect(result.counts.filler).toBe(1);
    expect(result.counts.pause).toBe(0);
    expect(result.hasEvent).toBe(true);
  });

  it('pause: 句中省略号算一次停顿', () => {
    const result = analyzeDisfluency('我本来以为没事的……结果还是没忍住');
    expect(result.counts.pause).toBe(1);
    expect(result.counts.trailoff).toBe(0);
  });

  it('repetition: 相邻重复字命中', () => {
    const result = analyzeDisfluency('我我觉得这次可能真的有点问题');
    expect(result.counts.repetition).toBe(1);
  });

  it('repair: 修正触发词命中', () => {
    const result = analyzeDisfluency('我们关系还行，不对，应该说只是表面还行');
    expect(result.counts.repair).toBe(1);
  });

  it('trailoff: 句末停顿 + 未完成片段 → 半截话', () => {
    const result = analyzeDisfluency('我其实想过要不要干脆就……');
    expect(result.counts.trailoff).toBe(1);
    expect(result.counts.pause).toBe(0);
  });

  it('elongation: 显式「词干 + 破折号」保守命中', () => {
    const result = analyzeDisfluency('哎——，怎么说呢');
    expect(result.counts.elongation).toBe(1);
  });
});

describe('Phase3 P0 · 消歧优先级 (一个位置只归一类)', () => {
  it('句末停顿归 trailoff, 不再重复计入 pause', () => {
    const result = analyzeDisfluency('我其实想过要不要干脆就……');
    expect(result.counts.trailoff).toBe(1);
    expect(result.counts.pause).toBe(0);
    expect(result.events).toBe(1);
  });

  it('填充词优先于拖音 (同一位置只归 filler)', () => {
    const result = analyzeDisfluency('嗯——，怎么说呢');
    expect(result.counts.filler).toBe(1);
    expect(result.counts.elongation).toBe(0);
  });

  it('修正触发词优先: 「不是」被认走时不再重复计「应该是」', () => {
    const result = analyzeDisfluency('其实不是这样');
    expect(result.counts.repair).toBe(1);
  });
});

describe('Phase3 P0 · 白名单与位置约束', () => {
  it('叠词白名单不计 repetition (妈妈 / 一点点)', () => {
    const result = analyzeDisfluency('我妈妈说一点点小事');
    expect(result.counts.repetition).toBe(0);
    expect(result.hasEvent).toBe(false);
  });

  it('连接词句中正常承接不计 filler', () => {
    const result = analyzeDisfluency('我然后去了那个地方');
    expect(result.counts.filler).toBe(0);
  });

  it('句首连接词计 filler (位置约束的另一侧)', () => {
    const result = analyzeDisfluency('然后我去了那个地方');
    expect(result.counts.filler).toBe(1);
  });
});

describe('Phase3 P0 · 聚合口径', () => {
  it('多轮聚合: 事件总数 / 轮次占比 / 密度 / 五类计数', () => {
    const turns = [
      analyzeDisfluency('嗯，我有点不知道怎么说'),
      analyzeDisfluency('我本来以为没事的……结果还是没忍住'),
      analyzeDisfluency('还行'),
    ];
    const aggregate = aggregateDisfluency(turns);
    expect(aggregate.eventsPerTurn).toBe(0.666667);
    expect(aggregate.eventTurnRate).toBe(0.666667);
    expect(aggregate.densityPer100Chars).toBe(7.407407);
    expect(aggregate.typeCounts.filler).toBe(1);
    expect(aggregate.typeCounts.pause).toBe(1);
    expect(aggregate.typeCounts.repair).toBe(0);
    expect(aggregate.typeCounts.repetition).toBe(0);
    expect(aggregate.typeCounts.trailoff).toBe(0);
    expect(aggregate.typeCounts.elongation).toBe(0);
  });

  it('空轮次集合 → 全零 (不抛错, 不出 NaN)', () => {
    const aggregate = aggregateDisfluency([]);
    expect(aggregate.eventsPerTurn).toBe(0);
    expect(aggregate.eventTurnRate).toBe(0);
    expect(aggregate.densityPer100Chars).toBe(0);
  });
});

describe('Phase3 P0 · 边界与确定性', () => {
  it('空文本 → 零值结构', () => {
    const result = analyzeDisfluency('');
    expect(result.events).toBe(0);
    expect(result.hasEvent).toBe(false);
    expect(result.normalizedLength).toBe(0);
    expect(result.counts).toEqual(EMPTY_DISFLUENCY_METRICS.counts);
  });

  it('纯标点 → 算一次停顿, 归一化长度为 0', () => {
    const result = analyzeDisfluency('……');
    expect(result.counts.pause).toBe(1);
    expect(result.normalizedLength).toBe(0);
  });

  it('超长句: 不炸, 计数合理', () => {
    const long = '这件事我想了很久'.repeat(200);
    const result = analyzeDisfluency(long);
    expect(result.normalizedLength).toBeGreaterThan(0);
    expect(result.counts.repetition).toBe(0);
  });

  it('无任何不流利的普通句 → 全零', () => {
    const result = analyzeDisfluency('今天天气不错');
    expect(result.events).toBe(0);
    expect(result.hasEvent).toBe(false);
  });

  it('同输入两次结果深相等 (确定性)', () => {
    const text = '嗯……我其实想过要不要干脆就……';
    expect(analyzeDisfluency(text)).toEqual(analyzeDisfluency(text));
  });
});

describe('Phase3 P0 · 归一化口径', () => {
  it('长度口径: 去空白 + 去标点', () => {
    expect(normalizeForLength('嗯，我说， 真的吗？')).toBe('嗯我说真的吗');
  });

  it('识别口径: 连续省略号合并为一个, 破折号统一', () => {
    expect(normalizeForDetection('等等……')).toBe('等等…');
    expect(normalizeForDetection('嗯——')).toBe('嗯——');
  });
});
