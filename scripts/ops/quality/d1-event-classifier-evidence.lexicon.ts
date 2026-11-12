// V2026-11-12 建立 (D-1 取证 · 规则轨漏判率离线取证 · 纯逻辑模块):
//   职责: 逐轮投影 (字段白名单) + 规则轨基线统计 + 人工标注对照 (precision / recall /
//         两向漏判率) + Wilson 区间 + 分层抽样 + CSV 序列化 —— 全部**零 IO 纯函数**.
//
//   为什么抽成独立模块 (而不是把 CLI 脚本当模块直接测):
//     CLI 脚本末尾是 `await main();` —— 一 import 就跑整场取证 (读几百份逐字稿),
//     单测没法 import. 口径与实现必须同源 (脚本与 spec 各写一套 = 反双胞胎).
//
//   边界: 零 IO / 零 DB / 零网络; 输入是**已解析**的 JSON 与纯数据.
//
//   ⚠️ 隐私红线 (AGENTS.md §5.4):
//     · 本模块**不接收也不返回**对话原文 —— 投影只取 messages[].text 的**长度**
//       (用于归一化字符数桶), 原文既不进返回结构, 也不进任何 CSV;
//     · 禁止字段 (title / characterLabel / renderSpec / kernelState) 连类型都不声明,
//       编译器因此不可能让本模块去碰它们;
//     · 输出只有: id / 计数 / 比率 / 标签 / 归一化字符数桶.
//
//   口径来源 (单一真相源, 本模块不另立一份):
//     · 事件种类表与正向事件表来自 src/auto-practice/metrics/metric-dictionary.js
//       (WP-K 指标字典, 零依赖纯常量) —— 不复制;
//     · 负向**词**事件集合从 core 的 EVENT_LEXICON 派生 (规则轨分类器遍历的
//       同一张静态词表) —— 不复制、不硬编码;
//     · 事件种类**类型**来自 core 的 CounselorEventKind (type-only import).
//
//   验证: pnpm exec vitest run test/quality/d1-event-classifier-evidence.spec.ts

import { POSITIVE_EVENTS, TRACKED_EVENTS } from '../../../src/auto-practice/metrics/metric-dictionary.js';
import { EVENT_LEXICON } from '../../../src/engine-core/domain/events/event-lexicon.js';
import type { CounselorEventKind } from '../../../src/engine-core/index.js';

/** 轮次段 (分层抽样用): 首段 / 中段 / 尾段. */
export type TurnSegment = 'head' | 'middle' | 'tail';

/** 规则轨事件种类 (core CounselorEventKind 的别名, 便于本模块只依赖类型). */
export type EvidenceEventKind = CounselorEventKind;

/**
 * 人工标注词表 = 规则轨 11 类 (含 neutral) ∪ 两类在场标签.
 *
 * ⚠️ 两类在场标签只是**标注列取值**, 不是 core 事件种类 —— 本单不产出 core 类型
 *   (联合形状留 D-2 拍板).
 */
export const HUMAN_LABEL_VOCABULARY: readonly string[] = [...TRACKED_EVENTS, 'holding_present', 'cold_absent'];

/**
 * 负向**词**事件种类 (4 类) —— 从静态词表派生, 不另立一份清单.
 *
 * ⚠️ **不含 `sensitive_touch`**: 它不在 `EVENT_LEXICON` 里 —— 按
 *   `rule-based-classifier.ts:31-37`, 它由角色 `sensitiveTopics` 上下文命中,
 *   语义是「本轮触碰了敏感议题」, 不是「说了负向话」. 任务单 §5 与 DOC-2 备忘说的
 *   「4 类负向词事件」= judgment / preaching / minimizing / boundary_cross.
 */
export const NEGATIVE_LEXICON_KINDS: readonly string[] = [
  ...new Set(EVENT_LEXICON.map((rule) => rule.kind).filter((kind) => !POSITIVE_EVENTS.includes(kind))),
];

/** 机器候选标签的备注串 (写进标注文件 note 列). */
export const MACHINE_CANDIDATE_NOTE = '候选待主控复核';

