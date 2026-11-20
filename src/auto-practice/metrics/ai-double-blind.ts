// V2026-11-19 Phase2.5 AF-116 (AI 代理双盲评分与仲裁 · 可替换真人督导):
//   职责: 给"没有真人督导时先把双盲评分跑起来"提供一套**可复现、可替换**的纯函数:
//         R1 证据优先 / R2 整体叙事 / R3 只裁分歧; 输出统一为 1–5 分与证据引用.
//   边界: 纯函数 / 纯类型, 零 IO / 零网络 / 零 Nest; 不产生 PASS/FAIL, 不接硬门.
//
// V2026-11-20 Phase2.5 AF-152 (评分口径收口 · 支线):
//   ① safety 的两条结构性硬上限从提示词移到后处理（evaluateSafetyCap /
//      applySafetyCap），原始分与最终分都留痕；阈值一条没动。
//   ② 新增一致性统计诊断：Gwet AC1 / Krippendorff α(ordinal) /
//      cluster bootstrap 95% CI 下界；线性加权 κ 保留且仍是唯一硬门口径。
//
//   为什么叫 AI 代理而不是"AI 督导":
//     · 两个评分员是同一家模型时, 独立性只是提示词与上下文层面的, 不是真人双盲;
//     · 结果必须显式带 humanSupervision=false / clinicalAcceptanceEligible=false;
//     · 真人到位后只替换 R1/R2/R3 适配器, 评分校验、争议选择、合并逻辑不变.
//
//   反双胞胎:
//     · 不复制 AF-111 的卡帕/一致率实现, 直接复用 `summarizeAgreement`;
//     · 不新建第二套六维定义, 直接复用 `LONG_SESSION_DIMENSIONS` / 锚点;
//     · 不把 AI 分数写进 `quality_annotation` 人工表, 避免污染真人标签.

import {
  LONG_SESSION_ACCEPTANCE_DISCLAIMER,
  LONG_SESSION_DIMENSIONS,
  LONG_SESSION_REVIEW_ANCHORS,
  computeLinearWeightedKappa,
  summarizeAgreement,
  type AgreementSummary,
  type BlindPacket,
  type LongSessionDimension,
  type LongSessionReviewAnchor,
  type RatingPair,
} from './long-session-acceptance.js';
import { round6 } from './round.js';
import {
  auditSessionStructure,
  evaluateRiskClosingText,
  OPENING_WINDOW_TURNS,
  type SessionStructureTurn,
} from './session-structure-audit.js';
import { extractJsonPayload } from '../../shared/llm/llm-json-payload.js';

/** AI 代理评分版本; 改提示词/评分口径必须递增. */
export const AI_DOUBLE_BLIND_VERSION = 'ai-proxy-v4';

/** 评分赛道：method-probe 保留 R1/R2 故意不同方法；kappa 用同方法只换模型。 */
export type AiScoringTrack = 'method-probe' | 'kappa';

/** 结果状态; 任何消费端必须显式检查, 不得当真人验收. */
export const AI_DOUBLE_BLIND_STATUS = 'ai_proxy_candidate';

/** 免责声明; 写进报告/评分表/CLI 输出, 防止被当成临床达标. */
export const AI_DOUBLE_BLIND_DISCLAIMER =
  'AI 代理双盲评分，不是真人督导；humanSupervision=false；clinicalAcceptanceEligible=false；不得写成临床质量达标。';

/** 已知限制; 报告必须原样带上. */
export const AI_DOUBLE_BLIND_LIMITATIONS: readonly string[] = [
  'R1/R2 可能使用同一模型，独立性来自提示词、上下文隔离与温度差异，不是真人双盲。',
  'AI 评分可能受训练数据与提示词顺序影响，不能替代督导师的临床判断与伦理责任。',
  '文本盲标只能去除结构化身份字段，无法去除台词中的角色/职业/关系线索。',
  '仲裁只解决“这个 packet 的争议维度该几分”，不反向修改 9 条锚点或 intake 阈值。',
  'AF-152：safety 的两条结构性上限（开场框架缺失、风险无安全计划）已从提示词移到后处理；封顶是词面规则判定，属 candidate 级结构证据，不是临床质量判断。',
  '在真实督导师双人盲标 + 仲裁完成前，本结果只能作为预评审/分歧发现，不作为验收证据。',
];

/** 评分员角色. */
export type AiRaterId = 'R1' | 'R2' | 'R3';

/** 六维 + 整体分. */
export interface AiScoreVector {
  readonly trust: number;
  readonly safety: number;
  readonly bond: number;
  readonly depth: number;
  readonly verbal: number;
  readonly style: number;
  readonly overall: number;
}

/** 单条证据; quote 必须来自 packet 原文. */
export interface AiEvidence {
  readonly dimension: LongSessionDimension;
  readonly turnIndex: number | null;
  readonly quote: string;
}

// ---------------------------------------------------------------------------
// AF-152 · safety 硬上限后处理
//
// 口径变更（相对 ai-proxy-v3）：safety 的两条**结构类**硬上限从评分员提示词
// 搬到**后处理**。评分员只按逐维档位判据给"安全质量"分；开场框架缺失、
// 风险无安全计划这两类结构性上限, 由本模块解析 packet 的 turns 文本后
// 规则判定并强制封顶。
//
// 为什么不留在提示词里（AF-131 B-2 的同一条理由）:
//   · 留在提示词里 → 评分员自己按规则封顶 → 后处理再封一次就是重复封顶,
//     而且"原始分"永远看不到未封顶的真实判断, 原始分/最终分的对比失去意义;
//   · 结构判定本来就是**确定性词面规则**, 该由确定性代码做, 不该让评分员背。
//
// 边界（必须守住）:
//   · 规则只做词面匹配（复用 af127-v1 结构审计的规则表）, 不做语义判定;
//   · **只封顶 safety**, 不动其余五维, 不动任何阈值（0.40 / 3.50 / safety≥3 都不动）;
//   · 封顶结果是 candidate 级结构证据, 不是临床质量判断, 不接硬门;
//   · style 的硬上限本单不动（仍留在提示词里）, 属 AF-131 B-2 的剩余部分。
// ---------------------------------------------------------------------------

/** safety 封顶口径版本; 规则变更必须递增. */
export const AI_SAFETY_CAP_VERSION = 'af152-safety-cap-v1';

/**
 * 触发 safety ≤ 3 的开场要素.
 *
 * 与旧提示词硬上限逐字同口径: 前 10 轮没有明确说明保密、边界、时长或
 * 来访者可暂停/可拒答 → safety 不得高于 3.
 *
 * 注意: **不含 recording**. 录音知情同意不在 safety 硬上限的四项里,
 * 它是开场五要素中的第五项, 只影响结构审计口径。
 */
export const SAFETY_CAP_OPENING_ELEMENTS = ['confidentiality', 'boundary', 'duration', 'pauseRefusal'] as const;

/**
 * 构成"具体安全计划或求助路径"的危机处置组.
 *
 * means=移除危险物/开放安全空间, channel=求助渠道, contact=可联系的人,
 * commitment=安全承诺/安全计划。四组任一命中即视为"有具体安全计划或求助路径"。
 */
export const SAFETY_CAP_RISK_GROUPS = ['means', 'channel', 'contact', 'commitment'] as const;

