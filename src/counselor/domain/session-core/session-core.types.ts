// V2026-10-21 治本 (V1.2 VS-C — 会谈核心 (M2 知情同意 + M3 会谈核心) 类型契约):
//   原因: VS-C 有 4 个 JSON 结构要落库 / 进 prompt / 出 API, 若各写一份 TS 类型必然漂移:
//     ① 知情同意 4 要素覆盖明细 (training_sessions.informed_consent_transcript)
//     ② 技术统计仪表盘 (training_sessions.tech_stats / long_term_case_sessions.tech_stats)
//     ③ 每轮分析器的输出 (一次 LLM 调用同时产"实时提示 + 移情阻抗标记")
//     ④ LLM 结构化输出的校验函数 (手写, 跟 counselor 的 payload 校验同范式)
//   修法: 本文件是这 4 类的唯一真值源, 放在 domain 层 (纯类型 + 纯函数, 无 DI).
//   反双胞胎:
//     - 不用 class-validator class 承载嵌套 json: 它们是数组/对象结构, class-validator 对嵌套
//       json 表达力弱; 校验走手写 validate 函数 (跟 supervision payload 校验同范式),
//       类型靠 TS 保证编译期
//     - 不把这些类型塞进 entity 文件: entity 只声明字段类型, 结构定义集中一处便于复用
//       (DTO / service / prompt 三处都要用)
//     - 不把"每轮分析器"拆成 2 次 LLM 调用 (一次判提示 + 一次判移情): 同一轮对话只需要分析一次,
//       合并成 1 次调用同时输出两段结果 —— 省一次 LLM 成本, 也避免两次判定口径不一致
//       (同一条回复, 两次判可能得出矛盾结论)
//   验证:
//     1. tsc 0 错
//     2. 知情同意判定结果落库后 4 个 element 齐全 + covered 布尔正确
//     3. 每轮分析器对同一轮只产生 1 条 hint + 至多 1 条 mark
//   时间戳: 2026-10-21

import { ChatRole } from '../../enums/chat-role.enum';
import { InformedConsentElement } from '../../enums/informed-consent-element.enum';
import { LiveSupervisionHintTier } from '../../enums/live-supervision-hint-tier.enum';
import { TransferenceMarkDirection, TransferenceMarkType } from '../../enums/transference-mark.enum';

// ════════════════════════════════════════════════════════════════════════════
// ① 知情同意 4 要素覆盖明细 (v1.2 spec §5.4)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 单个知情同意要素的覆盖明细.
 *
 * 落 `training_sessions.informed_consent_transcript` json 数组.
 */
export interface InformedConsentEntry {
  /** 4 要素之一 */
  element: InformedConsentElement;
  /** 是否已讲全 */
  covered: boolean;
  /** AI 来访当时的反应 (接受 / 有疑问 / 担心保密 / 犹豫 / 拒绝录音) */
  visitorResponse: string;
  /** 在 transcript 第几轮讲的 (未覆盖时为 null) */
  coveredAtTurn: number | null;
}

// ════════════════════════════════════════════════════════════════════════════
// ② 技术统计仪表盘 (v1.2 spec §6.3)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 会谈技术统计 (督导 LLM 同一次调用顺带产出, 不额外花钱).
 *
 * 落 `training_sessions.tech_stats` / `long_term_case_sessions.tech_stats`.
 */
export interface SessionTechStats {
  /** 提问类型占比 */
  questionTypes: {
    /** 开放式提问次数 */
    open: number;
    /** 封闭式提问次数 */
    closed: number;
    /** 半开放式提问次数 */
    semi: number;
  };
  /** 干预技术使用次数 */
  interventions: {
    /** 共情 */
    reflection: number;
    /** 释义 */
    paraphrase: number;
    /** 总结 */
    summary: number;
    /** 面质 */
    confrontation: number;
    /** 解释 */
    interpretation: number;
    /** 建议 */
    advice: number;
  };
  /** 行为指标 */
  behavior: {
    /** 打断来访次数 */
    interruptions: number;
    /** 沉默总时长 (毫秒) */
    silenceMs: number;
    /** 议题跳转频率 */
    topicJumps: number;
  };
  /** 督导点评 (一段话) */
  commentary: string;
}

