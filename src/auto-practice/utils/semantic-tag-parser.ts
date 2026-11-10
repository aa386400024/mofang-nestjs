// V2026-11-10 建立 (Phase2.5 WP-J P1e · TTS 语义标记解析层 · 第一层「语义层」):
//   职责: 把 "LLM 输出的带语义标记文本" 解析成 **厂商无关** 的中间表示 SemanticTurn.
//
// ── 为什么要有这一层 (为什么不让 LLM 直接吐 MiniMax 标记) ──────────────────
//   ① **换厂商成本**: MiniMax 的 `<#0.5#>` / `(sighs)` 一旦写进 prompt, 换火山/阿里云
//      就得改 prompt + 重跑全部数据. 语义层把 "停顿 0.5 秒" 这个**意思**留在中间表示里,
//      换厂商只换适配层 (第二层), 语义层与存储层一行不动.
//   ② **LLM 输出不稳定**: 标签会拼错 ([sighs])、会混全角 ([pause：0.5])、会漏收尾
//      (只打了 `[sigh` 没打 `]`). 解析层兜底: 模糊匹配纠正 + 归一化 + 分级降级,
//      而不是让脏标记原样进 TTS —— 那会被**念出来**.
//   ③ **可观测**: 解析层只输出**标签统计 + 诊断码**, 不输出原文 (心理内容不进日志,
//      见 docs/team/conventions.md 隐私红线). 出问题时能一眼看出是 "LLM 没打标记"
//      还是 "标记被降级掉了", 且不泄露任何对话内容.
//
// ── 标记格式 (prompt 里教 LLM 的, **不是** MiniMax 格式) ─────────────────────
//   [sigh] [breath] [inhale] [emm] [laugh]   句首语气
//   [pause:0.5] [pause:1]                     停顿 (秒)
//   [emotion:sad]                             情绪 (放句末)
//   [[STATE:END]] [[STATE:MORE]]              控制标记 (引擎用, TTS 看不见)
//
//   为什么用英文短标签而不是厂商格式: LLM 记 `<#0.5#>` 容易错, 记 `[pause:0.5]` 稳;
//   而且换厂商时 prompt 一字不用改.
//
// ── 偏移口径 (pause offset) ────────────────────────────────────────────────
//   `pauses[].offset` = **剥掉全部标记后的纯文本**里的字符偏移 (UTF-16 code unit),
//   **不是** "带标记原文" 的偏移.
//   为什么这样定:
//     ① 适配器最终要把 `<#0.5#>` 插回**纯文本** —— 用纯文本偏移可以直接 slice,
//        不用二次换算 (按原文偏移算 = 把换算责任推给每个下游, 漏算一处就插错位置);
//     ② 纯文本偏移对 "标记增删" 免疫 —— 同一句话换一套标签写法, 偏移不变,
//        semanticJson 调试回放可跨版本对比;
//     ③ 口径写死为 **UTF-16 code unit** (JS 原生字符串下标): 中文 1 字 = 1 unit,
//        emoji/代理对 = 2 units. 不用 code point 是因为 JS 切片按 UTF-16 走,
//        换成 code point 反而多一层换算 bug (单测里有 emoji 用例把这条钉死).
//
// ── 三级降级 ──────────────────────────────────────────────────────────────
//   Level 0 干净解析, 无任何诊断;
//   Level 1 有 warning/error 但结构仍可用 —— ttsText 照常生成, 只是部分标签被
//          纠正 / 合并 / 截断;
//   Level 2 结构性失败 —— 语义字段全部作废, ttsText = displayText (纯文本).
//   **任何降级都不阻断对话**, 只是语音自然度打折扣.
//
// ── 控制面与语音面分离 (刻意的设计取舍) ───────────────────────────────────
//   Level 2 会清掉 preSpeech / pauses / emotion, 但 **controlTags 保留**:
//   控制标记是**引擎的结束信号** (见 counselor-agent.service.ts 的 CLOSE_TAG),
//   它的丢失会直接让会话收不了尾 —— 那是功能性故障, 不是 "语音不够自然".
//   语音面可以降级, 控制面不能.

/** 句首语气标签 (语义层与厂商无关). */
export type SemanticPreSpeech = 'sigh' | 'breath' | 'inhale' | 'emm' | 'laugh';

/** 情绪标签 (语义层). */
export type SemanticEmotion = 'sad' | 'calm' | 'fearful' | 'angry' | 'happy';

/** 控制标记 (引擎用, TTS 看不见). */
export type SemanticControlTag = 'END' | 'MORE';

/** 降级级别: 0 干净 / 1 轻度 / 2 重度. */
export type SemanticParseLevel = 0 | 1 | 2;

/** 诊断严重度. */
export type SemanticDiagnosticSeverity = 'warning' | 'error';

/**
 * 诊断码 —— **只有结构性信息, 没有原文**.
 *
 * 为什么单列一个码表: 上层日志/告警要能按码聚合 ("今天有多少场被降级"),
 * 而**绝不能**把对话原文写进日志 (心理内容不进日志).
 */