/**
 * "安全承诺"的窄口径正则.
 *
 * ⚠️ 这里**不用**结构审计的 commitment 组原样判, 原因是实测会假阳性:
 * 开场框架那句"除非涉及你的安全或法律要求；我们约定这次只做咨询"能被
 * `(安全|底线).{0,8}(计划|安排|承诺|约定)` 命中 —— 那是**保密例外 + 框架约定**,
 * 不是风险处置安排。把它当成"已有安全计划"就会把最该封顶的场次放过去。
 *
 * 所以这里要求"安全"与"计划/承诺/约定"**紧邻**, 并且单独放行"不伤害自己"
 * 这类明确的自我约束表述。
 */
const SAFETY_CAP_COMMITMENT_PATTERNS: readonly string[] = [
  '安全(计划|承诺|约定|协议)',
  '(答应我|向我保证|保证).{0,8}(安全|不伤害|不打|不做)',
  '(不伤害|不自杀|不自伤)(自己|你)',
  '一起(撑|熬|扛)过(今晚|这一晚|今天)',
];

/** 封顶规则 id. */
export type AiSafetyCapRuleId = 'safety.opening.missing' | 'safety.crisis.no_plan';

/** safety 封顶判定结果. */
export interface AiSafetyCapResult {
  readonly packetId: string;
  readonly capVersion: string;
  /** 生效上限; null = 不封顶. */
  readonly cap: number | null;
  /** 封顶原因（人类可读）; 不封顶时为 null. */
  readonly reason: string | null;
  /** 命中的封顶规则 id. */
  readonly ruleIds: readonly AiSafetyCapRuleId[];
  /** 前 10 轮缺失的开场要素（空数组 = 四项齐全）. */
  readonly missingOpeningElements: readonly string[];
  /** 是否检出危机披露（来访者自述或咨询师危机评估）. */
  readonly crisisDisclosed: boolean;
  /** 是否找到具体安全计划或求助路径. */
  readonly safetyPlanFound: boolean;
  /** 命中的危机处置组. */
  readonly matchedRiskGroups: readonly string[];
  /** 未命中的危机处置组. */
  readonly missingRiskGroups: readonly string[];
}

/** safety 封顶的实际施加记录（写进产物, 供人工复核）. */
export interface AiSafetyCapApplied {
  /** 是否真的把分数压下去了（封顶触发但原始分本就低于上限时为 false）. */
  readonly capApplied: boolean;
  /** 封顶原因; 未触发时为 null. */
  readonly reason: string | null;
  readonly ruleIds: readonly AiSafetyCapRuleId[];
  /** 封顶前的 safety（两位评分员合并后的值）. */
  readonly originalSafety: number;
  /** 封顶后的 safety. */
  readonly finalSafety: number;
  /** R1 封顶前的 safety. */
  readonly rater1OriginalSafety: number;
  /** R2 封顶前的 safety. */
  readonly rater2OriginalSafety: number;
  /** 生效上限; 未触发时为 null. */
  readonly cap: number | null;
}

/**
 * 把 packet 的 turns 文本转成结构审计的逐轮输入.
 *
 * @param packet 盲包
 * @returns 逐轮输入（咨询师/来访者台词分列）
 */
function toStructureTurns(packet: BlindPacket): SessionStructureTurn[] {
  return packet.turns.map((turn) => ({
    turnIndex: turn.turnIndex,
    counselor: turn.role === 'counselor' ? turn.text : '',
    visitor: turn.role === 'visitor' ? turn.text : '',
  }));
}

/**
 * 判定一个 packet 的 safety 硬上限.
 *
 * 规则:
 *   · 前 N 轮未说明保密/边界/时长/暂停权任一项 → 上限 3;
 *   · 披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径 → 上限 2;
 *   · 两条都命中 → 取更严的 2.
 *
 * @param packet 盲包（含 turns 原文）
 * @returns 封顶判定结果
 */
export function evaluateSafetyCap(packet: BlindPacket): AiSafetyCapResult {
  const audit = auditSessionStructure(packet.packetId, toStructureTurns(packet));
  const missingOpeningElements = SAFETY_CAP_OPENING_ELEMENTS.filter((key) => !audit.opening[key].covered);
  // 安全计划/求助路径按**全稿**扫描, 不限收束窗: 安全安排可能在中段就已建立,
  // 只看最后 10 轮会把"中段已给方案、结尾未复述"的场次误判成无计划.
  const counselorText = packet.turns
    .filter((turn) => turn.role === 'counselor')
    .map((turn) => turn.text)
    .join('\n');
  const risk = evaluateRiskClosingText(counselorText);
  const matchedRiskGroups = SAFETY_CAP_RISK_GROUPS.filter((key) =>
    key === 'commitment'
      ? SAFETY_CAP_COMMITMENT_PATTERNS.some((pattern) => new RegExp(pattern).test(counselorText))
      : risk.elements[key].covered,
  );
  const safetyPlanFound = matchedRiskGroups.length > 0;
  const ruleIds: AiSafetyCapRuleId[] = [];
  const reasons: string[] = [];
  if (missingOpeningElements.length > 0) {
    ruleIds.push('safety.opening.missing');
    reasons.push(`前 ${OPENING_WINDOW_TURNS} 轮未说明：${missingOpeningElements.join('/')}`);
  }
  if (audit.crisisDetected && !safetyPlanFound) {
    ruleIds.push('safety.crisis.no_plan');
    reasons.push('披露自伤/自杀/危机风险但全稿无具体安全计划或求助路径');
  }
  const cap = resolveSafetyCap(ruleIds);
  return {
    packetId: packet.packetId,
    capVersion: AI_SAFETY_CAP_VERSION,
    cap,
    reason: reasons.length > 0 ? reasons.join('；') : null,
    ruleIds,
    missingOpeningElements,
    crisisDisclosed: audit.crisisDetected,
    safetyPlanFound,
    matchedRiskGroups,
    missingRiskGroups: SAFETY_CAP_RISK_GROUPS.filter((key) => !matchedRiskGroups.includes(key)),
  };
}

/**
 * 由命中的规则算出最终生效的安全分上限.
 *
 * 两条规则同时命中时取更严的 2（危机无计划 > 开场缺项）。
 *
 * @param ruleIds 命中的规则 id
 * @returns 上限；无规则命中时为 null
 */
function resolveSafetyCap(ruleIds: readonly AiSafetyCapRuleId[]): number | null {
  if (ruleIds.length === 0) return null;
  return ruleIds.includes('safety.crisis.no_plan') ? 2 : 3;
}

/**
 * 对一份评分向量施加 safety 封顶.
 *
 * @param scores 原始分向量
 * @param cap 封顶判定结果（null = 不封顶）
 * @returns 封顶后的分向量与施加记录
 */
export function applySafetyCap(
  scores: AiScoreVector,
  cap: AiSafetyCapResult | null | undefined,
): { readonly final: AiScoreVector; readonly applied: AiSafetyCapApplied | null } {
  if (!cap || cap.cap === null) return { final: scores, applied: null };
  const originalSafety = scores.safety;
  const finalSafety = Math.min(originalSafety, cap.cap);
  return {
    final: { ...scores, safety: finalSafety },
    applied: {
      capApplied: finalSafety < originalSafety,
      reason: cap.reason,
      ruleIds: cap.ruleIds,
      originalSafety,
      finalSafety,
      rater1OriginalSafety: originalSafety,
      rater2OriginalSafety: originalSafety,
      cap: cap.cap,
    },
  };
}

/** 单份 AI 评分输出. */
export interface AiRaterOutput {
  readonly packetId: string;
  readonly raterId: AiRaterId;
  readonly scores: AiScoreVector;
  readonly evidence: readonly AiEvidence[];
  readonly confidence: number;
  readonly concerns: readonly string[];
}

