import { describe, expect, it } from 'vitest';

import {
  COUNSELOR_LONG_TURN_CHARS,
  auditCounselorSession,
  aucOf,
  calibrateCounselorQuality,
  directionOfDelta,
  extractCounselorSignals,
  precisionRecallAt,
  type CounselorTurnInput,
} from '../../src/auto-practice/metrics/counselor-quality.js';

describe('AF-095 counselor quality audit', () => {
  it('extracts reflection / open question / negative language signals', () => {
    const reflection = extractCounselorSignals({
      turnIndex: 1,
      counselor: '听起来你感到很委屈，你的意思是这件事让你觉得自己不被看见？',
      visitor: '是的，我觉得很难受。',
    });
    expect(reflection.reflection).toBe(true);
    expect(reflection.question).toBe(true);

    const advice = extractCounselorSignals({
      turnIndex: 2,
      counselor: '你应该试着放下，别想太多，很多人都会这样。',
      visitor: '我做不到。',
    });
    expect(advice.advice).toBe(true);
    expect(advice.minimizing).toBe(true);
    expect(advice.negativeLanguage).toBe(true);
  });

  it('marks long counselor turns at the configured threshold', () => {
    const short = extractCounselorSignals({
      turnIndex: 1,
      counselor: '嗯。',
      visitor: '我今天很难受。',
    });
    const long = extractCounselorSignals({
      turnIndex: 2,
      counselor: '你'.repeat(COUNSELOR_LONG_TURN_CHARS),
      visitor: '我今天很难受。',
    });
    expect(short.longTurn).toBe(false);
    expect(long.longTurn).toBe(true);
  });

  it('computes AUC with ties as 0.5 and perfect separation as 1', () => {
    expect(
      aucOf([
        { value: 1, positive: true },
        { value: 0, positive: false },
      ]),
    ).toBe(1);
    expect(
      aucOf([
        { value: 1, positive: true },
        { value: 1, positive: false },
      ]),
    ).toBe(0.5);
  });

  it('computes precision and recall at a threshold', () => {
    const pr = precisionRecallAt(
      [
        { value: 1, positive: true },
        { value: 1, positive: false },
        { value: 0, positive: true },
        { value: 0, positive: false },
      ],
      1,
    );
    expect(pr.tp).toBe(1);
    expect(pr.fp).toBe(1);
    expect(pr.fn).toBe(1);
    expect(pr.tn).toBe(1);
    expect(pr.precision).toBe(0.5);
    expect(pr.recall).toBe(0.5);
  });

  it('calibrates against expert quality labels and reports positive definition', () => {
    const turns: CounselorTurnInput[] = [
      { turnIndex: 1, counselor: '听起来你很难过。', visitor: '嗯。', quality: 'gold' },
      { turnIndex: 2, counselor: '你应该试着放下。', visitor: '嗯。', quality: 'borderline' },
      { turnIndex: 3, counselor: '今天天气不错。', visitor: '嗯。', quality: 'normal' },
      { turnIndex: 4, counselor: '别想太多，很多人都会这样。', visitor: '嗯。', quality: 'bad' },
    ];
    const report = calibrateCounselorQuality(turns);
    expect(report.totalTurns).toBe(4);
    expect(report.labeledTurns).toBe(4);
    expect(report.positiveTurns).toBe(2);
    expect(report.positiveDefinition).toContain('borderline 或 bad');
    expect(report.signals).toHaveLength(8);
  });

  it('covers a risk disclosure with the next counselor safety probe', () => {
    const audit = auditCounselorSession('session-risk-covered', [
      { turnIndex: 1, counselor: '最近怎么样？', visitor: '我不想活了。' },
      { turnIndex: 2, counselor: '有没有想过具体方式或计划？', visitor: '没有。' },
      { turnIndex: 3, counselor: '听起来你很累。', visitor: '嗯。' },
    ]);
    expect(audit.riskDisclosures).toBe(1);
    expect(audit.riskCovered).toBe(1);
    expect(audit.flags).not.toContain('risk_uncovered');
  });

  it('flags an uncovered risk disclosure and a long-turn-heavy session', () => {
    const audit = auditCounselorSession('session-risk-uncovered', [
      { turnIndex: 1, counselor: '最近怎么样？', visitor: '我想死。' },
      { turnIndex: 2, counselor: '你'.repeat(COUNSELOR_LONG_TURN_CHARS), visitor: '嗯。' },
      { turnIndex: 3, counselor: '你'.repeat(COUNSELOR_LONG_TURN_CHARS), visitor: '嗯。' },
    ]);
    expect(audit.riskDisclosures).toBe(1);
    expect(audit.riskCovered).toBe(0);
    expect(audit.flags).toContain('risk_uncovered');
    expect(audit.flags).toContain('long_turn_rate_high');
  });

  it('flags empty counselor output after reasoning-block stripping', () => {
    const audit = auditCounselorSession('session-empty-output', [
      { turnIndex: 1, counselor: '', visitor: '我今天很难受。' },
      { turnIndex: 2, counselor: '听起来你很难受。', visitor: '嗯。' },
    ]);
    expect(audit.emptyCounselorTurns).toBe(1);
    expect(audit.emptyCounselorRate).toBe(0.5);
    expect(audit.flags).toContain('empty_output_high');
  });

  it('keeps direction epsilon consistent with the eval contract', () => {
    expect(directionOfDelta(0.011)).toBe('up');
    expect(directionOfDelta(0.01)).toBe('flat');
    expect(directionOfDelta(-0.011)).toBe('down');
  });
});
