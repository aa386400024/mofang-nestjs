// V2026-11-21 建立 (AF-214 · R5 AI 双盲真人度评分协议):
//   职责: 给"AI 来访者像不像真实来访者"提供一份**可复现、可争议、可替换**的评分协议。
//
//   边界:
//     · 纯函数 / 纯类型，零 IO / 零网络 / 零 Nest；
//     · 只评来访者台词，不评咨询师技术，不作诊断，不输出临床结论；
//     · 分数与证据必须能回指 packet 原文；证据定位不到就判解析失败；
//     · 明确标注 AI 代理，不是真人督导。
//
//   为什么另起一套五维，而不是复用长会谈六维:
//     六维评的是"咨询质量"（信任/安全/联结/深度/言语/风格）。R5 要评的是
//     "来访者文本像不像真人"——自然度、情绪连续性、话轮形态、场景一致、关系在场。
//     把两套口径硬塞进同一个维度集合，会让分数既不能解释也不能复算。

import { createHash } from 'node:crypto';

import { computeLinearWeightedKappa } from './long-session-acceptance.js';
import { extractJsonPayload, stripThinkingTags } from '../../shared/llm/llm-json-payload.js';
import type { RealismScene } from '../../shared/realism/turn-shape-selector.js';

/** 评分协议版本；改锚点或提示词必须递增。 */
export const AI_REALISM_VERSION = 'ai-realism-v1';

/** AI 代理状态；任何消费端必须显式检查，不得当真人验收。 */
export const AI_REALISM_STATUS = 'ai_proxy_candidate';

/** 免责声明；写进报告与 CLI 输出。 */
export const AI_REALISM_DISCLAIMER =
  'AI 代理真人度评测，不是真人督导；humanSupervision=false；clinicalAcceptanceEligible=false；不得写成临床质量达标。';

/** 已知限制；报告必须原样带上。 */
export const AI_REALISM_LIMITATIONS: readonly string[] = [
  '两个评分员可能来自同一模型，独立性来自提示词、上下文隔离与温度差异，不是真人双盲。',
  'AI 评分受训练数据与提示词顺序影响，不能替代督导师对“像不像真人”的临床判断。',
  '盲标只能去除结构化身份字段，台词中的职业、关系、生活事件线索仍可能被识别。',
  '本协议只评文本表层与互动形态，不评诊断准确性、不评疗效、不评伦理责任。',
  '在真实督导师双人盲标 + 仲裁完成前，结果只能作为预评审与分歧发现。',
];

/** 五个观察维度。 */
export const REALISM_DIMENSIONS = ['naturalness', 'emotional_continuity', 'turn_shape', 'scene_congruence', 'relational_presence'] as const;

export type RealismDimension = (typeof REALISM_DIMENSIONS)[number];

/** 人读标签。 */
export const REALISM_DIMENSION_LABELS: Readonly<Record<RealismDimension, string>> = {
  naturalness: '自然度',
  emotional_continuity: '情绪连续性',
  turn_shape: '话轮形态',
  scene_congruence: '场景一致',
  relational_presence: '关系在场',
};

/** 1–5 整数分；所有评分入口共用，避免多处裸 union。 */
export type RealismScore = 1 | 2 | 3 | 4 | 5;

