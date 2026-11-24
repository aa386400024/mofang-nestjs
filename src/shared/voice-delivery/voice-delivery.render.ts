// AF-460: 三家 TTS 的渲染器（纯函数）.
//
// 每家只做两件事：
//   1. 把语义形态（[pause:0.4] / [beat:1.8] / [silence:5.2] / [breath]）翻译成
//      该厂商真正认的文本/参数，不伪造它没有的能力。
//   2. 把厂商无关的 VoiceDeliveryProfile 映射成该厂商的 speed/volume/pitch/emotion。
//
// 豆包 2.0 没有 `<#x#>`、没有 SSML break，也没有句内长停顿；这部分在预览里
// 明确标注"未落地"，而不是塞一个它不认的标签让上游念出来。

import type { DeliveryEmotion, VoiceDeliveryProfile } from './voice-delivery.types.js';
import { renderMiniMaxText, stripProsodyMarkers } from '../prosody/index.js';

/** 渲染器能力声明（调试页据此给警告，不猜）. */
export interface VoiceDeliveryRendererCapabilities {
  /** 是否支持文本内停顿标记（MiniMax `<#x#>`）. */
  readonly pauseMarkers: boolean;
  /** 是否支持 3–10s 的句内长沉默. */
  readonly longSilence: boolean;
  /** 是否支持 `(breath)/(sighs)` 这类副语言. */
  readonly paralinguistic: boolean;
  /** 是否支持独立 emotion 参数（部分音色才支持）. */
  readonly emotionParameter: boolean;
  /** 是否支持一条自然语言风格指令（豆包 context_texts）. */
  readonly styleContext: boolean;
  /** 单次长停顿上限（毫秒；0 = 不支持）. */
  readonly maxLongSilenceMs: number;
}

/** 渲染结果（文本 + 该 provider 实际落地/未落地的说明）. */
export interface VoiceDeliveryRenderResult {
  readonly ttsText: string;
  readonly notes: readonly string[];
  /** 真正进入音频的静默时长（豆包 2.0 为 0，长沉默需要服务端静默段）. */
  readonly appliedSilenceMs: number;
}

/** MiniMax 2.8 能力. */
export const MINIMAX_CAPABILITIES: VoiceDeliveryRendererCapabilities = {
  pauseMarkers: true,
  longSilence: true,
  paralinguistic: true,
  emotionParameter: true,
  styleContext: false,
  maxLongSilenceMs: 10_000,
};

/** 豆包 2.0 能力（Agent Plan 当前套餐）. */
export const DOUBAO_2_CAPABILITIES: VoiceDeliveryRendererCapabilities = {
  pauseMarkers: false,
  longSilence: false,
  paralinguistic: false,
  emotionParameter: false,
  styleContext: true,
  maxLongSilenceMs: 0,
};

/** MiniMax 官方 emotion 合法枚举；neutral 不是合法值，统一走 calm. */
const MINIMAX_EMOTIONS = new Set(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm']);

/**
 * 语义情绪 -> MiniMax `voice_setting.emotion`.
 *
 * @param emotion 交付档案情绪
 * @returns 合法枚举；null = 不下发
 */
export function toMiniMaxEmotion(emotion: DeliveryEmotion): string | null {
  return MINIMAX_EMOTIONS.has(emotion) ? emotion : null;
}

/**
 * 交付档案 -> MiniMax `voice_setting`.
 *
 * @param profile 交付档案
 * @returns MiniMax 参数
 */
export function toMiniMaxVoiceSetting(profile: VoiceDeliveryProfile): {
  speed: number;
  vol: number;
  pitch: number;
  emotion?: string;
} {
  const emotion = toMiniMaxEmotion(profile.emotion);
  return {
    speed: profile.speed,
    vol: profile.volume,
    pitch: profile.pitch,
    ...(emotion === null ? {} : { emotion }),
  };
}

/**
 * 交付档案 -> 豆包 2.0 `audio_params` 数值.
 *
 * 官方范围：speech_rate / loudness_rate [-50,100]，pitch_rate [-12,12]。
 * 这里用"相对 1 的百分比"映射，保证 0.92 的语速真的比 1.0 慢，而不是被吃掉。
 *
 * @param profile 交付档案
 * @returns 豆包参数
 */
export function toDoubaoAudioParams(profile: VoiceDeliveryProfile): {
  speech_rate: number;
  loudness_rate: number;
  pitch_rate: number;
} {
  const speechRate = Math.round((profile.speed - 1) * 100);
  const loudnessRate = Math.round((profile.volume - 1) * 100);
  const pitchRate = Math.round(profile.pitch);
  return {
    speech_rate: Math.min(100, Math.max(-50, speechRate)),
    loudness_rate: Math.min(100, Math.max(-50, loudnessRate)),
    pitch_rate: Math.min(12, Math.max(-12, pitchRate)),
  };
}

/**
 * 渲染 MiniMax 文本形态.
 *
 * @param speechText 语义形态
 * @param profile 交付档案
 * @returns 渲染结果
 */
export function renderMiniMaxDelivery(speechText: string, profile: VoiceDeliveryProfile): VoiceDeliveryRenderResult {
  const ttsText = renderMiniMaxText(speechText);
  const notes: string[] = [`emotion=${toMiniMaxEmotion(profile.emotion) ?? '未下发'}`];
  if (speechText.includes('[silence:')) {
    notes.push('长沉默以 <#x#> 下发（上限 10s）；流式链路靠服务端控制下发节奏');
  }
  if (speechText.includes('[beat:')) notes.push('思考段 = 口头语 + 0.5–3.0s 停顿');
  return { ttsText, notes, appliedSilenceMs: sumRenderedSilenceMs(ttsText) };
}

/**
 * 渲染豆包 2.0 文本形态.
 *
 * 2.0 不认 `<#x#>`/break：短停顿靠原文标点与语速，长沉默与副语言不伪造，
 * 在 notes 里说明需要服务端静默段。真实参数由调用方塞进 audio_params。
 *
 * @param speechText 语义形态
 * @returns 渲染结果
 */
export function renderDoubaoDelivery(speechText: string): VoiceDeliveryRenderResult {
  const ttsText = stripProsodyMarkers(speechText)
    .replaceAll(/[ \t]{2,}/g, ' ')
    .trim();
  const notes: string[] = [];
  if (speechText.includes('[pause:')) notes.push('2.0 不支持文本内停顿标签：短停顿已退化为标点 + 语速');
  if (speechText.includes('[beat:')) notes.push('2.0 不支持思考段停顿：仅保留「嗯……」口头语，停顿靠语速');
  if (speechText.includes('[silence:')) notes.push('2.0 不支持句内长沉默：需要服务端静默音频段，本合成不含该段');
  if (speechText.includes('[breath]') || speechText.includes('[sigh]')) notes.push('2.0 不支持 (breath)/(sighs) 标签：副语言已丢弃');
  return { ttsText, notes, appliedSilenceMs: 0 };
}

/** 统计真正落在渲染文本里的 `<#x#>` 总时长（被丢弃的句末标记不计）. */
function sumRenderedSilenceMs(ttsText: string): number {
  let total = 0;
  for (const match of ttsText.matchAll(/<#(\d+(?:\.\d+)?)#>/g)) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds)) total += seconds * 1000;
  }
  return total;
}
