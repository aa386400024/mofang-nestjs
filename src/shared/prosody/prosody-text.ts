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

/** 停顿标记（语义形态）. */
const PAUSE_MARKER = /\[pause:(\d+(?:\.\d+)?)\]/g;

/** 任意方括号标签（防御性清洗：不认识的也不当正文念）. */
const ANY_BRACKET_TAG = /\[[^\]]{0,40}\]/g;

/** 厂商停顿标记（可能来自上游或历史数据）. */
const VENDOR_PAUSE = /<#\d+(?:\.\d+)?#>/g;

/** 流式缓冲上限：超过就当作正文放行，避免异常输入把这一轮卡住. */
const MAX_HOLD_CHARS = 32;

/** 单个可发音字符（汉字/字母/数字/常见标点之外的非空白）. */
const SPEAKABLE = /[\p{L}\p{N}]/u;

/** 停顿可插的时长边界（秒）. */
const PAUSE_MIN_SEC = 0.1;
const PAUSE_MAX_SEC = 1;

/**
 * 清洗正文：剥掉所有语义/厂商标记与已知语气词.
 *
 * @param text 原始文本
 * @returns 只有正文的文本
 */
export function stripProsodyMarkers(text: string): string {
  let out = text.replaceAll(VENDOR_PAUSE, '');
  out = out.replaceAll(PAUSE_MARKER, '');
  out = out.replaceAll(ANY_BRACKET_TAG, '');
  out = out.replaceAll(/\(([a-z][a-z-]{1,20})\)/g, (whole, word: string) => (MINIMAX_VOICE_MARKERS.has(word) ? '' : whole));
  // 不做 trim：流式场景下 chunk 边界的空格是正文的一部分（英文单词会被拼掉）.
  return out.replaceAll(/[ \t]{2,}/g, ' ');
}

/**
 * 把语义形态渲染成 MiniMax 文本形态.
 *
 * 合法性检查（官方要求"停顿必须夹在两个可发音文本之间，不能连用"）：
 *   · 左侧必须以可发音字符结尾，右侧必须以可发音字符开头，否则丢掉这条停顿
 *   · 与上一条停顿相邻（`#><#`）时丢掉后一条
 *   · 时长夹到 [0.1, 1] 秒，两位小数
 *
 * @param speechText 语义形态文本
 * @returns MiniMax 可直接合成的文本
 */
export function renderMiniMaxText(speechText: string): string {
  const parts = speechText.split(PAUSE_MARKER);
  // split 带捕获组时：偶数位是正文，奇数位是时长
  let out = parts[0] ?? '';
  for (let index = 1; index < parts.length; index += 2) {
    const rawSeconds = Number(parts[index]);
    const right = parts[index + 1] ?? '';
    out += canPlacePause(out, right, rawSeconds) ? `<#${formatPauseSeconds(rawSeconds)}#>${right}` : right;
  }
  return out;
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
 * @param seconds 原始秒数
 * @returns 0.1–1 之间、最多两位小数的字符串
 */
function formatPauseSeconds(seconds: number): string {
  const clamped = Math.min(PAUSE_MAX_SEC, Math.max(PAUSE_MIN_SEC, seconds));
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
  if (bracket === -1) return paren;
  if (paren === -1) return bracket;
  return Math.min(bracket, paren);
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
