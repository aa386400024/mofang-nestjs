// V2026-11-20 建立 (AF-204 · R1 真人度 profile):
//   输入 = 角色底色 + 本轮临床状态 + 接触场景；输出 = 一段**可审计**的表演层指令。
//
//   三条设计约束:
//     ① off / audit 不往 prompt 里加一个字 —— 灰度开关关闭时与现状逐字一致；
//     ② active 才注入，且优先级写死: 安全 > 场景 > 角色声音 > 话轮形态 > 不流利配额；
//     ③ 所有配额都是"上限"，不是"必须发生" —— 避免模型为了达标机械塞语气词。

import { buildRealismEventPlan, buildRealismEventPromptLine, type RealismEventPlan } from './realism-event-plan.js';
import {
  resolveRealismScene,
  resolveRealismStateBand,
  resolveVisitorVoiceRole,
  selectTurnShape,
  type RealismScene,
  type RealismStateBand,
  type SceneSource,
  type VisitorTurnShape,
  type VisitorVoiceRole,
  type VoiceSource,
  type StateSource,
} from './turn-shape-selector.js';

export type RealismMode = 'off' | 'audit' | 'active';

/** 只认三个显式值；未配置 / 拼错 / 空串一律回落 off。 */
export function parseRealismMode(raw?: string | null): RealismMode {
  if (raw === 'active' || raw === 'audit' || raw === 'off') return raw;
  return 'off';
}

export interface VisitorRealismContext extends VoiceSource, StateSource {
  /** 本场接触方式；缺省由 profile 归一化为面对面咨询室。 */
  readonly encounter?: SceneSource | null;
}

export interface RealismQuotas {
  readonly filler: number;
  readonly pause: number;
  readonly repair: number;
  readonly trailoff: number;
  readonly repetition: number;
  readonly elongation: number;
  /** 六类合计上限；风险轮为 0。 */
  readonly maxEvents: number;
}

export interface VisitorRealismProfile {
  readonly mode: RealismMode;
  readonly scene: RealismScene;
  readonly role: VisitorVoiceRole;
  readonly state: RealismStateBand;
  readonly shape: VisitorTurnShape;
  readonly quotas: RealismQuotas;
  /** R2：具体口语事件候选与上限；off/audit 仍计算，但不注入。 */
  readonly eventPlan: RealismEventPlan;
  /** active 才非空；off / audit 为空数组。 */
  readonly directives: readonly string[];
}

const ROLE_INSTRUCTION: Record<VisitorVoiceRole, string> = {
  restrained: '话少、句子短，情绪压着；不轻易展开，也不用解释自己的克制。',
  emotional: '情绪会顶上来，句子可能断；可以说得急，但不要控诉，也不要演。',
  intellectualizing: '习惯先分析再碰感受；可以停顿一下再说“我分析一下”，但别讲课、别下结论。',
  passive_aggressive: '表面配合，话里带一点刺；可以阴阳一句，但不直接攻击，也不长篇。',
  anxious_seeker: '会试探、求证、怕被否定；允许一次“我是不是……”，但不要反复求保证。',
  guarded_withdrawn: '戒备、回避细节、句子短；不主动交代，也不一次性把心事说完。',
  chaotic_disorganized: '思绪会跳，可能突然换话题或停住；但不讲创伤细节，不失控，不攻击对方。',
};

const SHAPE_INSTRUCTION: Record<VisitorTurnShape, string> = {
  short_answer_then_silence: '只答一句，答完就停；不解释、不延伸。',
  fragment_then_stop: '这一轮说半句就停，别把句子补完整；把没说完的部分留在那里。',
  concrete_detail: '说一个具体细节（一个时间、一个动作、一个地点），不要只讲抽象感受。',
  question_back: '可以把问题轻轻抛回去一次，只一次；不要盘问对方的私人经历。',
  correct_self_mid_sentence: '说出口后改一次口，用“不对，我是说……”这种口语修正；不要用书面连接词。',
  guarded_deflection: '先挡一下，说“这个……我不太想说”，再给半句边缘信息；不要全盘交代。',
  fragmented: '句子短、断点多，允许重复一个词；不要写成长段，也不要把碎片整理成完整故事。',
  emotional_detail: '说一个让你有情绪的瞬间，别总结成道理；句子可以短，但不要喊。',
  indirect_barb: '表面顺着对方，话尾带一点刺；只说一句，不追着讽刺。',
  grounded_short: '先落在当下（此刻、呼吸、房间），说一句短的；不展开，也不做技术解释。',
  text_short: '像文字咨询里的短消息，最多两句；不要写任何界面词、软件操作或旁白。',
  text_fragmented: '像文字咨询里连着发了两三条短句，中间有断裂；不要写成一段完整长文。',
};

const SCENE_INSTRUCTION: Record<RealismScene, string> = {
  in_person: '保持面对面的现场感：像坐在同一间咨询室里说话；不要写任何线上界面词、软件操作或旁白。',
  online_voice: '保持同步语音感：像在电话或视频里说话，句子偏短；可以确认一次对方在听，但不要每轮都问；不要写任何界面词或软件操作。',
  online_text: '保持文字咨询感：可以像两条短消息，但不写任何界面词、软件操作或旁白。',
};

/**
 * 语域层：来访者说出口的话不能带咨询师术语、书面腔、助手口吻或不可朗读标记。
 * 这里只给正向边界，不列举禁用词，避免 prompt 自身成为台词泄漏源。
 */