// ════════════════════════════════════════════════════════════════════════════
// ③ 每轮分析器的输出 (一次 LLM 调用 → 提示 + 移情标记)
// ════════════════════════════════════════════════════════════════════════════

/** 实时轻提示的类别 (命中规则). */
export type LiveHintCategory =
  'closed_question_run' | 'suicide_cue' | 'premature_advice' | 'missed_empathy' | 'topic_jump' | 'over_interpretation';

/**
 * 分析器产出的实时轻提示 (可空 = 本轮没命中任何规则).
 *
 * 防依赖硬约束 (spec §6.1): **只给方向, 禁止输出替代话术原文**.
 */
export interface LiveTurnHint {
  /** 命中规则类别 */
  category: LiveHintCategory;
  /** 提示正文 (方向性, 不含可直接照念的话术) */
  hintText: string;
}

/**
 * 分析器产出的移情/阻抗标记 (可空 = 本轮没观察到).
 */
export interface LiveTurnTransferenceMark {
  /** 方向 (AI 自动标记恒为 visitor_auto) */
  direction: TransferenceMarkDirection;
  /** 标记类型 */
  markType: TransferenceMarkType;
  /** 备注 (一句话) */
  note: string;
}

/**
 * 每轮分析器的完整输出.
 *
 * 一次 LLM 调用同时给这三段 —— 同一轮对话只分析一次, 口径一致 + 省成本.
 */
export interface LiveTurnAnalysis {
  /** 实时轻提示 (本轮没命中则 null) */
  hint: LiveTurnHint | null;
  /** 移情/阻抗标记 (本轮没观察到则 null) */
  mark: LiveTurnTransferenceMark | null;
  /** 本轮来访者主动披露的人设事实 (本轮没披露则空数组) */
  disclosures: LiveTurnDisclosure[];
}

/**
 * 本轮来访者**主动披露**的人设事实 (v1.2 §4.2 视图 B 的数据来源).
 *
 * 每条披露对应全量人设的一个锚点 (JSON path) + 披露内容 (原话或紧贴原话的摘要).
 */
