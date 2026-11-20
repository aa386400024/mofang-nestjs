// V2026-11-21 建立 (AF-213 · R4 场景化语域):
//   线上文字咨询允许出现真实界面动作；面对面与语音仍按不可朗读硬拦。

import { describe, expect, it } from 'vitest';

import {
  buildRealismEventPlan,
  buildVisitorRealismProfile,
  buildVisitorRealismPromptBlock,
  inspectVisitorRealism,
  inspectVisitorRegister,
  type VisitorRealismContext,
} from '../../src/shared/realism/index.js';

const BASE_CONTEXT: VisitorRealismContext = {
  attachmentStyle: 'secure',
  narrativeStyle: 'structured',
  expressionTone: 'restrained',
  trust: 0.5,
  arousal: 0.4,
  verbalResistance: 0.3,
  depthResistance: 0.3,
  styleResistance: 0.3,
};

const ONLINE_TEXT: VisitorRealismContext = { ...BASE_CONTEXT, encounter: { mode: 'online', channel: 'text' } };
const ONLINE_VOICE: VisitorRealismContext = { ...BASE_CONTEXT, encounter: { mode: 'online', channel: 'voice' } };
const IN_PERSON: VisitorRealismContext = { ...BASE_CONTEXT, encounter: { mode: 'in_person' } };

function plan(maxEvents = 2) {
  return buildRealismEventPlan({
    role: 'anxious_seeker',
    state: 'steady',
    scene: 'online_text',
    quotas: { filler: 1, pause: 1, repair: 1, trailoff: 1, repetition: 0, elongation: 0, maxEvents },
  });
}

describe('AF-213 · 界面内容按场景判定', () => {
  it('线上文字咨询里“打开聊天框看回复”是台词内容，不是旁白', () => {
    expect(inspectVisitorRegister('我打开聊天框又看了一遍，你刚才那句话我还没回。', { scene: 'online_text' }).violations).toEqual([]);
  });

  it('面对面咨询仍把界面词当成不可朗读文本', () => {
    expect(inspectVisitorRegister('我打开聊天框又看了一遍。', { scene: 'in_person' }).violations).toEqual(['non_spoken_text']);
  });

  it('语音咨询不允许界面操作，避免把手机界面念出来', () => {
    expect(inspectVisitorRegister('我看到你发的语音条了。', { scene: 'online_voice' }).violations).toEqual(['non_spoken_text']);
  });

  it('任何场景都不允许舞台动作', () => {
    expect(inspectVisitorRegister('（沉默）我不想说。', { scene: 'online_text' }).violations).toEqual(['non_spoken_text']);
  });

  it('任何场景都不允许 prompt 回显', () => {
    expect(inspectVisitorRegister('这一轮怎么说：回答要短。', { scene: 'online_text' }).violations).toEqual(['prompt_echo']);
  });

  it('缺省场景按面对面处理，保持旧口径', () => {
    expect(inspectVisitorRegister('我打开聊天框又看了一遍。').violations).toEqual(['non_spoken_text']);
  });
});

describe('AF-213 · 审计链路透传场景', () => {
  it('online_text 下界面动作不触发硬失败', () => {
    const audit = inspectVisitorRealism('我打开聊天框又看了一遍。', { state: 'steady', shape: 'text_short', scene: 'online_text' }, plan());
    expect(audit.ok).toBe(true);
  });

  it('in_person 下同一句话触发 non_spoken_text', () => {
    const audit = inspectVisitorRealism('我打开聊天框又看了一遍。', { state: 'steady', shape: 'text_short', scene: 'in_person' }, plan());
    expect(audit.ok).toBe(false);
    expect(audit.reasons).toContain('non_spoken_text');
  });
});

describe('AF-213 · 场景 directive', () => {
  it('online_text 的 prompt 允许真实界面动作，但禁止写成旁白', () => {
    const block = buildVisitorRealismPromptBlock(buildVisitorRealismProfile(ONLINE_TEXT, 'active'));
    expect(block).toContain('允许提到正在看对话');
    expect(block).toContain('不要把界面操作写成旁白');
  });

  it('in_person 的 prompt 仍明确禁止线上界面词', () => {
    const block = buildVisitorRealismPromptBlock(buildVisitorRealismProfile(IN_PERSON, 'active'));
    expect(block).toContain('不要写任何线上界面词');
  });

  it('online_voice 仍按同步语音约束，不放开界面词', () => {
    const block = buildVisitorRealismPromptBlock(buildVisitorRealismProfile(ONLINE_VOICE, 'active'));
    expect(block).toContain('不要写任何界面词或软件操作');
  });
});
