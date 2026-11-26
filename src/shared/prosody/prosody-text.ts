// AF-459: 文本层的厂商渲染与标记清洗（纯函数 + 一个有状态的流式清洗器）.
//
// 三层文本不要混：
//   1. displayText：给人看的正文，**一个标签都不能有**（气泡、逐字稿、审计）
//   2. speechText：语义形态，`[pause:0.4]` 这种可读标记（管理端"语音形态"切换用它）
//   3. ttsText：厂商形态，MiniMax 的 `<#0.4#>`（只发给 TTS，不回前端当正文）
//
// 为什么要流式清洗：旧链路 prompt 会教模型写 `[pause:0.5]`，而 chunk 是流式的——
// 标签可能被拆成 `[pa` + `use:0.5]` 两段。逐 chunk 正则替换会漏掉半个标签、把
// `use:0.5]` 当正文念出来。所以按"未闭合的 [ / ( 先扣在缓冲里"处理.

import { stripVisitorStageDirections } from '../realism/visitor-stage-direction.js';

/** MiniMax 语气词白名单（官方文档；白名单外的会被当普通文字念出来）. */
const MINIMAX_VOICE_MARKERS = new Set([
  'laughs',
  'chuckle',
  'coughs',
  'clear-throat',
  'groans',
  'breath',
  'pant',
  'inhale',
  'exhale',
  'gasps',
  'sniffs',
  'sighs',
  'snorts',
  'burps',
  'lip-smacking',
  'humming',
  'hissing',
  'emm',
  'sneezes',
]);

/** 任意方括号标签（防御性清洗：不认识的也不当正文念）. */
const ANY_BRACKET_TAG = /\[[^\]]{0,40}\]/g;

/** 厂商停顿标记（可能来自上游或历史数据）. */
const VENDOR_PAUSE = /<#\d+(?:\.\d+)?#>/g;

/** 流式缓冲上限：超过就当作正文放行，避免异常输入把这一轮卡住. */
const MAX_HOLD_CHARS = 32;

/** 单个可发音字符（汉字/字母/数字/常见标点之外的非空白）. */
const SPEAKABLE = /[\p{L}\p{N}]/u;

/** 不同类型停顿的时长边界（秒）与渲染标签. */
const PAUSE_LIMITS = {
  pause: { min: 0.1, max: 1, kind: 'pause' },
  beat: { min: 0.5, max: 3, kind: 'beat' },
  silence: { min: 1, max: 10, kind: 'silence' },
} as const;

/** 副语言 -> MiniMax 白名单标签. */
const MINIMAX_PARALINGUISTIC: Readonly<Partial<Record<string, string>>> = {
  breath: 'breath',
  sigh: 'sighs',
};

/**
 * 清洗正文：剥掉所有语义/厂商标记与已知语气词.
 *
 * @param text 原始文本
 * @returns 只有正文的文本
 */
export function stripProsodyMarkers(text: string): string {
  let out = text.replaceAll(VENDOR_PAUSE, '');
  out = out.replaceAll(ANY_BRACKET_TAG, '');
  out = out.replaceAll(/\(([a-z][a-z-]{1,20})\)/g, (whole, word: string) => (MINIMAX_VOICE_MARKERS.has(word) ? '' : whole));
  // AF-559: 中文全角括号舞台说明（（停顿）（声音很轻））不属语义标记，但同样不能进
  //   display / TTS. 放在最后统一投影，避免与上方标签清洗互相干扰.
  out = stripVisitorStageDirections(out);
  // 不做 trim：流式场景下 chunk 边界的空格是正文的一部分（英文单词会被拼掉）.
  return out.replaceAll(/[ \t]{2,}/g, ' ');
}

/** 可参与渲染的语义标记（停顿三类 + 副语言两类）. */
const RENDER_MARKER = /\[(pause|beat|silence):(\d+(?:\.\d+)?)\]|\[(breath|sigh)\]/g;

/**
 * 把语义形态渲染成 MiniMax 文本形态.
 *
 * 合法性检查（官方要求"停顿必须夹在两个可发音文本之间，不能连用"）：
 *   · 左侧必须以可发音字符结尾，右侧必须以可发音字符开头，否则丢掉这条停顿
 *   · 与上一条停顿相邻（`#><#`）时丢掉后一条
 *   · pause 夹到 [0.1, 1] 秒，beat 夹到 [0.5, 3] 秒，silence 夹到 [1, 10] 秒
 *   · 副语言只在句首或句末标点之后落地
 *
 * @param speechText 语义形态文本
 * @returns MiniMax 可直接合成的文本
 */
export function renderMiniMaxText(speechText: string): string {
  RENDER_MARKER.lastIndex = 0;
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RENDER_MARKER.exec(speechText)) !== null) {
    out += speechText.slice(lastIndex, match.index);
    const right = speechText.slice(RENDER_MARKER.lastIndex);
    if (match[1] !== undefined && match[2] !== undefined) {
      const kind = match[1] as keyof typeof PAUSE_LIMITS;
      const seconds = Number(match[2]);
      if (canPlacePause(out, right, seconds)) {
        out += `<#${formatPauseSeconds(kind, seconds)}#>`;
      }
    } else if (match[3] !== undefined) {
      const marker = MINIMAX_PARALINGUISTIC[match[3]];
      if (marker !== undefined && isSentenceStart(out)) {
        out += `(${marker})`;
      }
    }
    lastIndex = RENDER_MARKER.lastIndex;
  }
  out += speechText.slice(lastIndex);
  return dropInlineParalinguistic(out);
}

