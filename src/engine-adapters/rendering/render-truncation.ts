// V2026-10-29 治本 (WP9-C · B 层 · 截断保护):
//   职责: 提供"未闭合尾句"的判定与裁剪 —— 上游因 `finish_reason=length` 截断时,
//         把半截句子从出口文本里摘掉, **不让它进 TTS 队列**.
//   边界: 纯函数, 零 @nestjs / 零 IO / 零网络.
//
//   为什么渲染层要管这件事 (而不是丢给 TTS 层):
//     TTS 层的切句是**出声口径** (按上游攒句协议逐字对齐), 它收到什么就合成什么 ——
//     一个半截句子进了 TTS 队列, 就会合成出半截音频, 前端字幕也跟着半句.
//     而"这一轮被上游截断了"这个事实, 只有**发起请求的渲染层**知道 (TTS 层看不到
//     finish_reason). 所以防护必须落在渲染层: 半截文本根本不该离开渲染端口.
//
//   反双胞胎:
//     - 不复用 TTS 的切句器 (`src/voice/tts/tts-sentence-splitter.ts`): 那是出声口径
//       (按上游攒句协议逐字对齐, 切早会让那句永不合成), 本文件是**截断裁剪**口径
//       (只找"最后一个已闭合句子的边界", 不做分段). 两者目标不同, 合流会让
//       字幕口径反过来影响出声协议.
//     - 不写正则: 本仓有 `sonarjs/super-linear-regex` 红线, 且逐字符判定不需要正则.
//     - 不用 `…` 单独成句判定: 中文省略号是成对的 (`……`), 单个 `…` 也算句末 ——
//       与 TTS 切句的标点集保持一致, 免得"渲染层认为闭合了、TTS 却还在攒".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9c-truncation.spec.ts 覆盖裁剪 / 保留 / 空文本

/**
 * 句末标点集合 (与 TTS 切句口径一致的最小集).
 */
const SENTENCE_ENDINGS: ReadonlySet<string> = new Set(['。', '！', '？', '…', '；', '!', '?', '\n']);

/**
 * 找到最后一个**已闭合句子**的结束位置 (返回标点的下标; 没有则 -1).
 *
 * @param text 待判定文本
 * @returns 最后一个句末标点的下标; 无则 -1
 */
export function lastClosedSentenceEnd(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (SENTENCE_ENDINGS.has(char)) return index;
  }
  return -1;
}

/**
 * 丢弃未闭合的尾句 (截断保护).
 *
 * 语义:
 *   - 文本本就以句末标点收尾 → **原样返回** (不吞正常短回复; 一句"嗯"虽然没标点,
 *     但调用方只在 `finish_reason=length` 时才用本函数, 正常收尾走另一条路);
 *   - 文本以半句收尾 → 截到最后一个句末标点为止;
 *   - 一个完整句子都没有 → 返回空串 (调用方据此降级, 不把半截当正常回复).
 *
 * @param text 上游返回的文本
 * @returns 裁剪后的文本
 */
export function dropUnclosedTail(text: string): string {
  const end = lastClosedSentenceEnd(text);
  if (end < 0) return '';
  return text.slice(0, end + 1);
}

/**
 * 文本是否**已闭合** (以句末标点收尾).
 *
 * @param text 待判定文本
 * @returns 是否已闭合
 */
export function isClosedSentence(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return true;
  const last = trimmed.at(-1);
  return last !== undefined && SENTENCE_ENDINGS.has(last);
}

/**
 * 把缓冲区切成"已闭合部分"与"未闭合尾巴".
 *
 * 用途: 流式渲染里, 只有已闭合部分才能往下游 (字幕 / TTS) 发 —— 未闭合的尾巴
 * 留在缓冲区里等下一个 delta; 若流被上游截断 (`finish_reason=length`), 这段尾巴
 * 直接丢弃, 不出声.
 *
 * @param buffer 当前缓冲区全文
 * @returns 已闭合前缀 + 未闭合尾巴
 */
export function splitClosedPrefix(buffer: string): { readonly closed: string; readonly pending: string } {
  const end = lastClosedSentenceEnd(buffer);
  if (end < 0) return { closed: '', pending: buffer };
  return { closed: buffer.slice(0, end + 1), pending: buffer.slice(end + 1) };
}
