// V2026-11-10 建立 (Phase2.5 WP-J P1e · TTS 语义标记解析层 · 第二层「适配层」):
//   职责: 把**厂商无关**的 SemanticTurn 翻译成 MiniMax T2A 能吃的文本与语音参数.
//
// ── 这一层为什么单独存在 ──────────────────────────────────────────────────
//   语义层 (semantic-tag-parser) 只知道 "停顿 0.5 秒" / "叹气", 不知道 MiniMax 怎么写.
//   厂商差异全部关在这一层里:
//     · 停顿:      语义 `[pause:0.5]`   → MiniMax `<#0.5#>` (插在文本里的对应位置)
//     · 句首语气:  语义 `[sigh]`        → MiniMax `(sighs)` (只能在句首)
//     · 情绪:      语义 `[emotion:sad]`  → MiniMax **voice_setting.emotion** (不在文本里)
//     · 控制标记:  语义 `[[STATE:END]]`  → **剥掉** (TTS 看不见, 那是引擎的事)
//   以后加火山/阿里云适配器 = 再写一个同形状的适配器, 语义层与存储层一行不动.
//
// ── 情绪映射里的一处妥协 (必须写清楚) ────────────────────────────────────
//   语义层的 'calm' 在 MiniMax 的 emotion 枚举里**没有对应值** —— MiniMax 只有
//   happy / sad / angry / fearful / disgusted / surprised / neutral.
//   这里映射成 'neutral' (最接近), 而不是把 'calm' 生搬过去 (那会让 TTS 报非法值).
//
// ── 语速/音调为什么不放在语义层 ───────────────────────────────────────────
//   speed / pitch 是**角色基线属性** (8 个角色各有自己的语速音调, 存在角色 profile 里),
//   不是 "这一轮说了什么" 的语义. 混进 SemanticTurn 会让 "角色是谁" 和 "这一轮什么情绪"
//   挤在一个对象里, Phase 2 接线时无处安放角色参数.
//   所以: 角色参数由**调用方**从角色 profile 取出来, 通过 `baseVoiceParams` 传进来;
//   适配器只负责把它和本轮派生的 emotion 合并. 语义层契约因此不必再改.
//
// ── Phase 2 接线时的三条提醒 (写在代码里, 别到时候忘了) ────────────────────
//   ① **控制标记不能从 displayText 取**: 引擎的结束信号在 `rawText` 里
//      ([[STATE:END]]), 解析层会把它从正文剥掉 —— 用 displayText 判断收尾会永远收不了尾.
//   ② **ttsText ≠ displayText**: ttsText 多了厂商标记, 且会剥掉"不认识的标记"
//      (那是防止把 [xyzzy] 当词念出来); displayText 保留它们, 供标注台与事后校准.
//   ③ **厂商标记格式需按账号的模型版本复核**: MiniMax 的语气标签表会随模型版本增补,
//      本适配器只认代码里那张表; 认不出的会按"厂商标记丢弃"处理 (记 warning, 不入正文).
//      官方文档: https://platform.minimaxi.com/document/Announcement/speech-model

import type {
  SemanticEmotion,
  SemanticParseResult,
  SemanticPreSpeech,
  SemanticTurn,
  SemanticUnknownTagSpan,
} from '../utils/semantic-tag-parser.js';

/** MiniMax voice_setting.emotion 的合法取值. */
export type MiniMaxEmotion = 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';

/** MiniMax voice_setting 里本项目会用到的参数. */
export interface MiniMaxVoiceParams {
  /** 情绪 (由本轮语义派生). */
  readonly emotion?: MiniMaxEmotion;
  /** 语速 (0.5 - 2), 来自角色基线. */
  readonly speed?: number;
  /** 音调 (-12 - 12), 来自角色基线. */
  readonly pitch?: number;
  /** 音量 (0.1 - 10), 来自角色基线. */
  readonly vol?: number;
}

/** 渲染参数. */
export interface MiniMaxTtsRenderOptions {
  /** 角色基线参数 (语速/音调/音量) —— 由调用方从角色 profile 传入. */
  readonly baseVoiceParams?: MiniMaxVoiceParams;
}

/** 渲染结果. */
export interface MiniMaxTtsRenderResult {
  /** 喂给 TTS 的文本 (带 MiniMax 标记). */
  readonly ttsText: string;
  /** 喂给 TTS 的语音参数. */
  readonly voiceParams: MiniMaxVoiceParams;
}

/** 语义层句首语气 → MiniMax 语气标签. */
const PRE_SPEECH_MARKERS: Readonly<Record<SemanticPreSpeech, string>> = {
  sigh: '(sighs)',
  breath: '(breath)',
  emm: '(emm)',
  laugh: '(laughs)',
  inhale: '(inhales)',
};

/** 语义层情绪 → MiniMax emotion (calm 在 MiniMax 侧没有对应值, 归到 neutral). */
const EMOTION_MAPPING: Readonly<Record<SemanticEmotion, MiniMaxEmotion>> = {
  sad: 'sad',
  calm: 'neutral',
  fearful: 'fearful',
  angry: 'angry',
  happy: 'happy',
};

