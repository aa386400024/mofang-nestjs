// V2026-11-20 建立 (AF-209 · R3 场景矩阵):
//   把 7 类角色 × 3 类场景 × 4 类状态带的真人度层固化成确定性回归：
//   场景默认面对面、active 才注入、语域层进入 prompt、prompt 不自带界面词。
//
//   纯函数 + prompt 拼装；不读 DB / 不调 LLM。

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildVisitorRealismProfile,
  buildVisitorRealismPromptBlock,
  REALISM_SCENES,
  REALISM_STATE_BANDS,
  VISITOR_TURN_SHAPES,
  VISITOR_VOICE_ROLES,
  type VisitorRealismContext,
  type VisitorVoiceRole,
} from '../../src/shared/realism/index.js';

afterEach(() => {
  delete process.env['RENDER_REALISM_MODE'];
});

const ROLE_SOURCE: Readonly<
  Record<VisitorVoiceRole, Pick<VisitorRealismContext, 'attachmentStyle' | 'narrativeStyle' | 'expressionTone'>>
> = {
  restrained: { attachmentStyle: 'secure', narrativeStyle: 'structured', expressionTone: 'restrained' },
  emotional: { attachmentStyle: 'secure', narrativeStyle: 'structured', expressionTone: 'emotional' },
  intellectualizing: { attachmentStyle: 'secure', narrativeStyle: 'structured', expressionTone: 'intellectualizing' },
  passive_aggressive: { attachmentStyle: 'secure', narrativeStyle: 'structured', expressionTone: 'passive_aggressive' },
  anxious_seeker: { attachmentStyle: 'anxious', narrativeStyle: 'structured', expressionTone: 'restrained' },
  guarded_withdrawn: { attachmentStyle: 'avoidant', narrativeStyle: 'mixed', expressionTone: 'restrained' },
  chaotic_disorganized: { attachmentStyle: 'disorganized', narrativeStyle: 'disorganized', expressionTone: 'restrained' },
};

const SCENE_ENCOUNTER: Readonly<Record<(typeof REALISM_SCENES)[number], { mode: string; channel?: string }>> = {
  in_person: { mode: 'in_person' },
  online_voice: { mode: 'online', channel: 'voice' },
  online_text: { mode: 'online', channel: 'text' },
};

const STATE_SOURCE: Readonly<
  Record<
    (typeof REALISM_STATE_BANDS)[number],
    Pick<VisitorRealismContext, 'trust' | 'arousal' | 'verbalResistance' | 'depthResistance' | 'styleResistance' | 'riskLevel'>
  >
> = {
  steady: { trust: 0.6, arousal: 0.4, verbalResistance: 0.3, depthResistance: 0.3, styleResistance: 0.3 },
  guarded: { trust: 0.2, arousal: 0.4, verbalResistance: 0.7, depthResistance: 0.3, styleResistance: 0.3 },
  flooded: { trust: 0.5, arousal: 0.8, verbalResistance: 0.4, depthResistance: 0.8, styleResistance: 0.4 },
  risk: { trust: 0.5, arousal: 0.5, verbalResistance: 0.4, depthResistance: 0.4, styleResistance: 0.4, riskLevel: 'high' },
};

const PROMPT_UI_LEAK = /对方正在输入|聊天框|消息框|语音条|屏幕上|发送键|回车发送|发消息|发送消息/;

describe('AF-209 · 场景矩阵', () => {
  it('7 角色 × 3 场景 × 4 状态带：确定性、形态合法、语域层始终注入', () => {
    for (const role of VISITOR_VOICE_ROLES) {
      for (const scene of REALISM_SCENES) {
        for (const state of REALISM_STATE_BANDS) {
          const context: VisitorRealismContext = {
            ...ROLE_SOURCE[role],
            ...STATE_SOURCE[state],
            encounter: SCENE_ENCOUNTER[scene],
          };
          const first = buildVisitorRealismProfile(context, 'active');
          const second = buildVisitorRealismProfile(context, 'active');

          expect(first.role).toBe(role);
          expect(first.scene).toBe(scene);
          expect(first.state).toBe(state);
          expect(VISITOR_TURN_SHAPES).toContain(first.shape);
          expect(first.directives.join('\n')).toContain('语域层');
          expect(second).toEqual(first);

          const prompt = buildVisitorRealismPromptBlock(first);
          expect(prompt).toContain('语域层');
          expect(prompt).toContain('能直接说出口');
          expect(prompt).not.toMatch(PROMPT_UI_LEAK);
        }
      }
    }
  });

  it('默认不给 encounter = 面对面咨询室，不是线上文字', () => {
    const profile = buildVisitorRealismProfile({ ...ROLE_SOURCE.guarded_withdrawn, ...STATE_SOURCE.steady }, 'active');
    expect(profile.scene).toBe('in_person');
    const prompt = buildVisitorRealismPromptBlock(profile);
    expect(prompt).toContain('保持面对面的现场感');
    expect(prompt).not.toContain('保持文字咨询感');
  });

  it('视频 / 语音都归同步语音场景，文字必须显式指定', () => {
    const voice = buildVisitorRealismProfile(
      { ...ROLE_SOURCE.emotional, ...STATE_SOURCE.steady, encounter: { mode: 'online', channel: 'voice' } },
      'active',
    );
    const video = buildVisitorRealismProfile(
      { ...ROLE_SOURCE.emotional, ...STATE_SOURCE.steady, encounter: { mode: 'online', channel: 'video' } },
      'active',
    );
    const text = buildVisitorRealismProfile(
      { ...ROLE_SOURCE.emotional, ...STATE_SOURCE.steady, encounter: { mode: 'online', channel: 'text' } },
      'active',
    );
    expect(voice.scene).toBe('online_voice');
    expect(video.scene).toBe('online_voice');
    expect(text.scene).toBe('online_text');
  });

  it('off / audit 不注入语域层，active 才注入', () => {
    const base = { ...ROLE_SOURCE.restrained, ...STATE_SOURCE.steady };
    expect(buildVisitorRealismPromptBlock(buildVisitorRealismProfile(base, 'off'))).toBe('');
    expect(buildVisitorRealismPromptBlock(buildVisitorRealismProfile(base, 'audit'))).toBe('');
    expect(buildVisitorRealismPromptBlock(buildVisitorRealismProfile(base, 'active'))).toContain('语域层');
  });

  it('风险轮语域层仍在，但不流利配额归零', () => {
    const profile = buildVisitorRealismProfile(
      { ...ROLE_SOURCE.chaotic_disorganized, ...STATE_SOURCE.risk, encounter: SCENE_ENCOUNTER.in_person },
      'active',
    );
    expect(profile.quotas.maxEvents).toBe(0);
    expect(profile.eventPlan.maxEvents).toBe(0);
    expect(buildVisitorRealismPromptBlock(profile)).toContain('语域层');
  });
});
