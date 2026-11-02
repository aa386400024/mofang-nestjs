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
import { SessionType } from '../../enums/session-type.enum';
import { SupervisionFailureCode } from '../../enums/supervision-failure-code.enum';
import { SupervisionSchoolCode } from '../../enums/supervision-school-code.enum';
import { TrainingSessionStatus } from '../../enums/training-session-status.enum';
import { TransferenceMarkDirection, TransferenceMarkType } from '../../enums/transference-mark.enum';
import { isInsufficientMaterial, type EffectiveMaterial, type EffectiveMaterialThresholds } from '../session-view/session-material';

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

// ════════════════════════════════════════════════════════════════════════════
// ⑤ 复盘报告状态归一 (V2026-10-26 起; V2026-10-27 统一为「唯一派生处」)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 复盘报告状态.
 *
 * 刻意区分四档 (不是"有/无"两态): 前端要能分清
 * 「还没生成」(pending) /「生成了」(completed) /「生成失败」(parse_error) /「没有素材」(no_content).
 * 把它们折成"没有报告", 前端就只能一直转圈或直接报错, 用户分不清"再等等"还是"重试",
 * 更分不清"这场压根没内容, 再等也不会有".
 *
 * V2026-10-27 (spec 任务 C): 新增 `no_content` ——
 *   一场会话**没有可分析的素材** (有效轮 < 2 或有效字数 < 30) 时, 报告**永远不会**生成.
 *   以前这种会话被派生成 `pending` (永久"生成中"), 用户永远等不到.
 */
export type SessionReportStatus = 'completed' | 'parse_error' | 'pending' | 'no_content';

/**
 * 主报告行状态 (agent 侧 `supervision_reports`).
 *
 * 报告行只有两档: 生成成功 / 生成失败 —— "还没生成"不是报告行的状态, 是**没有报告行**.
 */
export interface SessionMainReportState {
  /** 报告行状态. */
  readonly status: 'completed' | 'parse_error';
  /** 报告总分 0-100 (报告行里的值). */
  readonly overallScore: number;
}

/**
 * 4 流派反馈状态 (counselor 侧 `supervision_feedback`).
 *
 * 单次训练 (training_session) 场景下**没有**主报告链路 (主报告由 voice 侧
 * `endSession → SupervisorProcessor` 产出, 只覆盖 vpt), 因此这份反馈就是该会话的
 * "报告内容"本体 —— 派生时必须把它算进来, 否则单次训练永远是 pending.
 */
export interface SessionSchoolFeedbackState {
  /** 反馈状态: 生成成功 / 生成失败. */
  readonly status: 'completed' | 'parse_error';
  /** 反馈总分 0-100 (失败态为 null —— 不补 0). */
  readonly overallScore: number | null;
  /** 失败原因码 (失败态才有值). */
  readonly failureCode: SupervisionFailureCode | null;
}

/**
 * 报告状态派生入参 (全部是**已取好的事实**, 本函数不碰 IO).
 */
export interface SessionReportStateInput {
  /** 会话状态 (判定是否 finished). */
  readonly sessionStatus: TrainingSessionStatus;
  /** 会话结束时刻 (ms); null = 还没结束. */
  readonly endedAtMs: number | null;
  /** 当前时刻 (ms) — 调用方传入, 保持纯函数 (可测 / 可重放). */
  readonly nowMs: number;
  /** 主报告行 (agent 侧); null = 还没有报告行. */
  readonly mainReport: SessionMainReportState | null;
  /** 4 流派反馈状态 (counselor 侧); null = 还没有反馈记录. */
  readonly schoolFeedback: SessionSchoolFeedbackState | null;
  /**
   * 这条会话的「报告正身」是不是 agent 主报告链路.
   *
   * V2026-10-27 治本 (vpt 适用范围隔离, docs/progress/vpt-feedback-status-isolation-2026-10-27.md):
   *   两类会话的「报告正身」不同, 反馈的**角色**也不同:
   *     · vpt_voice (true)      → 报告正身是 agent 主报告 (`supervision_reports`:
   *                                六维评分 / 亮点 / 标注 / 风险线索); 4 流派反馈只是
   *                                **附加** (技术统计来源 + 多流派展示)
   *     · training_session (false) → **没有**主报告链路, 4 流派反馈就是报告本体
   *   少了这个位, vpt 会在「主报告还没异步到达」的窗口里被反馈带跑:
   *   反馈先成功 → 提前判 completed (但 dimensions/annotations 为空, 自相矛盾),
   *   反馈先失败 → 把 vpt 误判成 parse_error (主报告其实可能成功).
   */
  readonly hasMainReportChannel: boolean;
  /** 有效素材量; null = 未取到 (此时不判空局 —— 无法证明"没有素材"). */
  readonly material: EffectiveMaterial | null;
  /** 最小可分析量阈值. */
  readonly thresholds: EffectiveMaterialThresholds;
  /** 陈旧 pending 判定阈值 (ms). */
  readonly stalePendingTimeoutMs: number;
  /**
   * 是否启用陈旧 pending 兜底.
   *
   * 列表 = false (列表是**快照**, 墙钟判定是报告页的现场);
   * 详情 = true (前端在轮询, 需要一个"永远转圈"的兜底).
   */
  readonly applyStaleTimeout: boolean;
}