export interface LiveTurnDisclosure {
  /** 锚点 (对应 VisitorFullPersona 的 JSON path) */
  anchorKey: string;
  /** 披露内容 (来访者原话或摘要) */
  content: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 信任度推进规则
// ════════════════════════════════════════════════════════════════════════════

/**
 * 披露深度 → 信任度增量权重.
 *
 * V2026-10-21 治本 (V1.2 VS-B2 — 信任度推进规则):
 *   原因: spec §4.1 的信息暴露节奏由「咨访信任度 (0.0-1.0)」驱动, 但没说"披露了什么
 *     该加多少信任". 若按"每条 +0.05"一刀切, 则"披露了童年被打"跟"说了自己叫张伟"
 *     一样重 —— 这跟临床现实不符 (深层的自我暴露才真正建立信任).
 *   修法: 按锚点所在的人设块分档加权:
 *     - 浅层事实 (basics / presentingIssue): +0.03
 *     - 关系与内在 (socialMap / innerWorkingModel): +0.06
 *     - 深层 (developmentalTimeline / coping / therapyExpectation): +0.08
 *     - 其他锚点: +0.04 (默认)
 *   反双胞胎:
 *     - 不做"由 LLM 自己判断这条披露值多少信任": 那是让模型输出一个不可校准的数,
 *       且同一份披露两次判定可能不同; 权重是**服务端规则**, 可复算可解释
 *     - 不按披露内容自由打分: 同上, 且无法在 UI 上解释"为什么信任度涨了 0.06"
 *   验证: 1. tsc 0 错  2. 大炮跑一轮披露, 看信任度增量与锚点深度对应
 *   时间戳: 2026-10-21
 */
export const TRUST_DISCLOSURE_WEIGHTS: Readonly<Record<string, number>> = {
  basics: 0.03,
  presentingIssue: 0.03,
  socialMap: 0.06,
  innerWorkingModel: 0.06,
  developmentalTimeline: 0.08,
  coping: 0.08,
  therapyExpectation: 0.08,
};

/** 未知锚点前缀的默认权重. */
export const TRUST_DISCLOSURE_DEFAULT_WEIGHT = 0.04;

/**
 * 按锚点算信任度增量.
 *
 * @param anchorKey 披露锚点 (如 "innerWorkingModel.coreBeliefs[0]")
 * @returns 信任度增量 (0.03 - 0.08)
 */
export function trustWeightForAnchor(anchorKey: string): number {
  const prefix = anchorKey.split('.', 1)[0] ?? '';
  return TRUST_DISCLOSURE_WEIGHTS[prefix] ?? TRUST_DISCLOSURE_DEFAULT_WEIGHT;
}

// ════════════════════════════════════════════════════════════════════════════
// ④ 手写校验函数 (结构化输出的业务校验回调)
// ════════════════════════════════════════════════════════════════════════════

/** 实时提示的合法类别集合 (校验用). */
export const LIVE_HINT_CATEGORIES: readonly LiveHintCategory[] = [
  'closed_question_run',
  'suicide_cue',
  'premature_advice',
  'missed_empathy',
  'topic_jump',
  'over_interpretation',
];

/** 移情/阻抗标记的合法类型集合 (校验用). */
export const LIVE_MARK_TYPES: readonly TransferenceMarkType[] = [
  TransferenceMarkType.RESISTANCE,
  TransferenceMarkType.AVOIDANCE,
  TransferenceMarkType.POSITIVE_TRANSFERENCE,
  TransferenceMarkType.NEGATIVE_TRANSFERENCE,
  TransferenceMarkType.DISSOCIATION,
  TransferenceMarkType.COUNTER_TRANSFERENCE,
];

/**
 * 披露锚点的合法前缀 (对应全量人设的 7 大块).
 *
 * 校验用: 模型给的 anchorKey 必须落在这 7 块之内, 否则档案条目无法定位到人设节点.
 */
export const LIVE_DISCLOSURE_ANCHOR_PREFIXES: readonly string[] = [
  'basics',
  'developmentalTimeline',
  'innerWorkingModel',
  'socialMap',
  'coping',
  'therapyExpectation',
  'presentingIssue',
];

/**
 * 单段校验结果.
 *
 * - `ok: true`  → 该段合法, `value` 是解析后的值 (**value 本身可以是 null** = 合法但"本轮无发现")
 * - `ok: false` → 该段结构非法, 整份 payload 判非法
 *
 * 为什么不用 `T | null` 直接表达: `hint` / `mark` 的**合法值就是 null** (本轮没命中),
 * 而 null 也可能表示"解析失败" —— 两者必须区分, 否则无法既表达"没有提示"又表达"提示格式错了".
 */
type SegmentResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * 校验轻提示段 (可空: 本轮没命中 → value = null).
 *
 * @param obj LLM 输出的顶层对象
 */
function checkLiveHint(obj: Record<string, unknown>): SegmentResult<LiveTurnHint | null> {
  const hintRaw = obj['hint'];
  if (hintRaw === null || hintRaw === undefined) {
    return { ok: true, value: null };
  }
  if (typeof hintRaw !== 'object' || Array.isArray(hintRaw)) {
    return { ok: false };
  }
  const h = hintRaw as Record<string, unknown>;
  const category = h['category'];
  const hintText = h['hintText'];
  if (typeof category !== 'string' || !LIVE_HINT_CATEGORIES.includes(category as LiveHintCategory)) {
    return { ok: false };
  }
  if (typeof hintText !== 'string' || hintText.trim().length === 0) {
    return { ok: false };
  }
  // 防依赖硬约束 1: 提示只给方向, 长度上限 500 (超长 = 模型在写话术而不是给方向)
  const trimmed = hintText.trim();
  if (trimmed.length > 500) {
    return { ok: false };
  }
  return { ok: true, value: { category: category as LiveHintCategory, hintText: trimmed } };
}

/**
 * 校验移情/阻抗标记段 (可空: 本轮没观察到 → value = null).
 *
 * @param obj LLM 输出的顶层对象
 */
function checkLiveMark(obj: Record<string, unknown>): SegmentResult<LiveTurnTransferenceMark | null> {
  const markRaw = obj['mark'];
  if (markRaw === null || markRaw === undefined) {
    return { ok: true, value: null };
  }
  if (typeof markRaw !== 'object' || Array.isArray(markRaw)) {
    return { ok: false };
  }
  const m = markRaw as Record<string, unknown>;
  const direction = m['direction'];
  const markType = m['markType'];
  const note = m['note'];
  if (direction !== TransferenceMarkDirection.VISITOR_AUTO) {
    // AI 分析器只产出 visitor_auto (咨询师手动标记走独立 API, 层级由调用入口决定)
    return { ok: false };
  }
  if (typeof markType !== 'string' || !LIVE_MARK_TYPES.includes(markType as TransferenceMarkType)) {
    return { ok: false };
  }
  if (typeof note !== 'string') {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      direction: TransferenceMarkDirection.VISITOR_AUTO,
      markType: markType as TransferenceMarkType,
      note: note.trim().slice(0, 500),
    },
  };
}

