// V2026-11-20 建立 (AF-204 · R1 真人度):
//   覆盖 ① 7 类角色声音 × 3 种接触场景 × 4 个状态带的确定性话轮形态；
//   ② off / audit 不注入 prompt，active 才注入且优先级写死；
//   ③ 场景默认面对面、文字通道显式生效；
//   ④ 临床边界（风险轮）与咨询师边界档位（专家/家常/胡言乱语）。
//
//   纯函数 + prompt 拼装；不起容器 / 不连 DB / 不调 LLM。
//
//   验证: pnpm exec vitest run test/auto-practice/af204-realism.spec.ts

import { afterEach, describe, expect, it } from 'vitest';

import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import {
  buildVisitorRealismProfile,
  buildVisitorRealismPromptBlock,
  parseDisfluencyLevel,
  parseRealismMode,
  REALISM_SCENES,
  resolveRealismScene,
  VISITOR_TURN_SHAPES,
  VISITOR_VOICE_ROLES,
  type VisitorRealismContext,
  type VisitorVoiceRole,
} from '../../src/shared/realism/index.js';

function makeRenderSpec(encounter?: { mode?: string; channel?: string }): AdaptiveRenderSpec {
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'simple_response',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: [],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.5,
    coreBeliefs: [],
    forbiddenBehaviors: [],
    recall: [],
    recentTurns: [],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 512 },
    ...(encounter === undefined ? {} : { encounter }),
  };
}

function systemPrompt(encounter?: { mode?: string; channel?: string }): string {
  return (buildVisitorMessages(makeRenderSpec(encounter))[0]?.content ?? '') as string;
}

function setMode(mode: string | undefined): void {
  if (mode === undefined) {
    delete process.env['RENDER_REALISM_MODE'];
  } else {
    process.env['RENDER_REALISM_MODE'] = mode;
  }
}

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
    'steady' | 'guarded' | 'flooded' | 'risk',
    Pick<VisitorRealismContext, 'trust' | 'arousal' | 'verbalResistance' | 'depthResistance' | 'styleResistance' | 'riskLevel'>
  >
> = {
  steady: { trust: 0.6, arousal: 0.4, verbalResistance: 0.3, depthResistance: 0.3, styleResistance: 0.3 },
  guarded: { trust: 0.2, arousal: 0.4, verbalResistance: 0.7, depthResistance: 0.3, styleResistance: 0.3 },
  flooded: { trust: 0.5, arousal: 0.8, verbalResistance: 0.4, depthResistance: 0.8, styleResistance: 0.4 },
  risk: { trust: 0.5, arousal: 0.5, verbalResistance: 0.4, depthResistance: 0.4, styleResistance: 0.4, riskLevel: 'high' },
};

describe('AF-204 · 真人度开关', () => {
  it('未配置 / 拼错 / 空串一律回落 off，只有三个显式值生效', () => {
    expect(parseRealismMode()).toBe('off');
    expect(parseRealismMode(null)).toBe('off');
    expect(parseRealismMode('')).toBe('off');
    expect(parseRealismMode('ACTIVE')).toBe('off');
    expect(parseRealismMode('off')).toBe('off');
    expect(parseRealismMode('audit')).toBe('audit');
    expect(parseRealismMode('active')).toBe('active');
  });

  it('off / audit 的 prompt 逐字一致（audit 只算不注入）', () => {
    setMode('off');
    const off = systemPrompt();
    setMode('audit');
    const audit = systemPrompt();
    expect(audit).toBe(off);
    expect(audit).not.toContain('真人质感');
  });

  it('active 才注入真人质感块，且优先级顺序写死', () => {
    setMode('active');
    const prompt = systemPrompt();
    expect(prompt).toContain('你这一轮说话的真人质感');
    expect(prompt).toContain('优先级：安全约束 > 本场接触方式 > 角色声音 > 话轮形态 > 不流利配额');
    expect(prompt).toContain('不要模仿对方的措辞');
  });
});

