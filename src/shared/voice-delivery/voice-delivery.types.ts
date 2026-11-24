// AF-460: 厂商无关的语音交付档案（纯类型，无 IO、无 Nest）.
//
// 为什么需要这一层：
//   AF-459 只解决了"文本里有没有停顿标记"，但真正让声音像真人还需要
//   情绪、语速、音量、音调、思考段、长沉默与副语言一起决定。把这些参数
//   散落在三家 provider 的请求体里，会出现"同一轮三家听感完全不是一个人"
//   和"调试页看不到实际参数"两个问题。这里先产出一份厂商无关的交付档案，
//   再由每家渲染器映射到自己的 API。

/** 语义情绪（与自动对练 semantic JSON 的封闭枚举对齐；未知值归 calm）. */
export type DeliveryEmotion = 'calm' | 'sad' | 'fearful' | 'angry' | 'happy' | 'surprised' | 'disgusted';

/** 来访者配合风格（业务侧从角色画像/会话元数据映射，纯层只认字符串）. */
export type DeliveryStyle = 'cooperative' | 'mixed' | 'defensive' | 'resistant' | 'avoidant' | 'unknown';

/** 难度档（用于长沉默上限与思考段长度）. */
export type DeliveryDifficulty = 'L1' | 'L2' | 'L3' | 'unknown';

/** 一轮的语音交付档案. */
export interface VoiceDeliveryProfile {
  readonly version: 'af460-v1';
  /** 语义情绪；三家渲染器各自映射，不把 vendor 枚举写进业务层. */
  readonly emotion: DeliveryEmotion;
  /** 情绪强度 1–5；豆包走 context_texts，MiniMax 可走 emotion（模型支持时）. */
  readonly emotionIntensity: number;
  /** 语速（1 = 原速；建议 0.85–1.08）. */
  readonly speed: number;
  /** 音量（1 = 原音量；建议 0.9–1.05）. */
  readonly volume: number;
  /** 音调（整数半音；建议 -4–4，MiniMax/豆包都要求整数）. */
  readonly pitch: number;
  readonly style: DeliveryStyle;
  readonly difficulty: DeliveryDifficulty;
  readonly turnIndex: number;
  /** 确定性 seed；同一轮重放时参数不漂移. */
  readonly seed: string;
  /** 豆包 2.0 的 context_texts 组合指令（只发一条，官方只有第一条生效）. */
  readonly contextText: string;
  /** 给调试页/审计看的可读说明，不参与厂商请求. */
  readonly notes: readonly string[];
}

/** 档案输入（业务侧从会话元数据/角色画像取值）. */
export interface VoiceDeliveryInput {
  readonly sessionId: string;
  readonly turnIndex: number;
  /** 语义情绪（可空；空时按效价/唤醒或风格推断）. */
  readonly emotion?: string | null;
  readonly style?: string;
  readonly difficulty?: string;
  /** 角色画像的情绪效价 [-1,1] 与唤醒 [0,1]（可空）. */
  readonly valence?: number;
  readonly arousal?: number;
  /** 角色画像的话量基线 [0,1]（越高越絮叨）. */
  readonly speechVolumeBaseline?: number;
  /** 角色画像的表达语态（restrained/emotional/intellectualizing/passive_aggressive）. */
  readonly expressionTone?: string;
  /** 角色画像的依恋风格（secure/anxious/avoidant/disorganized）. */
  readonly attachmentStyle?: string;
}

/** 语义情绪 -> 封闭枚举；未知/neutral 一律按 calm（官方中性值）. */
export function normalizeDeliveryEmotion(value: string | null | undefined): DeliveryEmotion {
  switch (value) {
    case 'sad':
    case 'fearful':
    case 'angry':
    case 'happy':
    case 'surprised':
    case 'disgusted':
    case 'calm':
      return value;
    case 'anxious':
    case 'nervous':
      return 'fearful';
    case 'neutral':
    case undefined:
    case null:
      return 'calm';
    default:
      return 'calm';
  }
}

/** 风格/依恋/语态 -> 交付风格（优先级从具体到泛化）. */
export function normalizeDeliveryStyle(input: Pick<VoiceDeliveryInput, 'style' | 'expressionTone' | 'attachmentStyle'>): DeliveryStyle {
  switch (input.style) {
    case 'cooperative':
    case 'mixed':
    case 'defensive':
    case 'resistant':
    case 'avoidant':
      return input.style;
    default:
      break;
  }
  if (input.attachmentStyle === 'avoidant') return 'avoidant';
  if (input.expressionTone === 'passive_aggressive') return 'resistant';
  if (input.expressionTone === 'intellectualizing') return 'defensive';
  if (input.attachmentStyle === 'disorganized') return 'defensive';
  if (input.attachmentStyle === 'secure') return 'cooperative';
  if (input.attachmentStyle === 'anxious') return 'mixed';
  return 'unknown';
}

/** 难度归一化. */
export function normalizeDeliveryDifficulty(value: string | undefined): DeliveryDifficulty {
  const upper = value?.trim().toUpperCase();
  if (upper === 'L1' || upper === 'L2' || upper === 'L3') return upper;
  return 'unknown';
}