/** 归一化字符数桶的取值 (只出桶, 不出原始长度 —— 长度也是内容侧信息). */
export const CHAR_BUCKETS: readonly string[] = ['0', '1-5', '6-15', '16-40', '41+'];

/** 逐字稿里的一条 trace —— **只声明本模块要用的字段** (禁止字段连类型都不声明). */
export interface RawTrace {
  readonly turnIndex?: number;
  readonly eventTags?: readonly string[];
  readonly degraded?: boolean;
  readonly crisis?: { readonly detected?: boolean };
}

/** 逐字稿里的一条 message —— 只用 role 与 text 的**长度**. */
export interface RawMessage {
  readonly role?: string;
  readonly text?: string;
  readonly turnIndex?: number;
}

/** 逐字稿文件 (白名单视图). */
export interface RawTranscript {
  readonly id?: string;
  readonly characterSlug?: string;
  readonly messages?: readonly RawMessage[];
  readonly traces?: readonly RawTrace[];
}

/** 一轮的投影结果 (白名单字段). */
export interface ProjectedTurn {
  readonly debugSessionId: string;
  readonly turnIndex: number;
  readonly characterSlug: string;
  readonly counselorModeId: string;
  readonly eventTags: readonly string[];
  readonly degraded: boolean;
  readonly crisis: boolean;
  readonly charBucket: string;
  readonly segment: TurnSegment;
  /** 该轮所处"连续 neutral 段"的长度 (段的存在性标记, 不是临床缺席阈值). */
  readonly neutralRunLength: number;
}

/** Wilson 95% 区间. */
export interface WilsonInterval {
  readonly lower: number;
  readonly upper: number;
}

/** 一个分组的统计 (模式 / 角色 / 轮次段通用). */
export interface TurnBucket {
  readonly key: string;
  readonly turns: number;
  readonly degradedTurns: number;
  readonly eligibleTurns: number;
  readonly neutralTurns: number;
  readonly neutralRate: number;
  readonly tagCounts: ReadonlyMap<string, number>;
}

/** 规则轨基线 (全量, 不需要人工标注). */
export interface RuleTrackBaseline {
  readonly sessions: number;
  readonly totalTurns: number;
  readonly degradedTurns: number;
  readonly eligibleTurns: number;
  readonly tagCounts: ReadonlyMap<string, number>;
  readonly neutralTurns: number;
  readonly neutralRate: number;
  readonly neutralInterval: WilsonInterval;
  /** 正向事件率 (5 类: empathy / acceptance / normalization / open_probe / affirmation). */
  readonly positiveEventRate: number;
  /** 负向**词**事件率 (4 类: judgment / preaching / minimizing / boundary_cross; 不含 sensitive_touch). */
  readonly negativeEventRate: number;
  readonly multiTagTurns: number;
  readonly zeroTagTurns: number;
  readonly byMode: ReadonlyMap<string, TurnBucket>;
  readonly byCharacter: ReadonlyMap<string, TurnBucket>;
  readonly bySegment: ReadonlyMap<string, TurnBucket>;
}

/** 某一类的规则轨 / 人工一致度. */
export interface KindAgreement {
  readonly kind: string;
  /** 人工标为该类的轮数 (分母, recall 的分母). */
  readonly support: number;
  /** 规则轨判为该类的轮数 (分母, precision 的分母). */
  readonly ruleCount: number;
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly falseNegative: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly precisionInterval: WilsonInterval | null;
  readonly recallInterval: WilsonInterval | null;
}

/** 一向漏判 (误吞) 统计. */
export interface SwallowStat {
  readonly labeled: number;
  readonly swallowed: number;
  readonly rate: number | null;
  readonly interval: WilsonInterval | null;
}