export type SemanticDiagnosticCode =
  | 'TAG_FUZZY_CORRECTED'
  | 'TAG_UNKNOWN'
  | 'TAG_UNCLOSED'
  | 'TAG_UNCLOSED_RECOVERED'
  | 'PAUSE_DURATION_CLAMPED'
  | 'PAUSE_TRAILING_DROPPED'
  | 'PAUSE_MERGED'
  | 'PAUSE_TOO_MANY'
  | 'PRE_SPEECH_DUPLICATE'
  | 'EMOTION_DUPLICATE'
  | 'CONTROL_TAG_CONFLICT'
  | 'VENDOR_FORMAT_CONVERTED'
  | 'VENDOR_MARKER_DROPPED'
  | 'ILLEGAL_RATIO_EXCEEDED'
  | 'TOO_MANY_TAGS';

/** 诊断附带的结构性元信息 (只放标签名/偏移/数量, **不放原文**). */
export interface SemanticDiagnosticMeta {
  /** 标签名 (只保留字母数字下划线, 最长 24 字符; 其余一律脱敏). */
  readonly tag?: string;
  /** 在纯文本里的偏移 (UTF-16 code unit). */
  readonly offset?: number;
  /** 计数 (同类问题出现几次). */
  readonly count?: number;
  /** 数值 (比如停顿时长). */
  readonly value?: number;
}

/** 一条诊断. */
export interface SemanticDiagnostic {
  readonly code: SemanticDiagnosticCode;
  readonly severity: SemanticDiagnosticSeverity;
  readonly meta: SemanticDiagnosticMeta;
}

/** 一个停顿. */
export interface SemanticPause {
  /** 在**纯文本**里的字符偏移 (UTF-16 code unit; 见文件头说明). */
  readonly offset: number;
  /** 停顿时长 (秒). */
  readonly durationSec: number;
}

/**
 * 不认识的标记在纯文本里的区间.
 *
 * 为什么单列 (对给定 SemanticTurn 契约的**扩展**):
 *   规格要求 "不认识��标签当普通文本保留" —— 那是给 **displayText** 的要求
 *   (不丢内容, 便于事后校准 prompt). 但同样的字符串进了 **ttsText** 就会被念出来
 *   ("[xyzzy]" 被 TTS 当词读出来 = 事故级听感缺陷).
 *   把这段区间带在中间表示里, 适配层就能 "displayText 保留 / ttsText 剥离",
 *   两个诉求同时满足, 且不用把厂商格式的知识漏回语义层.
 */
export interface SemanticUnknownTagSpan {
  /** 在纯文本里的起始偏移 (UTF-16 code unit). */
  readonly offset: number;
  /** 标记原文长度 (UTF-16 code unit). */
  readonly length: number;
}

/**
 * 语义中间表示 —— **厂商无关**.
 *
 * 契约:
 *   · `text` 恒为纯文本 (不含任何已识别标记);
 *   · `preSpeech` / `emotion` **恒存在**, null = 无 (JSON 里字段稳定, 不出现时有时无);
 *   · `controlTags` 只进控制面, 不进 ttsText.
 */
export interface SemanticTurn {
  /** 纯文本内容 (不含任何已识别标记). */
  readonly text: string;
  /** 句首语气 (null = 无). */
  readonly preSpeech: SemanticPreSpeech | null;
  /** 句中停顿 (按 offset 升序). */
  readonly pauses: readonly SemanticPause[];
  /** 控制标记 (引擎用, TTS 看不见). */
  readonly controlTags: readonly SemanticControlTag[];
  /** 情绪倾向 (null = 无). */
  readonly emotion: SemanticEmotion | null;
  /** 不认识的标记在 `text` 里的区间 (给适配层剥离用). */
  readonly unknownTags: readonly SemanticUnknownTagSpan[];
}

/** 标签统计 (纯计数 —— 可安全进日志). */
export interface SemanticTagStats {
  /** 识别到的语义标记总数. */
  readonly totalTags: number;
  readonly preSpeechTags: number;
  readonly pauseTags: number;
  readonly emotionTags: number;
  readonly controlTags: number;
  readonly unknownTags: number;
  /** 被模糊匹配纠正过的标记数. */
  readonly correctedTags: number;
  /** 从厂商格式转换回来的标记数. */
  readonly convertedVendorTags: number;
  /** 被丢弃的厂商标记数 (认得但语义层表达不了). */
  readonly droppedVendorMarkers: number;
  /** 非法字符数 (认不出、又不是合法散文的部分). */
  readonly illegalChars: number;
}

/** 解析结果. */
export interface SemanticParseResult {
  /** 降级级别. */
  readonly level: SemanticParseLevel;
  /** 中间表示. */
  readonly turn: SemanticTurn;
  /** 原始输入 —— Phase 2 喂引擎用 (控制标记不能丢). */
  readonly rawText: string;
  /** 纯文本 (标注台 / 日志 / 存档). */
  readonly displayText: string;
  readonly warnings: readonly SemanticDiagnostic[];
  readonly errors: readonly SemanticDiagnostic[];
  readonly stats: SemanticTagStats;
}

/**
 * 诊断出口 —— 上层可以接 Nest Logger.
 *
 * 收到的诊断里 **只有码与结构性元信息**, 没有原文.
 */
export interface SemanticTagDiagnosticSink {
  warn(diagnostic: SemanticDiagnostic): void;
  error(diagnostic: SemanticDiagnostic): void;
}

/** 解析器可调参数. */
export interface SemanticTagParserOptions {
  /** 诊断出口 (不传 = 完全静默, 纯函数). */
  readonly sink?: SemanticTagDiagnosticSink;
  /** 单轮最多认多少个标记 (防病态输入; 超过 = Level 2). */
  readonly maxTags?: number;
  /** 非法字符占比上限 (超过 = Level 2). */
  readonly illegalRatioLimit?: number;
}