/** 逐维 1–5 锚点；必须写可观察行为，不写“好/差”这种空话。 */
export const REALISM_ANCHORS: Readonly<Record<RealismDimension, Readonly<Record<RealismScore, string>>>> = {
  naturalness: {
    1: '整段像成稿朗读：每轮结构完整、措辞均匀，没有口语节奏。',
    2: '偶尔有口语词，但句子仍像提前写好，停顿与填充不承担表达功能。',
    3: '能看出在说话，但节奏偏顺，犹豫像装饰而不是边想边说。',
    4: '多数轮次有真实口语节奏：短句、停顿、改口在需要时出现，不密集。',
    5: '几乎每轮都像现场说出来的：有呼吸感、有取舍，卡顿与流畅随状态变化。',
  },
  emotional_continuity: {
    1: '情绪突然跳档，上一轮还在防御，下一轮突然深情告白，缺少过渡。',
    2: '情绪大致对，但转折生硬，像按剧情需要换情绪。',
    3: '情绪能接上，偶尔有解释感；深层情绪出现得快、收得也快。',
    4: '情绪承接自然，有试探、回避、靠近的渐进，不是一次性交底。',
    5: '情绪像被上一轮真的推动：有迟滞、有反复，也有说不清的部分。',
  },
  turn_shape: {
    1: '每轮都是完整论述，几乎不短答、不反问、不沉默。',
    2: '以完整句为主，偶尔短答，但缺少真实话轮的收放。',
    3: '有短答和停顿，但分布均匀，像按模板轮换。',
    4: '话轮形态随状态变化：防御时短、松动时多，偶尔反问或停住。',
    5: '话轮像真人现场博弈：会躲、会试探、会只给半句，也会突然多说。',
  },
  scene_congruence: {
    1: '明显混入其他媒介：面对面场景出现消息、屏幕、发送、语音条。',
    2: '多数台词符合场景，但偶尔出现只属于其他场景的动作或媒介词。',
    3: '没有明显穿帮，但场景只停留在称呼层面，没有影响说话方式。',
    4: '说话方式与场景一致：面对面是出声口语，线上文字是短消息节奏。',
    5: '场景成为表达的一部分：同一句话在当面说和打字说有可感知差异。',
  },
  relational_presence: {
    1: '自说自话，对咨询师的话没有反应，像独白。',
    2: '偶尔回应咨询师，但主要是等待被问，缺少主动试探。',
    3: '能接住咨询师的话，但反应偏礼貌、偏配合。',
    4: '对咨询师有真实反应：信任、试探、阻抗、靠近随互动变化。',
    5: '关系在场感强：会因为对方一句话而停顿、改口、回避或靠近。',
  },
};

/** 盲评 packet 的单轮；不含角色/档位/session id。 */
export interface RealismPacketTurn {
  readonly turnIndex: number;
  readonly role: 'visitor' | 'counselor';
  readonly text: string;
}

/** 盲评 packet；场景标签是评分必需信息，其余身份字段一律不带。 */
export interface RealismBlindPacket {
  readonly packetId: string;
  readonly scene: RealismScene;
  readonly turns: readonly RealismPacketTurn[];
}

/** 单维评分 + 证据。 */
export interface RealismDimensionRating {
  readonly score: RealismScore;
  readonly evidence: {
    readonly turnIndex: number;
    readonly quote: string;
  };
}

/** 一份完整评分。 */
export interface RealismRating {
  readonly packetId: string;
  readonly dimensions: Readonly<Record<RealismDimension, RealismDimensionRating>>;
  readonly overall: number;
  readonly notes: readonly string[];
}

/** 解析结果。 */
export type RealismRatingParseResult =
  { readonly ok: true; readonly rating: RealismRating } | { readonly ok: false; readonly error: string };

/** 仲裁决定。 */
export interface RealismArbitrationDecision {
  readonly dimension: RealismDimension;
  readonly score: RealismScore;
  readonly reason: string;
}

/** 评分员提示词。 */
export interface RealismRaterPrompt {
  readonly system: string;
  readonly user: string;
}

/** 一致性摘要。 */
export interface RealismAgreement {
  readonly n: number;
  readonly exactAgreement: number;
  readonly withinOneAgreement: number;
  readonly linearWeightedKappa: number | null;
}

/** 场景标签。 */
const SCENE_LABELS: Readonly<Record<RealismScene, string>> = {
  in_person: '面对面咨询（同一个咨询室，直接出声说话）',
  online_voice: '线上实时语音咨询（能听见声音，不是打字）',
  online_text: '线上文字咨询（通过文字消息交流）',
};