/** 人工标注对照结果. */
export interface LabelAgreement {
  readonly labeledTurns: number;
  readonly unlabeledTurns: number;
  readonly labelCounts: ReadonlyMap<string, number>;
  readonly perKind: readonly KindAgreement[];
  readonly swallow: {
    readonly holdingPresent: SwallowStat;
    readonly coldAbsent: SwallowStat;
  };
  /** 规则轨判 neutral 且已标注的轮数 (误吞分解的分母). */
  readonly neutralRuleLabeled: number;
  /** 规则轨判 neutral 的已标注轮里, 人工判成了什么 (误吞分解). */
  readonly neutralRuleBreakdown: ReadonlyMap<string, number>;
}

/** 抽样清单的一行. */
export interface SampleItem {
  readonly turn: ProjectedTurn;
  readonly stratum: string;
  readonly machineCandidate: string;
}

/**
 * 归一化字符数桶.
 *
 * @param length 原始字符数
 * @returns 桶名
 */
export function charBucket(length: number): string {
  if (length <= 0) return '0';
  if (length <= 5) return '1-5';
  if (length <= 15) return '6-15';
  if (length <= 40) return '16-40';
  return '41+';
}

/**
 * 轮次段 (前 1/3 = head, 中 1/3 = middle, 后 1/3 = tail).
 *
 * @param turnIndex 轮次号 (从 1 起)
 * @param totalTurns 本场总轮数
 * @returns 轮次段
 */
export function segmentOf(turnIndex: number, totalTurns: number): TurnSegment {
  if (totalTurns <= 0) return 'head';
  const third = Math.ceil(totalTurns / 3);
  if (turnIndex <= third) return 'head';
  if (turnIndex <= third * 2) return 'middle';
  return 'tail';
}

/**
 * 这一轮是否"规则轨只判了 neutral" (含一个标签都没挂的情况).
 *
 * @param turn 投影行
 * @returns 是则 true
 */
export function isNeutralOnly(turn: ProjectedTurn): boolean {
  return turn.eventTags.every((tag) => tag === 'neutral');
}

/**
 * 取咨询师每轮的**长度** (只留长度, 原文不留存).
 *
 * @param messages 逐字稿消息
 * @returns 轮次号 → 字符数
 */
function counselorLengths(messages: readonly RawMessage[]): Map<number, number> {
  const lengths = new Map<number, number>();
  for (const message of messages) {
    if (message.role !== 'counselor') continue;
    const turnIndex = Number(message.turnIndex ?? 0);
    if (!Number.isFinite(turnIndex) || turnIndex <= 0) continue;
    lengths.set(turnIndex, (message.text ?? '').trim().length);
  }
  return lengths;
}

/**
 * 给每一轮标上"它处在多长的连续 neutral 段里".
 *
 * ⚠️ 段长只是**连续性存在性的标记**, 不是 `cold_absent` 的临床缺席轮数阈值
 *   (那个留 D-2 标定) —— 这里只回答"这一轮前后还有没有别的 neutral 轮".
 *
 * @param turns 投影行 (按轮次顺序)
 * @returns 带段长的投影行
 */