/** 已知句首语气标签 (顺序即模糊匹配的优先级). */
export const SEMANTIC_PRE_SPEECH_TAGS: readonly SemanticPreSpeech[] = ['sigh', 'breath', 'inhale', 'emm', 'laugh'];

/** 已知情绪标签 (顺序即模糊匹配的优先级). */
export const SEMANTIC_EMOTION_TAGS: readonly SemanticEmotion[] = ['sad', 'calm', 'fearful', 'angry', 'happy'];

/** 已知控制标记. */
export const SEMANTIC_CONTROL_TAGS: readonly SemanticControlTag[] = ['END', 'MORE'];

/** 停顿时长下限 (秒). */
export const SEMANTIC_PAUSE_MIN_SEC = 0.01;

/** 停顿时长上限 (秒). */
export const SEMANTIC_PAUSE_MAX_SEC = 99.99;

/** 一轮最多保留几个停顿 (超了合并成最长的那个). */
export const SEMANTIC_MAX_PAUSES = 5;

/** 单轮最多认多少个标记 (防病态输入). */
export const SEMANTIC_MAX_TAGS = 64;

/** 非法字符占比上限 (超过即 Level 2). */
export const SEMANTIC_ILLEGAL_RATIO_LIMIT = 0.1;

/** 标签名最大长度 (超了按脱敏处理). */
const MAX_TAG_NAME_LENGTH = 24;

/**
 * 全角 ASCII 区间与半角的固定差.
 *
 * 为什么用十进制而不是十六进制字面量:
 *   本仓 eslint 同时开了 `unicorn/number-literal-case` (要求十六进制大写) 与
 *   `prettier/prettier` (要求十六进制小写) —— 两者要求**相反**, `eslint --fix`
 *   只会在两种写法之间来回改 (ESLintCircularFixesWarning), 永远 lint 不干净.
 *   治本: 带字母的十六进制字面量一律不用, 改成**具名十进制常量**
 *   (与 src/counselor/providers/practice-asr-audio.util.ts 同款).
 */
/** U+FF01 — 全角 ASCII 区间起点. */
const FULLWIDTH_FIRST = 65_281;
/** U+FF5E — 全角 ASCII 区间终点. */
const FULLWIDTH_LAST = 65_374;
/** U+FEE0 — 全角 → 半角的固定差. */
const FULLWIDTH_OFFSET = 65_248;
/** U+3000 — 表意空格 (→ 半角空格). */
const IDEOGRAPHIC_SPACE = 12_288;

/** 标签名 (归一化用). */
const TAG_NAME_PAUSE = 'pause';
const TAG_NAME_EMOTION = 'emotion';

/**
 * 常见中文引号 → 直引号 (**1:1 替换**, 长度不变 → 偏移不失效).
 *
 * 为什么不能整体做 "全角 → 半角": 那样会把中文正文里的 "，：；？！" 全换成 ASCII,
 * 中文排版就垮了. 所以全角转换只发生在**标记影子**里 (见 toTagShadow), 正文标点
 * 只做这一张 1:1 的引号表.
 */
const PROSE_PUNCTUATION: ReadonlyMap<string, string> = new Map([
  ['「', '“'],
  ['」', '”'],
  ['『', '“'],
  ['』', '”'],
  ['‘', "'"],
  ['’', "'"],
]);

/**
 * 形近数字纠正表 (LLM 手滑打出来的).
 *
 * 只覆盖真实会打错的几个: o→0 (最常见), l/i→1, s→5, b→8, z→2.
 */
const SHAPE_DIGITS: ReadonlyMap<string, string> = new Map([
  ['o', '0'],
  ['O', '0'],
  ['l', '1'],
  ['I', '1'],
  ['i', '1'],
  ['s', '5'],
  ['S', '5'],
  ['b', '8'],
  ['B', '8'],
  ['z', '2'],
  ['Z', '2'],
]);

/**
 * MiniMax 语气标签 → 语义层句首语气.
 *
 * null = "认得 (确实是 MiniMax 的语气标签), 但语义层表达不了" —— 这类标记**丢弃**
 * (不进 text, 不进 ttsText), 记一条 warning.
 *
 * 为什么要认厂商格式: LLM 总会时不时直接吐厂商标记 (prompt 里见过就爱写).
 * 认出来并**转换回语义层**, 比当脏数据丢掉或原样喂给 TTS 都强 —— 这正是
 * "校验层兜底" 的价值.
 */
const VENDOR_PRE_SPEECH: ReadonlyMap<string, SemanticPreSpeech | null> = new Map([
  ['sigh', 'sigh'],
  ['sighs', 'sigh'],
  ['breath', 'breath'],
  ['breaths', 'breath'],
  ['emm', 'emm'],
  ['laugh', 'laugh'],
  ['laughs', 'laugh'],
  ['chuckle', 'laugh'],
  ['inhale', 'inhale'],
  ['inhales', 'inhale'],
  ['coughs', null],
  ['crying', null],
  ['gasps', null],
  ['humming', null],
  ['clears throat', null],
  ['clucking', null],
  ['sniffling', null],
  ['sobbing', null],
  ['whistles', null],
  ['snores', null],
  ['whimper', null],
  ['screams', null],
  ['groans', null],
]);

