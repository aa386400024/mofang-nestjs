// V2026-11-21 建立 (AF-216 · R6 事件的条件分布):
//   覆盖状态化节奏、条件 prompt、事件分布审计与 off/audit 零注入。
//
//   纯函数；不起容器 / 不连 DB / 不调 LLM。

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRealismEventPlan,
  buildRealismEventPromptLine,
  buildVisitorRealismProfile,
  buildVisitorRealismPromptBlock,
  inspectRealismEventDistribution,
  resolveRealismEventRhythm,
  type RealismScene,
  type RealismStateBand,
  type VisitorRealismContext,
  type VisitorVoiceRole,
} from '../../src/shared/realism/index.js';

afterEach(() => {
  delete process.env['RENDER_REALISM_MODE'];
});

const ROLE_SOURCE: Readonly<
  Record<
    'restrained' | 'emotional' | 'chaotic_disorganized',
    Pick<VisitorRealismContext, 'attachmentStyle' | 'narrativeStyle' | 'expressionTone'>
  >
> = {
  restrained: { attachmentStyle: 'secure', narrativeStyle: 'structured', expressionTone: 'restrained' },
  emotional: { attachmentStyle: 'secure', narrativeStyle: 'structured', expressionTone: 'emotional' },
  chaotic_disorganized: { attachmentStyle: 'disorganized', narrativeStyle: 'disorganized', expressionTone: 'restrained' },
};

const STATE_SOURCE: Readonly<
  Record<
    'steady' | 'guarded' | 'flooded',
    Pick<VisitorRealismContext, 'trust' | 'arousal' | 'verbalResistance' | 'depthResistance' | 'styleResistance'>
  >
> = {
  steady: { trust: 0.6, arousal: 0.4, verbalResistance: 0.3, depthResistance: 0.3, styleResistance: 0.3 },
  guarded: { trust: 0.2, arousal: 0.4, verbalResistance: 0.7, depthResistance: 0.3, styleResistance: 0.3 },
  flooded: { trust: 0.5, arousal: 0.8, verbalResistance: 0.4, depthResistance: 0.8, styleResistance: 0.4 },
};

function profile(role: VisitorVoiceRole, state: RealismStateBand, scene: RealismScene = 'in_person') {
  const encounter =
    scene === 'in_person'
      ? ({ mode: 'in_person' } as const)
      : scene === 'online_text'
        ? ({ mode: 'online', channel: 'text' } as const)
        : ({ mode: 'online', channel: 'voice' } as const);
  const base = state === 'risk' ? STATE_SOURCE.steady : STATE_SOURCE[state];
  return buildVisitorRealismProfile(
    {
      ...(role === 'restrained' || role === 'emotional' || role === 'chaotic_disorganized' ? ROLE_SOURCE[role] : ROLE_SOURCE.restrained),
      ...base,
      ...(state === 'risk' ? { riskLevel: 'high' } : {}),
      encounter,
    },
    'active',
  );
}

describe('AF-216 · 状态化事件节奏', () => {
  it('同一角色在 steady / guarded / flooded 至少两项节奏不同', () => {
    const steady = resolveRealismEventRhythm({ role: 'restrained', state: 'steady', scene: 'in_person' });
    const guarded = resolveRealismEventRhythm({ role: 'restrained', state: 'guarded', scene: 'in_person' });
    const flooded = resolveRealismEventRhythm({ role: 'restrained', state: 'flooded', scene: 'in_person' });

    const diff = (a: typeof steady, b: typeof steady): number =>
      Number(a.pauseStyle !== b.pauseStyle) +
      Number(a.repairPosition !== b.repairPosition) +
      Number(a.shortAnswerBias !== b.shortAnswerBias) +
      Number(a.maxClauses !== b.maxClauses);

    expect(diff(steady, guarded)).toBeGreaterThanOrEqual(2);
    expect(diff(guarded, flooded)).toBeGreaterThanOrEqual(2);
    expect(diff(steady, flooded)).toBeGreaterThanOrEqual(2);
  });

  it('guarded 强短答、不硬加改口；flooded 拉长停顿、句中改口；steady 句缝改口', () => {
    const guarded = resolveRealismEventRhythm({ role: 'restrained', state: 'guarded', scene: 'in_person' });
    const flooded = resolveRealismEventRhythm({ role: 'restrained', state: 'flooded', scene: 'in_person' });
    const steady = resolveRealismEventRhythm({ role: 'restrained', state: 'steady', scene: 'in_person' });

    expect(guarded).toMatchObject({ pauseStyle: 'brief', repairPosition: 'none', shortAnswerBias: 'high', maxClauses: 2 });
    expect(flooded).toMatchObject({ pauseStyle: 'held', repairPosition: 'mid_sentence', shortAnswerBias: 'fragmented', maxPauseSpans: 2 });
    expect(flooded.conditionDirective).toContain('必须在第一个短句后写一次「…………」');
    expect(steady).toMatchObject({ pauseStyle: 'brief', repairPosition: 'clause_boundary', shortAnswerBias: 'normal', maxClauses: 3 });
  });

  it('失组织角色 flooded 走断裂停顿；文字场景多允许一条短消息', () => {
    const chaotic = resolveRealismEventRhythm({ role: 'chaotic_disorganized', state: 'flooded', scene: 'in_person' });
    const steadyText = resolveRealismEventRhythm({ role: 'restrained', state: 'steady', scene: 'online_text' });
    expect(chaotic.pauseStyle).toBe('broken');
    expect(steadyText.maxSentences).toBe(3);
  });

  it('风险轮零节奏，所有表演性痕迹关闭', () => {
    const rhythm = resolveRealismEventRhythm({ role: 'chaotic_disorganized', state: 'risk', scene: 'in_person' });
    expect(rhythm).toMatchObject({ pauseStyle: 'none', repairPosition: 'none', maxPauseSpans: 0 });
    expect(rhythm.conditionDirective).toContain('安全信息先说清楚');

    const risk = profile('chaotic_disorganized', 'risk');
    expect(risk.quotas.maxEvents).toBe(0);
  });
});

