// V2026-11-23 建立 (AF-323 · 分类器影子审计统计层):
//   职责: 钉死审计口径 —— 降级轮不进质量分母、Jaccard 空集按一致、缺失场次显性列出.
//   边界: 纯函数; 不读文件 / 不发网络 / 不接触原文.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TARGET_SESSION_IDS,
  formatRatio,
  jaccard,
  parseTargetIds,
  renderAuditMarkdown,
  summarizeAudit,
} from '../../ops/quality/af322-classifier-shadow-audit.mjs';

/**
 * 造一条无原文观测.
 *
 * @param overrides 覆写字段
 * @returns 观测记录
 */
function observation(overrides = {}) {
  return {
    sessionId: 'debug_a',
    turnIndex: 1,
    ruleKinds: ['empathy'],
    modelKinds: ['empathy'],
    agreement: true,
    confidence: 0.8,
    degraded: false,
    modelId: 'MiniMax-M3',
    ...overrides,
  };
}

describe('AF-323 分类器影子审计统计层', () => {
  it('解析目标 id：缺省 8 场，自定义去空去重', () => {
    expect(parseTargetIds(undefined)).toEqual(DEFAULT_TARGET_SESSION_IDS);
    expect(parseTargetIds('debug_a, debug_b, debug_a,')).toEqual(['debug_a', 'debug_b']);
  });

  it('Jaccard：空集按一致，部分重叠与完全不一致', () => {
    expect(jaccard([], [])).toBe(1);
    expect(jaccard(['empathy'], ['empathy'])).toBe(1);
    expect(jaccard(['empathy'], ['judgment'])).toBe(0);
    expect(jaccard(['empathy', 'open_probe'], ['empathy'])).toBeCloseTo(1 / 2);
  });

  it('汇总：降级轮单独计数，质量指标只用可用轮', () => {
    const records = [
      observation(),
      observation({ turnIndex: 2, ruleKinds: ['empathy'], modelKinds: ['holding_present'], agreement: false }),
      observation({ turnIndex: 3, degraded: true, ruleKinds: ['neutral'], modelKinds: [] }),
    ];
    const summary = summarizeAudit(records, ['debug_a', 'debug_b']);

    expect(summary.total).toBe(3);
    expect(summary.degraded).toBe(1);
    expect(summary.usable).toBe(2);
    expect(summary.exactAgreement).toBe(1);
    expect(summary.exactAgreementRate).toBe(0.5);
    expect(summary.meanJaccard).toBe(0.5);
    expect(summary.modelNeutral).toBe(0);
    expect(summary.missingSessions).toEqual(['debug_b']);
    expect(summary.bySession.debug_a.total).toBe(3);
    expect(summary.bySession.debug_b.present).toBe(false);
  });

  it('汇总：neutral 率与缺失场次都显性列出', () => {
    const summary = summarizeAudit(
      [
        observation({ ruleKinds: ['neutral'], modelKinds: ['neutral'] }),
        observation({ turnIndex: 2, ruleKinds: ['neutral'], modelKinds: ['empathy'], agreement: false }),
      ],
      ['debug_a'],
    );
    expect(summary.ruleNeutralRate).toBe(1);
    expect(summary.modelNeutralRate).toBe(0.5);
    expect(summary.bothNeutral).toBe(1);
    const markdown = renderAuditMarkdown(summary);
    expect(markdown).toMatch('缺失场次 | 无');
    expect(markdown).toMatch('| debug_a | 2 |');
  });

  it('比率格式化：null / 非有限值统一 n/a', () => {
    expect(formatRatio(null)).toBe('n/a');
    expect(formatRatio(Number.NaN)).toBe('n/a');
    expect(formatRatio(0.12345)).toBe('0.1235');
  });
});
