// V2026-10-28 WP1 (引擎内核 · 规则轨事件分类器):
//   职责: EventClassifier 的规则实现 —— 用静态词典把咨询师文本分类成标准事件.
//   边界: 纯函数, 无 I/O, 无随机, 可复现. 模型微调轨后期实现同接口替换, 本类可退役.
//
//   AF-349 (2026-11-23 · 规则轨语义 v2):
//     legacy 档逐字保持 AF-315 口径 (测试 / 历史快照仍可复现); v2 档只修三类
//     语义错误, 不改词表、不改 delta 表、不引入来访侧信号:
//       ① 否定抑制: "我不想让你觉得我在共情" 不该命中 empathy;
//       ② 长词遮盖消歧: "你觉得呢" 只算 open_probe, 不再同时双计 empathy;
//       ③ 强度折算: "有点 / 可能 / 似乎" 这类弱化词把该事件的 strength 降到 0.6,
//          下游 `aggregateTurnDelta` 本来就按 strength 缩放, 这里只补语义来源.
//     v2 **不读取来访话语** —— 内核边界仍是「事件分类只消费咨询师本轮文本」,
//     跨轮语义 (holding_present / cold_absent) 归模型轨, 不在本类伪造.

import { EVENT_LEXICON } from '../domain/events/event-lexicon.js';
import type { ClassifyContext, EventClassifier, SessionEvent } from '../domain/events/session-event.js';

/** 规则轨语义档: legacy = AF-315 旧口径, v2 = 否定 / 消歧 / 强度修正. */
export type RuleClassifierSemantics = 'legacy' | 'v2';

/** 构造选项. 缺省 legacy —— 直接 new 的调用方与改造前逐字一致. */
export interface RuleClassifierOptions {
  readonly semantics?: RuleClassifierSemantics;
}

/** 一条词 / 正则命中 (带原文本区间, 供否定判定与遮盖消歧). */
interface RuleMatch {
  readonly kind: string;
  readonly term: string;
  readonly start: number;
  readonly end: number;
}

/** 弱化词: 出现在命中词前 4 个字符内即折减强度. */
const HEDGE_PREFIXES: readonly string[] = ['有点', '稍微', '有些', '可能', '也许', '大概', '似乎', '算是'];
/** 弱化后的强度 (工程语义值, 不是临床幅度标定). */
const HEDGE_STRENGTH = 0.6;
/** 否定判定的回看窗口 (字符数). */
const NEGATION_WINDOW = 6;
/** 否定词 (长词优先, 避免 "没有" 被 "没" 抢先). */
const NEGATION_CUES: readonly string[] = [
  '并不是',
  '并没有',
  '不是说',
  '谈不上',
  '算不上',
  '没有',
  '不是',
  '并非',
  '不用',
  '不必',
  '无需',
  '不会',
  '不能',
  '不想',
  '不愿',
  '别',
  '没',
  '不',
];
/** 含 "不" 但不表否定的常见词 (避免 "不过 / 不仅 / 不但" 误 suppressing). */
const NON_NEGATING_AFTER_BARE_BU: ReadonlySet<string> = new Set(['过', '仅', '但', '论', '管', '如', '妨', '得', '错', '少']);
/** 裸 "不" 只有后接这些谓词词素时才按否定处理 (避免 "停不下来 / 忍不住" 误伤). */
const BARE_BU_NEGATING_NEXT: ReadonlySet<string> = new Set([
  '理',
  '觉',
  '想',
  '愿',
  '会',
  '能',
  '需',
  '要',
  '用',
  '必',
  '是',
  '在',
  '该',
  '应',
  '敢',
  '好',
  '对',
  '太',
  '够',
  '知',
  '说',
  '做',
  '来',
  '去',
  '给',
  '让',
  '评',
  '接',
  '关',
  '喜',
  '共',
  '适',
  '习',
]);
/** 反问 / 选择问前缀不是否定: "会不会让你觉得..." / "是否觉得..." / "要不要..." */
const QUESTION_PREFIX = /(?:会不会|能不能|是否|是不是|要不要|有没有)$/;
/** 句子边界: 否定作用域不跨标点 (避免 "他没接住，对你来说..." 被判成否定). */
const CLAUSE_BOUNDARIES: readonly string[] = ['。', '！', '？', '；', '：', '，', '\n', '.', '!', '?', ';', ',', ':', '\r'];
/** 双重否定前缀: "不是不理解你" 仍算肯定. */
const DOUBLE_NEGATION_PREFIXES: readonly string[] = ['不是', '并非', '并不是'];