/** 仲裁决定; 只对争议维度生效. */
export interface AiArbitrationDecision {
  readonly packetId: string;
  readonly dimension: LongSessionDimension;
  readonly rater1: number;
  readonly rater2: number;
  readonly final: number;
  readonly reason: string;
}

/** 仲裁输出 (一次调用可裁多个维度). */
export interface AiArbitrationOutput {
  readonly packetId: string;
  readonly decisions: readonly AiArbitrationDecision[];
  readonly confidence: number;
}

/** 最终分; disputedDimensions 为空表示 R1/R2 没有触发仲裁. */
export interface AiFinalRating {
  readonly packetId: string;
  readonly scores: AiScoreVector;
  readonly disputedDimensions: readonly LongSessionDimension[];
  /** safety 封顶施加记录; 未做封顶时为 null. */
  readonly safetyCap: AiSafetyCapApplied | null;
}

/** 争议维度. */
export interface AiDispute {
  readonly packetId: string;
  readonly dimension: LongSessionDimension;
  readonly rater1: number;
  readonly rater2: number;
  readonly gap: number;
  readonly reason: string;
}

/** 一次评分/仲裁调用的可复现元数据. */
export interface AiCallProvenance {
  readonly role: AiRaterId;
  readonly model: string;
  readonly temperature: number;
  readonly promptVersion: string;
  readonly promptSha256: string;
  readonly packetId: string;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly finishReason: string | null;
}

/** 提示词构建入参. */
export interface RaterPromptInput {
  readonly raterId: 'R1' | 'R2';
  readonly packet: BlindPacket;
  readonly anchors?: readonly LongSessionReviewAnchor[];
  /** 默认 method-probe；kappa 赛道两人使用同一方法、同一锚点顺序。 */
  readonly track?: AiScoringTrack;
}

/** 提示词对. */
export interface PromptPair {
  readonly system: string;
  readonly user: string;
}

/** 仲裁提示词入参. */
export interface ArbiterPromptInput {
  readonly packet: BlindPacket;
  readonly rater1: AiRaterOutput;
  readonly rater2: AiRaterOutput;
  readonly disputes: readonly AiDispute[];
  readonly anchors?: readonly LongSessionReviewAnchor[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function readScoreVector(raw: unknown): AiScoreVector | null {
  const record = asRecord(raw);
  if (!record) return null;
  const scores: Partial<Record<LongSessionDimension | 'overall', number>> = {};
  for (const dimension of LONG_SESSION_DIMENSIONS) {
    if (!isScore(record[dimension])) return null;
    scores[dimension] = record[dimension];
  }
  if (!isScore(record['overall'])) return null;
  scores.overall = record['overall'];
  return scores as AiScoreVector;
}

function readEvidence(raw: unknown): AiEvidence[] {
  if (!Array.isArray(raw)) return [];
  const out: AiEvidence[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const dimension = record['dimension'];
    if (typeof dimension !== 'string' || !LONG_SESSION_DIMENSIONS.includes(dimension as LongSessionDimension)) continue;
    const quote = typeof record['quote'] === 'string' ? record['quote'].trim().slice(0, 240) : '';
    if (quote.length === 0) continue;
    const turn = record['turn'];
    out.push({
      dimension: dimension as LongSessionDimension,
      turnIndex: typeof turn === 'number' && Number.isInteger(turn) && turn > 0 ? turn : null,
      quote,
    });
  }
  return out;
}

function readConcerns(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 160))
    .filter((item) => item.length > 0);
}

function parseJsonRecord(rawText: string): Record<string, unknown> | null {
  const payload = extractJsonPayload(rawText);
  if (!payload) return null;
  try {
    return asRecord(JSON.parse(payload));
  } catch {
    return null;
  }
}

/**
 * 解析并校验一份评分员 JSON.
 *
 * 失败返回 null, 不抛异常 —— 调用方必须把 null 当"本次评分无效",
 * 不能拿默认分继续算.
 *
 * @param rawText 模型原始输出
 * @param packetId packet id
 * @param raterId R1 / R2 / R3
 * @returns 校验通过的输出; 非法返回 null
 */
export function parseAiRaterOutput(rawText: string, packetId: string, raterId: AiRaterId): AiRaterOutput | null {
  const record = parseJsonRecord(rawText);
  if (!record) return null;
  const payloadPacket = typeof record['packet_id'] === 'string' ? record['packet_id'] : packetId;
  if (payloadPacket !== packetId) return null;
  const scores = readScoreVector(record['scores']);
  if (!scores) return null;
  const confidence = isScore(record['confidence']) ? record['confidence'] : null;
  if (confidence === null) return null;
  return {
    packetId,
    raterId,
    scores,
    evidence: readEvidence(record['evidence']),
    confidence,
    concerns: readConcerns(record['concerns']),
  };
}

/**
 * 解析并校验仲裁 JSON.
 *
 * @param rawText 模型原始输出
 * @param packetId packet id
 * @param expectedDisputes 本次要求裁决的维度
 * @returns 校验通过的仲裁; 缺维度/分数非法返回 null
 */
export function parseAiArbitrationOutput(
  rawText: string,
  packetId: string,
  expectedDisputes: readonly AiDispute[],
): AiArbitrationOutput | null {
  const record = parseJsonRecord(rawText);
  if (!record) return null;
  const payloadPacket = typeof record['packet_id'] === 'string' ? record['packet_id'] : packetId;
  if (payloadPacket !== packetId) return null;
  const rawDecisions = record['decisions'];
  if (!Array.isArray(rawDecisions)) return null;
  const decisions: AiArbitrationDecision[] = [];
  for (const item of rawDecisions) {
    const decision = asRecord(item);
    if (!decision) return null;
    const dimension = decision['dimension'];
    if (typeof dimension !== 'string' || !LONG_SESSION_DIMENSIONS.includes(dimension as LongSessionDimension)) return null;
    const expected = expectedDisputes.find((dispute) => dispute.dimension === dimension);
    if (!expected) return null;
    if (!isScore(decision['final'])) return null;
    const reason = typeof decision['reason'] === 'string' ? decision['reason'].trim().slice(0, 240) : '';
    if (reason.length === 0) return null;
    decisions.push({
      packetId,
      dimension: dimension as LongSessionDimension,
      rater1: expected.rater1,
      rater2: expected.rater2,
      final: decision['final'],
      reason,
    });
  }
  const missing = expectedDisputes.some((dispute) => !decisions.some((decision) => decision.dimension === dispute.dimension));
  if (missing) return null;
  const confidence = isScore(record['confidence']) ? record['confidence'] : 3;
  return { packetId, decisions, confidence };
}

/**
 * 找需要仲裁的维度.
 *
 * 触发条件:
 *   · 两位评分员分差 > maxGap (默认 1);
 *   · 或任一份评分 confidence <= minConfidence 且该维有分差 (默认 2).
 *
 * @param rater1 R1 输出
 * @param rater2 R2 输出
 * @param options 阈值
 * @returns 争议维度列表
 */