/**
 * 校验披露段 (可空: 本轮没披露 → 空数组).
 *
 * V2026-10-21 治本 (V1.2 VS-B2 — 披露段校验 + 锚点白名单):
 *   原因: 披露条目的 anchorKey 要能**定位到全量人设的真实节点**, 否则档案条目无法
 *     关联回人设图谱 (前端无法高亮, 信任度权重也算不准 —— 权重按锚点前缀分档).
 *   修法: 锚点前缀必须在 7 大块之内; 非法锚点整份判非法 (宁可报错也不要写脏档案).
 *   反双胞胎: 不用自由文本当锚点: 锚点是**结构化引用**, 不是标签; 自由文本无法校验,
 *     也没法做"这条披露解锁了人设图谱的哪个节点"这种定位.
 *
 * @param obj LLM 输出的顶层对象
 */
function checkLiveDisclosures(obj: Record<string, unknown>): SegmentResult<LiveTurnDisclosure[]> {
  const disclosuresRaw = obj['disclosures'];
  if (disclosuresRaw === undefined || disclosuresRaw === null) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(disclosuresRaw)) {
    return { ok: false };
  }
  const disclosures: LiveTurnDisclosure[] = [];
  for (const item of disclosuresRaw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false };
    }
    const d = item as Record<string, unknown>;
    const anchorKey = d['anchorKey'];
    const content = d['content'];
    if (typeof anchorKey !== 'string' || typeof content !== 'string') {
      return { ok: false };
    }
    const prefix = anchorKey.split('.', 1)[0] ?? '';
    if (!LIVE_DISCLOSURE_ANCHOR_PREFIXES.includes(prefix)) {
      return { ok: false };
    }
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return { ok: false };
    }
    disclosures.push({ anchorKey: anchorKey.trim(), content: trimmed.slice(0, 500) });
  }
  return { ok: true, value: disclosures };
}

/**
 * 校验每轮分析器的 LLM 输出 (hint + mark + disclosures 三段).
 *
 * 严格模式: 命中了但字段不合法 → 整份判非法 (返回 null), 由 client 转成
 * schema_validation_failed. 理由: 提示会直接推给用户看, 字段残缺的提示比没有提示更糟.
 *
 * V2026-10-21 治本 (V1.2 VS-B2 — 复杂度 33 → 4 分解):
 *   原因: 三段校验塞在一个函数里, ESLint complexity 报 33 (上限 20) / sonarjs
 *     cognitive-complexity 报 39 (上限 25) —— 超限 65%.
 *   修法: 按「单段校验各自成函数 + 主函数只做组合」分解 (三段语义本就独立):
 *     checkLiveHint / checkLiveMark / checkLiveDisclosures, 主函数组合三段结果.
 *   反双胞胎:
 *     - 不用 `// eslint-disable-next-line complexity`: 那是把味道藏起来, 下一轮加一个字段又超
 *     - 不用 `T | null` 直接表达"合法但无发现": null 同时表达"无发现"和"解析失败"两种含义,
 *       无法区分 → 用判别式 SegmentResult (ok + value)
 *     - 不拆成 3 个独立的 export: 这 3 段只有本函数用, 私有函数即可
 *   验证: 1. lint 0 错  2. 同一份非法 payload 修复前后判定一致 (都是 null)
 *   时间戳: 2026-10-21 15:45 GMT+8
 *
 * @param raw JSON.parse 后的未知值
 */
