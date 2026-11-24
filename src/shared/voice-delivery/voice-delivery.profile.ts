// AF-460: 从临床画像生成厂商无关交付档案（纯函数）.
//
// 设计原则：
//   1. 先定"这个人这句话会怎么说"，再映射到 TTS。不是让 TTS 自己猜语气。
//   2. 所有数值由风格/难度/情绪/角色基线推导，同输入同输出；重放不漂移。
//   3. 默认压低"播音腔"：略慢、略低、略收，允许犹豫和呼吸；但不同情绪有方向。

import {
  normalizeDeliveryDifficulty,
  normalizeDeliveryEmotion,
  normalizeDeliveryStyle,
  type DeliveryEmotion,
  type DeliveryStyle,
  type VoiceDeliveryInput,
  type VoiceDeliveryProfile,
} from './voice-delivery.types.js';

/** 情绪 -> 基线强度（1–5）；实际再按唤醒微调. */
const EMOTION_INTENSITY: Readonly<Record<DeliveryEmotion, number>> = {
  calm: 2,
  sad: 3,
  fearful: 4,
  angry: 3,
  happy: 3,
  surprised: 4,
  disgusted: 3,
};

/** 风格 -> 语速基线（越回避越慢，配合度越高越接近自然）. */
const STYLE_SPEED: Readonly<Record<DeliveryStyle, number>> = {
  cooperative: 1,
  mixed: 0.96,
  defensive: 0.93,
  resistant: 0.92,
  avoidant: 0.92,
  unknown: 0.95,
};

/** 风格 -> 音量基线（回避/阻抗更收，愤怒更高）. */
const STYLE_VOLUME: Readonly<Record<DeliveryStyle, number>> = {
  cooperative: 1,
  mixed: 0.98,
  defensive: 0.94,
  resistant: 0.95,
  avoidant: 0.92,
  unknown: 0.97,
};

/** 风格 -> 音调基线（低落/回避更低，焦虑更高）. */
const STYLE_PITCH: Readonly<Record<DeliveryStyle, number>> = {
  cooperative: 0,
  mixed: -0.4,
  defensive: -0.6,
  resistant: -0.4,
  avoidant: -1,
  unknown: -0.3,
};

/** 把数值夹在闭区间. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 保留两位小数，避免浮点噪声进请求体. */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** 情绪 -> 语速增量. */
function speedOfEmotion(emotion: DeliveryEmotion): number {
  switch (emotion) {
    case 'sad':
      return -0.04;
    case 'fearful':
      return 0.03;
    case 'angry':
      return -0.02;
    case 'happy':
      return 0.04;
    case 'surprised':
      return 0.02;
    case 'disgusted':
      return -0.01;
    default:
      return -0.01;
  }
}

/** 情绪 -> 音量增量. */
function volumeOfEmotion(emotion: DeliveryEmotion): number {
  switch (emotion) {
    case 'sad':
      return -0.06;
    case 'fearful':
      return -0.05;
    case 'angry':
      return 0.05;
    case 'happy':
      return 0.02;
    case 'surprised':
      return 0.02;
    case 'disgusted':
      return -0.02;
    default:
      return -0.02;
  }
}

/** 情绪 -> 音调增量（半音）. */
function pitchOfEmotion(emotion: DeliveryEmotion): number {
  switch (emotion) {
    case 'sad':
      return -2;
    case 'fearful':
      return 1;
    case 'angry':
      return 0.5;
    case 'happy':
      return 0.8;
    case 'surprised':
      return 1.2;
    case 'disgusted':
      return -0.5;
    default:
      return -0.3;
  }
}

/**
 * 生成豆包 2.0 的 context_texts（只发一条；官方只有第一条生效）.
 *
 * 写法刻意避开"请朗读/播报"这类会强化播音腔的词，改用"真实来访者的口吻".
 *
 * @param profile 已算好的情绪/风格
 * @returns 一条中文风格指令
 */
function contextTextOf(profile: Pick<VoiceDeliveryProfile, 'emotion' | 'style' | 'difficulty'>): string {
  const tone = (() => {
    switch (profile.emotion) {
      case 'sad':
        return '语气低落、克制，允许有一点疲惫';
      case 'fearful':
        return '语气紧张、不安，允许迟疑和吸气';
      case 'angry':
        return '语气紧绷，压着怒气，不要喊出来';
      case 'happy':
        return '语气轻快、自然，不要甜腻';
      case 'surprised':
        return '语气有轻微惊讶，但不要夸张';
      case 'disgusted':
        return '语气疏离、带一点反感';
      default:
        return '语气平静、自然，但不要平淡';
    }
  })();
  const pace = paceOfStyle(profile.style);
  const difficulty = profile.difficulty === 'L3' ? '句子之间可以多留一点空白' : '句子之间允许自然停顿';
  return `请用真实来访者的口吻，不要新闻播报或播音腔。${pace}，${tone}；${difficulty}，有犹豫、呼吸和口头语，不要每句都上扬，也不要过度饱满。`;
}

/** 风格 -> 风格指令里的语速描述. */
function paceOfStyle(style: DeliveryStyle): string {
  if (style === 'avoidant' || style === 'resistant') return '语速偏慢';
  if (style === 'cooperative') return '语速自然';
  return '语速略慢';
}

/**
 * 构建一轮交付档案.
 *
 * @param input 业务侧输入
 * @returns 厂商无关档案
 */
export function buildVoiceDeliveryProfile(input: VoiceDeliveryInput): VoiceDeliveryProfile {
  const style = normalizeDeliveryStyle(input);
  const difficulty = normalizeDeliveryDifficulty(input.difficulty);
  const emotion = normalizeDeliveryEmotion(input.emotion);
  const valence = input.valence ?? 0;
  const arousal = input.arousal ?? 0.4;
  const speechVolume = input.speechVolumeBaseline ?? 0.5;

  let intensity = EMOTION_INTENSITY[emotion];
  if (arousal >= 0.65) intensity += 1;
  if (arousal <= 0.25) intensity -= 1;
  if (valence <= -0.4 && (emotion === 'sad' || emotion === 'fearful')) intensity += 1;
  intensity = Math.round(clamp(intensity, 1, 5));

  let speed = STYLE_SPEED[style] + speedOfEmotion(emotion);
  if (speechVolume >= 0.65) speed += 0.02;
  if (speechVolume <= 0.35) speed -= 0.03;
  if (valence <= -0.3) speed -= 0.02;
  if (arousal >= 0.65) speed += 0.03;
  speed = round2(clamp(speed, 0.86, 1.08));

  let volume = STYLE_VOLUME[style] + volumeOfEmotion(emotion);
  if (difficulty === 'L3') volume -= 0.03;
  volume = round2(clamp(volume, 0.88, 1.06));

  let pitch = STYLE_PITCH[style] + pitchOfEmotion(emotion);
  if (difficulty === 'L3') pitch -= 1;
  pitch = round2(clamp(pitch, -3, 2));

  const partial = { emotion, style, difficulty };
  return {
    version: 'af460-v1',
    emotion,
    emotionIntensity: intensity,
    speed,
    volume,
    pitch,
    style,
    difficulty,
    turnIndex: input.turnIndex,
    seed: `${input.sessionId}#${input.turnIndex}`,
    contextText: contextTextOf(partial),
    notes: [
      `情绪=${emotion} 强度=${intensity}`,
      `语速=${speed.toFixed(2)} 音量=${volume.toFixed(2)} 音调=${pitch.toFixed(2)}`,
      `风格=${style} 难度=${difficulty}`,
    ],
  };
}