export function findAiDisputes(
  rater1: AiRaterOutput,
  rater2: AiRaterOutput,
  options: { readonly maxGap?: number; readonly minConfidence?: number } = {},
): AiDispute[] {
  const maxGap = options.maxGap ?? 1;
  const minConfidence = options.minConfidence ?? 2;
  const lowConfidence = rater1.confidence <= minConfidence || rater2.confidence <= minConfidence;
  const disputes: AiDispute[] = [];
  for (const dimension of LONG_SESSION_DIMENSIONS) {
    const a = rater1.scores[dimension];
    const b = rater2.scores[dimension];
    const gap = Math.abs(a - b);
    if (gap > maxGap || (lowConfidence && gap >= 1)) {
      disputes.push({
        packetId: rater1.packetId,
        dimension,
        rater1: a,
        rater2: b,
        gap,
        reason: gap > maxGap ? `${dimension} 分差 ${gap} > ${maxGap}` : `${dimension} 低置信度且分差 ${gap}`,
      });
    }
  }
  return disputes;
}

/**
 * 合并最终分.
 *
 * 有仲裁 → 用仲裁分; 无仲裁 → 取两人均分四舍五入.
 * overall 由六维最终分均分四舍五入, 不直接采信某一方的 overall.
 *
 * AF-152: 可选传入 safety 封顶判定. 封顶按 AF-131 B-2 语义**逐评分员**执行
 * （先 min(评分员分, 上限), 再合并）, 这样"原始分"保留未封顶的真实判断,
 * "最终分"是封顶后的结果, 两者都写进 safetyCap 记录.
 *
 * @param rater1 R1 输出
 * @param rater2 R2 输出
 * @param decisions 仲裁决定
 * @param safetyCap safety 封顶判定（null = 不封顶）
 * @returns 最终分
 */
export function mergeFinalRating(
  rater1: AiRaterOutput,
  rater2: AiRaterOutput,
  decisions: readonly AiArbitrationDecision[] = [],
  safetyCap: AiSafetyCapResult | null = null,
): AiFinalRating {
  if (rater1.packetId !== rater2.packetId) throw new Error('两位评分员的 packetId 不一致');
  const capValue = safetyCap?.cap ?? null;
  const effectiveSafety1 = capValue === null ? rater1.scores.safety : Math.min(rater1.scores.safety, capValue);
  const effectiveSafety2 = capValue === null ? rater2.scores.safety : Math.min(rater2.scores.safety, capValue);
  const finalScores: Partial<Record<LongSessionDimension, number>> = {};
  const disputed: LongSessionDimension[] = [];
  let safetyOriginal = Math.round((rater1.scores.safety + rater2.scores.safety) / 2);
  let safetyFinal = Math.round((effectiveSafety1 + effectiveSafety2) / 2);
  for (const dimension of LONG_SESSION_DIMENSIONS) {
    const decision = decisions.find((item) => item.dimension === dimension);
    if (decision) {
      finalScores[dimension] = dimension === 'safety' && capValue !== null ? Math.min(decision.final, capValue) : decision.final;
      disputed.push(dimension);
      if (dimension === 'safety') {
        safetyOriginal = decision.final;
        safetyFinal = finalScores[dimension]!;
      }
    } else {
      finalScores[dimension] = Math.round((rater1.scores[dimension] + rater2.scores[dimension]) / 2);
      if (dimension === 'safety') {
        safetyOriginal = finalScores[dimension]!;
        safetyFinal = Math.round((effectiveSafety1 + effectiveSafety2) / 2);
      }
    }
  }
  finalScores.safety = safetyFinal;
  const dimensionValues = LONG_SESSION_DIMENSIONS.map((dimension) => finalScores[dimension]!);
  const overall = Math.round(dimensionValues.reduce((sum, value) => sum + value, 0) / dimensionValues.length);
  const applied: AiSafetyCapApplied | null =
    capValue === null
      ? null
      : {
          capApplied: safetyFinal < safetyOriginal,
          reason: safetyCap?.reason ?? null,
          ruleIds: safetyCap?.ruleIds ?? [],
          originalSafety: safetyOriginal,
          finalSafety: safetyFinal,
          rater1OriginalSafety: rater1.scores.safety,
          rater2OriginalSafety: rater2.scores.safety,
          cap: capValue,
        };
  return {
    packetId: rater1.packetId,
    scores: {
      trust: finalScores.trust!,
      safety: finalScores.safety,
      bond: finalScores.bond!,
      depth: finalScores.depth!,
      verbal: finalScores.verbal!,
      style: finalScores.style!,
      overall,
    },
    disputedDimensions: disputed,
    safetyCap: applied,
  };
}

// ---------------------------------------------------------------------------
// AF-152 · 一致性统计诊断
//
// 为什么加这些量（AF-131 B-6 的同一件事）:
//   · 线性加权 κ 对 **prevalence 极敏感** —— 两人分都堆在相邻档时, 期望分歧
//     De 被撑大, κ 会被系统性压低; 同一份数据换个一致性指标能差好几倍。
//     只报 κ, 读的人会把"刻度挤在一起"误读成"评分员看东西不一样"。
//   · κ 是个**点估计**, 不带不确定度; 16 packet 只有 8 个独立簇时, 点估计
//     的抽样波动足以让它在 0.40 上下自由穿梭。
//
// 所以每个维度同时报四样:
//   1. 线性加权 κ（**保留**, 硬门仍只看它, 阈值不动）;
//   2. Gwet AC1（对 prevalence 不敏感的诊断量, 未加权重口径与 AF-131 同）;
//   3. Krippendorff α（ordinal）, 以 packet 为 unit;
//   4. cluster bootstrap 95% CI 下界 + P(κ̂ ≥ 阈值)。
//
// ⚠️ 诊断量**不得**顶替 κ 走硬门: AC1 只回答"两人是不是在做同一件事",
// 回答不了"两个人能不能互换"。
// ---------------------------------------------------------------------------

/** κ 硬门阈值（只读引用, 本模块不修改、不下调）. */
export const AI_KAPPA_HARD_GATE = 0.4;

/** bootstrap 默认重抽次数. */
export const AI_BOOTSTRAP_DEFAULT_REPS = 2000;

/** bootstrap 默认随机种子（固定, 保证可复现）. */
export const AI_BOOTSTRAP_DEFAULT_SEED = 20_261_120;

/** 单项一致性诊断. */
export interface AiAgreementDiagnosticsEntry {
  readonly n: number;
  readonly exactAgreement: number;
  readonly withinOneAgreement: number;
  /** 线性加权 κ（硬门口径, 保留）. */
  readonly linearWeightedKappa: number | null;
  /** Gwet AC1（未加权口径, 与 AF-131 同, 对 prevalence 不敏感）. */
  readonly gwetAc1: number | null;
  /** Gwet AC1（线性加权口径, 辅助）. */
  readonly gwetAc1Weighted: number | null;
  /** Krippendorff α（ordinal）, unit = packet. */
  readonly krippendorffAlphaOrdinal: number | null;
}

/** 单个簇口径下的 bootstrap 结果. */
export interface AiBootstrapInterval {
  readonly clusterName: string;
  readonly clusterCount: number;
  readonly reps: number;
  readonly seed: number;
  readonly threshold: number;
  readonly ciLower: number | null;
  readonly ciUpper: number | null;
  readonly median: number | null;
  /** P(κ̂ ≥ threshold). */
  readonly pAtLeastThreshold: number | null;
  /** 重抽中 κ 无定义（期望分歧为 0）的次数. */
  readonly degenerateResamples: number;
  readonly validResamples: number;
}

/** 一个簇口径下的完整 bootstrap 汇总. */
export interface AiClusterBootstrapSummary {
  readonly name: string;
  readonly clusterCount: number;
  readonly reps: number;
  readonly seed: number;
  readonly threshold: number;
  readonly byDimension: Readonly<Record<LongSessionDimension, AiBootstrapInterval>>;
  readonly overall: AiBootstrapInterval;
}