/** 评分纪律（R1/R2 共用）。 */
const RATING_DISCIPLINE = [
  '禁止输出 <think>、推理过程、分析、自查或任何解释；直接从第一行维度=分数开始输出结果。',
  '你只评**来访者**的台词，不评咨询师技术、不评诊断、不评疗效。',
  '五维各给 1–5 的整数分；1 是最差，5 是最像真实来访者，3 是“能看出在演但不算出戏”。',
  '每一维必须给一条 evidence：从**来访者**台词里原样摘一句，quote 不得改写、不得拼接。',
  'evidence 的 turnIndex 必须是该句所在的轮次编号。找不到可引用原句就说明该维无法评分，不要编造。',
  '不要因为“咨询师说得不好”而压低来访者分数；也不要因为剧情感人而抬高。',
  '总体分是五维的整体印象，允许与单维均值不同，但必须给理由（notes 里一句话）。',
  '按行协议输出；不要解释评分理由，不要复述对话，不要输出分析过程。',
].join('\n');

/** 行协议输出契约；比 JSON 更不容易被模型写坏，且不鼓励长篇推理。 */
const OUTPUT_CONTRACT = [
  '输出格式：每个维度一行，不要 JSON、不要 markdown、不要解释、不要输出分析过程。',
  '维度=分数|轮次编号|原文短句（从该轮来访者台词里原样摘，不改写）',
  '最后两行：overall=分数，notes=一句话（可省略）。',
  '示例（只是格式，不要照抄内容）：',
  'naturalness=4|2|嗯……不太好',
  'emotional_continuity=3|4|胸口闷',
  'turn_shape=4|2|躺下就开始想工作',
  'scene_congruence=4|4|有时候会突然坐起来',
  'relational_presence=3|2|不太好',
  'overall=4',
  'notes=整体能接住咨询师的话。',
].join('\n');

function renderAnchors(): string {
  return REALISM_DIMENSIONS.map((dimension) => {
    const anchors = REALISM_ANCHORS[dimension];
    const lines = ([1, 2, 3, 4, 5] as const).map((score) => `${score} 分：${anchors[score]}`);
    return `### ${REALISM_DIMENSION_LABELS[dimension]}（${dimension}）\n${lines.join('\n')}`;
  }).join('\n\n');
}

function renderPacket(packet: RealismBlindPacket): string {
  const lines = packet.turns.map((turn) => `第 ${turn.turnIndex} 轮 ${turn.role === 'visitor' ? '来访者' : '咨询师'}：${turn.text}`);
  return [`场景：${SCENE_LABELS[packet.scene]}`, `packetId：${packet.packetId}`, '', lines.join('\n')].join('\n');
}

/**
 * 构造评分员提示词。
 *
 * @param packet 盲评包
 * @param raterId R1 证据优先 / R2 整体叙事
 * @returns system + user
 */
export function buildRealismRaterPrompt(packet: RealismBlindPacket, raterId: 'R1' | 'R2'): RealismRaterPrompt {
  const stance =
    raterId === 'R1'
      ? '你的方法是**证据优先**：先找具体台词证据，再给分；没有证据的维度不要凭印象打分。'
      : '你的方法是**整体叙事**：先通读整段互动，判断这个来访者有没有“一个人在现场说话”的整体感，再回到证据校准分数。';
  const system = [
    `你是心塑 AI 来访者真人度评测的 AI 评分员 ${raterId}。`,
    AI_REALISM_DISCLAIMER,
    stance,
    RATING_DISCIPLINE,
    '',
    '## 五维锚点',
    renderAnchors(),
    '',
    OUTPUT_CONTRACT,
  ].join('\n');
  const user = ['请按五维锚点给下面这段咨询对话里的来访者打分。', '', renderPacket(packet)].join('\n');
  return { system, user };
}

/**
 * 构造仲裁提示词。
 *
 * @param packet 盲评包
 * @param rater1 R1 评分
 * @param rater2 R2 评分
 * @param disputes 分歧维度
 * @returns system + user
 */
