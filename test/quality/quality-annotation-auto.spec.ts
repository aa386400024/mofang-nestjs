// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 自动口径现算 · 单测):
//   覆盖任务单 §2.2 的 reveal / 一致性报告的**自动侧口径**:
//     ① 探索轮次按**来访者轮序** (从 1 起) 取第一个探索类策略;
//     ② 主导标签 = 5 个人工标签对应策略里出现最多的那个;
//     ③ 并列时按固定顺序取第一个 (口径必须可复算, 不能靠遍历顺序);
//     ④ 内核另外三个策略 (request / insight / discussing_plans) 不参与评选;
//     ⑤ 危机档位取最大值, 未知类别按 1 档兜底;
//     ⑥ 坏 trace 不炸 (逐字稿是文件, 字段缺失/类型不对不能拖垮整场).
//
//   验证: npx vitest run test/quality/quality-annotation-auto.spec.ts
//   时间戳: 2026-11-10 GMT+8
import { describe, expect, it } from 'vitest';

import { computeAutoMetrics, toAutoTraces, type AutoTraceInput } from '../../src/quality/quality-annotation-auto.js';

/**
 * 造一条 trace 摘要.
 *
 * @param turnIndex 轮次
 * @param strategy 内核策略
 * @returns trace 摘要
 */
function trace(turnIndex: number, strategy: string | null): AutoTraceInput {
  return { turnIndex, strategy, crisisDetected: false, crisisCategory: null };
}

describe('WP-J P2 · 自动口径现算', () => {
  it('① 探索轮次 = 第一个探索类策略所在的来访者轮序 (从 1 起)', () => {
    const result = computeAutoMetrics({
      visitorTurnCount: 4,
      traces: [trace(1, 'recounting'), trace(2, 'resistance'), trace(3, 'affective_exploration'), trace(4, 'simple_response')],
    });

    expect(result.explorationTurn).toBe(3);
  });

  it('① 全场没进探索 → explorationTurn = null', () => {
    const result = computeAutoMetrics({
      visitorTurnCount: 3,
      traces: [trace(1, 'recounting'), trace(2, 'resistance'), trace(3, 'simple_response')],
    });

    expect(result.explorationTurn).toBeNull();
  });

  it('① trace 缺号时按"未知"占位, 不把轮次算错', () => {
    // 第 2 轮没有 trace → 该轮按 unknown 参与统计, 探索轮次仍是第 3 轮.
    const result = computeAutoMetrics({
      visitorTurnCount: 3,
      traces: [trace(1, 'recounting'), trace(3, 'cognitive_exploration')],
    });

    expect(result.explorationTurn).toBe(3);
  });

  it('② 主导标签 = 出现最多的策略标签', () => {
    const result = computeAutoMetrics({
      visitorTurnCount: 4,
      traces: [trace(1, 'recounting'), trace(2, 'recounting'), trace(3, 'resistance'), trace(4, 'affective_exploration')],
    });

    expect(result.dominantLabel).toBe('recounting');
  });

  it('② affective_exploration 映射成前端词表里的 affective', () => {
    const result = computeAutoMetrics({
      visitorTurnCount: 2,
      traces: [trace(1, 'affective_exploration'), trace(2, 'affective_exploration')],
    });

    expect(result.dominantLabel).toBe('affective');
  });

  it('③ 并列时按固定顺序取第一个 (口径可复算)', () => {
    // recounting 与 resistance 各 1 次 → 按 ANNOTATION_LABELS 顺序取 recounting.
    const result = computeAutoMetrics({
      visitorTurnCount: 2,
      traces: [trace(1, 'resistance'), trace(2, 'recounting')],
    });

    expect(result.dominantLabel).toBe('recounting');
  });

  it('④ 内核另外三个策略不参与主导标签评选', () => {
    // request / insight / discussing_plans 人工点不出来 → 都不参与评选 → null.
    const result = computeAutoMetrics({
      visitorTurnCount: 3,
      traces: [trace(1, 'request'), trace(2, 'insight'), trace(3, 'discussing_plans')],
    });

    expect(result.dominantLabel).toBeNull();
  });

  it('⑤ 危机档位取所有轮次的最大值', () => {
    const result = computeAutoMetrics({
      visitorTurnCount: 3,
      traces: [
        { turnIndex: 1, strategy: 'recounting', crisisDetected: true, crisisCategory: 'passive_ideation' },
        { turnIndex: 2, strategy: 'recounting', crisisDetected: true, crisisCategory: 'suicide_plan' },
        { turnIndex: 3, strategy: 'recounting', crisisDetected: false, crisisCategory: null },
      ],
    });

    expect(result.crisisLevel).toBe(3);
  });

  it('⑤ 未知危机类别按 1 档兜底 (与审计脚本同口径)', () => {
    const result = computeAutoMetrics({
      visitorTurnCount: 1,
      traces: [{ turnIndex: 1, strategy: 'recounting', crisisDetected: true, crisisCategory: 'some_new_category' }],
    });

    expect(result.crisisLevel).toBe(1);
  });

  it('⑤ 没有危机 → 0 档', () => {
    const result = computeAutoMetrics({ visitorTurnCount: 2, traces: [trace(1, 'recounting'), trace(2, 'recounting')] });

    expect(result.crisisLevel).toBe(0);
  });

  it('⑥ 坏 trace 跳过, 不炸 (逐字稿是文件, 形状可能不对)', () => {
    const traces = toAutoTraces([null, 'not-an-object', 42, { turnIndex: 1, intention: { strategy: 'recounting' } }]);

    // null / 字符串 / 数字都不是对象 → 全部跳过, 只有那条真 trace 被抽出来.
    expect(traces).toHaveLength(1);
    expect(traces[0]).toEqual({ turnIndex: 1, strategy: 'recounting', crisisDetected: false, crisisCategory: null });
  });
});