function withNeutralRuns(turns: readonly ProjectedTurn[]): ProjectedTurn[] {
  const out: ProjectedTurn[] = [];
  let index = 0;
  while (index < turns.length) {
    if (!isNeutralOnly(turns[index])) {
      out.push(turns[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < turns.length && isNeutralOnly(turns[end])) end += 1;
    const runLength = end - index;
    for (let i = index; i < end; i += 1) out.push({ ...turns[i], neutralRunLength: runLength });
    index = end;
  }
  return out;
}

/**
 * 把一份逐字稿投影成逐轮白名单行.
 *
 * @param input 逐字稿 + 场次元信息
 * @returns 逐轮投影行
 */
export function projectTranscript(input: {
  readonly transcript: RawTranscript;
  readonly debugSessionId: string;
  readonly counselorModeId?: string;
}): ProjectedTurn[] {
  const traces = input.transcript.traces ?? [];
  const lengths = counselorLengths(input.transcript.messages ?? []);
  const totalTurns = traces.length;
  const projected: ProjectedTurn[] = [];
  for (const [position, trace] of traces.entries()) {
    const turnIndex = Number(trace.turnIndex ?? position + 1);
    const eventTags = (trace.eventTags ?? []).filter((tag) => typeof tag === 'string' && tag.length > 0);
    projected.push({
      debugSessionId: input.debugSessionId,
      turnIndex,
      characterSlug: input.transcript.characterSlug ?? '',
      counselorModeId: input.counselorModeId ?? '',
      eventTags,
      degraded: trace.degraded === true,
      crisis: trace.crisis?.detected === true,
      charBucket: charBucket(lengths.get(turnIndex) ?? 0),
      segment: segmentOf(turnIndex, totalTurns),
      neutralRunLength: 0,
    });
  }
  return withNeutralRuns(projected);
}

/**
 * Wilson 区间 (比例的精确区间; 稀有类用它代替点估计).
 *
 * @param successes 分子
 * @param total 分母
 * @param z 正态分位数 (默认 1.96 = 95%)
 * @returns 区间
 */
export function wilsonInterval(successes: number, total: number, z = 1.96): WilsonInterval {
  if (total <= 0) return { lower: 0, upper: 0 };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

/**
 * 按某个键分组统计.
 *
 * @param turns 投影行
 * @param keyOf 分组键
 * @returns 每组的统计
 */
export function bucketize(turns: readonly ProjectedTurn[], keyOf: (turn: ProjectedTurn) => string): Map<string, TurnBucket> {
  const buckets = new Map<string, TurnBucket>();
  for (const turn of turns) {
    const key = keyOf(turn);
    const current = buckets.get(key);
    const tagCounts = new Map(current?.tagCounts);
    for (const tag of turn.eventTags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const degradedTurns = (current?.degradedTurns ?? 0) + (turn.degraded ? 1 : 0);
    const eligibleTurns = (current?.eligibleTurns ?? 0) + (turn.degraded ? 0 : 1);
    const neutralTurns = (current?.neutralTurns ?? 0) + (isNeutralOnly(turn) ? 1 : 0);
    buckets.set(key, {
      key,
      turns: (current?.turns ?? 0) + 1,
      degradedTurns,
      eligibleTurns,
      neutralTurns,
      neutralRate: eligibleTurns > 0 ? neutralTurns / eligibleTurns : 0,
      tagCounts,
    });
  }
  return buckets;
}

/**
 * 规则轨基线统计 (全量口径, 不依赖人工标注).
 *
 * @param turns 全部投影行
 * @returns 基线
 */
export function computeRuleTrackBaseline(turns: readonly ProjectedTurn[]): RuleTrackBaseline {
  const sessions = new Set(turns.map((turn) => turn.debugSessionId)).size;
  const eligible = turns.filter((turn) => !turn.degraded);
  const tagCounts = new Map<string, number>();
  let neutralTurns = 0;
  let multiTagTurns = 0;
  let zeroTagTurns = 0;
  let positiveInstances = 0;
  let negativeInstances = 0;
  const negativeKinds = new Set(NEGATIVE_LEXICON_KINDS);
  for (const turn of turns) {
    for (const tag of turn.eventTags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      if (POSITIVE_EVENTS.includes(tag as (typeof POSITIVE_EVENTS)[number])) positiveInstances += 1;
      if (negativeKinds.has(tag as (typeof TRACKED_EVENTS)[number])) negativeInstances += 1;
    }
    if (isNeutralOnly(turn)) neutralTurns += 1;
    if (turn.eventTags.length > 1) multiTagTurns += 1;
    if (turn.eventTags.length === 0) zeroTagTurns += 1;
  }
  const eligibleTurns = eligible.length;
  return {
    sessions,
    totalTurns: turns.length,
    degradedTurns: turns.length - eligibleTurns,
    eligibleTurns,
    tagCounts,
    neutralTurns,
    neutralRate: eligibleTurns > 0 ? neutralTurns / eligibleTurns : 0,
    neutralInterval: wilsonInterval(neutralTurns, eligibleTurns),
    positiveEventRate: eligibleTurns > 0 ? positiveInstances / eligibleTurns : 0,
    negativeEventRate: eligibleTurns > 0 ? negativeInstances / eligibleTurns : 0,
    multiTagTurns,
    zeroTagTurns,
    byMode: bucketize(turns, (turn) => turn.counselorModeId || 'unknown'),
    byCharacter: bucketize(turns, (turn) => turn.characterSlug || 'unknown'),
    bySegment: bucketize(turns, (turn) => turn.segment),
  };
}

/**
 * 机器候选标签 (工程种子启发式, **不是最终标注**).
 *
 * 口径 (与任务单 §5 的标注判据同源):
 *   · 规则轨命中非 neutral 类 → 候选就是那个类 (人工只需确认 / 改判);
 *   · 规则轨判 neutral 且处在**连续 neutral 段**里 → 按长度分冷热候选;
 *   · 规则轨判 neutral、孤立短句 → 不给候选 (连连续性都不够, 单轮不作数).
 *
 * ⚠️ 这里的"段长 ≥ 2"只是**标记"该轮处在连续段内"**, 不是 `cold_absent` 的
 *   临床缺席轮数阈值 (留 D-2); "长度"同理是工程种子值, 非临床标定.
 *
 * @param turn 投影行
 * @returns 候选标签
 */
export function machineCandidateLabel(turn: ProjectedTurn): string {
  const matched = turn.eventTags.filter((tag) => tag !== 'neutral');
  if (matched.length > 1) return 'multi';
  if (matched.length === 1) return matched[0] ?? 'unclear';
  const short = turn.charBucket === '0' || turn.charBucket === '1-5' || turn.charBucket === '6-15';
  if (turn.neutralRunLength >= 2) return short ? 'cold_absent?' : 'holding_present?';
  if (!short) return 'holding_present?';
  return 'unclear';
}

/**
 * 一轮的键 (标注文件用).
 *
 * @param turn 投影行
 * @returns 键
 */
export function turnKey(turn: ProjectedTurn): string {
  return `${turn.debugSessionId}#${turn.turnIndex}`;
}

/**
 * 分层抽样: 模式 × 角色 × 轮次段, cold 富集 + 尾段优先 + 先剔降级轮.
 *
 * 确定性 (无随机): 同样输入 → 同样清单, 可复算.
 *
 * @param turns 全部投影行
 * @param size 目标条数
 * @returns 抽样清单
 */
export function stratifiedSample(turns: readonly ProjectedTurn[], size: number): SampleItem[] {
  const eligible = turns.filter((turn) => !turn.degraded);
  const groups = new Map<string, ProjectedTurn[]>();
  for (const turn of eligible) {
    const stratum = `${turn.counselorModeId || 'unknown'}|${turn.characterSlug || 'unknown'}|${turn.segment}`;
    const bucket = groups.get(stratum);
    if (bucket) bucket.push(turn);
    else groups.set(stratum, [turn]);
  }
  const modeRank = (mode: string): number => (mode === 'cold' ? 0 : 1);
  const segmentRank = (segment: TurnSegment): number => {
    if (segment === 'tail') return 0;
    if (segment === 'middle') return 1;
    return 2;
  };
  const ordered = [...groups.entries()].toSorted((left, right) => {
    const [leftMode, leftCharacter, leftSegment] = left[0].split('|');
    const [rightMode, rightCharacter, rightSegment] = right[0].split('|');
    const byMode = modeRank(leftMode) - modeRank(rightMode);
    if (byMode !== 0) return byMode;
    const bySegment = segmentRank(leftSegment as TurnSegment) - segmentRank(rightSegment as TurnSegment);
    if (bySegment !== 0) return bySegment;
    if (leftCharacter !== rightCharacter) return leftCharacter < rightCharacter ? -1 : 1;
    return left[0] < right[0] ? -1 : 1;
  });
  // ⚠️ `ordered` 的元素是 [stratum, bucket] **元组** —— 必须取元组的第二项,
  //   直接迭代 `ordered.values()` 拿到的是元组本身, 段内降序排序会静默失效.
  const sortedGroups = ordered.map((entry) => {
    const bucket = entry[1].toSorted((left, right) => {
      if (right.turnIndex !== left.turnIndex) return right.turnIndex - left.turnIndex;
      return left.debugSessionId < right.debugSessionId ? -1 : 1;
    });
    return [entry[0], bucket] as const;
  });
  const items: SampleItem[] = [];
  let cursor = 0;
  while (items.length < size) {
    let progressed = false;
    for (const [stratum, bucket] of sortedGroups) {
      if (items.length >= size) break;
      const turn = bucket[cursor];
      if (!turn) continue;
      progressed = true;
      items.push({ turn, stratum, machineCandidate: machineCandidateLabel(turn) });
    }
    if (!progressed) break;
    cursor += 1;
  }
  return items;
}

/**
 * 人工标注对照 (precision / recall + 两向漏判率 + 误吞分解).
 *
 * @param turns 全部投影行
 * @param labels 键 → 人工标签 (键由 turnKey 生成)
 * @returns 对照结果
 */
export function computeLabelAgreement(turns: readonly ProjectedTurn[], labels: ReadonlyMap<string, string>): LabelAgreement {
  const eligible = turns.filter((turn) => !turn.degraded);
  const labelCounts = new Map<string, number>();
  const kindSupport = new Map<string, number>();
  const kindRuleCount = new Map<string, number>();
  const kindTruePositive = new Map<string, number>();
  const neutralRuleBreakdown = new Map<string, number>();
  let labeledTurns = 0;
  let neutralRuleLabeled = 0;
  for (const turn of eligible) {
    const human = labels.get(turnKey(turn));
    if (!human || !HUMAN_LABEL_VOCABULARY.includes(human)) continue;
    labeledTurns += 1;
    labelCounts.set(human, (labelCounts.get(human) ?? 0) + 1);
    kindSupport.set(human, (kindSupport.get(human) ?? 0) + 1);
    for (const tag of turn.eventTags) {
      kindRuleCount.set(tag, (kindRuleCount.get(tag) ?? 0) + 1);
      if (tag === human) kindTruePositive.set(tag, (kindTruePositive.get(tag) ?? 0) + 1);
    }
    if (isNeutralOnly(turn)) {
      neutralRuleLabeled += 1;
      neutralRuleBreakdown.set(human, (neutralRuleBreakdown.get(human) ?? 0) + 1);
    }
  }
  const kinds = [...new Set([...HUMAN_LABEL_VOCABULARY, ...kindRuleCount.keys()])];
  const perKind: KindAgreement[] = kinds.map((kind) => {
    const support = kindSupport.get(kind) ?? 0;
    const ruleCount = kindRuleCount.get(kind) ?? 0;
    const truePositive = kindTruePositive.get(kind) ?? 0;
    const falsePositive = ruleCount - truePositive;
    const falseNegative = support - truePositive;
    return {
      kind,
      support,
      ruleCount,
      truePositive,
      falsePositive,
      falseNegative,
      precision: ruleCount > 0 ? truePositive / ruleCount : null,
      recall: support > 0 ? truePositive / support : null,
      precisionInterval: ruleCount > 0 ? wilsonInterval(truePositive, ruleCount) : null,
      recallInterval: support > 0 ? wilsonInterval(truePositive, support) : null,
    };
  });
  const swallowFor = (kind: string): SwallowStat => {
    const labeled = kindSupport.get(kind) ?? 0;
    const swallowed = neutralRuleBreakdown.get(kind) ?? 0;
    return {
      labeled,
      swallowed,
      rate: labeled > 0 ? swallowed / labeled : null,
      interval: labeled > 0 ? wilsonInterval(swallowed, labeled) : null,
    };
  };
  return {
    labeledTurns,
    unlabeledTurns: eligible.length - labeledTurns,
    labelCounts,
    perKind,
    swallow: {
      holdingPresent: swallowFor('holding_present'),
      coldAbsent: swallowFor('cold_absent'),
    },
    neutralRuleLabeled,
    neutralRuleBreakdown,
  };
}

/**
 * CSV 字段转义 (只在必要时加引号).
 *
 * @param value 字段值
 * @returns 转义后的值
 */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/**
 * 一行 CSV.
 *
 * @param fields 字段
 * @returns 行
 */
function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(',');
}

/**
 * 逐轮投影 CSV.
 *
 * @param turns 投影行
 * @returns CSV 文本
 */
export function buildProjectionCsv(turns: readonly ProjectedTurn[]): string {
  const header = csvRow([
    'debug_session_id',
    'turn_index',
    'character_slug',
    'counselor_mode_id',
    'event_tags',
    'degraded',
    'crisis',
    'char_bucket',
    'segment',
    'neutral_run_length',
    'machine_candidate',
  ]);
  const rows = turns.map((turn) =>
    csvRow([
      turn.debugSessionId,
      String(turn.turnIndex),
      turn.characterSlug,
      turn.counselorModeId,
      turn.eventTags.join('|'),
      turn.degraded ? '1' : '0',
      turn.crisis ? '1' : '0',
      turn.charBucket,
      turn.segment,
      String(turn.neutralRunLength),
      machineCandidateLabel(turn),
    ]),
  );
  return [header, ...rows].join('\n') + '\n';
}

/**
 * 分层抽样清单 CSV.
 *
 * @param items 抽样清单
 * @returns CSV 文本
 */
export function buildSampleCsv(items: readonly SampleItem[]): string {
  const header = csvRow([
    'sample_index',
    'stratum',
    'debug_session_id',
    'turn_index',
    'character_slug',
    'counselor_mode_id',
    'segment',
    'char_bucket',
    'neutral_run_length',
    'event_tags',
    'degraded',
    'machine_candidate',
  ]);
  const rows = items.map((item, index) =>
    csvRow([
      String(index + 1),
      item.stratum,
      item.turn.debugSessionId,
      String(item.turn.turnIndex),
      item.turn.characterSlug,
      item.turn.counselorModeId,
      item.turn.segment,
      item.turn.charBucket,
      String(item.turn.neutralRunLength),
      item.turn.eventTags.join('|'),
      item.turn.degraded ? '1' : '0',
      item.machineCandidate,
    ]),
  );
  return [header, ...rows].join('\n') + '\n';
}

/**
 * 标注骨架 CSV (列固定为任务单 §3.1-4 约定的九列).
 *
 * @param items 抽样清单
 * @returns CSV 文本
 */
export function buildAnnotationCsv(items: readonly SampleItem[]): string {
  const header = csvRow([
    'debug_session_id',
    'turn_index',
    'character_slug',
    'counselor_mode_id',
    'event_tags',
    'degraded',
    'machine_candidate',
    'human_label',
    'note',
  ]);
  const rows = items.map((item) =>
    csvRow([
      item.turn.debugSessionId,
      String(item.turn.turnIndex),
      item.turn.characterSlug,
      item.turn.counselorModeId,
      item.turn.eventTags.join('|'),
      item.turn.degraded ? '1' : '0',
      item.machineCandidate,
      '',
      MACHINE_CANDIDATE_NOTE,
    ]),
  );
  return [header, ...rows].join('\n') + '\n';
}

/**
 * 从标注骨架 CSV 里读回人工标签 (键 = debug_session_id#turn_index).
 *
 * @param csv CSV 文本
 * @returns 键 → 人工标签
 */
export function parseAnnotationLabels(csv: string): Map<string, string> {
  const labels = new Map<string, string>();
  const lines = csv.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return labels;
  const header = splitCsvLine(lines[0] ?? '');
  const sessionIndex = header.indexOf('debug_session_id');
  const turnIndex = header.indexOf('turn_index');
  const labelIndex = header.indexOf('human_label');
  if (sessionIndex === -1 || turnIndex === -1 || labelIndex === -1) return labels;
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    const sessionId = fields[sessionIndex] ?? '';
    const turn = fields[turnIndex] ?? '';
    const label = (fields[labelIndex] ?? '').trim();
    if (!sessionId || !turn || !label) continue;
    labels.set(`${sessionId}#${turn}`, label);
  }
  return labels;
}

/**
 * 拆一行 CSV (支持带引号的字段).
 *
 * @param line 行文本
 * @returns 字段
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}