/** 标记形态: 只认 "字母开头的名字" 或 "名字:值" —— 避免把正文里的方括号当标记. */
const TAG_SHAPE = /^[A-Za-z]\w*(?::[\w.+-]*)?$/;

/** 脱敏后的占位标签名. */
const REDACTED_TAG = '<redacted>';

/**
 * 判断两个字符串的编辑距离是否 ≤ 1.
 *
 * 为什么只允许 1 次编辑: 允许 2 次就会把 "sad" 和 "aid" 之类的噪声也吸进来,
 * 误纠正比不纠正更危险 (改错情绪比不改更糟). 1 次编辑刚好覆盖真实的手滑.
 *
 * @param a 字符串 a
 * @param b 字符串 b
 * @returns 距离是否 ≤ 1
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (long.length - short.length > 1) {
    return false;
  }
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) {
      return false;
    }
    if (short.length === long.length) {
      // 等长 → 只能是**替换**: 两边同时前进一位.
      i++;
      j++;
    } else {
      // 不等长 (差 1) → 只能是长串多一个字: 长串前进一位.
      j++;
    }
  }
  // 循环结束后剩的尾巴最多算一次编辑 (尾部多/少一个字).
  if (i < short.length || j < long.length) {
    edits++;
  }
  return edits <= 1;
}

/**
 * 正文标点归一化 (1:1, 长度不变).
 *
 * @param text 原始文本
 * @returns 归一化文本 (与原文等长)
 */
function normalizeProse(text: string): string {
  let out = '';
  for (const ch of text) {
    out += PROSE_PUNCTUATION.get(ch) ?? ch;
  }
  return out;
}

/**
 * 构造 "标记影子" —— 只用于**定位标记**, 不作为正文.
 *
 * 全角 ASCII (U+FF01-U+FF5E) → 半角; 表意空格 → 半角空格.
 * 全部是 1:1 替换, 所以影子与原文字节级对齐, 下标可以直接换算回原文.
 *
 * @param text 归一化后的正文
 * @returns 标记影子 (与入参等长)
 */
function toTagShadow(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= FULLWIDTH_FIRST && cp <= FULLWIDTH_LAST) {
      out += String.fromCodePoint(cp - FULLWIDTH_OFFSET);
    } else if (cp === IDEOGRAPHIC_SPACE) {
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 把标签名脱敏成可安全进日志的形态.
 *
 * 只留字母 / 数字 / 下划线, 最长 24 字符 —— 其余一律 `<redacted>`.
 * 为什么: 未知标记的内文理论上可能夹带正文片段, 不能原样落日志.
 *
 * @param raw 原始标签名
 * @returns 脱敏后的标签名
 */
export function sanitizeTagName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return REDACTED_TAG;
  }
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    return REDACTED_TAG;
  }
  return /^\w+$/.test(trimmed) ? trimmed : REDACTED_TAG;
}

/**
 * 解析标签的数值部分 (带形近数字纠正).
 *
 * @param raw 数值原文
 * @returns 数值; 解析不出来返回 null
 */
function parseNumericValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) {
    return direct;
  }
  let corrected = '';
  for (const ch of trimmed) {
    corrected += SHAPE_DIGITS.get(ch) ?? ch;
  }
  const second = Number(corrected);
  return Number.isFinite(second) ? second : null;
}

/**
 * 在已知标签表里找 "差一次编辑" 的那个.
 *
 * @param name 标签名 (已小写)
 * @param candidates 候选表 (按优先级)
 * @returns 命中的标签; 没有返回 null
 */