/** 规则轨分类器: 关键词 / 正则兜底, 一条文本可命中多类, 未命中归 neutral. */
export class RuleBasedClassifier implements EventClassifier {
  readonly semantics: RuleClassifierSemantics;

  constructor(options: RuleClassifierOptions = {}) {
    this.semantics = options.semantics ?? 'legacy';
  }

  classify(text: string, context?: ClassifyContext): readonly SessionEvent[] {
    return this.semantics === 'v2' ? classifyV2(text, context) : classifyLegacy(text, context);
  }
}

/** legacy 路径: 与 AF-315 实现逐字相同 (含 substring 双计). */
function classifyLegacy(text: string, context?: ClassifyContext): readonly SessionEvent[] {
  const haystack = text.trim().toLowerCase();
  if (!haystack) {
    return [{ kind: 'neutral', matchedTerms: [], strength: 1 }];
  }

  const events: SessionEvent[] = [];

  for (const rule of EVENT_LEXICON) {
    const matched: string[] = [];
    for (const term of rule.terms) {
      if (haystack.includes(term.toLowerCase())) matched.push(term);
    }
    for (const pattern of rule.patterns ?? []) {
      if (pattern.test(haystack)) matched.push(pattern.source);
    }
    if (matched.length > 0) {
      events.push({ kind: rule.kind, matchedTerms: matched, strength: 1 });
    }
  }

  // sensitive_touch 来自角色敏感议题词表 (上下文), 不在静态词典里.
  const sensitive = (context?.sensitiveTopics ?? []).filter(
    (topic) => topic.trim().length > 0 && haystack.includes(topic.trim().toLowerCase()),
  );
  if (sensitive.length > 0) {
    events.push({ kind: 'sensitive_touch', matchedTerms: sensitive, strength: 1 });
  }

  if (events.length === 0) {
    return [{ kind: 'neutral', matchedTerms: [], strength: 1 }];
  }
  return events;
}

/** v2 路径: 否定抑制 → 遮盖消歧 → 强度折算. */
function classifyV2(text: string, context?: ClassifyContext): readonly SessionEvent[] {
  const haystack = text.trim().toLowerCase();
  if (!haystack) {
    return [{ kind: 'neutral', matchedTerms: [], strength: 1 }];
  }

  const matches: RuleMatch[] = [];
  for (const rule of EVENT_LEXICON) {
    for (const term of rule.terms) {
      collectTermMatches(haystack, term, rule.kind, matches);
    }
    for (const pattern of rule.patterns ?? []) {
      collectPatternMatches(haystack, pattern, rule.kind, matches);
    }
  }

  // 遮盖消歧: 较短命中被另一类更长命中完全包含时丢弃 (典型: "你觉得" ⊂ "你觉得呢").
  // 不做全局 replace —— 同一句仍可同时含 "我理解你的" 与 "你觉得呢".
  const kept = matches.filter(
    (candidate) =>
      !matches.some(
        (other) =>
          other !== candidate &&
          other.kind !== candidate.kind &&
          other.start <= candidate.start &&
          other.end >= candidate.end &&
          other.end - other.start > candidate.end - candidate.start,
      ),
  );

  const events: SessionEvent[] = [];
  for (const rule of EVENT_LEXICON) {
    const kindMatches = kept.filter((match) => match.kind === rule.kind);
    if (kindMatches.length === 0) continue;
    const matchedTerms = [...new Set(kindMatches.map((match) => match.term))];
    const strength = Math.max(...kindMatches.map((match) => strengthOf(haystack, match)));
    events.push({ kind: rule.kind, matchedTerms, strength });
  }

  const sensitive = (context?.sensitiveTopics ?? []).filter((topic) => {
    const needle = topic.trim().toLowerCase();
    if (!needle) return false;
    const start = haystack.indexOf(needle);
    return start !== -1 && !isNegated(haystack, start);
  });
  if (sensitive.length > 0) {
    events.push({ kind: 'sensitive_touch', matchedTerms: sensitive, strength: 1 });
  }

  if (events.length === 0) {
    return [{ kind: 'neutral', matchedTerms: [], strength: 1 }];
  }
  return events;
}

