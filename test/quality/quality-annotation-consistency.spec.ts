// V2026-11-10 治本 (WP-J P2 · 专业级标注工具 · 一致性计算 · 单测):
//   覆盖任务单 §2.2 一致性报告的口径:
//     ① 未标注的行**不参与**对比 (但计入 total);
//     ② 标签一致率 = 命中数 / 可比数;
//     ③ 危机档位一致率;
//     ④ 探索轮次平均绝对误差 (MAE);
//     ⑤ 没有可比场次时三个指标返 **null 而不是 0** ——
//        "还没法比"与"完全不一致"是两件事, 返 0 会让看板显示"零一致".
//
//   验证: npx vitest run test/quality/quality-annotation-consistency.spec.ts
//   时间戳: 2026-11-10 GMT+8
import { describe, expect, it } from 'vitest';

import { computeConsistency, type ConsistencyInput } from '../../src/quality/quality-annotation-consistency.js';

/**
 * 造一条一致性输入.
 *
 * @param overrides 覆盖字段
 * @returns 输入
 */
function input(overrides: Partial<ConsistencyInput>): ConsistencyInput {
  return {
    labeled: true,
    humanLabel: 'recounting',
    humanCrisisLevel: 0,
    humanExplorationTurn: null,
    auto: { explorationTurn: null, dominantLabel: null, crisisLevel: 0 },
    ...overrides,
  };
}

describe('WP-J P2 · 一致性计算', () => {
  it('① 未标注的行不参与对比, 但计入 total', () => {
    const report = computeConsistency([
      input({ labeled: true, humanLabel: 'recounting', auto: { explorationTurn: null, dominantLabel: 'recounting', crisisLevel: 0 } }),
      input({ labeled: false, humanLabel: null, auto: { explorationTurn: null, dominantLabel: 'resistance', crisisLevel: 0 } }),
    ]);

    expect(report.total).toBe(2);
    expect(report.labeled).toBe(1);
    // 未标注那场的人工标签是 null, 若被算进来会把一致率拉到 0.5.
    expect(report.labelAgreement).toBe(1);
  });

  it('② 标签一致率 = 命中数 / 可比数', () => {
    const report = computeConsistency([
      input({ humanLabel: 'recounting', auto: { explorationTurn: null, dominantLabel: 'recounting', crisisLevel: 0 } }),
      input({ humanLabel: 'recounting', auto: { explorationTurn: null, dominantLabel: 'resistance', crisisLevel: 0 } }),
      input({ humanLabel: 'recounting', auto: { explorationTurn: null, dominantLabel: 'recounting', crisisLevel: 0 } }),
    ]);

    expect(report.labelAgreement).toBeCloseTo(2 / 3);
  });

  it('② 自动侧没标签时该场不参与标签对比 (不当作不一致)', () => {
    const report = computeConsistency([
      input({ humanLabel: 'recounting', auto: { explorationTurn: null, dominantLabel: 'recounting', crisisLevel: 0 } }),
      input({ humanLabel: 'recounting', auto: { explorationTurn: null, dominantLabel: null, crisisLevel: 0 } }),
    ]);

    expect(report.labelAgreement).toBe(1);
  });

  it('③ 危机档位一致率', () => {
    const report = computeConsistency([
      input({ humanCrisisLevel: 0, auto: { explorationTurn: null, dominantLabel: null, crisisLevel: 0 } }),
      input({ humanCrisisLevel: 2, auto: { explorationTurn: null, dominantLabel: null, crisisLevel: 2 } }),
      input({ humanCrisisLevel: 1, auto: { explorationTurn: null, dominantLabel: null, crisisLevel: 0 } }),
    ]);

    expect(report.crisisAgreement).toBeCloseTo(2 / 3);
  });

  it('④ 探索轮次 MAE (两边都有值才参与)', () => {
    const report = computeConsistency([
      input({ humanExplorationTurn: 3, auto: { explorationTurn: 5, dominantLabel: null, crisisLevel: 0 } }),
      input({ humanExplorationTurn: 2, auto: { explorationTurn: 2, dominantLabel: null, crisisLevel: 0 } }),
      // 人工没填 → 不参与 (不是误差 0, 是没数据)
      input({ humanExplorationTurn: null, auto: { explorationTurn: 4, dominantLabel: null, crisisLevel: 0 } }),
    ]);

    expect(report.explorationTurnMae).toBeCloseTo(1);
  });

  it('⑤ 没有可比场次 → 三个指标都是 null (不是 0)', () => {
    const report = computeConsistency([input({ labeled: false, humanLabel: null })]);

    expect(report.labeled).toBe(0);
    expect(report.total).toBe(1);
    expect(report.labelAgreement).toBeNull();
    expect(report.crisisAgreement).toBeNull();
    expect(report.explorationTurnMae).toBeNull();
  });

  it('⑤ 逐字稿缺失 (auto = null) 的场次跳过对比, 不炸', () => {
    const report = computeConsistency([input({ auto: null }), input({ auto: null })]);

    expect(report.labeled).toBe(2);
    expect(report.labelAgreement).toBeNull();
    expect(report.crisisAgreement).toBeNull();
    expect(report.explorationTurnMae).toBeNull();
  });
});