/**
 * 归一失败原因码 (库值 → 领域值).
 *
 * V2026-10-27 治本 (vpt 适用范围隔离): 失败码来自 `supervision_feedback.feedback` json,
 *   是**别人可能手改过的库值** (不像编译期 enum 那样受类型保护):
 *     · 非空字符串且是已知码 → 原样返回
 *     · 非空字符串但**未知码** (库里手改过 / 旧版本遗留) → 归到 `parse_failed`
 *       (仍是"失败", 绝不能当成"成功" —— 否则占位的 0 分会被当真实评分展示出去)
 *     · 空 / 非字符串 → null (不是失败记录)
 *   两个 service 都要做这次归一 → 收在 domain 一处, 不各写一份.
 *
 * @param raw 库里的原始值
 * @returns 失败原因码 (不是失败记录 → null)
 */
export function toSupervisionFailureCode(raw: unknown): SupervisionFailureCode | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  for (const code of Object.values(SupervisionFailureCode)) {
    if (code === raw) {
      return code;
    }
  }
  return SupervisionFailureCode.PARSE_FAILED;
}

/**
 * 一条流派反馈的派生输入 (最小结构 — domain 层不认识 entity).
 */
export interface SchoolFeedbackRow {
  /** 流派码; null = 流派被软删 (读不出视角, 跳过这条). */
  readonly schoolCode: SupervisionSchoolCode | null;
  /** 反馈总分 0-100 (失败记录里是占位值, 不参与取值). */
  readonly overallScore: number;
  /** 失败原因码 (非空 = 这条是**失败记录**, 内容是占位值). */
  readonly failureCode: SupervisionFailureCode | null;
}

/**
 * 会话级流派反馈状态 (列表与详情**共用**同一份判定).
 *
 * V2026-10-27 治本 (vpt 适用范围隔离): 这份判定原本在两个 service 里**各写了一份**
 *   (详情 `loadFeedbackBySchool` / 列表 `loadFeedbackStatesBySessionId`) —— 两份判定
 *   必然漂移: 列表说 78 分、详情说 80 分, 学员看到的是两张打架的卡片.
 *   而且两份都要"选默认流派 / 取码序最前" → 同一个排序写两遍, 改一处忘另一处就错.
 *   现在收进 domain 一处, 两个 service 只负责取行 + 映射成最小结构.
 *
 * 口径 (确定性优先 —— 同一份数据每次派生结果必须一致):
 *   1. 有失败记录 → parse_error (失败原因码取流派码序最靠前的那条)
 *   2. 否则有成功记录 → completed (分数取**默认流派 CBT**; 没有 CBT 时取流派码序最靠前的一个)
 *   3. 都没有 → null (还没有反馈记录)
 *
 * 为什么失败优先于成功: 用户看到的是"这份报告生成失败了", 让他手动重试;
 * 若成功优先, 他会看到"生成成功"但报告里缺了失败的那一份 —— 静默丢内容更难排查.
 *
 * @param rows 该会话的流派反馈行 (已映射成最小结构)
 * @returns 会话级反馈状态 (无记录 → null)
 */
export function resolveSchoolFeedbackState(rows: readonly SchoolFeedbackRow[]): SessionSchoolFeedbackState | null {
  const usable: {
    readonly code: SupervisionSchoolCode;
    readonly overallScore: number;
    readonly failureCode: SupervisionFailureCode | null;
  }[] = [];
  for (const row of rows) {
    if (row.schoolCode === null) {
      continue;
    }
    usable.push({ code: row.schoolCode, overallScore: row.overallScore, failureCode: row.failureCode });
  }
  const byCode = (a: { readonly code: SupervisionSchoolCode }, b: { readonly code: SupervisionSchoolCode }): number =>
    a.code.localeCompare(b.code);

  const failed = usable.filter((r) => r.failureCode !== null);
  if (failed.length > 0) {
    const first = failed.toSorted(byCode)[0];
    return {
      status: 'parse_error',
      overallScore: null,
      failureCode: first?.failureCode ?? SupervisionFailureCode.PARSE_FAILED,
    };
  }

  const succeeded = usable.filter((r) => r.failureCode === null);
  if (succeeded.length === 0) {
    return null;
  }
  const preferred = succeeded.find((r) => r.code === SupervisionSchoolCode.CBT) ?? succeeded.toSorted(byCode)[0];
  if (!preferred) {
    return null;
  }
  return { status: 'completed', overallScore: preferred.overallScore, failureCode: null };
}