const REGISTER_INSTRUCTION =
  '语域层：只用来访者能直接说出口的口语；不用咨询或诊断术语、书面连接词、助手口吻或旁白式总结，也不要把动作写进括号或星号里。';

function maxOf(...values: readonly number[]): number {
  return Math.max(0, ...values);
}

/**
 * 配额按角色/状态/场景收紧或放宽，但所有值都是"上限"。
 * 风险轮一律归零：安全信息必须清楚，真人感不能压过可听性。
 */
function buildQuotas(role: VisitorVoiceRole, state: RealismStateBand): RealismQuotas {
  if (state === 'risk') {
    return { filler: 0, pause: 0, repair: 0, trailoff: 0, repetition: 0, elongation: 0, maxEvents: 0 };
  }

  const base = {
    filler: role === 'emotional' || role === 'anxious_seeker' || role === 'chaotic_disorganized' ? 1 : 0,
    pause: 1,
    repair: role === 'anxious_seeker' || role === 'emotional' || role === 'chaotic_disorganized' ? 1 : 0,
    trailoff: role === 'intellectualizing' ? 0 : 1,
    repetition: role === 'chaotic_disorganized' ? 1 : 0,
    elongation: role === 'emotional' || role === 'chaotic_disorganized' ? 1 : 0,
  };

  const stateBoost = state === 'flooded' ? 1 : 0;
  const guardedTrim = state === 'guarded' ? 1 : 0;

  const filler = maxOf(base.filler - guardedTrim);
  const pause = maxOf(base.pause + stateBoost);
  const repair = maxOf(base.repair - guardedTrim);
  const trailoff = maxOf(base.trailoff + stateBoost);
  const repetition = maxOf(base.repetition + stateBoost);
  const elongation = maxOf(base.elongation);

  const sum = filler + pause + repair + trailoff + repetition + elongation;
  return {
    filler,
    pause,
    repair,
    trailoff,
    repetition,
    elongation,
    maxEvents: Math.min(3, sum),
  };
}

function buildQuotaDirective(quotas: RealismQuotas, state: RealismStateBand): string {
  if (state === 'risk') {
    return '不流利配额：这一轮不刻意加入填充、停顿、改口或半截话；安全信息优先清楚。';
  }
  const detail = [
    `填充词 ${quotas.filler} 处`,
    `停顿 ${quotas.pause} 处`,
    `改口 ${quotas.repair} 处`,
    `半截话 ${quotas.trailoff} 处`,
    `重复词 ${quotas.repetition} 处`,
    `拖长音 ${quotas.elongation} 处`,
  ].join('、');
  return `不流利配额：六类合计最多 ${quotas.maxEvents} 处（上限：${detail}）；没有自然发生就不加。`;
}

function buildDirectives(
  scene: RealismScene,
  role: VisitorVoiceRole,
  state: RealismStateBand,
  shape: VisitorTurnShape,
  quotas: RealismQuotas,
  eventPlan: RealismEventPlan,
): readonly string[] {
  const eventLine = buildRealismEventPromptLine(eventPlan);
  return [
    '优先级：安全约束 > 本场接触方式 > 角色声音 > 话轮形态 > 不流利配额。冲突时，前面的压过后面的。',
    `场景层：${SCENE_INSTRUCTION[scene]}`,
    REGISTER_INSTRUCTION,
    `角色声音层：${ROLE_INSTRUCTION[role]}`,
    `话轮形态层：${SHAPE_INSTRUCTION[shape]}`,
    buildQuotaDirective(quotas, state),
    ...(eventLine === '' ? [] : [`事件层：${eventLine}`]),
    '如果角色声音或状态要求你突然跳开（例如失组织状态下的联想），允许一次短促的偏移；如果角色是讨好/焦虑型，允许一次试探性反问。两者都只允许一次，且不得展开成对咨询师私人经历的盘问。',
    '不要解释自己为什么这样说话，也不要把“停顿/改口/配额/话轮形态”这些词说出来。',
    '无论咨询师说得专业、家常、跑题还是胡言乱语，你都按本场场景和自己的角色声音回应；不要模仿对方的措辞，不要替对方解释，也不要跟着跑题。',
  ];
}

/**
 * 只做纯计算，不读 env、不写日志、不落库。
 * 调用方负责决定 mode（通常是 RENDER_REALISM_MODE）与是否把 directive 拼进 prompt。
 */
export function buildVisitorRealismProfile(context: VisitorRealismContext, mode: RealismMode = 'off'): VisitorRealismProfile {
  const scene = resolveRealismScene(context.encounter);
  const role = resolveVisitorVoiceRole(context);
  const state = resolveRealismStateBand(context);
  const shape = selectTurnShape({ ...context, scene });
  const quotas = buildQuotas(role, state);
  const eventPlan = buildRealismEventPlan({ role, state, scene, quotas });

  return {
    mode,
    scene,
    role,
    state,
    shape,
    quotas,
    eventPlan,
    directives: mode === 'active' ? buildDirectives(scene, role, state, shape, quotas, eventPlan) : [],
  };
}

/**
 * 拼成 prompt 块。
 *
 * off / audit 返回空串 —— 这样"审计模式不改变线上 prompt"可以被逐字断言。
 */
export function buildVisitorRealismPromptBlock(profile: VisitorRealismProfile): string {
  if (profile.mode !== 'active' || profile.directives.length === 0) return '';
  return ['你这一轮说话的真人质感（表现层，不得压过安全与本场接触方式）：', ...profile.directives.map((line) => `- ${line}`)].join('\n');
}
