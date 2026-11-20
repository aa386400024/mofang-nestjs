// V2026-11-20 建立 (AF-204 · R1 真人度):
//   把"这一轮该用哪种话轮形态"变成确定性纯函数 —— 7 类角色声音 × 3 种接触场景 ×
//   4 个关键状态带。它只影响 prompt 里的一句表演指令，不新增 LLM 调用、不改内核状态。
//
//   为什么不用随机:
//     · 同一角色 / 场景 / 状态必须可复现，否则回归测试与双盲验收无法归因；
//     · 真人的"变化"来自状态变化，不来自每次抽签；抽签反而会变成机械噪声。

export const VISITOR_VOICE_ROLES = [
  'restrained',
  'emotional',
  'intellectualizing',
  'passive_aggressive',
  'anxious_seeker',
  'guarded_withdrawn',
  'chaotic_disorganized',
] as const;

export type VisitorVoiceRole = (typeof VISITOR_VOICE_ROLES)[number];

export const REALISM_SCENES = ['in_person', 'online_voice', 'online_text'] as const;

export type RealismScene = (typeof REALISM_SCENES)[number];

export const REALISM_STATE_BANDS = ['steady', 'guarded', 'flooded', 'risk'] as const;

export type RealismStateBand = (typeof REALISM_STATE_BANDS)[number];

export const VISITOR_TURN_SHAPES = [
  'short_answer_then_silence',
  'fragment_then_stop',
  'concrete_detail',
  'question_back',
  'correct_self_mid_sentence',
  'guarded_deflection',
  'fragmented',
  'emotional_detail',
  'indirect_barb',
  'grounded_short',
  'text_short',
  'text_fragmented',
] as const;

export type VisitorTurnShape = (typeof VISITOR_TURN_SHAPES)[number];

/** 场景输入只取两个字段，避免 shared 层反向依赖渲染规格。 */
export interface SceneSource {
  readonly mode?: string | null;
  readonly channel?: string | null;
}

/** 角色声音只读表达风格与依恋底色；不读角色名，避免把 persona 文案带进 prompt 逻辑。 */
export interface VoiceSource {
  readonly attachmentStyle?: string | null;
  readonly narrativeStyle?: string | null;
  readonly expressionTone?: string | null;
}

/** 状态输入是标量；阈值写死在这里，保证同一快照永远得到同一形态。 */
export interface StateSource {
  readonly trust: number;
  readonly arousal: number;
  readonly verbalResistance: number;
  readonly depthResistance: number;
  readonly styleResistance: number;
  readonly riskLevel?: string | null;
  readonly bond?: number;
}

export interface TurnShapeInput extends VoiceSource, StateSource {
  readonly scene: RealismScene;
}

/**
 * 接触场景归一化。
 *
 * 产品口径 (用户 2026-11-20 明确): 面对面咨询室是全局默认；线上语音是线上默认；
 * 文字是线上显式通道；video 与 voice 同属同步音频场景，共用 spoken 形态。
 */
export function resolveRealismScene(scene?: SceneSource | null): RealismScene {
  if (scene?.mode !== 'online') return 'in_person';
  if (scene.channel === 'text') return 'online_text';
  return 'online_voice';
}

/**
 * 7 类角色声音的确定性映射。
 *
 * 优先级: 失组织 > 被动攻击 > 理智化 > 焦虑依恋 > 情绪外显 > 回避依恋 > 克制。
 * 这样同一角色不会同时拿到两套互相冲突的声音指令。
 */
export function resolveVisitorVoiceRole(source: VoiceSource): VisitorVoiceRole {
  if (source.attachmentStyle === 'disorganized' || source.narrativeStyle === 'disorganized') {
    return 'chaotic_disorganized';
  }
  if (source.expressionTone === 'passive_aggressive') return 'passive_aggressive';
  if (source.expressionTone === 'intellectualizing') return 'intellectualizing';
  if (source.attachmentStyle === 'anxious') return 'anxious_seeker';
  if (source.expressionTone === 'emotional') return 'emotional';
  if (source.attachmentStyle === 'avoidant') return 'guarded_withdrawn';
  return 'restrained';
}

/**
 * 状态带。
 *
 * risk 永远压过其他带: 风险轮不刻意加不流利，先保证安全信息清楚。
 * flooded = 高唤醒或深阻抗；guarded = 低信任或高言语阻抗。
 */
export function resolveRealismStateBand(source: StateSource): RealismStateBand {
  if (source.riskLevel !== undefined && source.riskLevel !== null && source.riskLevel !== 'none') {
    return 'risk';
  }
  if (source.arousal >= 0.7 || source.depthResistance >= 0.7) return 'flooded';
  if (source.trust < 0.4 || source.verbalResistance >= 0.6 || source.styleResistance >= 0.65) {
    return 'guarded';
  }
  return 'steady';
}

/**
 * 话轮形态选择器。
 *
 * 只做"这一轮怎么开口"，不决定内容。所有分支都是纯查表/阈值，输入相同则输出相同。
 */
export function selectTurnShape(input: TurnShapeInput): VisitorTurnShape {
  const state = resolveRealismStateBand(input);

  // 风险优先: 短、落地、可被听见；不做半截话，也不做改口。
  if (state === 'risk') return 'grounded_short';

  // 文字通道: 默认短消息感；失组织角色才允许碎裂。
  if (input.scene === 'online_text') {
    return resolveVisitorVoiceRole(input) === 'chaotic_disorganized' ? 'text_fragmented' : 'text_short';
  }

  const role = resolveVisitorVoiceRole(input);
  if (role === 'chaotic_disorganized') return 'fragmented';
  if (state === 'guarded') return 'guarded_deflection';

  switch (role) {
    case 'anxious_seeker':
      // 只在联盟还没建立时"问回去"；联盟稳了就不再反复求证。
      return (input.bond ?? 0.5) < 0.5 ? 'question_back' : 'correct_self_mid_sentence';
    case 'intellectualizing':
      // 理智化角色最缺的是具体细节，不是更多分析。
      return 'concrete_detail';
    case 'passive_aggressive':
      return 'indirect_barb';
    case 'emotional':
      return state === 'flooded' ? 'fragment_then_stop' : 'emotional_detail';
    case 'guarded_withdrawn':
      return 'guarded_deflection';
    case 'restrained':
      return state === 'flooded' ? 'fragment_then_stop' : 'short_answer_then_silence';
    default:
      return 'correct_self_mid_sentence';
  }
}
