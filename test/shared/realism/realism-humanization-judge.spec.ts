import { describe, expect, it } from 'vitest';

import {
  ANXIOUS_REPAIR_PER_TURN_MIN,
  GUARDED_PAUSE_PER_TURN_MIN,
  GUARDED_TRAILOFF_PER_TURN_MIN,
  SIGNATURE_DENSITY_CAP_PER100,
  SIGNATURE_JUDGE_VERSION,
  detailSignatureVerdicts,
  judgeSignatureRealism,
  summarizeSignatureVerdicts,
} from '../../../src/shared/realism/realism-humanization-judge.js';

function counts(partial: Partial<Record<string, number>> = {}): Record<string, number> {
  return {
    filler: partial['filler'] ?? 0,
    pause: partial['pause'] ?? 0,
    repetition: partial['repetition'] ?? 0,
    repair: partial['repair'] ?? 0,
    trailoff: partial['trailoff'] ?? 0,
    elongation: partial['elongation'] ?? 0,
  };
}

describe('realism-humanization-judge', () => {
  it('固定版本与三个人设阈值', () => {
    expect(SIGNATURE_JUDGE_VERSION).toBe('realism-signature-judge-v1');
    expect(SIGNATURE_DENSITY_CAP_PER100).toBe(4.943817);
    expect(ANXIOUS_REPAIR_PER_TURN_MIN).toBe(0.05);
    expect(GUARDED_PAUSE_PER_TURN_MIN).toBe(0.9);
    expect(GUARDED_TRAILOFF_PER_TURN_MIN).toBe(0.15);
  });

  it('焦虑无改口判 off-like', () => {
    const result = judgeSignatureRealism({ persona: 'anxious', turns: 12, densityPer100: 2, counts: counts({ filler: 4, pause: 3 }) });
    expect(result.verdict).toBe('off-like');
    expect(result.signaturePassed).toBe(false);
    expect(result.signatureScore).toBe(0);
  });

  it('焦虑出现一次改口即保留签名, 低密度判 humanized', () => {
    const result = judgeSignatureRealism({ persona: 'anxious', turns: 12, densityPer100: 2.5, counts: counts({ repair: 1 }) });
    expect(result.verdict).toBe('humanized');
    expect(result.signaturePassed).toBe(true);
    expect(result.signatureScore).toBeCloseTo(1.666667, 5);
  });

  it('焦虑签名保留但密度超过上限判 overloaded', () => {
    const result = judgeSignatureRealism({ persona: 'anxious', turns: 12, densityPer100: 5.2, counts: counts({ repair: 3 }) });
    expect(result.verdict).toBe('overloaded');
    expect(result.reasons).toContain('签名保留但密度过载: 判 overloaded');
  });

  it('回避停顿未到每轮且无半截话判 off-like', () => {
    const result = judgeSignatureRealism({ persona: 'guarded', turns: 12, densityPer100: 3, counts: counts({ pause: 8, trailoff: 1 }) });
    expect(result.verdict).toBe('off-like');
    expect(result.signaturePassed).toBe(false);
  });

  it('回避停顿接近每轮即保留签名', () => {
    const result = judgeSignatureRealism({ persona: 'guarded', turns: 12, densityPer100: 3, counts: counts({ pause: 11 }) });
    expect(result.verdict).toBe('humanized');
    expect(result.signatureScore).toBeCloseTo(1.018519, 5);
  });

  it('回避半截话两次即保留签名', () => {
    const result = judgeSignatureRealism({ persona: 'guarded', turns: 12, densityPer100: 3, counts: counts({ trailoff: 2 }) });
    expect(result.verdict).toBe('humanized');
    expect(result.signatureScore).toBeCloseTo(1.111111, 5);
  });

  it('回避一次半截话不足以保留签名', () => {
    const result = judgeSignatureRealism({ persona: 'guarded', turns: 12, densityPer100: 3, counts: counts({ trailoff: 1 }) });
    expect(result.verdict).toBe('off-like');
  });

  it('密度恰好等于上限不算过载', () => {
    const result = judgeSignatureRealism({
      persona: 'anxious',
      turns: 12,
      densityPer100: SIGNATURE_DENSITY_CAP_PER100,
      counts: counts({ repair: 2 }),
    });
    expect(result.verdict).toBe('humanized');
  });

  it('密度略高于上限即过载', () => {
    const result = judgeSignatureRealism({
      persona: 'anxious',
      turns: 12,
      densityPer100: SIGNATURE_DENSITY_CAP_PER100 + 0.000001,
      counts: counts({ repair: 2 }),
    });
    expect(result.verdict).toBe('overloaded');
  });

  it('中文人设名也识别', () => {
    expect(judgeSignatureRealism({ persona: '焦虑依恋', turns: 12, densityPer100: 2, counts: counts({ repair: 1 }) }).personaFamily).toBe(
      'anxious',
    );
    expect(judgeSignatureRealism({ persona: '回避依恋', turns: 12, densityPer100: 2, counts: counts({ trailoff: 2 }) }).personaFamily).toBe(
      'guarded',
    );
  });

  it('未知人设直接抛错', () => {
    expect(() => judgeSignatureRealism({ persona: 'unknown', turns: 12, densityPer100: 2, counts: counts() })).toThrow(/未知人设/);
  });

  it('非法 turns 与非法密度抛错', () => {
    expect(() => judgeSignatureRealism({ persona: 'anxious', turns: 0, densityPer100: 2, counts: counts() })).toThrow(/turns/);
    expect(() => judgeSignatureRealism({ persona: 'anxious', turns: 12, densityPer100: Number.NaN, counts: counts() })).toThrow(/density/);
  });

  it('负数与缺失计数按 0 处理', () => {
    const result = judgeSignatureRealism({
      persona: 'anxious',
      turns: 12,
      densityPer100: 2,
      counts: { repair: -3, filler: Number.NaN },
    });
    expect(result.verdict).toBe('off-like');
    expect(result.signatureScore).toBe(0);
  });

  it('按 persona + arm 汇总三态与均值', () => {
    const cells = summarizeSignatureVerdicts([
      { persona: 'anxious', arm: 'a', turns: 12, densityPer100: 2, counts: counts({ repair: 1 }) },
      { persona: 'anxious', arm: 'a', turns: 12, densityPer100: 6, counts: counts({ repair: 2 }) },
      { persona: 'anxious', arm: 'b', turns: 12, densityPer100: 2, counts: counts() },
    ]);
    expect(cells).toHaveLength(2);
    const cellA = cells.find((cell) => cell.arm === 'a');
    expect(cellA?.humanized).toBe(1);
    expect(cellA?.overloaded).toBe(1);
    expect(cellA?.signatureRate).toBe(1);
    expect(cellA?.meanDensityPer100).toBe(4);
    const cellB = cells.find((cell) => cell.arm === 'b');
    expect(cellB?.offLike).toBe(1);
  });

  it('逐样本明细按人设、臂、密度稳定排序', () => {
    const details = detailSignatureVerdicts([
      { persona: 'guarded', arm: 'z', turns: 12, densityPer100: 3, counts: counts({ trailoff: 2 }) },
      { persona: 'anxious', arm: 'b', turns: 12, densityPer100: 5, counts: counts({ repair: 1 }) },
      { persona: 'anxious', arm: 'a', turns: 12, densityPer100: 2, counts: counts({ repair: 1 }) },
    ]);
    expect(details.map((detail) => `${detail.persona}/${detail.arm}`)).toEqual(['anxious/a', 'anxious/b', 'guarded/z']);
    expect(details.map((detail) => detail.verdict)).toEqual(['humanized', 'overloaded', 'humanized']);
  });
});
