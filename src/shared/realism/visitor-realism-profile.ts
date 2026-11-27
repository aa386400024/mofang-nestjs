// V2026-11-20 建立 (AF-204 · R1 真人度 profile):
//   输入 = 角色底色 + 本轮临床状态 + 接触场景；输出 = 一段**可审计**的表演层指令。
//
//   三条设计约束:
//     ① off / audit 不往 prompt 里加一个字 —— 灰度开关关闭时与现状逐字一致；
//     ② active 才注入，且优先级写死: 安全 > 场景 > 角色声音 > 话轮形态 > 不流利配额；
//     ③ 所有配额都是"上限"，不是"必须发生" —— 避免模型为了达标机械塞语气词。

import { buildRealismEventPlan, buildRealismEventPromptLine, type RealismEventPlan } from './realism-event-plan.js';
import { resolveRealismEventRhythm, type RealismEventRhythm } from './realism-event-rhythm.js';
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

/**
 * 角色级不流利档位全集 (Phase3 P3): 角色天生更顺 / 更磕巴的基线倾向.
 *
 * - none   = 不主动加不流利痕迹 (仍受风险轮归零约束)
 * - light  = 只保留一次短停顿/半截话级别的痕迹
 * - natural = 沿用 AF-204 的角色 + 状态配额 (缺省档)
 * - heavy  = 在角色底色上再放宽一档, 但仍受 4 处硬上限约束
 */
export const DISFLUENCY_LEVELS = ['none', 'light', 'natural', 'heavy'] as const;

export type DisfluencyLevel = (typeof DISFLUENCY_LEVELS)[number];

/** 只认四个显式值；未配置 / 拼错 / 空串 → undefined (= 角色没表态). */
export function parseDisfluencyLevel(raw?: string | null): DisfluencyLevel | undefined {
  if (raw === null || raw === undefined) return undefined;
  return (DISFLUENCY_LEVELS as readonly string[]).includes(raw) ? (raw as DisfluencyLevel) : undefined;
}

/** 只认三个显式值；未配置 / 拼错 / 空串一律回落 off。 */
export function parseRealismMode(raw?: string | null): RealismMode {
  if (raw === 'active' || raw === 'audit' || raw === 'off') return raw;
  return 'off';
}

export interface VisitorRealismContext extends VoiceSource, StateSource {
  /** 本场接触方式；缺省由 profile 归一化为面对面咨询室。 */
  readonly encounter?: SceneSource | null;
  /**
   * 角色级不流利档位 (Phase3 P3): 由角色库 NULL → 不传; NULL = 不表态 = natural.
   *
   * 为什么不从 role/state 反推: 现有 quotas 已经把 role/state 编码进去了,
   * 再从同一批输入反推 "档位" 只会造出第二份真相.
   */
  readonly disfluencyLevel?: DisfluencyLevel;
  /**
   * 角色级密度倾向 [0,1] (Phase3 P3): 0.5 = 不修正; ≤0.25 / ≥0.75 各修正一档.
   *
   * 缺省 = 不传 = 修正量 0 (与 AF-204 逐字一致).
   */
  readonly disfluencyDensity?: number;
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
  /** Phase3 P3: 角色级档位 (缺省 natural; 只用于审计日志与回放, 不进 prompt 字面). */
  readonly disfluencyLevel: DisfluencyLevel;
  /** R2：具体口语事件候选与上限；off/audit 仍计算，但不注入。 */
  readonly eventPlan: RealismEventPlan;
  /** R6：状态化节奏（停顿形态、改口位置、短答偏置）；off/audit 仍计算，但不注入。 */
  readonly rhythm: RealismEventRhythm;
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
  online_text: '保持文字咨询感：像两条短消息，允许提到正在看对话、等回复这类真实动作；但不要把界面操作写成旁白或说明文字。',
};

/**
 * 语域层：来访者说出口的话不能带咨询师术语、书面腔、助手口吻或不可朗读标记。
 * 这里只给正向边界，不列举禁用词，避免 prompt 自身成为台词泄漏源。
 */
