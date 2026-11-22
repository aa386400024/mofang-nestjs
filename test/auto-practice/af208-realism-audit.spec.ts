// V2026-11-20 建立 (AF-208 · R2 真人度):
//   覆盖六类口语事件计数、话轮形态硬违约、配额超限与风险轮豁免。
//
//   纯函数；不读 env / 不调 LLM / 不写日志。

import { describe, expect, it } from 'vitest';

import { buildRealismEventPlan, countRealismEvents, inspectVisitorRealism } from '../../src/shared/realism/index.js';

function plan(maxEvents = 2) {
  return buildRealismEventPlan({
    role: 'anxious_seeker',
    state: 'steady',
    scene: 'in_person',
    quotas: { filler: 1, pause: 1, repair: 1, trailoff: 1, repetition: 0, elongation: 0, maxEvents },
  });
}

describe('AF-208 · 口语事件计数', () => {
  it('同一位置只归一类：改口 > 半截话 > 重复 > 拖长音 > 停顿 > 填充', () => {
    const result = countRealismEvents('嗯，那个……我我……');
    expect(result.counts.filler).toBe(2);
    expect(result.counts.pause).toBe(1);
    expect(result.counts.repetition).toBe(1);
    expect(result.counts.trailoff).toBe(1);
    expect(result.totalEvents).toBe(5);
  });

  it('改口只认严格口语标记，不把疑问“是不是”算进去', () => {
    expect(countRealismEvents('我是不是太敏感了？').counts.repair).toBe(0);
    expect(countRealismEvents('不对，我是说，我有点怕。').counts.repair).toBe(1);
  });

  it('合法叠词不算不流利', () => {
    const result = countRealismEvents('谢谢，慢慢说就好。');
    expect(result.counts.repetition).toBe(0);
  });
});

const LONG_TEXT =
  '我今天其实想了很多，我觉得我应该把最近发生的事情都跟您说清楚，从我小时候一直到工作以后，包括家里那些一直没处理完的事，还有我最近睡不好、吃不下、上班也总是拖着，这样可能对我有帮助，也免得我下次还要再重新讲一遍，虽然我也不知道从哪里开始，但我想试一试。';

describe('AF-208 · 话轮形态审计', () => {
  it('该短却长篇 → too_long', () => {
    const audit = inspectVisitorRealism(LONG_TEXT, { state: 'steady', shape: 'short_answer_then_silence' }, plan(3));
    expect(audit.ok).toBe(false);
    expect(audit.reasons).toContain('too_long');
  });

  it('该半句却铺成长段 → too_long', () => {
    const audit = inspectVisitorRealism(
      `${LONG_TEXT}而且我怕说了以后会更难受，晚上又睡不着，第二天还要装作没事一样去上班。`,
      { state: 'steady', shape: 'fragment_then_stop' },
      plan(3),
    );
    expect(audit.ok).toBe(false);
    expect(audit.reasons).toContain('too_long');
  });

  it('该问回却没问 → missing_question_back', () => {
    const audit = inspectVisitorRealism('我不知道。', { state: 'steady', shape: 'question_back' }, plan(3));
    expect(audit.ok).toBe(false);
    expect(audit.reasons).toContain('missing_question_back');
  });

  it('该改口却没改 → missing_repair', () => {
    const audit = inspectVisitorRealism('我就是有点累。', { state: 'steady', shape: 'correct_self_mid_sentence' }, plan(3));
    expect(audit.ok).toBe(false);
    expect(audit.reasons).toContain('missing_repair');
  });

  it('不流利超配额 → over_quota', () => {
    const audit = inspectVisitorRealism('嗯……我我那个……', { state: 'steady', shape: 'short_answer_then_silence' }, plan(2));
    expect(audit.ok).toBe(false);
    expect(audit.reasons).toContain('over_quota');
  });

  it('合规短句放行', () => {
    const audit = inspectVisitorRealism('嗯……有点累。', { state: 'steady', shape: 'short_answer_then_silence' }, plan(2));
    expect(audit).toMatchObject({ ok: true, reasons: [], totalEvents: 2 });
  });

  it('该戒备挡回却没挡 → 只记软信号，不触发重试', () => {
    const audit = inspectVisitorRealism('我还可以，最近就那样。', { state: 'guarded', shape: 'guarded_deflection' }, plan(3));
    expect(audit.ok).toBe(true);
    expect(audit.reasons).toHaveLength(0);
    expect(audit.signals).toContain('missing_deflection');
  });

  it('风险轮不做形态/配额强判', () => {
    const audit = inspectVisitorRealism('我……不想活了。', { state: 'risk', shape: 'grounded_short' }, plan(0));
    expect(audit.ok).toBe(true);
  });
});