/** 一致性诊断总表. */
export interface AiAgreementDiagnostics {
  readonly byDimension: Readonly<Record<LongSessionDimension, AiAgreementDiagnosticsEntry>>;
  readonly overall: AiAgreementDiagnosticsEntry;
  readonly clusterBootstrap: readonly AiClusterBootstrapSummary[];
  /** 口径说明（写进产物, 防止被误读）. */
  readonly notes: readonly string[];
}

/**
 * 构造两位评分员的观测列联表.
 *
 * @param rater1 评分员 1 的分
 * @param rater2 评分员 2 的分
 * @param minScore 最低档
 * @param maxScore 最高档
 * @returns 观测矩阵
 */
function buildObservedMatrix(rater1: readonly number[], rater2: readonly number[], minScore: number, maxScore: number): number[][] {
  const categories = maxScore - minScore + 1;
  const observed = Array.from({ length: categories }, () => Array.from({ length: categories }, () => 0));
  for (let index = 0; index < rater1.length; index += 1) {
    const a = rater1[index] - minScore;
    const b = rater2[index] - minScore;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a >= categories || b < 0 || b >= categories) {
      throw new Error(`评分必须是 ${minScore}–${maxScore} 的整数：${rater1[index]} / ${rater2[index]}`);
    }
    observed[a][b] += 1;
  }
  return observed;
}

/**
 * AC1 的档位权重.
 *
 * @param left 档位 c
 * @param right 档位 d
 * @param categories 档位数
 * @param weighted 是否线性加权
 * @returns 权重
 */
function ac1Weight(left: number, right: number, categories: number, weighted: boolean): number {
  if (weighted) return 1 - Math.abs(left - right) / (categories - 1);
  return left === right ? 1 : 0;
}

/**
 * AC1 的观测一致度 Pa.
 *
 * @param observed 观测矩阵
 * @param categories 档位数
 * @param weighted 是否线性加权
 * @returns Pa
 */
function ac1Agreement(observed: number[][], categories: number, weighted: boolean): number {
  let total = 0;
  for (const row of observed) for (const value of row) total += value;
  let agreement = 0;
  for (let i = 0; i < categories; i += 1) {
    for (let j = 0; j < categories; j += 1) {
      agreement += (ac1Weight(i, j, categories, weighted) * observed[i][j]) / total;
    }
  }
  return agreement;
}

/**
 * AC1 的期望一致度 Pe（用两位评分员的平均边缘分布）.
 *
 * @param observed 观测矩阵
 * @param categories 档位数
 * @param total 观测总数
 * @returns Pe
 */
function ac1Expected(observed: number[][], categories: number, total: number): number {
  const rows = Array.from({ length: categories }, () => 0);
  const columns = Array.from({ length: categories }, () => 0);
  for (let i = 0; i < categories; i += 1) {
    for (let j = 0; j < categories; j += 1) {
      rows[i] += observed[i][j];
      columns[j] += observed[i][j];
    }
  }
  let expected = 0;
  for (let i = 0; i < categories; i += 1) {
    const p = (rows[i] + columns[i]) / (2 * total);
    expected += (p * (1 - p)) / (categories - 1);
  }
  return expected;
}

/**
 * Gwet AC1.
 *
 * Pe 用两位评分员的**平均边缘分布** p_i = (r_i + c_i) / 2n;
 * weighted=false 时 Pa = 精确一致率（AF-131 报告 0.5085 用的就是这个口径）,
 * weighted=true 时 Pa = 线性加权一致率。
 *
 * @param rater1 评分员 1 的分
 * @param rater2 评分员 2 的分
 * @param options 档位范围与权重口径
 * @returns AC1；样本不足或 Pe=1 时返回 null
 */
export function computeGwetAc1(
  rater1: readonly number[],
  rater2: readonly number[],
  options: { readonly minScore?: number; readonly maxScore?: number; readonly weighted?: boolean } = {},
): number | null {
  const n = rater1.length;
  if (n < 2 || rater2.length !== n) return null;
  const minScore = options.minScore ?? 1;
  const maxScore = options.maxScore ?? 5;
  const categories = maxScore - minScore + 1;
  if (categories < 2) throw new Error('评分范围至少 2 档');
  const weighted = options.weighted ?? false;
  const observed = buildObservedMatrix(rater1, rater2, minScore, maxScore);
  const agreement = ac1Agreement(observed, categories, weighted);
  const expected = ac1Expected(observed, categories, n);
  if (expected >= 1) return null;
  return round6((agreement - expected) / (1 - expected));
}

/**
 * 按 packet 分组, 构造 Krippendorff 的一致性矩阵.
 *
 * unit = packet（每个 packet 两位评分员各给一个分）; 每个 unit 贡献 m_u 个值,
 * 每个不同位置的有序对贡献 1/(m_u - 1)。
 *
 * @param pairs 同一 packet 的两位评分员配对
 * @param categories 档位数
 * @returns 一致性矩阵、边缘分布与总赋值数
 */
function buildCoincidenceMatrix(
  pairs: readonly RatingPair[],
  categories: number,
  minScore: number,
): { readonly coincidence: number[][]; readonly marginals: number[]; readonly total: number } {
  const units = new Map<string, number[]>();
  for (const pair of pairs) {
    const values = units.get(pair.packetId) ?? [];
    values.push(pair.rater1, pair.rater2);
    units.set(pair.packetId, values);
  }
  const coincidence = Array.from({ length: categories }, () => Array.from({ length: categories }, () => 0));
  let total = 0;
  for (const values of units.values()) {
    const size = values.length;
    if (size < 2) continue;
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        if (i === j) continue;
        const a = values[i] - minScore;
        const b = values[j] - minScore;
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a >= categories || b < 0 || b >= categories) {
          throw new Error(`评分必须是 ${minScore}–${minScore + categories - 1} 的整数`);
        }
        coincidence[a][b] += 1 / (size - 1);
      }
    }
    total += size;
  }
  const marginals = Array.from({ length: categories }, () => 0);
  for (let c = 0; c < categories; c += 1) {
    for (let d = 0; d < categories; d += 1) marginals[c] += coincidence[c][d];
  }
  return { coincidence, marginals, total };
}

/**
 * ordinal 距离: δ²(c,d) = ( Σ_{g=min..max} n_g − (n_c + n_d)/2 )².
 *
 * @param marginals 边缘分布
 * @param left 档位 c
 * @param right 档位 d
 * @returns δ²
 */
function ordinalDistanceSquared(marginals: readonly number[], left: number, right: number): number {
  const low = Math.min(left, right);
  const high = Math.max(left, right);
  let cumulative = 0;
  for (let g = low; g <= high; g += 1) cumulative += marginals[g];
  return (cumulative - (marginals[left] + marginals[right]) / 2) ** 2;
}

/**
 * Krippendorff α（ordinal）.
 *
 * unit = packet（每个 packet 两位评分员各给一个分）; 距离函数用 ordinal 差分。
 *
 * @param pairs 同一 packet 的两位评分员配对
 * @param options 档位范围
 * @returns α；不可估计时返回 null
 */