/**
 * 丢掉句子中间的 `(breath)/(sighs)`，只保留句首或句末标点后的副语言.
 *
 * 官方允许副语言标签，但把它塞在词中间会变成"我（吸气）有点累"这种朗读腔，
 * 听感比不加更假。生成端本来只产句首，这里再兜一层，防止外部文本带进来.
 *
 * @param text 已渲染文本
 * @returns 清洗后文本
 */
function dropInlineParalinguistic(text: string): string {
  return text.replaceAll(/\((?:breath|sighs)\)/g, (marker, offset: number) => {
    const left = text.slice(0, offset);
    const right = text.slice(offset + marker.length);
    return isSentenceStart(left) || /^\s*$/.test(right) ? marker : '';
  });
}

/**
 * 副语言是否在合法位置（句首或句末标点之后）.
 *
 * @param left 已输出的左半段
 * @returns true = 可以落
 */
function isSentenceStart(left: string): boolean {
  if (left.length === 0) return true;
  return /[。！？!?]\s*$/.test(left) || /^\s*$/.test(left);
}

/**
 * 判断停顿能否落在当前位置.
 *
 * 官方要求"夹在两个可发音文本之间"——标点本身不发音，但"…，<#0.4#>工作…"
 * 这种写法两侧仍有实际语音，是合法且最自然的断点；真正非法的是句首/句尾
 * 以及与另一条停顿相邻.
 *
 * @param left 已输出的左半段
 * @param right 右半段
 * @param seconds 原始时长
 * @returns true = 可插
 */
function canPlacePause(left: string, right: string, seconds: number): boolean {
  if (!Number.isFinite(seconds) || left.length === 0 || right.length === 0) return false;
  if (left.endsWith('#>') || left.endsWith('[') || left.endsWith('<')) return false;
  if (findSpeakable(left, -1) === '' || findSpeakable(right, 1) === '') return false;
  return true;
}

/**
 * 在给定方向上找最近的"可发音字符"（最多看 4 个字符，避免跨句误判）.
 *
 * @param text 文本
 * @param direction -1 = 向左, 1 = 向右
 * @returns 字符；找不到返回空串
 */
function findSpeakable(text: string, direction: -1 | 1): string {
  const limit = Math.min(4, text.length);
  for (let step = 1; step <= limit; step += 1) {
    const char = direction === -1 ? text.at(-step) : text.at(step - 1);
    if (char === undefined) break;
    if (SPEAKABLE.test(char)) return char;
  }
  return '';
}

/**
 * 归一化停顿时长.
 *
 * @param kind 停顿类型
 * @param seconds 原始秒数
 * @returns 各类型边界内、最多两位小数的字符串
 */
function formatPauseSeconds(kind: keyof typeof PAUSE_LIMITS, seconds: number): string {
  const limit = PAUSE_LIMITS[kind];
  const clamped = Math.min(limit.max, Math.max(limit.min, seconds));
  return String(Number(clamped.toFixed(2)));
}

/**
 * 流式文本清洗器（每轮一个实例）.
 *
 * 语义：`feed()` 返回"可以安全展示/送 TTS 的正文"，未闭合的标签前缀先扣住；
 * 轮末 `flush()` 把剩余缓冲清洗后放出来（真正未闭合的残片直接丢弃）.
 */
export class ProsodyStreamSanitizer {
  private buffer = '';

  /**
   * 喂一个 LLM chunk.
   *
   * @param chunk 原始增量
   * @returns 可安全下发的正文片段（可能为空串）
   */
  feed(chunk: string): string {
    if (chunk.length === 0) return '';
    this.buffer += chunk;
    const holdAt = findHoldStart(this.buffer);
    const head = holdAt === -1 ? this.buffer : this.buffer.slice(0, holdAt);
    this.buffer = holdAt === -1 ? '' : this.buffer.slice(holdAt);
    if (this.buffer.length > MAX_HOLD_CHARS) {
      const forced = this.buffer;
      this.buffer = '';
      return stripProsodyMarkers(`${head}${forced}`);
    }
    return stripProsodyMarkers(head);
  }

  /**
   * 轮末冲刷.
   *
   * @returns 剩余正文（未闭合标签会被剥掉）
   */
  flush(): string {
    const rest = this.buffer;
    this.buffer = '';
    const holdAt = findHoldStart(rest);
    // 轮末仍未闭合的标签前缀直接丢弃 —— 它的正文部分已经发过了.
    return stripProsodyMarkers(holdAt === -1 ? rest : rest.slice(0, holdAt));
  }
}

/**
 * 找必须扣住的起点（最后一个未闭合的 `[` 或 `(`）.
 *
 * @param text 当前缓冲
 * @returns 扣留起点；-1 = 无需扣留
 */
function findHoldStart(text: string): number {
  const bracket = lastUnclosed(text, '[', ']');
  const paren = lastUnclosed(text, '(', ')');
  const fullwidthParen = lastUnclosed(text, '（', '）');
  const candidates = [bracket, paren, fullwidthParen].filter((at) => at !== -1);
  return candidates.length === 0 ? -1 : Math.min(...candidates);
}

/**
 * 最后一个未闭合的开符号位置.
 *
 * @param text 当前缓冲
 * @param open 开符号
 * @param close 闭符号
 * @returns 位置；-1 = 没有未闭合
 */
function lastUnclosed(text: string, open: string, close: string): number {
  const openAt = text.lastIndexOf(open);
  if (openAt === -1) return -1;
  return text.lastIndexOf(close) > openAt ? -1 : openAt;
}