/** 收集一条普通词的**全部**未否定出现 (同一词出现两次时都保留, 强度取最大). */
function collectTermMatches(haystack: string, term: string, kind: string, out: RuleMatch[]): void {
  const needle = term.toLowerCase();
  if (!needle) return;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) return;
    if (!isNegated(haystack, start)) {
      out.push({ kind, term, start, end: start + needle.length });
    }
    from = start + needle.length;
  }
}

/** 收集正则的**全部**未否定命中 (不信任调用方是否带 g, 统一复制成 g). */
function collectPatternMatches(haystack: string, pattern: RegExp, kind: string, out: RuleMatch[]): void {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(haystack)) !== null) {
    if (match[0].length === 0) {
      scanner.lastIndex += 1;
      continue;
    }
    if (!isNegated(haystack, match.index)) {
      out.push({ kind, term: pattern.source, start: match.index, end: match.index + match[0].length });
    }
  }
}

/**
 * 命中位置之前 6 个字符内是否有否定词.
 *
 * 规则:
 *   · 否定词在命中词**之前**才算否定; 命中词内部的 "不" 不算 (如 "你不该" 仍是评判);
 *   · 双重否定 ("不是不理解你") 不抑制 —— 临床语义是肯定;
 *   · "不过 / 不仅 / 不但 / 不论 / 不管" 里的裸 "不" 不是否定.
 */
function isNegated(haystack: string, start: number): boolean {
  const windowStart = Math.max(0, start - NEGATION_WINDOW);
  const before = haystack.slice(windowStart, start);
  if (!before) return false;

  // 否定作用域不跨标点: 只看当前分句.
  const boundary = Math.max(...CLAUSE_BOUNDARIES.map((char) => before.lastIndexOf(char)));
  const clause = boundary >= 0 ? before.slice(boundary + 1) : before;
  if (!clause) return false;
  // 反问 / 选择问不是否定.
  if (QUESTION_PREFIX.test(clause)) return false;

  // 双重否定: "不是不理解你" / "并非不想共情" → 临床语义是肯定, 不抑制.
  if (/(?:并不是|不是|并非)\s*(?:不|没|没有|不会|不能|别)/.test(clause)) return false;

  for (const cue of NEGATION_CUES) {
    let cueStart = clause.lastIndexOf(cue);
    while (cueStart >= 0) {
      if (isBareBuFalsePositive(clause, cueStart)) {
        cueStart = cueStart > 0 ? clause.lastIndexOf(cue, cueStart - 1) : -1;
        continue;
      }
      const prefixStart = Math.max(0, cueStart - 3);
      const cuePrefix = clause.slice(prefixStart, cueStart);
      if (DOUBLE_NEGATION_PREFIXES.some((prefix) => cuePrefix.endsWith(prefix))) {
        cueStart = cueStart > 0 ? clause.lastIndexOf(cue, cueStart - 1) : -1;
        continue;
      }
      return true;
    }
  }
  return false;
}

/** 裸 "不" 后接 "过 / 仅 / 但 ..." 或补语结构 (停不下来) 时不是否定. */
function isBareBuFalsePositive(before: string, cueStart: number): boolean {
  if (before[cueStart] !== '不') return false;
  const next = before[cueStart + 1];
  if (!next) return true;
  if (NON_NEGATING_AFTER_BARE_BU.has(next)) return true;
  // 只有后接谓词词素时才算否定；"停不下来 / 忍不住 / 说不上" 这类补语不算.
  return !BARE_BU_NEGATING_NEXT.has(next);
}

/** 弱化词在前 4 字内 → 0.6; 其余 → 1.0 (不做增强, 避免凭空放大临床幅度). */
function strengthOf(text: string, match: RuleMatch): number {
  const before = text.slice(Math.max(0, match.start - 4), match.start);
  return HEDGE_PREFIXES.some((hedge) => before.includes(hedge)) ? HEDGE_STRENGTH : 1;
}