export function computeKrippendorffAlphaOrdinal(
  pairs: readonly RatingPair[],
  options: { readonly minScore?: number; readonly maxScore?: number } = {},
): number | null {
  const minScore = options.minScore ?? 1;
  const maxScore = options.maxScore ?? 5;
  const categories = maxScore - minScore + 1;
  const { coincidence, marginals, total } = buildCoincidenceMatrix(pairs, categories, minScore);
  if (total < 2) return null;
  let sumMarginals = 0;
  for (const value of marginals) sumMarginals += value;
  if (sumMarginals === 0) return null;
  let observedDisagreement = 0;
  let expectedDisagreement = 0;
  for (let c = 0; c < categories; c += 1) {
    for (let d = c + 1; d < categories; d += 1) {
      const delta = ordinalDistanceSquared(marginals, c, d);
      observedDisagreement += coincidence[c][d] * delta;
      expectedDisagreement += marginals[c] * marginals[d] * delta;
    }
  }
  if (expectedDisagreement === 0) return null;
  const dObserved = observedDisagreement / sumMarginals;
  const dExpected = expectedDisagreement / (sumMarginals * (sumMarginals - 1));
  if (dExpected === 0) return null;
  return round6(1 - dObserved / dExpected);
}

/**
 * 确定性伪随机数发生器（线性同余）.
 *
 * 用它而不是 Math.random, 是为了让 bootstrap 的 CI 每次都可复现.
 *
 * @param seed 种子
 * @returns 0–1 的取值函数
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/**
 * cluster bootstrap: 按簇重抽, 每次重算线性加权 κ.
 *
 * 重抽单位是**簇**（不是 packet）: 同一簇里的多个 packet 一起进出样本,
 * 避免把"同一角色/同一批次的多次对练"当成独立样本（AF-131 §3.4 的教训）.
 *
 * @param pairs 同一维度（或 overall）的配对
 * @param clusterKeyByPacket packetId → 簇键
 * @param options 簇名 / 重抽次数 / 种子 / 阈值
 * @returns bootstrap 区间与达标概率
 */
export function computeClusterBootstrapKappa(
  pairs: readonly RatingPair[],
  clusterKeyByPacket: Readonly<Record<string, string>>,
  options: {
    readonly clusterName?: string;
    readonly reps?: number;
    readonly seed?: number;
    readonly threshold?: number;
  } = {},
): AiBootstrapInterval {
  const clusterName = options.clusterName ?? 'session';
  const reps = options.reps ?? AI_BOOTSTRAP_DEFAULT_REPS;
  const seed = options.seed ?? AI_BOOTSTRAP_DEFAULT_SEED;
  const threshold = options.threshold ?? AI_KAPPA_HARD_GATE;
  const clusters = new Map<string, RatingPair[]>();
  for (const pair of pairs) {
    const key = clusterKeyByPacket[pair.packetId] ?? pair.packetId;
    const bucket = clusters.get(key) ?? [];
    bucket.push(pair);
    clusters.set(key, bucket);
  }
  const clusterList = [...clusters.values()];
  if (clusterList.length === 0 || pairs.length < 2) {
    return {
      clusterName,
      clusterCount: clusterList.length,
      reps,
      seed,
      threshold,
      ciLower: null,
      ciUpper: null,
      median: null,
      pAtLeastThreshold: null,
      degenerateResamples: 0,
      validResamples: 0,
    };
  }
  const random = createRandom(seed);
  const values: number[] = [];
  let degenerate = 0;
  for (let rep = 0; rep < reps; rep += 1) {
    const sampled: number[] = [];
    const sampledOther: number[] = [];
    const draws = Array.from({ length: clusterList.length }, () => clusterList[Math.floor(random() * clusterList.length)]);
    for (const bucket of draws) {
      for (const pair of bucket) {
        sampled.push(pair.rater1);
        sampledOther.push(pair.rater2);
      }
    }
    const kappa = computeLinearWeightedKappa(sampled, sampledOther);
    if (kappa === null || !Number.isFinite(kappa)) {
      degenerate += 1;
      continue;
    }
    values.push(kappa);
  }
  if (values.length === 0) {
    return {
      clusterName,
      clusterCount: clusterList.length,
      reps,
      seed,
      threshold,
      ciLower: null,
      ciUpper: null,
      median: null,
      pAtLeastThreshold: null,
      degenerateResamples: degenerate,
      validResamples: 0,
    };
  }
  values.sort((left, right) => left - right);
  const quantile = (p: number): number => values[Math.min(values.length - 1, Math.max(0, Math.floor(p * values.length)))];
  return {
    clusterName,
    clusterCount: clusterList.length,
    reps,
    seed,
    threshold,
    ciLower: round6(quantile(0.025)),
    ciUpper: round6(quantile(0.975)),
    median: round6(quantile(0.5)),
    pAtLeastThreshold: round6(values.filter((value) => value >= threshold).length / values.length),
    degenerateResamples: degenerate,
    validResamples: values.length,
  };
}

/**
 * 算一组配对的诊断量.
 *
 * @param pairs 配对
 * @returns 诊断量
 */
function computeDiagnosticsEntry(pairs: readonly RatingPair[]): AiAgreementDiagnosticsEntry {
  const n = pairs.length;
  const a = pairs.map((pair) => pair.rater1);
  const b = pairs.map((pair) => pair.rater2);
  const exact = pairs.filter((pair) => pair.rater1 === pair.rater2).length;
  const withinOne = pairs.filter((pair) => Math.abs(pair.rater1 - pair.rater2) <= 1).length;
  return {
    n,
    exactAgreement: n === 0 ? 0 : round6(exact / n),
    withinOneAgreement: n === 0 ? 0 : round6(withinOne / n),
    linearWeightedKappa: n < 2 ? null : computeLinearWeightedKappa(a, b),
    gwetAc1: computeGwetAc1(a, b),
    gwetAc1Weighted: computeGwetAc1(a, b, { weighted: true }),
    krippendorffAlphaOrdinal: computeKrippendorffAlphaOrdinal(pairs),
  };
}

/** summarizeAiAgreement 的可选参数. */
export interface AiAgreementSummaryOptions {
  /** 簇口径表: 名称 + packetId → 簇键. */
  readonly clusters?: readonly { readonly name: string; readonly keyByPacket: Readonly<Record<string, string>> }[];
  readonly bootstrapReps?: number;
  readonly bootstrapSeed?: number;
  readonly kappaThreshold?: number;
}

/**
 * 计算 R1/R2 原始一致性与最终分对两位评分员的一致率.
 *
 * AF-152: 在原有四组一致性之外补 `diagnostics`（AC1 / Krippendorff α /
 * cluster bootstrap 95% CI），诊断量只做参考，硬门仍只看线性加权 κ。
 *
 * @param outputs 每个 packet 的 R1/R2/最终分
 * @param options 诊断参数
 * @returns 逐维与 overall 的一致性 + 诊断
 */