function fuzzyMatchTag(name: string, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (withinOneEdit(name, candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * 一个标记的处理结局.
 *
 * 'consumed' = 标记被识别并吃掉 (不进正文);
 * 'unknown'  = 不认识 → 整段标记当**普通正文**保留, 并登记区间 (给适配层剥离用).
 */
type TagOutcome = 'consumed' | 'unknown';

/**
 * 一次扫描的中间状态.
 *
 * 用一个可变对象串起扫描过程 —— 拆成一堆返回值会让 "offset 随正文增长" 这件事
 * 变得难读. 这里 plain.length 就是"当前纯文本长度", 也正好是下一个标记的偏移.
 */
interface ScanContext {
  plain: string;
  preSpeech: SemanticPreSpeech | null;
  emotion: SemanticEmotion | null;
  controlTags: SemanticControlTag[];
  pauses: SemanticPause[];
  unknownSpans: SemanticUnknownTagSpan[];
  warnings: SemanticDiagnostic[];
  errors: SemanticDiagnostic[];
  totalTags: number;
  preSpeechTags: number;
  pauseTags: number;
  emotionTags: number;
  controlTagCount: number;
  unknownTagCount: number;
  correctedTags: number;
  convertedVendorTags: number;
  droppedVendorMarkers: number;
  illegalChars: number;
  hardFailure: boolean;
  sink: SemanticTagDiagnosticSink | undefined;
}

/**
 * 记一条诊断 (同时推给 sink).
 *
 * @param ctx 扫描上下文
 * @param code 诊断码
 * @param severity 严重度
 * @param meta 结构性元信息
 */
function report(ctx: ScanContext, code: SemanticDiagnosticCode, severity: SemanticDiagnosticSeverity, meta: SemanticDiagnosticMeta): void {
  const diagnostic: SemanticDiagnostic = { code, severity, meta };
  if (severity === 'error') {
    ctx.errors.push(diagnostic);
    ctx.sink?.error(diagnostic);
    return;
  }
  ctx.warnings.push(diagnostic);
  ctx.sink?.warn(diagnostic);
}

/**
 * 把"不认识但必须保留"的标记**当普通正文留下**, 并登记它的区间.
 *
 * 为什么保留 (而不是直接丢掉): 规格要求 "标签拼写完全不认识 → 当普通文本保留"
 * —— displayText 是标注台与事后校准 prompt 的依据, 丢了就再也看不到 LLM 到底写了什么.
 * 但它**不该被 TTS 念出来** —— 所以登记区间, 适配层生成 ttsText 时剥掉.
 *
 * @param ctx 扫描上下文
 * @param text 归一化后的正文
 * @param start 标记起点
 * @param end 标记终点 (不含)
 * @param inner 标记内文 (脱敏后进 meta)
 */
function keepUnknownMarkup(ctx: ScanContext, text: string, start: number, end: number, inner: string): void {
  const offset = ctx.plain.length;
  const length = end - start;
  ctx.plain += text.slice(start, end);
  ctx.unknownTagCount++;
  ctx.illegalChars += length;
  ctx.unknownSpans.push({ offset, length });
  report(ctx, 'TAG_UNKNOWN', 'error', { tag: sanitizeTagName(inner), offset, count: ctx.unknownTagCount });
}

/**
 * 处理一个已识别的标记.
 *
 * @param ctx 扫描上下文
 * @param inner 标记内文 (影子里的, 已小写归一)
 * @param isControl 是否是 [[...]] 形态
 * @returns 'consumed' = 标记被吃掉了; 'unknown' = 不认识, 整段要当正文保留
 */
function applySemanticTag(ctx: ScanContext, inner: string, isControl: boolean): TagOutcome {
  ctx.totalTags++;
  const colon = inner.indexOf(':');
  const rawName = colon === -1 ? inner : inner.slice(0, colon);
  const rawValue = colon === -1 ? null : inner.slice(colon + 1);
  const name = rawName.trim().toLowerCase();

  if (isControl) {
    const value = (rawValue ?? '').trim().toUpperCase();
    const control = SEMANTIC_CONTROL_TAGS.find((item) => item === value);
    if (control) {
      ctx.controlTagCount++;
      ctx.controlTags.push(control);
      return 'consumed';
    }
    return 'unknown';
  }

  if (name === TAG_NAME_PAUSE) {
    return applyPauseTag(ctx, rawValue);
  }
  if (name === TAG_NAME_EMOTION) {
    return applyEmotionTag(ctx, rawValue);
  }
  const exact = SEMANTIC_PRE_SPEECH_TAGS.find((item) => item === name);
  if (exact) {
    applyPreSpeechTag(ctx, exact);
    return 'consumed';
  }
  const fuzzy = fuzzyMatchTag(name, [...SEMANTIC_PRE_SPEECH_TAGS, TAG_NAME_PAUSE, TAG_NAME_EMOTION]);
  if (fuzzy === TAG_NAME_PAUSE) {
    ctx.correctedTags++;
    report(ctx, 'TAG_FUZZY_CORRECTED', 'warning', { tag: sanitizeTagName(rawName) });
    return applyPauseTag(ctx, rawValue);
  }
  if (fuzzy === TAG_NAME_EMOTION) {
    ctx.correctedTags++;
    report(ctx, 'TAG_FUZZY_CORRECTED', 'warning', { tag: sanitizeTagName(rawName) });
    return applyEmotionTag(ctx, rawValue);
  }
  if (fuzzy) {
    ctx.correctedTags++;
    report(ctx, 'TAG_FUZZY_CORRECTED', 'warning', { tag: sanitizeTagName(rawName) });
    applyPreSpeechTag(ctx, fuzzy as SemanticPreSpeech);
    return 'consumed';
  }
  return 'unknown';
}

/**
 * 处理停顿标记 (含时长夹取).
 *
 * @param ctx 扫描上下文
 * @param rawValue 时长原文
 */
function applyPauseTag(ctx: ScanContext, rawValue: string | null): TagOutcome {
  ctx.pauseTags++;
  const parsed = rawValue === null ? null : parseNumericValue(rawValue);
  if (parsed === null) {
    return 'unknown';
  }
  const rawTrimmed = (rawValue ?? '').trim();
  if (rawTrimmed.length > 0 && !Number.isFinite(Number(rawTrimmed))) {
    // 形近数字纠正 (o→0 / l→1 ...) —— 也是一次"纠正", 记一笔便于事后校准.
    ctx.correctedTags++;
    report(ctx, 'TAG_FUZZY_CORRECTED', 'warning', { tag: sanitizeTagName(rawTrimmed) });
  }
  let duration = parsed;
  if (duration < SEMANTIC_PAUSE_MIN_SEC) {
    duration = SEMANTIC_PAUSE_MIN_SEC;
    report(ctx, 'PAUSE_DURATION_CLAMPED', 'warning', { value: duration, count: ctx.pauseTags });
  } else if (duration > SEMANTIC_PAUSE_MAX_SEC) {
    duration = SEMANTIC_PAUSE_MAX_SEC;
    report(ctx, 'PAUSE_DURATION_CLAMPED', 'warning', { value: duration, count: ctx.pauseTags });
  }
  ctx.pauses.push({ offset: ctx.plain.length, durationSec: duration });
  return 'consumed';
}

/**
 * 处理情绪标记.
 *
 * @param ctx 扫描上下文
 * @param rawValue 情绪原文
 */
function applyEmotionTag(ctx: ScanContext, rawValue: string | null): TagOutcome {
  ctx.emotionTags++;
  const value = (rawValue ?? '').trim().toLowerCase();
  const exact = SEMANTIC_EMOTION_TAGS.find((item) => item === value);
  if (exact) {
    applyEmotionValue(ctx, exact);
    return 'consumed';
  }
  const fuzzy = fuzzyMatchTag(value, [...SEMANTIC_EMOTION_TAGS]);
  if (fuzzy) {
    ctx.correctedTags++;
    report(ctx, 'TAG_FUZZY_CORRECTED', 'warning', { tag: sanitizeTagName(rawValue ?? '') });
    applyEmotionValue(ctx, fuzzy as SemanticEmotion);
    return 'consumed';
  }
  return 'unknown';
}

/**
 * 落一个情绪值 (去重: 第一个说了算).
 *
 * @param ctx 扫描上下文
 * @param emotion 情绪
 */
function applyEmotionValue(ctx: ScanContext, emotion: SemanticEmotion): void {
  if (ctx.emotion !== null) {
    report(ctx, 'EMOTION_DUPLICATE', 'warning', { tag: emotion, count: ctx.emotionTags });
    return;
  }
  ctx.emotion = emotion;
}

/**
 * 落一个句首语气 (去重: 第一个说了算).
 *
 * @param ctx 扫描上下文
 * @param preSpeech 语气
 */
function applyPreSpeechTag(ctx: ScanContext, preSpeech: SemanticPreSpeech): void {
  ctx.preSpeechTags++;
  if (ctx.preSpeech !== null) {
    report(ctx, 'PRE_SPEECH_DUPLICATE', 'warning', { tag: preSpeech, count: ctx.preSpeechTags });
    return;
  }
  ctx.preSpeech = preSpeech;
}

/**
 * 处理厂商格式的停顿标记 `<#0.5#>` —— 转换成语义层的停顿.
 *
 * @param ctx 扫描上下文
 * @param inner 数值原文
 */
function applyVendorPause(ctx: ScanContext, inner: string): void {
  const parsed = parseNumericValue(inner);
  if (parsed === null) {
    ctx.droppedVendorMarkers++;
    ctx.illegalChars += inner.length + 4;
    report(ctx, 'VENDOR_MARKER_DROPPED', 'warning', { tag: sanitizeTagName(inner) });
    return;
  }
  ctx.convertedVendorTags++;
  ctx.totalTags++;
  report(ctx, 'VENDOR_FORMAT_CONVERTED', 'warning', { tag: sanitizeTagName(inner) });
  applyPauseTag(ctx, inner);
}

/**
 * 处理厂商格式的语气标记 `(sighs)` —— 转换成语义层的句首语气.
 *
 * @param ctx 扫描上下文
 * @param inner 语气原文
 */
function applyVendorPreSpeech(ctx: ScanContext, inner: string): void {
  const mapped = VENDOR_PRE_SPEECH.get(inner.trim().toLowerCase());
  if (mapped === undefined) {
    return;
  }
  if (mapped === null) {
    ctx.droppedVendorMarkers++;
    ctx.illegalChars += inner.length + 2;
    report(ctx, 'VENDOR_MARKER_DROPPED', 'warning', { tag: sanitizeTagName(inner) });
    return;
  }
  ctx.convertedVendorTags++;
  ctx.totalTags++;
  report(ctx, 'VENDOR_FORMAT_CONVERTED', 'warning', { tag: sanitizeTagName(inner) });
  applyPreSpeechTag(ctx, mapped);
}

/**
 * 未闭合标记的恢复: 看剩余文本开头是不是已知标签名.
 *
 * @param rest 剩余文本 (不含开头的 '[')
 * @returns 可安全剥掉的标签名长度; 不能恢复返回 0
 */
function recoverableTagPrefix(rest: string): number {
  const candidates = [...SEMANTIC_PRE_SPEECH_TAGS, TAG_NAME_PAUSE, TAG_NAME_EMOTION];
  let best = 0;
  for (const candidate of candidates) {
    if (rest.length < candidate.length) {
      continue;
    }
    if (rest.slice(0, candidate.length).toLowerCase() !== candidate) {
      continue;
    }
    // charAt 而不是下标: 越界时返回空串 (不是 undefined), 不用写"存在性"判断.
    const next = rest.charAt(candidate.length);
    if (/[A-Za-z]/.test(next)) {
      continue;
    }
    best = Math.max(best, candidate.length);
  }
  return best;
}

/**
 * 扫描一遍文本, 抽出所有标记.
 *
 * @param text 归一化后的正文 (内容取自这里)
 * @param shadow 标记影子 (定位用)
 * @param ctx 扫描上下文
 */
function scanMarkup(text: string, shadow: string, ctx: ScanContext): void {
  let i = 0;
  while (i < shadow.length) {
    // ⚠️ 判定标记形态用**影子**, 收集正文用**原文** ——
    //   影子里的中文标点被半角化了, 拿它当正文会把 "，" 变成 ",".
    const ch = shadow[i];
    if (ch === '[') {
      i = scanBracket(text, shadow, i, ctx);
      continue;
    }
    if (ch === '<' && shadow[i + 1] === '#') {
      const close = shadow.indexOf('#>', i + 2);
      if (close === -1) {
        ctx.plain += text.slice(i);
        ctx.illegalChars += 2;
        i = shadow.length;
        continue;
      }
      applyVendorPause(ctx, shadow.slice(i + 2, close));
      i = close + 2;
      continue;
    }
    if (ch === '(') {
      const close = shadow.indexOf(')', i + 1);
      if (close > i) {
        const inner = shadow.slice(i + 1, close);
        if (VENDOR_PRE_SPEECH.has(inner.trim().toLowerCase())) {
          applyVendorPreSpeech(ctx, inner);
          i = close + 1;
          continue;
        }
      }
      ctx.plain += text[i];
      i++;
      continue;
    }
    ctx.plain += text[i];
    i++;
  }
}

/**
 * 处理一个方括号标记 (含 [[...]] 控制标记与未闭合的恢复).
 *
 * @param text 归一化后的正文
 * @param shadow 标记影子
 * @param start '[' 的位置
 * @param ctx 扫描上下文
 * @returns 下一个扫描位置
 */
function scanBracket(text: string, shadow: string, start: number, ctx: ScanContext): number {
  const isControl = shadow[start + 1] === '[';
  const closeToken = isControl ? ']]' : ']';
  const contentStart = isControl ? start + 2 : start + 1;
  const close = shadow.indexOf(closeToken, contentStart);
  if (close === -1) {
    return handleUnclosedBracket(text, shadow, start, ctx);
  }
  const inner = shadow.slice(contentStart, close);
  const end = close + closeToken.length;
  if (!TAG_SHAPE.test(inner)) {
    // 不是标签形态 (如 [你好] / [1]) —— 当普通正文保留, 不记诊断.
    ctx.plain += text.slice(start, end);
    return end;
  }
  const outcome = applySemanticTag(ctx, inner, isControl);
  if (outcome === 'unknown') {
    keepUnknownMarkup(ctx, text, start, end, inner);
  }
  return end;
}

/**
 * 未闭合标记的处理.
 *
 * 两种结局:
 *   · 剩余文本开头是已知标签名 → **剥掉标签名**, 剩下当正文 (Level 1 warning);
 *   · 认不出来 → 整段当正文保留 (Level 2 error, 因为无法确定标记边界).
 *
 * @param text 归一化后的正文
 * @param shadow 标记影子
 * @param start '[' 的位置
 * @param ctx 扫描上下文
 * @returns 下一个扫描位置 (恒为末尾)
 */
function handleUnclosedBracket(text: string, shadow: string, start: number, ctx: ScanContext): number {
  const rest = shadow.slice(start + 1);
  const prefix = recoverableTagPrefix(rest);
  if (prefix > 0) {
    ctx.plain += text.slice(start + 1 + prefix);
    report(ctx, 'TAG_UNCLOSED_RECOVERED', 'warning', { tag: sanitizeTagName(rest.slice(0, prefix)) });
    return shadow.length;
  }
  ctx.plain += text.slice(start);
  ctx.hardFailure = true;
  report(ctx, 'TAG_UNCLOSED', 'error', { offset: start });
  return shadow.length;
}

/**
 * 停顿后处理: 同位合并 → 句尾丢弃 → 超量只留最长.
 *
 * 顺序有讲究: 先合并 (相邻短停顿本来就是一回事), 再丢句尾 (句尾停顿没意义),
 * 最后限量 (超 5 个说明 LLM 乱打, 只留信息量最大的那个).
 *
 * @param pauses 原始停顿
 * @param text 纯文本
 * @param ctx 扫描上下文
 * @returns 处理后的停顿
 */
function applyPauseRules(pauses: readonly SemanticPause[], text: string, ctx: ScanContext): SemanticPause[] {
  const byOffset = new Map<number, SemanticPause>();
  for (const pause of pauses) {
    const existing = byOffset.get(pause.offset);
    if (existing) {
      report(ctx, 'PAUSE_MERGED', 'warning', { offset: pause.offset, value: Math.max(existing.durationSec, pause.durationSec) });
      if (pause.durationSec > existing.durationSec) {
        byOffset.set(pause.offset, pause);
      }
      continue;
    }
    byOffset.set(pause.offset, pause);
  }
  const merged = [...byOffset.values()].toSorted((a, b) => a.offset - b.offset);
  const kept = merged.filter((pause) => {
    const tail = text.slice(pause.offset).trim();
    if (tail.length === 0) {
      report(ctx, 'PAUSE_TRAILING_DROPPED', 'warning', { offset: pause.offset });
      return false;
    }
    return true;
  });
  if (kept.length <= SEMANTIC_MAX_PAUSES) {
    return kept;
  }
  let longest = kept[0];
  for (const pause of kept) {
    if (pause.durationSec > longest.durationSec) {
      longest = pause;
    }
  }
  report(ctx, 'PAUSE_TOO_MANY', 'warning', { count: kept.length, value: longest.durationSec });
  return [longest];
}

/**
 * 首尾空白裁剪后, 把"不认识的标记"区间平移到新文本上.
 *
 * @param spans 原区间 (相对未裁剪文本)
 * @param lead 被裁掉的前导空白长度
 * @param textLength 裁剪后的文本长度
 * @returns 平移并裁剪后的区间 (完全被裁掉的丢弃)
 */
function shiftSpans(spans: readonly SemanticUnknownTagSpan[], lead: number, textLength: number): SemanticUnknownTagSpan[] {
  const out: SemanticUnknownTagSpan[] = [];
  for (const span of spans) {
    const start = Math.max(0, span.offset - lead);
    const end = Math.min(textLength, span.offset + span.length - lead);
    if (end <= start) {
      continue;
    }
    out.push({ offset: start, length: end - start });
  }
  return out;
}

/**
 * 语义标签解析器 —— **纯工具类**: 不起 NestJS, 不发网络, 不连 DB, 不打日志.
 *
 * 用法:
 *   const result = new SemanticTagParser().parse(raw);
 *   result.level            // 0 / 1 / 2
 *   result.turn.text        // 纯文本
 *   result.displayText      // 同上 (存储层直接用)
 *   result.stats            // 标签统计 (可安全进日志)
 */
export class SemanticTagParser {
  private readonly options: SemanticTagParserOptions;

  /**
   * @param options 可调参数 (诊断出口 / 上限)
   */
  constructor(options: SemanticTagParserOptions = {}) {
    this.options = options;
  }

  /**
   * 解析一段带语义标记的文本.
   *
   * @param input 原始文本 (LLM 输出)
   * @returns 解析结果 (中间表示 + 诊断 + 统计)
   */
  parse(input: string): SemanticParseResult {
    const normalized = normalizeProse(input);
    const shadow = toTagShadow(normalized);
    const ctx: ScanContext = {
      plain: '',
      preSpeech: null,
      emotion: null,
      controlTags: [],
      pauses: [],
      unknownSpans: [],
      warnings: [],
      errors: [],
      totalTags: 0,
      preSpeechTags: 0,
      pauseTags: 0,
      emotionTags: 0,
      controlTagCount: 0,
      unknownTagCount: 0,
      correctedTags: 0,
      convertedVendorTags: 0,
      droppedVendorMarkers: 0,
      illegalChars: 0,
      hardFailure: false,
      sink: this.options.sink,
    };

    scanMarkup(normalized, shadow, ctx);

    // 首尾空白裁掉 —— 偏移同步平移 (前导空白会让后面所有偏移都挪位).
    const lead = ctx.plain.length - ctx.plain.trimStart().length;
    const plainText = ctx.plain.trim();
    const shiftedPauses = ctx.pauses.map((pause) => ({
      offset: Math.max(0, pause.offset - lead),
      durationSec: pause.durationSec,
    }));
    const shiftedUnknown = shiftSpans(ctx.unknownSpans, lead, plainText.length);

    const maxTags = this.options.maxTags ?? SEMANTIC_MAX_TAGS;
    if (ctx.totalTags > maxTags) {
      ctx.hardFailure = true;
      report(ctx, 'TOO_MANY_TAGS', 'error', { count: ctx.totalTags });
    }

    const pauses = applyPauseRules(shiftedPauses, plainText, ctx);

    const ratioLimit = this.options.illegalRatioLimit ?? SEMANTIC_ILLEGAL_RATIO_LIMIT;
    const ratio = normalized.length === 0 ? 0 : ctx.illegalChars / normalized.length;
    if (ratio > ratioLimit) {
      ctx.hardFailure = true;
      report(ctx, 'ILLEGAL_RATIO_EXCEEDED', 'error', { count: ctx.illegalChars });
    }

    const hasConflict = ctx.controlTags.includes('END') && ctx.controlTags.includes('MORE');
    if (hasConflict) {
      report(ctx, 'CONTROL_TAG_CONFLICT', 'warning', { count: ctx.controlTags.length });
    }

    let level: SemanticParseLevel = 0;
    if (ctx.hardFailure) {
      // 结构性失败: 语义字段全部作废 (控制面保留, 见文件头说明).
      level = 2;
    } else if (ctx.warnings.length + ctx.errors.length > 0) {
      level = 1;
    }

    const turn: SemanticTurn = {
      text: plainText,
      // Level 2 = 语音面作废 (控制面保留, 见文件头说明).
      preSpeech: level === 2 ? null : ctx.preSpeech,
      pauses: level === 2 ? [] : pauses,
      emotion: level === 2 ? null : ctx.emotion,
      controlTags: ctx.controlTags,
      unknownTags: shiftedUnknown,
    };

    return {
      level,
      turn,
      rawText: input,
      displayText: plainText,
      warnings: ctx.warnings,
      errors: ctx.errors,
      stats: {
        totalTags: ctx.totalTags,
        preSpeechTags: ctx.preSpeechTags,
        pauseTags: ctx.pauseTags,
        emotionTags: ctx.emotionTags,
        controlTags: ctx.controlTagCount,
        unknownTags: ctx.unknownTagCount,
        correctedTags: ctx.correctedTags,
        convertedVendorTags: ctx.convertedVendorTags,
        droppedVendorMarkers: ctx.droppedVendorMarkers,
        illegalChars: ctx.illegalChars,
      },
    };
  }
}

/**
 * 便捷函数 —— 一次性解析.
 *
 * @param input 原始文本
 * @param options 可调参数
 * @returns 解析结果
 */
export function parseSemanticTags(input: string, options: SemanticTagParserOptions = {}): SemanticParseResult {
  return new SemanticTagParser(options).parse(input);
}