/**
 * 报告状态派生结果 (对外出参).
 */
export interface SessionReportState {
  /** 对外状态 (4 档). */
  readonly status: SessionReportStatus;
  /** 报告总分 0-100; 仅 'completed' 时非 null, 其余一律 null (红线: 绝不补 0). */
  readonly overallScore: number | null;
  /** 失败原因码; 非失败态一律 null. */
  readonly failureCode: SupervisionFailureCode | null;
  /** 是否可手动重试 (仅 'parse_error' 且素材充足时为 true). */
  readonly retryable: boolean;
}

/**
 * 这条会话的「报告正身」是不是 agent 主报告链路.
 *
 * V2026-10-27 治本 (vpt 适用范围隔离, docs/progress/vpt-feedback-status-isolation-2026-10-27.md):
 *   事实依据 (读代码确认, 不是推测):
 *     · `vpt_voice` 会话由 voice 侧 `endSession → SupervisorProcessor` 触发 agent 主报告
 *       → 写 `supervision_reports` (六维评分 / 亮点 / 标注 / 风险线索) —— **有**主报告链路.
 *       counselor 侧的 4 流派反馈在 vpt 里是**附加**: 技术统计 (techStats) 的唯一来源
 *       + 多流派切换展示, 不是报告正身.
 *     · `training_session` / `long_term_case_session` **没有**主报告链路 (主报告只由
 *       voice 侧触发) → 它们的报告内容就是 4 流派反馈 (+ techStats + 移情标记).
 *   所以: vpt 的整体状态必须等主报告, 反馈的成败不参与判定 (否则会在主报告的
 *   异步窗口里提前判 completed / 误报 parse_error).
 *
 * 反双胞胎:
 *   - 不用"反馈有没有"反推: vpt 的反馈先落**不能**说明主报告不会来 (那是猜)
 *   - 不用 scenarioId 字面量: 场景标识由 `resolveSessionTypeByScenarioId` 归一, 本函数
 *     只认归一后的 sessionType, 避免两处各写一份字面量
 *
 * @param sessionType 归一后的会话类型
 * @returns true = 有主报告链路 (反馈只是附加, 不决定整体状态)
 */
export function resolveHasMainReportChannel(sessionType: SessionType): boolean {
  return sessionType === SessionType.VPT_VOICE;
}

/**
 * 报告状态归一 (**列表与详情共用的唯一派生处**).
 *
 * 判定优先级 (自上而下, 先命中先返回):
 *   1. 主报告行 completed  → completed (分数取主报告分)
 *   2. 主报告行 parse_error → parse_error (分数 null)
 *   3. 会话已结束 + 素材不足 → no_content (空局: 报告永远不会来, 不可重试)
 *   4. 4 流派反馈 parse_error → parse_error (带失败原因码)   ← 仅"报告正身 = 反馈"的会话
 *   5. 4 流派反馈 completed  → completed (分数取反馈分)      ← 仅"报告正身 = 反馈"的会话
 *   6. 还没有任何报告内容     → pending; 详情侧超陈旧阈值 → parse_error
 *
 * 第 4/5 档的适用性 (vpt 适用范围隔离, 2026-10-27):
 *   只有 `hasMainReportChannel = false` (单次训练 / 长程个案) 才走这两档 ——
 *   它们的报告正身就是这份反馈.
 *   vpt_voice (有主报告链路) **跳过**这两档: 主报告还没异步到达时保持 pending 等它,
 *   反馈的成功/失败都不改变整体 status, 也不拿反馈分当 overallScore.
 *   但反馈**照常读取** (技术统计 / 多流派展示不能丢), 只是不参与状态派生.
 *
 * 反双胞胎:
 *   - 不用 boolean `hasReport`: 表达不了"还没生成"/"生成失败"/"没有素材"三者的区别
 *   - 不在 service 里内联这段判断: 它是**纯函数** (无 IO), 内联进去就没法单测 ——
 *     而"永远 pending"正是本轮要治的 bug, 必须有测试锁住
 *   - 不让列表与详情各写一份: 两份判定必然漂移 (列表说 no_content、详情说 pending,
 *     学员看到的是两张打架的卡片)
 *   - 不用墙钟读当前时间: `nowMs` 由调用方传入, 函数保持纯粹 (可测 / 可重放)
 *   - 不用"反馈有没有"反推"有没有主报告链路": 那是**猜** (vpt 的反馈先落也不能说明
 *     主报告不会来); 场景位由调用方按事实注入
 *
 * @param input 派生入参 (全部为已取好的事实)
 * @returns 报告状态 / 分数 / 失败原因码 / 是否可重试
 */