export function buildRealismArbiterPrompt(
  packet: RealismBlindPacket,
  rater1: RealismRating,
  rater2: RealismRating,
  disputes: readonly RealismDimension[],
): RealismRaterPrompt {
  const system = [
    '你是心塑 AI 来访者真人度评测的仲裁员 R3。',
    AI_REALISM_DISCLAIMER,
    '禁止输出 <think>、推理过程、分析或解释；直接从第一行 dimension=分数|理由 开始输出。',
    '你只裁分歧维度，不改没有分歧的分数，不重新发明锚点。',
    '仲裁必须依据 packet 原文；只能选 1–5 的整数分，并给一句理由。',
    '输出格式：每个分歧维度一行，dimension=分数|一句话理由；不要 JSON、不要解释流程。',
    '示例（只是格式）：naturalness=3|证据更支持中等。',
    '不要输出对话原文全文。',
  ].join('\n');
  const rows = disputes.map((dimension) => {
    const r1 = rater1.dimensions[dimension];
    const r2 = rater2.dimensions[dimension];
    return [
      `### ${REALISM_DIMENSION_LABELS[dimension]}（${dimension}）`,
      `R1：${r1.score} 分；证据「${r1.evidence.quote}」`,
      `R2：${r2.score} 分；证据「${r2.evidence.quote}」`,
      `锚点：${([1, 2, 3, 4, 5] as const).map((score) => `${score}=${REALISM_ANCHORS[dimension][score]}`).join(' / ')}`,
    ].join('\n');
  });
  const user = ['请只裁以下分歧维度。', '', renderPacket(packet), '', rows.join('\n\n')].join('\n');
  return { system, user };
}