/**
 * 停顿时长的文本化.
 *
 * 两位小数、去掉多余的零: 0.5 → "0.5", 1 → "1", 0.05 → "0.05", 99.99 → "99.99".
 *
 * @param durationSec 时长 (秒)
 * @returns 文本化结果
 */
export function formatPauseDuration(durationSec: number): string {
  return String(Number(durationSec.toFixed(2)));
}

/**
 * 归一化"要剥掉的区间" (排序 + 合并重叠).
 *
 * @param spans 区间列表
 * @returns 归一化后的区间 (按 offset 升序, 不重叠)
 */
function normalizeSpans(spans: readonly SemanticUnknownTagSpan[]): SemanticUnknownTagSpan[] {
  const sorted = [...spans].toSorted((a, b) => a.offset - b.offset);
  const merged: SemanticUnknownTagSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.offset < last.offset + last.length) {
      const end = Math.max(last.offset + last.length, span.offset + span.length);
      merged[merged.length - 1] = { offset: last.offset, length: end - last.offset };
      continue;
    }
    merged.push({ offset: span.offset, length: span.length });
  }
  return merged;
}

/**
 * 文本上的一个事件: 要插入的标记 / 要剥掉的区间.
 */
interface TextEvent {
  readonly offset: number;
  readonly kind: 'cut' | 'mark';
  /** 'cut' 时 = 区间结束位置; 'mark' 时 = 无意义. */
  readonly end: number;
  /** 'mark' 时 = 要插入的文本. */
  readonly marker: string;
}

/**
 * 组装 ttsText: 剥掉不认识的标记 + 在对应偏移插入停顿标记.
 *
 * 走一遍事件流而不是反复 slice/拼接 —— 偏移是纯文本下标, 一旦插入标记,
 * 后面所有偏移都会平移, 事件流天然规避这个坑.
 *
 * @param text 纯文本
 * @param pauses 停顿 (按 offset 升序)
 * @param cuts 要剥掉的区间
 * @param preSpeechMarker 句首语气标记 (没有则为空串)
 * @returns ttsText
 */
function buildTtsText(
  text: string,
  pauses: readonly { readonly offset: number; readonly durationSec: number }[],
  cuts: readonly SemanticUnknownTagSpan[],
  preSpeechMarker: string,
): string {
  const events: TextEvent[] = [];
  for (const cut of normalizeSpans(cuts)) {
    events.push({ offset: cut.offset, kind: 'cut', end: cut.offset + cut.length, marker: '' });
  }
  for (const pause of pauses) {
    events.push({ offset: pause.offset, kind: 'mark', end: pause.offset, marker: `<#${formatPauseDuration(pause.durationSec)}#>` });
  }
  events.sort((a, b) => {
    if (a.offset !== b.offset) {
      return a.offset - b.offset;
    }
    if (a.kind === b.kind) {
      return 0;
    }
    return a.kind === 'cut' ? -1 : 1;
  });

  let out = '';
  let cursor = 0;
  for (const event of events) {
    if (event.offset < cursor) {
      // 落在已被剥掉的区间里 → 跳过 (标记不会插在被删的位置).
      continue;
    }
    out += text.slice(cursor, event.offset);
    cursor = event.offset;
    if (event.kind === 'cut') {
      cursor = event.end;
      continue;
    }
    out += event.marker;
  }
  out += text.slice(cursor);
  return preSpeechMarker + out;
}

/**
 * MiniMax T2A 适配器 —— 语义层 → MiniMax 格式.
 *
 * 纯工具类: 不发网络请求, 不读配置, 不打日志. Phase 2 由调用方拿它的输出去拼
 * TTS 请求的 `text` 与 `voice_setting`.
 */
export class MiniMaxTtsAdapter {
  /**
   * 渲染一轮语义 → MiniMax 文本 + 语音参数.
   *
   * @param turn 语义中间表示
   * @param options 渲染参数 (角色基线参数)
   * @returns ttsText + voiceParams
   */
  render(turn: SemanticTurn, options: MiniMaxTtsRenderOptions = {}): MiniMaxTtsRenderResult {
    const marker = turn.preSpeech ? PRE_SPEECH_MARKERS[turn.preSpeech] : '';
    const ttsText = buildTtsText(turn.text, turn.pauses, turn.unknownTags, marker);
    const base = options.baseVoiceParams;
    const voiceParams: MiniMaxVoiceParams = turn.emotion ? { ...base, emotion: EMOTION_MAPPING[turn.emotion] } : { ...base };
    return { ttsText, voiceParams };
  }

  /**
   * 渲染一次解析结果 (便捷入口).
   *
   * Level 2 (重度降级) 时语义字段已作废, 这里自然退化成 **纯文本** ——
   * 不需要额外分支.
   *
   * @param result 解析结果
   * @param options 渲染参数 (角色基线参数)
   * @returns ttsText + voiceParams
   */
  renderParsed(result: SemanticParseResult, options: MiniMaxTtsRenderOptions = {}): MiniMaxTtsRenderResult {
    return this.render(result.turn, options);
  }
}