const REGISTER_INSTRUCTION =
  '语域层：只用来访者能直接说出口的口语；不用咨询或诊断术语、书面连接词、助手口吻或旁白式总结，也不要把动作写进括号或星号里。';

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

  // R6: 状态不再只是“加一/减一”，而是明确分布：
  //   · guarded 只留一次短停顿与一次半截话，短答优先，不硬加填充/改口；
  //   · flooded 允许两个停顿 span、句中改口、重复与拖长；
  //   · steady 保持角色底色，但合计最多两处，避免每轮都像“按配额塞痕迹”。
  if (state === 'guarded') {
    return {
      filler: 0,
      pause: 1,
      repair: 0,
      trailoff: 1,
      repetition: 0,
      elongation: 0,
      maxEvents: 1,
    };
  }

  if (state === 'flooded') {
    return {
      filler: base.filler,
      pause: 2,
      repair: base.repair,
      trailoff: base.trailoff,
      repetition: base.repetition,
      elongation: base.elongation,
      maxEvents: 3,
    };
  }

  const sum = base.filler + base.pause + base.repair + base.trailoff + base.repetition + base.elongation;
  return {
    ...base,
    maxEvents: Math.min(2, sum),
  };
}

/**
 * 把密度倾向归一成 -1 / 0 / 1 的档位修正量.
 *
 * 为什么取 0.25 / 0.75 两个断点: 配额是整数上限, 0.5 权重落不到半档;
 * 极端区各修正一档、中间 50% 区间不修正, 既让密度可感知, 又避免连续值抖动.
 */
function resolveDensityShift(density: number | undefined): number {
  if (density === undefined || !Number.isFinite(density)) return 0;
  const clamped = Math.min(1, Math.max(0, density));
  if (clamped <= 0.25) return -1;
  if (clamped >= 0.75) return 1;
  return 0;
}

/**
 * Phase3 P3: 在 role/state 底色上叠加角色级档位与密度修正.
 *
 * 优先级仍是安全 > 档位: 风险轮直接返回全零, 不受 heavy 影响.
 */
function applyDisfluencyConfig(
  base: RealismQuotas,
  state: RealismStateBand,
  level: DisfluencyLevel | undefined,
  density: number | undefined,
): RealismQuotas {
  if (state === 'risk') return base;
  const resolvedLevel = level ?? 'natural';
  if (resolvedLevel === 'none') {
    return { filler: 0, pause: 0, repair: 0, trailoff: 0, repetition: 0, elongation: 0, maxEvents: 0 };
  }

  const adjusted = { ...base };
  if (resolvedLevel === 'light') {
    adjusted.maxEvents = Math.min(1, adjusted.maxEvents);
  } else if (resolvedLevel === 'heavy' && state !== 'guarded') {
    adjusted.filler += 1;
    adjusted.pause += 1;
    adjusted.maxEvents = Math.min(4, adjusted.maxEvents + 1);
  }

  adjusted.maxEvents = Math.max(0, Math.min(4, adjusted.maxEvents + resolveDensityShift(density)));
  return adjusted;
}

function buildQuotaDirective(quotas: RealismQuotas, state: RealismStateBand, level: DisfluencyLevel): string {
  if (state === 'risk') {
    return '不流利配额：这一轮不刻意加入填充、停顿、改口或半截话；安全信息优先清楚。';
  }
  if (level === 'none') {
    return '不流利配额：这一轮不主动加入填充、停顿、改口或半截话；自然带出也不要超过上限。';
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
  level: DisfluencyLevel,
  shape: VisitorTurnShape,
  quotas: RealismQuotas,
  eventPlan: RealismEventPlan,
  rhythm: RealismEventRhythm,
): readonly string[] {
  const eventLine = buildRealismEventPromptLine(eventPlan, rhythm);
  return [
    '优先级：安全约束 > 本场接触方式 > 角色声音 > 话轮形态 > 不流利配额。冲突时，前面的压过后面的。',
    `场景层：${SCENE_INSTRUCTION[scene]}`,
    REGISTER_INSTRUCTION,
    `角色声音层：${ROLE_INSTRUCTION[role]}`,
    `话轮形态层：${SHAPE_INSTRUCTION[shape]}`,
    buildQuotaDirective(quotas, state, level),
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
  const level = context.disfluencyLevel ?? 'natural';
  const quotas = applyDisfluencyConfig(buildQuotas(role, state), state, level, context.disfluencyDensity);
  const eventPlan = buildRealismEventPlan({ role, state, scene, quotas });
  const rhythm = resolveRealismEventRhythm({ role, state, scene });

  return {
    mode,
    scene,
    role,
    state,
    shape,
    quotas,
    disfluencyLevel: level,
    eventPlan,
    rhythm,
    directives: mode === 'active' ? buildDirectives(scene, role, state, level, shape, quotas, eventPlan, rhythm) : [],
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