describe('AF-216 · 条件化 prompt', () => {
  it('active 事件层写明停顿位置/长度、改口位置与分句上限', () => {
    const prompt = buildVisitorRealismPromptBlock(profile('restrained', 'guarded'));
    expect(prompt).toContain('事件层：');
    expect(prompt).toContain('节奏条件：');
    expect(prompt).toContain('停顿只在第一个短句后出现一次');
    expect(prompt).toContain('这一轮最多两个分句、一句就停');
  });

  it('off / audit 不注入条件节奏（逐字空）', () => {
    const off = buildVisitorRealismProfile({ ...ROLE_SOURCE.restrained, ...STATE_SOURCE.guarded }, 'off');
    const audit = buildVisitorRealismProfile({ ...ROLE_SOURCE.restrained, ...STATE_SOURCE.guarded }, 'audit');
    expect(buildVisitorRealismPromptBlock(off)).toBe('');
    expect(buildVisitorRealismPromptBlock(audit)).toBe('');
    expect(off.rhythm).toEqual(audit.rhythm);
  });

  it('不传 rhythm 时保持 R2 原文案，传 rhythm 时追加条件', () => {
    const plan = buildRealismEventPlan({
      role: 'restrained',
      state: 'steady',
      scene: 'in_person',
      quotas: { filler: 0, pause: 1, repair: 0, trailoff: 1, repetition: 0, elongation: 0, maxEvents: 2 },
    });
    const rhythm = resolveRealismEventRhythm({ role: 'restrained', state: 'steady', scene: 'in_person' });
    expect(buildRealismEventPromptLine(plan)).not.toContain('节奏条件：');
    expect(buildRealismEventPromptLine(plan, rhythm)).toContain('节奏条件：');
  });
});

describe('AF-216 · 事件分布审计', () => {
  it('区分短停顿、长停顿与短答/碎片', () => {
    const brief = inspectRealismEventDistribution('嗯，我今天……还行。');
    expect(brief.pauseSpans).toBe(1);
    expect(brief.pauseSpanClasses.brief).toBe(1);
    expect(brief.pauseSpanClasses.held).toBe(0);
    expect(brief.shortAnswer).toBe(true);
    expect(brief.fragmented).toBe(true);

    const held = inspectRealismEventDistribution('我今天…………还行。');
    expect(held.pauseSpans).toBe(1);
    expect(held.pauseSpanClasses.held).toBe(1);
  });

  it('区分改口的句首 / 句缝 / 句中位置', () => {
    expect(inspectRealismEventDistribution('不对，我是说，我今天还行。').repairPositions).toMatchObject({
      start: 1,
      clause_boundary: 0,
      mid_sentence: 0,
    });
    expect(inspectRealismEventDistribution('我本来想说没事，不对，我是说，我有点累。').repairPositions).toMatchObject({
      start: 0,
      clause_boundary: 1,
      mid_sentence: 0,
    });
    expect(inspectRealismEventDistribution('我今天本来想说……不对，我是说，我有点累。').repairPositions).toMatchObject({
      start: 0,
      clause_boundary: 0,
      mid_sentence: 1,
    });
  });

  it('返回计数与分类，不返回原文', () => {
    const raw = '我今天本来想说……不对，我是说，我有点累。';
    const distribution = inspectRealismEventDistribution(raw);
    expect(JSON.stringify(distribution)).not.toContain('我今天');
    expect(distribution.counts.repair).toBe(1);
    expect(distribution.counts.pause).toBe(1);
  });
});