function normalizeQuote(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function isIntegerScore(value: unknown): value is RealismScore {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

function validateDimensionEvidence(
  rawScore: unknown,
  rawTurnIndex: unknown,
  rawQuote: unknown,
  visitorTextByTurn: ReadonlyMap<number, string>,
  dimension: RealismDimension,
): { readonly ok: true; readonly rating: RealismDimensionRating } | { readonly ok: false; readonly error: string } {
  if (!isIntegerScore(rawScore)) return { ok: false, error: `score_invalid:${dimension}` };
  if (!Number.isInteger(rawTurnIndex)) return { ok: false, error: `evidence_turn_invalid:${dimension}` };
  if (typeof rawQuote !== 'string' || rawQuote.trim().length === 0) return { ok: false, error: `evidence_quote_missing:${dimension}` };
  const turnIndex = Number(rawTurnIndex);
  const quote = normalizeQuote(rawQuote);
  const turnText = visitorTextByTurn.get(turnIndex);
  if (turnText === undefined) return { ok: false, error: `evidence_turn_not_visitor:${dimension}` };
  if (!turnText.includes(quote)) return { ok: false, error: `evidence_not_in_turn:${dimension}` };
  if (quote.length > 120) return { ok: false, error: `evidence_quote_too_long:${dimension}` };
  return { ok: true, rating: { score: rawScore, evidence: { turnIndex, quote } } };
}

function visitorTextByTurnOf(packet: RealismBlindPacket): ReadonlyMap<number, string> {
  return new Map(packet.turns.filter((turn) => turn.role === 'visitor').map((turn) => [turn.turnIndex, normalizeQuote(turn.text)]));
}

/**
 * 解析行协议评分。
 *
 * 格式（每维一行，最后 overall / notes 各一行）：
 *   naturalness=4|2|嗯……不太好
 *   overall=4
 *   notes=整体能接住咨询师的话。
 *
 * @param raw 模型原始输出
 * @param packet 盲评包
 * @returns 解析结果
 */
export function parseRealismRatingLines(raw: string, packet: RealismBlindPacket): RealismRatingParseResult {
  const cleaned = stripThinkingTags(raw).replaceAll('```', '').replaceAll('**', '');
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lineByDimension = new Map<RealismDimension, string>();
  const dimensionPattern = new RegExp(String.raw`^(?:[-*•]\s*)?(${REALISM_DIMENSIONS.join('|')})\s*[=:]\s*(.+)$`, 'i');
  for (const line of lines) {
    const match = dimensionPattern.exec(line);
    if (!match) continue;
    const dimension = match[1].toLowerCase() as RealismDimension;
    if (!lineByDimension.has(dimension)) lineByDimension.set(dimension, match[2]);
  }
  const visitorTextByTurn = visitorTextByTurnOf(packet);
  const ratings = {} as Record<RealismDimension, RealismDimensionRating>;
  for (const dimension of REALISM_DIMENSIONS) {
    const payload = lineByDimension.get(dimension);
    if (payload === undefined) return { ok: false, error: `dimension_missing:${dimension}` };
    const [scoreRaw, turnRaw, ...rest] = payload.split('|');
    const quoteRaw = rest.join('|').trim();
    const checked = validateDimensionEvidence(
      Number(scoreRaw?.trim()),
      Number((turnRaw ?? '').trim()),
      quoteRaw,
      visitorTextByTurn,
      dimension,
    );
    if (!checked.ok) return checked;
    ratings[dimension] = checked.rating;
  }

  const overallLine = lines
    .map((line) => /^(?:[-*•]\s*)?overall\s*[=:]\s*(\d+)/i.exec(line))
    .find((match): match is RegExpExecArray => match !== null);
  if (!overallLine) return { ok: false, error: 'overall_invalid' };
  const overall = Number(overallLine[1]);
  if (!isIntegerScore(overall)) return { ok: false, error: 'overall_invalid' };
  const notesLine = lines.find((line) => /^(?:[-*•]\s*)?notes\s*[=:]/i.test(line));
  const notes = notesLine === undefined ? [] : [notesLine.replace(/^(?:[-*•]\s*)?notes\s*[=:]\s*/i, '').slice(0, 80)];
  return { ok: true, rating: { packetId: packet.packetId, dimensions: ratings, overall, notes } };
}

/**
 * 解析行协议仲裁。
 *
 * 格式：dimension=分数|一句话理由
 *
 * @param raw 模型原始输出
 * @param disputes 待裁维度
 * @returns 仲裁决定或错误
 */
export function parseRealismArbitrationLines(
  raw: string,
  disputes: readonly RealismDimension[],
): { readonly ok: true; readonly decisions: readonly RealismArbitrationDecision[] } | { readonly ok: false; readonly error: string } {
  const cleaned = stripThinkingTags(raw).replaceAll('```', '').replaceAll('**', '');
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const pattern = new RegExp(String.raw`^(?:[-*•]\s*)?(${REALISM_DIMENSIONS.join('|')})\s*[=:]\s*(\d)\s*\|\s*(.+)$`, 'i');
  const byDimension = new Map<RealismDimension, RealismArbitrationDecision>();
  for (const line of lines) {
    const match = pattern.exec(line);
    if (!match) continue;
    const dimension = match[1].toLowerCase() as RealismDimension;
    if (!disputes.includes(dimension) || byDimension.has(dimension)) continue;
    const score = Number(match[2]);
    if (!isIntegerScore(score)) return { ok: false, error: `decision_score_invalid:${dimension}` };
    byDimension.set(dimension, { dimension, score, reason: match[3].trim().slice(0, 120) });
  }
  const decisions: RealismArbitrationDecision[] = [];
  for (const dimension of disputes) {
    const decision = byDimension.get(dimension);
    if (decision === undefined) return { ok: false, error: `decision_missing:${dimension}` };
    decisions.push(decision);
  }
  return { ok: true, decisions };
}

/**
 * 解析评分员输出；优先 JSON（兼容结构化 provider），失败再按行协议。
 *
 * @param raw 模型原始输出
 * @param packet 盲评包
 * @returns 解析结果
 */
export function parseRealismRating(raw: string, packet: RealismBlindPacket): RealismRatingParseResult {
  const json = extractJsonPayload(raw);
  if (json !== null) {
    const parsedJson = parseRealismRatingJson(json, packet);
    if (parsedJson.ok) return parsedJson;
  }
  return parseRealismRatingLines(raw, packet);
}

function parseRealismRatingJson(json: string, packet: RealismBlindPacket): RealismRatingParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
    return { ok: false, error: position ? `json_parse_failed@${position}` : 'json_parse_failed' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'json_not_object' };
  const root = parsed as Record<string, unknown>;
  const dimensionsRaw = root['dimensions'];
  if (typeof dimensionsRaw !== 'object' || dimensionsRaw === null) return { ok: false, error: 'dimensions_missing' };
  const dimensions = dimensionsRaw as Record<string, unknown>;
  const visitorTurns = packet.turns.filter((turn) => turn.role === 'visitor');
  const byIndex = new Map(visitorTurns.map((turn) => [turn.turnIndex, normalizeQuote(turn.text)]));
  const ratings = {} as Record<RealismDimension, RealismDimensionRating>;

  for (const dimension of REALISM_DIMENSIONS) {
    const checked = parseJsonDimensionRating(dimensions[dimension], byIndex, dimension);
    if (!checked.ok) return checked;
    ratings[dimension] = checked.rating;
  }

  if (!Number.isInteger(root['overall']) || Number(root['overall']) < 1 || Number(root['overall']) > 5) {
    return { ok: false, error: 'overall_invalid' };
  }
  const notesRaw = root['notes'];
  const notes = Array.isArray(notesRaw) ? notesRaw.filter((note): note is string => typeof note === 'string').slice(0, 2) : [];
  return {
    ok: true,
    rating: {
      packetId: packet.packetId,
      dimensions: ratings,
      overall: Number(root['overall']),
      notes,
    },
  };
}

function parseJsonDimensionRating(
  item: unknown,
  byIndex: ReadonlyMap<number, string>,
  dimension: RealismDimension,
): { readonly ok: true; readonly rating: RealismDimensionRating } | { readonly ok: false; readonly error: string } {
  if (typeof item !== 'object' || item === null) return { ok: false, error: `dimension_missing:${dimension}` };
  const record = item as Record<string, unknown>;
  if (!isIntegerScore(record['score'])) return { ok: false, error: `score_invalid:${dimension}` };
  const evidenceRaw = record['evidence'];
  if (typeof evidenceRaw !== 'object' || evidenceRaw === null) return { ok: false, error: `evidence_missing:${dimension}` };
  const evidence = evidenceRaw as Record<string, unknown>;
  return validateDimensionEvidence(record['score'], evidence['turnIndex'], evidence['quote'], byIndex, dimension);
}

/**
 * 解析评分员 JSON；证据必须能在对应来访者轮次里原样定位。
 *
 * @param raw 模型原始输出
 * @param packet 盲评包
 * @returns 解析结果
 */
export function parseRealismRatingJsonOnly(raw: string, packet: RealismBlindPacket): RealismRatingParseResult {
  const json = extractJsonPayload(raw);
  if (json === null) return { ok: false, error: 'json_not_found' };
  return parseRealismRatingJson(json, packet);
}

/**
 * 解析仲裁 JSON。
 *
 * @param raw 模型原始输出
 * @param disputes 待裁维度
 * @returns 仲裁决定或错误
 */
export function parseRealismArbitration(
  raw: string,
  disputes: readonly RealismDimension[],
): { readonly ok: true; readonly decisions: readonly RealismArbitrationDecision[] } | { readonly ok: false; readonly error: string } {
  const json = extractJsonPayload(raw);
  if (json !== null) {
    const parsedJson = parseRealismArbitrationJson(json, disputes);
    if (parsedJson.ok) return parsedJson;
  }
  return parseRealismArbitrationLines(raw, disputes);
}

/**
 * 解析仲裁 JSON（仅 JSON，不做行协议回退）；供结构化 provider 与单测使用。
 *
 * @param raw 模型原始输出
 * @param disputes 待裁维度
 * @returns 仲裁决定或错误
 */
export function parseRealismArbitrationJsonOnly(
  raw: string,
  disputes: readonly RealismDimension[],
): { readonly ok: true; readonly decisions: readonly RealismArbitrationDecision[] } | { readonly ok: false; readonly error: string } {
  const json = extractJsonPayload(raw);
  if (json === null) return { ok: false, error: 'json_not_found' };
  return parseRealismArbitrationJson(json, disputes);
}

function parseRealismArbitrationJson(
  json: string,
  disputes: readonly RealismDimension[],
): { readonly ok: true; readonly decisions: readonly RealismArbitrationDecision[] } | { readonly ok: false; readonly error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
    return { ok: false, error: position ? `json_parse_failed@${position}` : 'json_parse_failed' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'json_not_object' };
  const root = parsed as Record<string, unknown>;
  const decisionsRaw = root['decisions'];
  if (typeof decisionsRaw !== 'object' || decisionsRaw === null) return { ok: false, error: 'decisions_missing' };
  const decisions = decisionsRaw as Record<string, unknown>;
  const out: RealismArbitrationDecision[] = [];
  for (const dimension of disputes) {
    const item = decisions[dimension];
    if (typeof item !== 'object' || item === null) return { ok: false, error: `decision_missing:${dimension}` };
    const record = item as Record<string, unknown>;
    if (!isIntegerScore(record['score'])) return { ok: false, error: `decision_score_invalid:${dimension}` };
    if (typeof record['reason'] !== 'string' || record['reason'].trim().length === 0) {
      return { ok: false, error: `decision_reason_missing:${dimension}` };
    }
    out.push({ dimension, score: record['score'], reason: record['reason'].trim() });
  }
  return { ok: true, decisions: out };
}

/**
 * 找分歧维度。
 *
 * @param rater1 R1 评分
 * @param rater2 R2 评分
 * @param threshold 分差阈值；默认 2
 * @returns 分歧维度
 */
export function findRealismDisputes(rater1: RealismRating, rater2: RealismRating, threshold = 2): readonly RealismDimension[] {
  return REALISM_DIMENSIONS.filter(
    (dimension) => Math.abs(rater1.dimensions[dimension].score - rater2.dimensions[dimension].score) >= threshold,
  );
}

/**
 * 合并双方评分与仲裁。
 *
 * 无分歧：取双方均值，保留 1 位小数；
 * 有分歧：以仲裁分为准，未裁的分歧保持均值并记录。
 *
 * @param rater1 R1 评分
 * @param rater2 R2 评分
 * @param decisions 仲裁决定
 * @returns 最终评分
 */
export function mergeRealismRating(
  rater1: RealismRating,
  rater2: RealismRating,
  decisions: readonly RealismArbitrationDecision[] = [],
): {
  readonly dimensions: Readonly<Record<RealismDimension, number>>;
  readonly overall: number;
  readonly unresolved: readonly RealismDimension[];
} {
  const decisionMap = new Map(decisions.map((decision) => [decision.dimension, decision.score]));
  const unresolved: RealismDimension[] = [];
  const dimensions = {} as Record<RealismDimension, number>;
  for (const dimension of REALISM_DIMENSIONS) {
    const r1 = rater1.dimensions[dimension].score;
    const r2 = rater2.dimensions[dimension].score;
    if (decisionMap.has(dimension)) {
      dimensions[dimension] = decisionMap.get(dimension)!;
      continue;
    }
    const mean = (r1 + r2) / 2;
    dimensions[dimension] = Math.round(mean * 10) / 10;
    if (Math.abs(r1 - r2) >= 2) unresolved.push(dimension);
  }
  const overall = Math.round((Object.values(dimensions).reduce((sum, value) => sum + value, 0) / REALISM_DIMENSIONS.length) * 10) / 10;
  return { dimensions, overall, unresolved };
}

/**
 * 计算单个维度的一致性。
 *
 * @param scores1 R1 分数
 * @param scores2 R2 分数
 * @returns 一致性摘要；样本不足返回 null 项
 */
export function summarizeRealismAgreement(scores1: readonly number[], scores2: readonly number[]): RealismAgreement {
  if (scores1.length !== scores2.length) throw new Error('两位评分人的评分数必须一致');
  const n = scores1.length;
  if (n === 0) return { n: 0, exactAgreement: 0, withinOneAgreement: 0, linearWeightedKappa: null };
  const exact = scores1.filter((score, index) => score === scores2[index]).length;
  const withinOne = scores1.filter((score, index) => Math.abs(score - scores2[index]) <= 1).length;
  return {
    n,
    exactAgreement: Math.round((exact / n) * 1_000_000) / 1_000_000,
    withinOneAgreement: Math.round((withinOne / n) * 1_000_000) / 1_000_000,
    linearWeightedKappa: n < 2 ? null : computeLinearWeightedKappa(scores1, scores2, { minScore: 1, maxScore: 5 }),
  };
}

/**
 * 生成 packetId（稳定、不可逆，不带 session id）。
 *
 * @param sessionId 原始会话 id
 * @param seed 抽样种子
 * @returns 16 位 hex
 */
export function deriveRealismPacketId(sessionId: string, seed: number): string {
  return createHash('sha256').update(`${sessionId}:${seed}`).digest('hex').slice(0, 16);
}