export function validateLiveTurnAnalysis(raw: unknown): LiveTurnAnalysis | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  const hint = checkLiveHint(obj);
  const mark = checkLiveMark(obj);
  const disclosures = checkLiveDisclosures(obj);
  if (!hint.ok || !mark.ok || !disclosures.ok) {
    return null;
  }
  return { hint: hint.value, mark: mark.value, disclosures: disclosures.value };
}

/**
 * 校验知情同意 4 要素判定结果.
 *
 * @param raw JSON.parse 后的未知值
 * @returns 4 个要素的覆盖明细 (顺序固定) 或 null
 */
export function validateInformedConsentEntries(raw: unknown): InformedConsentEntry[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: InformedConsentEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return null;
    }
    const e = item as Record<string, unknown>;
    const element = e['element'];
    const covered = e['covered'];
    const visitorResponse = e['visitorResponse'];
    const coveredAtTurn = e['coveredAtTurn'];
    if (typeof element !== 'string') {
      return null;
    }
    if (!Object.values(InformedConsentElement).includes(element as InformedConsentElement)) {
      return null;
    }
    if (typeof covered !== 'boolean') {
      return null;
    }
    if (typeof visitorResponse !== 'string') {
      return null;
    }
    const turn = typeof coveredAtTurn === 'number' && Number.isFinite(coveredAtTurn) ? Math.round(coveredAtTurn) : null;
    out.push({
      element: element as InformedConsentElement,
      covered,
      visitorResponse: visitorResponse.slice(0, 500),
      coveredAtTurn: turn,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * 校验技术统计 (techStats).
 *
 * @param raw JSON.parse 后的未知值
 */
export function validateSessionTechStats(raw: unknown): SessionTechStats | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  const readCount = (source: Record<string, unknown>, key: string): number => {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  };

  const questionTypesRaw = obj['questionTypes'];
  const interventionsRaw = obj['interventions'];
  const behaviorRaw = obj['behavior'];
  const commentary = obj['commentary'];
  if (
    typeof questionTypesRaw !== 'object' ||
    questionTypesRaw === null ||
    typeof interventionsRaw !== 'object' ||
    interventionsRaw === null ||
    typeof behaviorRaw !== 'object' ||
    behaviorRaw === null ||
    typeof commentary !== 'string'
  ) {
    return null;
  }

  const q = questionTypesRaw as Record<string, unknown>;
  const i = interventionsRaw as Record<string, unknown>;
  const b = behaviorRaw as Record<string, unknown>;

  return {
    questionTypes: {
      open: readCount(q, 'open'),
      closed: readCount(q, 'closed'),
      semi: readCount(q, 'semi'),
    },
    interventions: {
      reflection: readCount(i, 'reflection'),
      paraphrase: readCount(i, 'paraphrase'),
      summary: readCount(i, 'summary'),
      confrontation: readCount(i, 'confrontation'),
      interpretation: readCount(i, 'interpretation'),
      advice: readCount(i, 'advice'),
    },
    behavior: {
      interruptions: readCount(b, 'interruptions'),
      silenceMs: readCount(b, 'silenceMs'),
      topicJumps: readCount(b, 'topicJumps'),
    },
    commentary: commentary.slice(0, 1000),
  };
}

/** 分析器输入 (一段已完成的对话轮次). */
export interface LiveTurnAnalysisInput {
  /** 轮次序号 */
  turnIndex: number;
  /** 咨询师这一轮说的话 */
  counselorText: string;
  /** 来访者这一轮的回应 */
  visitorText: string;
  /** 之前的轮次 (最近 N 轮, 给模型上下文) */
  recentTurns: readonly { role: ChatRole; text: string }[];
  /** 触发时的档位 */
  tier: LiveSupervisionHintTier;
}
