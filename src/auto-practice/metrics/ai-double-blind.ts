// V2026-11-19 Phase2.5 AF-116 (AI 代理双盲评分与仲裁 · 可替换真人督导):
//   职责: 给"没有真人督导时先把双盲评分跑起来"提供一套**可复现、可替换**的纯函数:
//         R1 证据优先 / R2 整体叙事 / R3 只裁分歧; 输出统一为 1–5 分与证据引用.
//   边界: 纯函数 / 纯类型, 零 IO / 零网络 / 零 Nest; 不产生 PASS/FAIL, 不接硬门.
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
  summarizeAgreement,
  type AgreementSummary,
  type BlindPacket,
  type LongSessionDimension,
  type LongSessionReviewAnchor,
  type RatingPair,
} from './long-session-acceptance.js';
import { extractJsonPayload } from '../../shared/llm/llm-json-payload.js';

/** AI 代理评分版本; 改提示词/评分口径必须递增. */
export const AI_DOUBLE_BLIND_VERSION = 'ai-proxy-v1';

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
 * @param rater1 R1 输出
 * @param rater2 R2 输出
 * @param decisions 仲裁决定
 * @returns 最终分
 */
export function mergeFinalRating(
  rater1: AiRaterOutput,
  rater2: AiRaterOutput,
  decisions: readonly AiArbitrationDecision[] = [],
): AiFinalRating {
  if (rater1.packetId !== rater2.packetId) throw new Error('两位评分员的 packetId 不一致');
  const finalScores: Partial<Record<LongSessionDimension, number>> = {};
  const disputed: LongSessionDimension[] = [];
  for (const dimension of LONG_SESSION_DIMENSIONS) {
    const decision = decisions.find((item) => item.dimension === dimension);
    if (decision) {
      finalScores[dimension] = decision.final;
      disputed.push(dimension);
    } else {
      finalScores[dimension] = Math.round((rater1.scores[dimension] + rater2.scores[dimension]) / 2);
    }
  }
  const dimensionValues = LONG_SESSION_DIMENSIONS.map((dimension) => finalScores[dimension]!);
  const overall = Math.round(dimensionValues.reduce((sum, value) => sum + value, 0) / dimensionValues.length);
  return {
    packetId: rater1.packetId,
    scores: {
      trust: finalScores.trust!,
      safety: finalScores.safety!,
      bond: finalScores.bond!,
      depth: finalScores.depth!,
      verbal: finalScores.verbal!,
      style: finalScores.style!,
      overall,
    },
    disputedDimensions: disputed,
  };
}

/**
 * 计算 R1/R2 原始一致性与最终分对两位评分员的一致率.
 *
 * @param outputs 每个 packet 的 R1/R2/最终分
 * @returns 逐维与 overall 的一致性
 */
export function summarizeAiAgreement(outputs: readonly { rater1: AiRaterOutput; rater2: AiRaterOutput; final: AiFinalRating }[]): {
  readonly rawByDimension: Readonly<Record<LongSessionDimension, AgreementSummary>>;
  readonly rawOverall: AgreementSummary;
  readonly finalVsRater1: Readonly<Record<LongSessionDimension, AgreementSummary>>;
  readonly finalVsRater2: Readonly<Record<LongSessionDimension, AgreementSummary>>;
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
 *
 * @param input 角色 / packet / 锚点
 * @returns system + user
 */
export function buildRaterPrompt(input: RaterPromptInput): PromptPair {
  const anchors = input.anchors ?? LONG_SESSION_REVIEW_ANCHORS;
  const packetText = formatPacket(input.packet);
  const common = [
    `你是临床督导评分员 ${input.raterId}，正在对一段匿名心理咨询逐字稿做 1–5 分评分。`,
    `口径版本：${AI_DOUBLE_BLIND_VERSION}。`,
    '只依据逐字稿本身评分；不要推测来访者身份、诊断、职业或角色；不要给咨询建议。',
    '1=明显差，2=偏弱，3=可接受，4=良好，5=明显好。',
    `免责声明：${AI_DOUBLE_BLIND_DISCLAIMER}`,
    `口径边界：${LONG_SESSION_ACCEPTANCE_DISCLAIMER}`,
  ].join('\n');
  const roleSpecific =
    input.raterId === 'R1'
      ? [
          '评分方法：证据优先。对每个维度先在逐字稿里找一条最短的原文证据，再给分；找不到证据时给 3 分并在 concerns 里说明。',
          '不要用整体印象替代逐维证据。',
        ].join('\n')
      : [
          '评分方法：整体叙事。先通读整场，判断建立/工作/收尾三段各自是否成立，再给六维分；不要按 R1 的检查顺序逐条打勾。',
          '允许对同一维度给出与逐条证据不同的整体判断，但必须在 concerns 里写出理由。',
        ].join('\n');
  return {
    system: `${common}\n${roleSpecific}\n\n${outputSchema()}`,
    user: [
      `packet_id：${input.packet.packetId}`,
      '',
      '## 9 条观察锚点',
      formatAnchors(anchors, input.raterId === 'R2'),
      '',
      '## 匿名会谈记录',
      packetText,
      '',
      '## 输出要求',
      `只针对 packet_id=${input.packet.packetId} 输出一个 JSON 对象；六个维度与 overall 都必须是 1–5 的整数。`,
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