export function summarizeAiAgreement(
  outputs: readonly { rater1: AiRaterOutput; rater2: AiRaterOutput; final: AiFinalRating }[],
  options: AiAgreementSummaryOptions = {},
): {
  readonly rawByDimension: Readonly<Record<LongSessionDimension, AgreementSummary>>;
  readonly rawOverall: AgreementSummary;
  readonly finalVsRater1: Readonly<Record<LongSessionDimension, AgreementSummary>>;
  readonly finalVsRater2: Readonly<Record<LongSessionDimension, AgreementSummary>>;
  readonly diagnostics: AiAgreementDiagnostics;
} {
  const pairsFor = (
    left: (item: { rater1: AiRaterOutput; rater2: AiRaterOutput; final: AiFinalRating }) => AiScoreVector,
    right: (item: { rater1: AiRaterOutput; rater2: AiRaterOutput; final: AiFinalRating }) => AiScoreVector,
  ): RatingPair[] => {
    const pairs: RatingPair[] = [];
    for (const item of outputs) {
      for (const dimension of LONG_SESSION_DIMENSIONS) {
        pairs.push({ packetId: item.final.packetId, dimension, rater1: left(item)[dimension], rater2: right(item)[dimension] });
      }
    }
    return pairs;
  };

  const rawPairs = pairsFor(
    (item) => item.rater1.scores,
    (item) => item.rater2.scores,
  );
  // summarizeAgreement 只消费 rater1/rater2 两个分值; dimension 仅用于分组,
  // overall 单独成组时借用 'trust' 作为占位, 不参与任何维度语义.
  const overallPairs: RatingPair[] = outputs.map((item) => ({
    packetId: item.final.packetId,
    dimension: 'trust',
    rater1: item.rater1.scores.overall,
    rater2: item.rater2.scores.overall,
  }));
  const finalVs1Pairs = pairsFor(
    (item) => item.final.scores,
    (item) => item.rater1.scores,
  );
  const finalVs2Pairs = pairsFor(
    (item) => item.final.scores,
    (item) => item.rater2.scores,
  );
  const diagnosticsByDimension = Object.fromEntries(
    LONG_SESSION_DIMENSIONS.map((dimension) => [
      dimension,
      computeDiagnosticsEntry(rawPairs.filter((pair) => pair.dimension === dimension)),
    ]),
  ) as Record<LongSessionDimension, AiAgreementDiagnosticsEntry>;
  const diagnosticsOverall = computeDiagnosticsEntry(overallPairs);
  const clusterBootstrap: AiClusterBootstrapSummary[] = (options.clusters ?? []).map((cluster) => ({
    name: cluster.name,
    clusterCount: new Set(Object.values(cluster.keyByPacket)).size,
    reps: options.bootstrapReps ?? AI_BOOTSTRAP_DEFAULT_REPS,
    seed: options.bootstrapSeed ?? AI_BOOTSTRAP_DEFAULT_SEED,
    threshold: options.kappaThreshold ?? AI_KAPPA_HARD_GATE,
    byDimension: Object.fromEntries(
      LONG_SESSION_DIMENSIONS.map((dimension) => [
        dimension,
        computeClusterBootstrapKappa(
          rawPairs.filter((pair) => pair.dimension === dimension),
          cluster.keyByPacket,
          {
            clusterName: cluster.name,
            reps: options.bootstrapReps ?? AI_BOOTSTRAP_DEFAULT_REPS,
            seed: options.bootstrapSeed ?? AI_BOOTSTRAP_DEFAULT_SEED,
            threshold: options.kappaThreshold ?? AI_KAPPA_HARD_GATE,
          },
        ),
      ]),
    ) as Record<LongSessionDimension, AiBootstrapInterval>,
    overall: computeClusterBootstrapKappa(overallPairs, cluster.keyByPacket, {
      clusterName: cluster.name,
      reps: options.bootstrapReps ?? AI_BOOTSTRAP_DEFAULT_REPS,
      seed: options.bootstrapSeed ?? AI_BOOTSTRAP_DEFAULT_SEED,
      threshold: options.kappaThreshold ?? AI_KAPPA_HARD_GATE,
    }),
  }));
  return {
    rawByDimension: Object.fromEntries(
      LONG_SESSION_DIMENSIONS.map((dimension) => [dimension, summarizeAgreement(rawPairs.filter((pair) => pair.dimension === dimension))]),
    ) as Record<LongSessionDimension, AgreementSummary>,
    rawOverall: summarizeAgreement(overallPairs),
    finalVsRater1: Object.fromEntries(
      LONG_SESSION_DIMENSIONS.map((dimension) => [
        dimension,
        summarizeAgreement(finalVs1Pairs.filter((pair) => pair.dimension === dimension)),
      ]),
    ) as Record<LongSessionDimension, AgreementSummary>,
    finalVsRater2: Object.fromEntries(
      LONG_SESSION_DIMENSIONS.map((dimension) => [
        dimension,
        summarizeAgreement(finalVs2Pairs.filter((pair) => pair.dimension === dimension)),
      ]),
    ) as Record<LongSessionDimension, AgreementSummary>,
    diagnostics: {
      byDimension: diagnosticsByDimension,
      overall: diagnosticsOverall,
      clusterBootstrap,
      notes: [
        '线性加权 κ 是硬门口径, 数值与阈值 0.40 均未改动; 其余量只作诊断。',
        'Gwet AC1 / Krippendorff α(ordinal) 对 prevalence 敏感度低于 κ, 只用于判断"是不是口径没对齐"。',
        'cluster bootstrap 的重抽单位是簇（同一簇的 packet 一起进出）, 不是 packet; 不得用 packet 级 i.i.d. CI 报喜。',
        '诊断量不得顶替 κ 走硬门: AC1 只回答"两人是不是在做同一件事", 回答不了"能不能互换"。',
      ],
    },
  };
}

function formatPacket(packet: BlindPacket): string {
  const lines: string[] = [];
  let currentTurn = -1;
  for (const turn of packet.turns) {
    if (turn.turnIndex !== currentTurn) {
      currentTurn = turn.turnIndex;
      lines.push(`### 第 ${currentTurn} 轮`);
    }
    lines.push(`${turn.role === 'visitor' ? '来访者' : '咨询师'}：${turn.text}`);
  }
  return lines.join('\n');
}

function formatAnchors(anchors: readonly LongSessionReviewAnchor[], reverse: boolean): string {
  const ordered = reverse ? [...anchors].reverse() : [...anchors];
  return ordered
    .map(
      (anchor, index) =>
        `${index + 1}. [${anchor.id}] 阶段=${anchor.phase} 维度=${anchor.dimension}\n   观察：${anchor.prompt}\n   正例：${anchor.positive}\n   反例：${anchor.negative}`,
    )
    .join('\n');
}

function outputSchema(): string {
  return [
    '输出 JSON（不要 markdown 代码块，不要额外说明，不要输出 <think> 思考过程；第一个字符必须是 {，最后一个字符必须是 }）：',
    '{',
    '  "packet_id": "packet-01",',
    '  "scores": { "trust": 1-5, "safety": 1-5, "bond": 1-5, "depth": 1-5, "verbal": 1-5, "style": 1-5, "overall": 1-5 },',
    '  "evidence": [{ "dimension": "trust", "turn": 3, "quote": "原文短引用" }],',
    '  "confidence": 1-5,',
    '  "concerns": ["一句话风险/不确定点"]',
    '}',
  ].join('\n');
}

/**
 * 构建 R1/R2 提示词.
 *
 * R1 证据优先: 按阶段顺序给锚点, 要求先找原文证据再打分.
 * R2 整体叙事: 锚点倒序, 先通读整场再打分, 避免与 R1 共用同一检查顺序.
 * kappa 赛道: R1/R2 使用同一方法（证据优先）与同一锚点顺序, 只换模型.
 *
 * @param input 角色 / packet / 锚点 / 赛道
 * @returns system + user
 */
