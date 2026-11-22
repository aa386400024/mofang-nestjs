// V2026-11-20 建立 (AF-209 · R3 语域审计):
//   覆盖“可朗读性”硬违约与咨询语域软信号。
//
//   纯函数；不读 env / 不调 LLM / 不写日志。

import { describe, expect, it } from 'vitest';

import { buildRealismEventPlan, inspectVisitorRealism, inspectVisitorRegister } from '../../src/shared/realism/index.js';

function plan(maxEvents = 2) {
  return buildRealismEventPlan({
    role: 'anxious_seeker',
    state: 'steady',
    scene: 'in_person',
    quotas: { filler: 1, pause: 1, repair: 1, trailoff: 1, repetition: 0, elongation: 0, maxEvents },
  });
}

describe('AF-209 · 不可朗读文本硬违约', () => {
  it('括号动作是硬违约，不被当成普通台词', () => {
    const result = inspectVisitorRegister('（沉默）我有点累。');
    expect(result.violations).toEqual(['non_spoken_text']);
    expect(result.signals).toEqual([]);
  });

  it('星号动作同样不可朗读', () => {
    const result = inspectVisitorRegister('*叹气* 我也不知道从哪里说。');
    expect(result.violations).toContain('non_spoken_text');
  });

  it.each(['对方正在输入', '语音条', '聊天框', '屏幕上', '未读消息'])('界面 chrome「%s」不是来访者台词', (marker) => {
    expect(inspectVisitorRegister(`我看到了${marker}。`).violations).toContain('non_spoken_text');
  });

  it('生活语义的“给朋友发消息”不是界面 chrome，不能误杀', () => {
    expect(inspectVisitorRegister('给朋友发消息今晚可以试试。').violations).toEqual([]);
  });

  it('风险轮也不接受括号动作，安全优先不等于可以写旁白', () => {
    const audit = inspectVisitorRealism('（深呼吸）我现在还好。', { state: 'risk', shape: 'grounded_short' }, plan(0));
    expect(audit.ok).toBe(false);
    expect(audit.reasons).toContain('non_spoken_text');
  });

  it('设定 / prompt 回显是独立硬违约，不混进普通语域信号', () => {
    const audit = inspectVisitorRegister('这一轮怎么说：\n这轮你不太想多说。\n硬规则：一次最多说一到三句。');
    expect(audit.violations).toEqual(['prompt_echo']);
  });
});

describe('AF-209 · 咨询语域软信号', () => {
  it('临床术语只记信号，不判硬失败', () => {
    const result = inspectVisitorRegister('我觉得这是我的防御机制在起作用。');
    expect(result.violations).toEqual([]);
    expect(result.signals).toContain('clinical_jargon');
  });

  it('书面连接词只记信号', () => {
    const result = inspectVisitorRegister('此外，我最近睡不好。');
    expect(result.violations).toEqual([]);
    expect(result.signals).toContain('bookish_connective');
  });

  it('助手口吻与元话语只记信号', () => {
    const result = inspectVisitorRegister('我理解你的意思，你说得对；让我重新组织一下。');
    expect(result.violations).toEqual([]);
    expect(result.signals).toEqual(expect.arrayContaining(['assistant_tone', 'meta_speech']));
  });

  it('正常来访者口语不误报', () => {
    const result = inspectVisitorRegister('我今天在咨询室门口站了很久，就是不太想进来。');
    expect(result).toEqual({ violations: [], signals: [] });
  });

  it('软信号不会让真人度审计整体失败', () => {
    const audit = inspectVisitorRealism('此外，我最近睡不好。', { state: 'steady', shape: 'short_answer_then_silence' }, plan(2));
    expect(audit.ok).toBe(true);
    expect(audit.signals).toContain('bookish_connective');
  });
});
