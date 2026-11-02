// V2026-10-23 治本 (TTS 句切分 — 纯函数, 严格对齐官方攒句规则):
//   来源: 官方文档《双向流式语音合成》"攒句与延迟"章节
//     (2026-10-23 大炮补发官方文档, 本文件按官方规则校准).
//   官方攒句规则 (服务端行为):
//     - 遇到**句末标点**（`。！？…；!?.` 及换行）→ **立即**送去合成
//     - 遇到**次级标点**（`，、：,;:`）且已攒够长度 → 才切
//     - 累计长度达到上限 → 强制切分
//   为什么本端也要切句 (而不是纯靠服务端攒):
//     业务帧 `tts_audio.text` 必须与那一段 mp3 **严格对应** (前端靠它同步字幕条),
//     而上游**不告诉我们**"这一句是哪段文本" —— 只能自己切, 才能把第 N 句对齐到第 N 段音频.
//     (官方同时支持逐 token 发送, 但那样字幕只能靠猜; 逐句发送的首字延迟与官方攒句**一致**,
//      因为官方同样要等一个完整句子的标点才开合成.)
//   ⚠️ 切句标点集必须与官方**完全一致**:
//     若本端把 ASCII `;` 当句末标点切走, 而官方只把 `；`(全角) 当句末, 官方缓冲区里
//     就只剩 "…;" 这种不触发立即合成的尾巴 —— 音频会**卡住不播**. 这类"切早了一点"
//     是本文件存在的全部意义, 不能拍脑袋改标点集.
//
//   反双胞胎:
//     - 不把切句塞进 client 的消息处理里: 切句是纯函数, 独立成文件才能单测
//     - 不在切句时删标点/空白: 标点决定官方合成节奏, 删了就变味
//     - 不用 ASCII `;` / `,` 当句末标点: 官方把它们当**次级**标点 (见上)
//   验证:
//     1. tsc 0 错
//     2. "你最近怎么样？我挺好的。" → 2 句
//     3. "真的吗……" → 1 句 (连续标点算一个句末)
//     4. "……没有标点" → rest 非空
//   时间戳: 2026-10-23

/**
 * 句末标点 (官方明确定义: 遇到即**立即**合成).
 *
 * 注意集合要与官方逐字一致: `.`(ASCII 句点) 是句末标点, `;`(ASCII 分号) **不是**
 * (官方把 ASCII `;` 归在次级标点里, 全角 `；` 才是句末).
 */
const SENTENCE_TERMINATORS = new Set(['。', '！', '？', '…', '；', '!', '?', '.', '\n']);

/**
 * 次级标点 (官方: 攒够长度才切, 不立即合成).
 *
 * 超长句强制切分时优先在这些位置断开 —— 比硬切自然得多 (硬切会把词劈开).
 * 额外保留空格: 英文语境下的天然断点.
 */
const SOFT_BREAK_CHARS = new Set(['，', '、', '：', ',', ';', ':', ' ']);

/** 单句字符数下限 (低于它不值得单独成句, 留给下一句一起合成). */
const MIN_SENTENCE_CHARS = 1;

/**
 * 切句结果.
 */
export interface SentenceSplitResult {
  /** 已成句的文本 (按序, 每条都是可直接下发的完整句). */
  readonly sentences: readonly string[];
  /** 未成句的尾巴 (留待下一批文本或 finish() 冲刷). */
  readonly rest: string;
}

/**
 * 把缓冲区切成"完整句 + 残余".
 *
 * @param buffer 当前累积文本
 * @param maxChars 单句最大字符数 (超过则强制切)
 * @returns 切句结果
 */
export function splitSentences(buffer: string, maxChars: number): SentenceSplitResult {
  if (buffer.length === 0) {
    return { sentences: [], rest: '' };
  }

  const sentences: string[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const terminatorIndex = findTerminator(buffer, cursor);
    if (terminatorIndex === -1) {
      break;
    }
    // 连续的句末标点算**一个**句末 ("……" / "？！" 都是一句), 不拆成两句
    const end = consumeTerminatorRun(buffer, terminatorIndex);
    const raw = buffer.slice(cursor, end);
    // 纯空白会被官方**静默丢弃** (不发错误), 本端也不必为它单独成句
    if (raw.trim().length >= MIN_SENTENCE_CHARS) {
      sentences.push(...splitOversized(raw, maxChars));
    }
    cursor = end;
  }

  const rest = buffer.slice(cursor);
  // 残余过长时也要强制切, 否则一句无标点的长篇会一直占着不发 (官方迟迟不合成)
  if (rest.length > maxChars) {
    const forced = splitOversized(rest, maxChars);
    return { sentences: [...sentences, ...forced.slice(0, -1)], rest: forced.at(-1) ?? '' };
  }

  return { sentences, rest };
}

/**
 * 找到下一个句末标点的位置.
 *
 * @param buffer 缓冲区
 * @param from 起始下标
 * @returns 标点下标; 没有则 -1
 */
function findTerminator(buffer: string, from: number): number {
  for (let index = from; index < buffer.length; index += 1) {
    // 注: 本仓 tsconfig **未开** noUncheckedIndexedAccess, 故 `buffer[index]` 类型是 string
    //   (不是 string | undefined) —— 写 `!== undefined` 是恒真判断, sonarjs 会报.
    if (SENTENCE_TERMINATORS.has(buffer[index])) {
      return index;
    }
  }
  return -1;
}

/**
 * 吃掉连续的句末标点 (返回该句结束位置).
 *
 * @param buffer 缓冲区
 * @param firstIndex 第一个标点下标
 * @returns 句子结束下标 (不含)
 */
function consumeTerminatorRun(buffer: string, firstIndex: number): number {
  let end = firstIndex + 1;
  while (end < buffer.length) {
    if (!SENTENCE_TERMINATORS.has(buffer[end])) break;
    end += 1;
  }
  return end;
}

/**
 * 把超长句拆成若干段 (≤ maxChars).
 *
 * 优先在次级标点/空格处断; 找不到就硬切 (总比让官方报 2204 好).
 *
 * @param text 超长句
 * @param maxChars 单句最大字符数
 * @returns 拆分后的片段 (至少 1 段)
 */
function splitOversized(text: string, maxChars: number): string[] {
  if (maxChars <= 0 || text.length <= maxChars) {
    return [text];
  }

  const parts: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= maxChars) {
      parts.push(text.slice(cursor));
      break;
    }
    const window = text.slice(cursor, cursor + maxChars);
    let breakAt = -1;
    for (let index = window.length - 1; index > 0; index -= 1) {
      if (SOFT_BREAK_CHARS.has(window[index])) {
        breakAt = index + 1;
        break;
      }
    }
    if (breakAt <= 0) {
      breakAt = maxChars;
    }
    parts.push(text.slice(cursor, cursor + breakAt));
    cursor += breakAt;
  }
  return parts;
}