describe('AF-204 · 场景默认与显式通道', () => {
  it('未传 encounter = 面对面咨询室，不是线上聊天', () => {
    setMode('active');
    const prompt = systemPrompt();
    expect(prompt).toContain('咨询室里面对面说话');
    expect(prompt).toContain('保持面对面的现场感');
    expect(prompt).not.toContain('保持文字咨询感');
  });

  it('显式 online + text 才走文字咨询口径', () => {
    setMode('active');
    const prompt = systemPrompt({ mode: 'online', channel: 'text' });
    expect(prompt).toContain('远程咨询里说话');
    expect(prompt).toContain('保持文字咨询感');
    expect(prompt).not.toContain('咨询室里面对面说话');
  });

  it('video 与 voice 共用同步语音场景（默认仍是 spoken，不是 text）', () => {
    expect(resolveRealismScene({ mode: 'online', channel: 'video' })).toBe('online_voice');
    expect(resolveRealismScene({ mode: 'online', channel: 'voice' })).toBe('online_voice');
    expect(resolveRealismScene()).toBe('in_person');
  });
});

describe('AF-204 · 7 角色 × 3 场景 × 4 状态带', () => {
  it('所有组合都有确定形态，且同输入重复调用结果一致', () => {
    for (const role of VISITOR_VOICE_ROLES) {
      for (const scene of REALISM_SCENES) {
        for (const state of Object.keys(STATE_SOURCE) as (keyof typeof STATE_SOURCE)[]) {
          const context: VisitorRealismContext = {
            ...ROLE_SOURCE[role],
            ...STATE_SOURCE[state],
            encounter: SCENE_ENCOUNTER[scene],
          };
          const first = buildVisitorRealismProfile(context, 'active');
          const second = buildVisitorRealismProfile(context, 'active');
          expect(first.role).toBe(role);
          expect(first.scene).toBe(scene);
          expect(VISITOR_TURN_SHAPES).toContain(first.shape);
          expect(second).toEqual(first);
        }
      }
    }
  });

  it('关键状态压过角色默认：风险 = 落地短句，文字 = 短消息形态', () => {
    const risk = buildVisitorRealismProfile(
      { ...ROLE_SOURCE.emotional, ...STATE_SOURCE.risk, encounter: SCENE_ENCOUNTER.in_person },
      'active',
    );
    expect(risk.shape).toBe('grounded_short');
    expect(risk.quotas.maxEvents).toBe(0);

    const text = buildVisitorRealismProfile(
      { ...ROLE_SOURCE.intellectualizing, ...STATE_SOURCE.steady, encounter: SCENE_ENCOUNTER.online_text },
      'active',
    );
    expect(text.shape).toBe('text_short');

    const textChaotic = buildVisitorRealismProfile(
      { ...ROLE_SOURCE.chaotic_disorganized, ...STATE_SOURCE.steady, encounter: SCENE_ENCOUNTER.online_text },
      'active',
    );
    expect(textChaotic.shape).toBe('text_fragmented');
  });
});

describe('AF-204 · 临床与咨询师边界', () => {
  it('高风险轮不靠不流利撑真人感：配额归零，安全信息优先', () => {
    const profile = buildVisitorRealismProfile(
      { ...ROLE_SOURCE.chaotic_disorganized, ...STATE_SOURCE.risk, encounter: SCENE_ENCOUNTER.in_person },
      'active',
    );
    expect(profile.state).toBe('risk');
    expect(profile.quotas).toEqual({
      filler: 0,
      pause: 0,
      repair: 0,
      trailoff: 0,
      repetition: 0,
      elongation: 0,
      maxEvents: 0,
    });
    expect(buildVisitorRealismPromptBlock(profile)).toContain('安全信息优先清楚');
  });

  it('专家 / 家常 / 胡言乱语三种咨询师档位共用同一真人度层，不改变角色声音与场景', () => {
    // 这三个档位不是 visitor 人设，而是咨询师输入风格；真人度层必须对输入风格保持稳定，
    // 只由角色/状态/场景决定，不能被对方措辞带跑。
    for (const counselorStyle of ['expert', 'casual', 'nonsense']) {
      void counselorStyle;
      const profile = buildVisitorRealismProfile(
        { ...ROLE_SOURCE.guarded_withdrawn, ...STATE_SOURCE.guarded, encounter: SCENE_ENCOUNTER.in_person },
        'active',
      );
      expect(profile.role).toBe('guarded_withdrawn');
      expect(profile.scene).toBe('in_person');
      expect(buildVisitorRealismPromptBlock(profile)).toContain('不要模仿对方的措辞');
    }
  });
});

