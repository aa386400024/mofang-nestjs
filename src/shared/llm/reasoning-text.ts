// V2026-11-18 治本 (AF-106 · 推理块零泄漏):
//   单一真相源: 模型输出里的 `<think>...</think>` 推理块既不是可见台词, 也不该进逐字稿 /
//   历史 / 来访者引擎上下文. 本模块只做"删除推理块"这一件事, 不做内容改写.
//
// 为什么抽到 shared:
//   - 渲染适配器 (engine-adapters) 与咨询师可见输出判定 (auto-practice) 都要用同一套规则;
//   - 各自复制一份正则, 迟早出现"适配器剥了、可见判定没剥"或反之的分裂;
//   - 纯函数, 零 IO / 零 env / 零 NestJS, 两个层都能依赖.

/**
 * 推理块标签族。
 *
 * 除了标准 `<think>`，还要覆盖带命名空间的 `<mm:think>` 与孤立的 `</mm:think>`：
 * 某些提供方会把推理标签加前缀，或只回一个闭合标签，不能让它漏进可见台词。
 */
const THINK_OPEN = '<(?:[a-z0-9]+:)?think>';
const THINK_CLOSE = '</(?:[a-z0-9]+:)?think>';
const CLOSED_BLOCK = new RegExp(String.raw`${THINK_OPEN}[\s\S]*?${THINK_CLOSE}`, 'gi');
const OPEN_TAIL = new RegExp(String.raw`${THINK_OPEN}[\s\S]*$`, 'i');
const ORPHAN_CLOSE = new RegExp(THINK_CLOSE, 'gi');
const OPEN_SEARCH = new RegExp(THINK_OPEN, 'i');
/**
 * 末尾"半截推理标签"的判定：`<` / `</` / `<mm:` / `<mm:thi` / `<think` / `</think`。
 *
 * 不能简单写成 `^<[a-z0-9:]*$` —— 那会把正常以数字结尾的文本（例如 `价格<5`）也扣住，
 * 流恰好结束时这部分就永远发不出去。这里只用字符串前缀判断，避免正则复杂度爆表。
 */
function isPartialThinkTag(tail: string): boolean {
  let rest = tail.toLowerCase();
  if (rest.startsWith('</')) rest = rest.slice(2);
  else if (rest.startsWith('<')) rest = rest.slice(1);
  else return false;

  const colon = rest.indexOf(':');
  if (colon !== -1) {
    const namespace = rest.slice(0, colon);
    if (!/^[a-z0-9]+$/.test(namespace)) return false;
    rest = rest.slice(colon + 1);
  }

  if (rest.endsWith('>')) rest = rest.slice(0, -1);
  return 'think'.startsWith(rest);
}

/**
 * 删除推理块, **不 trim** (供 JSON 抽取等需要保留原空白的调用方使用).
 *
 * 为什么要处理**未闭合**的推理块:
 *   输出被长度上限截断时, 推理块往往只开了头没结尾 (`<think>...` 就没了).
 *   只处理闭合块的话, 截断的推理会留在台词里 —— 正是最该被清掉的那种.
 *
 * 为什么要处理**孤立闭合标签**:
 *   上游可能只回 `</mm:think>` 而没有开标签; 它仍是推理协议残留, 不是给来访者看的内容.
 *
 * @param text 原始文本
 * @returns 删除推理块后的文本 (保留其余空白)
 */
export function removeReasoningBlocks(text: string): string {
  const withoutClosed = text.replaceAll(CLOSED_BLOCK, '');
  // 孤立的闭合标签（含命名空间）直接删.
  const withoutOrphan = withoutClosed.replaceAll(ORPHAN_CLOSE, '');
  // 未闭合的推理块: 从开标签一直删到结尾 (它后面本来就没有别的内容了).
  return withoutOrphan.replace(OPEN_TAIL, '');
}

/**
 * 删除推理块并 trim (可见台词口径).
 *
 * @param text 原始文本
 * @returns 去掉推理块后的可见文本 (已 trim)
 */
export function stripReasoningBlocks(text: string): string {
  return removeReasoningBlocks(text).trim();
}

/**
 * 流式安全的"可见前缀": 只返回**已经确定不是推理块**的部分.
 *
 * 流式增量会把 `<think>` / `</think>` 拆到不同 chunk 里; 如果逐 chunk 删除,
 * 半截标签会漏进 TTS / 字幕. 本函数把未闭合的 `<think>` 以及末尾可能是
 * `<think>` 打开标签前缀的字符**扣住不发**, 等后续 chunk 到齐再判断.
 *
 * 末尾的 `<` / `<t` / `<th` / `<thi` / `<thin` 都可能是 `<think>` 的开头,
 * 因此一律扣住; 如果流到此结束且不是 `<think>`, 调用方用 `stripReasoningBlocks`
 * 取最终可见文本即可把扣住的部分放出来.
 *
 * @param raw 当前累计的原始文本
 * @returns 可安全下发的可见前缀
 */
export function safeVisiblePrefix(raw: string): string {
  const withoutClosed = raw.replaceAll(CLOSED_BLOCK, '').replaceAll(ORPHAN_CLOSE, '');
  // 未闭合的推理块: 从开标签开始全部扣住.
  const openIndex = withoutClosed.search(OPEN_SEARCH);
  if (openIndex >= 0) {
    return withoutClosed.slice(0, openIndex);
  }
  // 末尾可能是任意标签前缀（含 `<mm:think>`）: 扣住, 等下一 chunk.
  const lastLt = withoutClosed.lastIndexOf('<');
  if (lastLt !== -1) {
    const tail = withoutClosed.slice(lastLt);
    if (isPartialThinkTag(tail)) return withoutClosed.slice(0, lastLt);
  }
  return withoutClosed;
}