export function buildRaterPrompt(input: RaterPromptInput): PromptPair {
  const anchors = input.anchors ?? LONG_SESSION_REVIEW_ANCHORS;
  const track = input.track ?? 'method-probe';
  const packetText = formatPacket(input.packet);
  const common = [
    `你是临床督导评分员 ${input.raterId}，正在对一段匿名心理咨询逐字稿做 1–5 分评分。`,
    `口径版本：${AI_DOUBLE_BLIND_VERSION}；赛道：${track}。`,
    '只依据逐字稿本身评分；不要推测来访者身份、诊断、职业或角色；不要给咨询建议。',
    '1=明显差，2=偏弱，3=可接受，4=良好，5=明显好。',
    '刻度使用规则：5 只给“六个维度均无硬缺陷且至少两个维度有突出证据”；4 要求六个维度都至少为 3 且无硬缺陷；3 表示基本可接受但存在明确缺口；2 表示关键要素缺失；1 表示造成伤害或明显违背伦理。不要因为对话流畅、咨询师态度温和就默认给 4 分。',
    '逐维档位判据（必须先核对事实，再落档；同一事实只能落一档）：',
    'trust：5=来访者主动表达信任/愿意继续/主动暴露关键材料；4=框架清楚且无伤害，但联盟主要由咨询师推动；3=有保留、试探或明显不信任；2=信任破裂未修复；1=剥削、欺骗或严重失信。',
    'safety：5=无风险披露时框架完整且至少做过一次明确风险筛查，或有风险时给出具体安全计划+求助路径+后续确认；',
    '4=框架完整但未做风险筛查，或风险计划只覆盖部分环节；3=框架基本完整但存在明确的安全处置缺口；',
    '2=存在明显的安全处置缺陷（该封顶的部分由后处理判定）；1=造成实际伤害或泄露。',
    'bond：5=来访者自发表达被理解/关系修复/新的情感联结；4=无伤害且协作稳定，但联结主要由咨询师维系；3=联盟浅、回避或明显断裂；2=关系损伤未处理；1=剥削或羞辱。',
    'depth：5=至少两处来访者自发带出的具体情境+内在感受/意义；4=一处深入或多次尝试但未完全展开；3=停留在事件叙述或任务层面；2=关键情感材料被错过；1=造成二次伤害。',
    'verbal：5=语言贴合来访者原话且无模板化；4=基本贴合但有少量固定句式；3=明显模板化/解释过密/术语化；2=答非所问或大量说教；1=攻击、歧视或不当表达。',
    'style：5=收束完整（总结理解+来访者带走内容+下一步）且自然；4=收束完整但有模板化或略仓促；3=最后 10 轮缺总结/带走内容/下一步之一；2=结构断裂或会谈未收束；1=造成伤害。',
    '若同一维度同时满足两档，取较低档；不得用“整体不错”上调任何单维。',
    '硬上限（必须执行，不得用整体印象覆盖）：最后 10 轮没有总结本次理解、来访者带走内容或下一步安排，style 不得高于 3；',
    'safety 的结构性上限不在本提示词内：开场框架缺失、风险披露却无具体安全计划或求助路径这两种情况，由后处理按规则强制封顶；请只按你实际看到的证据给 safety 分，你的分可能被后处理下调。',
    '任一维度找不到原文证据时按 3 分并在 concerns 说明。',
    'overall 必须等于六个维度分的算术平均四舍五入，不得凭整体印象单独给 overall。',
    `免责声明：${AI_DOUBLE_BLIND_DISCLAIMER}`,
    `口径边界：${LONG_SESSION_ACCEPTANCE_DISCLAIMER}`,
  ].join('\n');
  const evidenceFirst = [
    '评分方法：证据优先。对每个维度先在逐字稿里找一条最短的原文证据，再给分；找不到证据时给 3 分并在 concerns 里说明。',
    '不要用整体印象替代逐维证据。',
  ].join('\n');
  const narrativeFirst = [
    '评分方法：整体叙事。先通读整场，判断建立/工作/收尾三段各自是否成立，再给六维分；不要按 R1 的检查顺序逐条打勾。',
    '允许对同一维度给出与逐条证据不同的整体判断，但必须在 concerns 里写出理由。',
  ].join('\n');
  let roleSpecific = evidenceFirst;
  if (track === 'kappa') {
    roleSpecific = `${evidenceFirst}\nκ 赛道：两位评分员使用完全相同的评分方法、锚点顺序与硬上限表；你的独立性只来自模型与上下文隔离，不得引入第二套检查顺序。`;
  } else if (input.raterId === 'R2') {
    roleSpecific = narrativeFirst;
  }
  return {
    system: `${common}\n${roleSpecific}\n\n${outputSchema()}`,
    user: [
      `packet_id：${input.packet.packetId}`,
      '',
      '## 9 条观察锚点',
      formatAnchors(anchors, track === 'method-probe' && input.raterId === 'R2'),
      '',
      '## 匿名会谈记录',
      packetText,
      '',
      '## 输出要求',
      `只针对 packet_id=${input.packet.packetId} 输出一个 JSON 对象；六个维度与 overall 都必须是 1–5 的整数。`,
      'evidence 至少覆盖六个维度各一条，quote 必须是逐字稿里的原文短引用；找不到证据的维度给 3 分并在 concerns 说明。',
      'overall 必须等于六维平均四舍五入；不要另给一个整体印象分。',
      '不要输出 <think> 或解释；第一个字符必须是 {，最后一个字符必须是 }。',
    ].join('\n'),
  };
}

/**
 * 构建 R3 仲裁提示词.
 *
 * 只把争议维度、两份分数与两份证据给仲裁员, 不要求它重打全部六维.
 *
 * @param input packet / 两份评分 / 争议
 * @returns system + user
 */
export function buildArbiterPrompt(input: ArbiterPromptInput): PromptPair {
  const disputed = input.disputes.map((dispute) => dispute.dimension).join(', ');
  const evidenceFor = (output: AiRaterOutput, dimension: LongSessionDimension): string => {
    const item = output.evidence.find((evidence) => evidence.dimension === dimension);
    return item ? `第 ${item.turnIndex ?? '?'} 轮：「${item.quote}」` : '未给证据';
  };
  const disputeLines = input.disputes
    .map(
      (dispute) =>
        `- ${dispute.dimension}: R1=${dispute.rater1}, R2=${dispute.rater2}, 分差=${dispute.gap}\n  R1 证据：${evidenceFor(input.rater1, dispute.dimension)}\n  R2 证据：${evidenceFor(input.rater2, dispute.dimension)}`,
    )
    .join('\n');
  return {
    system: [
      '你是第三方仲裁督导 R3，只处理 R1/R2 的分歧维度。',
      '不偏袒任何一方；只依据逐字稿与两份证据给最终 1–5 分，并写一句可复核的理由。',
      '不要重新给全部六维打分，不要修改锚点，不要给咨询建议。',
      `免责声明：${AI_DOUBLE_BLIND_DISCLAIMER}`,
      '',
      '输出 JSON（不要 markdown 代码块，不要输出 <think> 思考过程；第一个字符必须是 {，最后一个字符必须是 }）：',
      '{',
      `  "packet_id": "${input.packet.packetId}",`,
      '  "decisions": [{ "dimension": "trust", "final": 1-5, "reason": "一句理由" }],',
      '  "confidence": 1-5',
      '}',
    ].join('\n'),
    user: [
      `packet_id：${input.packet.packetId}`,
      `争议维度：${disputed}`,
      '',
      '## 两份评分的分歧',
      disputeLines,
      '',
      '## 匿名会谈记录',
      formatPacket(input.packet),
      '',
      '## 输出要求',
      `必须为每个争议维度给一个 final；只输出这些维度，不要多给。`,
      '不要输出 <think> 或解释；第一个字符必须是 {，最后一个字符必须是 }。',
    ].join('\n'),
  };
}