export function resolveSessionReportState(input: SessionReportStateInput): SessionReportState {
  // 1-2. 主报告行 (agent 侧) 优先: 它是"报告"的正身.
  if (input.mainReport) {
    if (input.mainReport.status === 'completed') {
      return {
        status: 'completed',
        overallScore: normalizeOverallScore(input.mainReport.overallScore),
        failureCode: null,
        retryable: false,
      };
    }
    return {
      status: 'parse_error',
      overallScore: null,
      // 失败原因码优先取流派反馈的 (更具体: 上游不可用 / 限流 / 超时),
      // 没有才回落到主报告的通用解析失败.
      //
      // V2026-10-27 (vpt 适用范围隔离) 说明: 这条**只描述失败原因**, 不决定状态与分数 ——
      //   状态由主报告行决定 (第 2 档), 分数恒为 null.
      //   任务单「不能误删」明确只剥夺反馈对 reportStatus / overallScore 的决定权,
      //   失败原因码仍可取反馈的更具体码 (两条链路打的是同一个上游, 限流/超时这类信号
      //   对主报告的失败同样有解释力).
      failureCode: input.schoolFeedback?.failureCode ?? SupervisionFailureCode.PARSE_FAILED,
      retryable: isRetryable(input),
    };
  }

  // 3. 空局: 会话已结束 + 素材不足 → 报告永远不会生成 (spec 任务 C).
  if (isEmptySession(input)) {
    return { status: 'no_content', overallScore: null, failureCode: null, retryable: false };
  }

  // 4-5. 4 流派反馈 (counselor 侧): 仅当「报告正身就是这份反馈」时才参与派生
  //      (单次训练 / 长程个案). vpt_voice 有主报告链路 → 跳过这两档, 等主报告.
  //      注意: 反馈**仍然读取** (技术统计 / 多流派展示), 只是不决定整体状态与分数.
  if (!input.hasMainReportChannel && input.schoolFeedback) {
    if (input.schoolFeedback.status === 'parse_error') {
      return {
        status: 'parse_error',
        overallScore: null,
        failureCode: input.schoolFeedback.failureCode ?? SupervisionFailureCode.PARSE_FAILED,
        retryable: isRetryable(input),
      };
    }
    return {
      status: 'completed',
      overallScore: normalizeOverallScore(input.schoolFeedback.overallScore),
      failureCode: null,
      retryable: false,
    };
  }

  // 6. 还没有任何报告内容 → pending; 陈旧兜底只覆盖"worker 没跑 / 落库失败"这类漏网.
  if (input.applyStaleTimeout && input.endedAtMs !== null && input.nowMs - input.endedAtMs > input.stalePendingTimeoutMs) {
    return {
      status: 'parse_error',
      overallScore: null,
      failureCode: SupervisionFailureCode.TIMEOUT,
      retryable: isRetryable(input),
    };
  }
  return { status: 'pending', overallScore: null, failureCode: null, retryable: false };
}

/**
 * 是否空局 (会话已结束 + 素材低于最小可分析量).
 *
 * 会话**还没结束**时不判空局: 素材还在长, 提前判空会把"刚开始的会谈"误伤成空局.
 *
 * @param input 派生入参
 * @returns true = 空局
 */
function isEmptySession(input: SessionReportStateInput): boolean {
  if (input.sessionStatus !== TrainingSessionStatus.FINISHED) {
    return false;
  }
  if (input.material === null) {
    // 素材未知 → 无法证明"没有素材", 不判空局 (宁可多派一次 job, 不可错杀一场会谈).
    return false;
  }
  return isInsufficientMaterial(input.material, input.thresholds);
}

/**
 * 是否允许手动重试.
 *
 * 只有"有素材但生成失败"才可重试: 空局 (no_content) 重试多少次都是空,
 * 未结束 (interrupted) 的会话还没有可分析的完整素材.
 *
 * @param input 派生入参
 * @returns true = 可重试
 */
function isRetryable(input: SessionReportStateInput): boolean {
  if (input.material === null) {
    return true;
  }
  return !isInsufficientMaterial(input.material, input.thresholds);
}

/** 分数合法区间 (与 agent 侧写库时的校验同口径). */
const SCORE_MIN = 0;
/** 分数合法区间上界. */
const SCORE_MAX = 100;

/**
 * 分数归一: 只接受 0-100 的整数, 越界 / 非有限值一律 null.
 *
 * 为什么不原样透传: 分数是学员直接看到的数字, 一旦库里有脏值就会在卡片上显示
 * 一个"看起来正常但其实是脏数据"的分. 宁可显示"暂无分数" (null) 也不显示错分.
 *
 * @param score 原始分
 * @returns 合法分数或 null
 */
export function normalizeOverallScore(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return null;
  }
  const rounded = Math.round(score);
  if (rounded < SCORE_MIN || rounded > SCORE_MAX) {
    return null;
  }
  return rounded;
}