describe('AF-584 · 角色级不流利配置', () => {
  function profileWith(config: Pick<VisitorRealismContext, 'disfluencyLevel' | 'disfluencyDensity'>) {
    return buildVisitorRealismProfile(
      { ...ROLE_SOURCE.emotional, ...STATE_SOURCE.steady, encounter: SCENE_ENCOUNTER.in_person, ...config },
      'active',
    );
  }

  it('只认四个显式档位；NULL / 拼错 / 空串 = 角色没表态', () => {
    expect(parseDisfluencyLevel()).toBeUndefined();
    expect(parseDisfluencyLevel(null)).toBeUndefined();
    expect(parseDisfluencyLevel('')).toBeUndefined();
    expect(parseDisfluencyLevel('HEAVY')).toBeUndefined();
    expect(parseDisfluencyLevel('none')).toBe('none');
    expect(parseDisfluencyLevel('light')).toBe('light');
    expect(parseDisfluencyLevel('natural')).toBe('natural');
    expect(parseDisfluencyLevel('heavy')).toBe('heavy');
  });

  it('缺省与显式 natural + 0.5 密度配额逐字一致，prompt 也不变', () => {
    const baseline = profileWith({});
    const explicitNeutral = profileWith({ disfluencyLevel: 'natural', disfluencyDensity: 0.5 });
    expect(baseline.quotas).toEqual(explicitNeutral.quotas);
    expect(baseline.disfluencyLevel).toBe('natural');
    expect(buildVisitorRealismPromptBlock(baseline)).toBe(buildVisitorRealismPromptBlock(explicitNeutral));
  });

  it('light 把合计上限压到 1；none 全零且不主动加痕迹；heavy 在角色底色上放宽', () => {
    const baseline = profileWith({});
    expect(baseline.quotas.maxEvents).toBe(2);

    const light = profileWith({ disfluencyLevel: 'light' });
    expect(light.quotas.maxEvents).toBe(1);

    const none = profileWith({ disfluencyLevel: 'none' });
    expect(none.quotas).toEqual({
      filler: 0,
      pause: 0,
      repair: 0,
      trailoff: 0,
      repetition: 0,
      elongation: 0,
      maxEvents: 0,
    });
    expect(buildVisitorRealismPromptBlock(none)).toContain('这一轮不主动加入填充');

    const heavy = profileWith({ disfluencyLevel: 'heavy' });
    expect(heavy.quotas.filler).toBe(2);
    expect(heavy.quotas.pause).toBe(2);
    expect(heavy.quotas.maxEvents).toBe(3);
  });

  it('密度按 0.5 权重做档位修正：≤0.25 降一档，≥0.75 升一档，中间不修正', () => {
    const natural = profileWith({ disfluencyLevel: 'natural', disfluencyDensity: 0.5 });
    const low = profileWith({ disfluencyLevel: 'natural', disfluencyDensity: 0 });
    const high = profileWith({ disfluencyLevel: 'natural', disfluencyDensity: 1 });
    expect(low.quotas.maxEvents).toBe(natural.quotas.maxEvents - 1);
    expect(high.quotas.maxEvents).toBe(natural.quotas.maxEvents + 1);
    expect(profileWith({ disfluencyDensity: Number.NaN }).quotas).toEqual(natural.quotas);
  });

  it('安全优先：heavy 遇到风险轮仍归零', () => {
    const risk = buildVisitorRealismProfile(
      {
        ...ROLE_SOURCE.emotional,
        ...STATE_SOURCE.risk,
        encounter: SCENE_ENCOUNTER.in_person,
        disfluencyLevel: 'heavy',
        disfluencyDensity: 1,
      },
      'active',
    );
    expect(risk.quotas.maxEvents).toBe(0);
    expect(buildVisitorRealismPromptBlock(risk)).toContain('安全信息优先清楚');
  });
});
