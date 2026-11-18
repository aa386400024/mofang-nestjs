// V2026-11-19 Phase2.5 AF-111 (long 50 轮候选验收口径 · 不接硬门):
//   职责: 给 40–50 轮长会谈一套"按阶段看"的观察锚点与双人盲标数据形状;
//         回答"这段长程对话在建立/工作/收尾阶段各该看什么", 而不是把 12 轮
//         intake 阈值拉长后套一遍.
//   边界: 纯函数 / 纯类型, 零 IO / 零框架.
//
//   为什么必须是 candidate:
//     · 没有真实督导师双人盲标 + 仲裁前, 任何数值阈值都只是猜测;
//     · 本文件不给 PASS/FAIL, 不参与 batch-report / CI 门禁;
//     · 只有 100–200 轮真实盲标复核、κ 达标后, 才允许另立任务讨论升为硬门.
//
//   临床依据 (方向性, 不写具体数值):
//     · engagement (1–12): 结盟、知情同意、框架与安全; 不要求探索;
//     · working (13–40): 具体情境→内在感受的推进、阻抗/移情命名与修复、探索;
//     · closing (41–50): 收束、可带走的一句话/下一步、风险与边界.
//   intake-v1/v2 仍是首次会谈 12 轮口径; 本文件不修改、不替代它.

import { round6 } from './round.js';

/** 长会谈阶段. */
export type LongSessionPhaseId = 'engagement' | 'working' | 'closing';

/** 阶段定义 (边界闭区间; closing 上界为 null = 到会谈结束). */
export interface LongSessionPhase {
  readonly id: LongSessionPhaseId;
  readonly label: string;
  readonly startTurn: number;
  readonly endTurn: number | null;
}

/** 三段阶段; 与 12 轮 intake 档显式分离. */
export const LONG_SESSION_PHASES: readonly LongSessionPhase[] = [
  { id: 'engagement', label: '建立阶段', startTurn: 1, endTurn: 12 },
  { id: 'working', label: '工作阶段', startTurn: 13, endTurn: 40 },
  { id: 'closing', label: '收尾阶段', startTurn: 41, endTurn: null },
];

/** 候选口径版本; 改锚点必须递增. */
export const LONG_SESSION_ACCEPTANCE_VERSION = 'long-v0-candidate';

/** 候选状态; 任何消费端必须显式检查, 不得当硬门. */
export const LONG_SESSION_ACCEPTANCE_STATUS = 'candidate';

/** 免责声明; 写进报告/评分表, 防止被当成临床达标结论. */
export const LONG_SESSION_ACCEPTANCE_DISCLAIMER =
  '候选口径，不产生 PASS/FAIL；未接入 batch-report / CI；未取得真实督导师双人盲标 + 仲裁前，不得写成临床质量达标。';

/** 六维观察维度 (与 batch metrics 的 dim.* 对齐). */
export type LongSessionDimension = 'trust' | 'safety' | 'bond' | 'depth' | 'verbal' | 'style';

export const LONG_SESSION_DIMENSIONS: readonly LongSessionDimension[] = ['trust', 'safety', 'bond', 'depth', 'verbal', 'style'];

/** 逐轮 BDI 快照; 只取长会谈需要的字段. */
export interface LongSessionBdiSnapshot {
  readonly trust: number;
  readonly safety: number;
  readonly bond: number;
  readonly resistanceVerbal: number;
  readonly resistanceDepth: number;
  readonly resistanceStyle: number;
  readonly arousal: number;
}

/** 一条 trace 点 (turnIndex + BDI). */
export interface LongSessionTracePoint {
  readonly turnIndex: number;
  readonly bdiSnapshot: LongSessionBdiSnapshot | null;
}

/** 阶段汇总; 只描述观测, 不是合格判定. */
export interface LongSessionPhaseSummary {
  readonly phase: LongSessionPhaseId;
  readonly label: string;
  readonly startTurn: number;
  readonly endTurn: number | null;
  readonly turns: number;
  readonly dimensions: Readonly<Record<LongSessionDimension, number | null>>;
  readonly arousalAvg: number | null;
}

/** 盲标 packet 的单轮; 不含任何角色/模式/标题字段. */
export interface BlindPacketTurn {
  readonly turnIndex: number;
  readonly role: 'visitor' | 'counselor';
  readonly text: string;
}

/** 盲标 packet; 仅 packetId + 对话轮, 可安全发给评分人. */
export interface BlindPacket {
  readonly packetId: string;
  readonly turns: readonly BlindPacketTurn[];
  readonly disclaimer: string;
}

/** 原始 transcript 的最小输入 (只读取消息, 不读取身份字段). */
export interface TranscriptLike {
  readonly messages?: readonly {
    readonly role?: string;
    readonly text?: string;
    readonly turnIndex?: number;
  }[];
}

/** 一条临床复核锚点 (文字描述, 不含数值阈值). */
export interface LongSessionReviewAnchor {
  readonly id: string;
  readonly phase: LongSessionPhaseId;
  readonly dimension: LongSessionDimension | 'process' | 'arousal';
  readonly prompt: string;
  readonly positive: string;
  readonly negative: string;
}

/**
 * 三段锚点: 9 条, 覆盖建立/工作/收尾.
 *
 * 这些是**督导师评分时的观察提示**, 不是机器判据; 评分人按 1–5 给分,
 * 由 `computeAgreement` 只算一致性, 不算临床准确率.
 */
export const LONG_SESSION_REVIEW_ANCHORS: readonly LongSessionReviewAnchor[] = [
  {
    id: 'engagement-alliance',
    phase: 'engagement',
    dimension: 'trust',
    prompt: '前 12 轮里，来访者是否出现“愿意再谈一次”的微小信号？咨询师是否接住了，而不是急着推进？',
    positive: '来访者从试探/回避转向具体描述，咨询师用复述/确认接住。',
    negative: '咨询师连续追问事实，来访者只给短答；或过快承诺“会好起来”。',
  },
  {
    id: 'engagement-frame',
    phase: 'engagement',
    dimension: 'safety',
    prompt: '是否建立了会谈框架（时间、保密、边界、可以停）？来访者的“不敢说”是否被正常化？',
    positive: '咨询师明确说明可以慢、可以不说；来访者试探性披露后没有被评判。',
    negative: '未说明边界就深挖创伤；或把沉默当成不配合。',
  },
  {
    id: 'working-depth',
    phase: 'working',
    dimension: 'depth',
    prompt: '13–40 轮是否出现至少一次“具体情境 → 当时的内在感受”的推进？',
    positive: '从一个工作场景推进到“当时其实挺难受/有点怕”，并停留、扩展。',
    negative: '50 轮仍在列问题清单、反复讲同一件事，没有向内移动。',
  },
  {
    id: 'working-exploration',
    phase: 'working',
    dimension: 'verbal',
    prompt: '是否出现来访者自己带出的新细节/新角度，而不是咨询师单方面提问？',
    positive: '来访者主动补充一个此前没提过的场景或念头，咨询师跟随而非换题。',
    negative: '咨询师问题密度过高，来访者只回答不探索；或话题频繁跳跃。',
  },
  {
    id: 'working-rupture',
    phase: 'working',
    dimension: 'process',
    prompt: '出现阻抗、沉默、迟到/讨好/贬低咨询师时，是否被命名并修复？',
    positive: '咨询师把“你刚才好像往后退了一点”放回对话，来访者能回应并继续。',
    negative: '阻抗被忽略或被解释成“你在防御”；修复失败后直接换话题。',
  },
  {
    id: 'working-regulation',
    phase: 'working',
    dimension: 'arousal',
    prompt: '情绪被激活后，咨询师是否帮助来访者回到可承受窗口，而不是继续加码？',
    positive: '咨询师降低节奏、锚定当下、给选择；来访者 arousal 回落并能继续。',
    negative: '持续深挖导致来访者 shutdown/解离；或过早安抚把情绪压平。',
  },
  {
    id: 'closing-consolidation',
    phase: 'closing',
    dimension: 'bond',
    prompt: '41–50 轮是否收束到“这次谈到了什么/带走什么/下次想从哪里开始”？',
    positive: '来访者能用自己的话说出一个新的理解或下一步，咨询师不替她总结。',
    negative: '结束时仍在开新话题；或咨询师给一长串建议，来访者只点头。',
  },
  {
    id: 'closing-safety',
    phase: 'closing',
    dimension: 'safety',
    prompt: '若涉及风险/危机，是否有明确的安全计划、边界与“可以怎么做”？',
    positive: '有具体联系人/求助路径/下次时间；来访者知道可以停或求助。',
    negative: '只做情绪安抚，没有具体计划；或把风险轻描淡写。',
  },
  {
    id: 'whole-style',
    phase: 'closing',
    dimension: 'style',
    prompt: '整体语言是否稳定、具体、不模板化、不评判？是否像“一个人”，而不是话术库？',
    positive: '短句、具体、跟随来访者用词；不同阶段语气有变化但一致。',
    negative: '重复模板句、过度解释、用“你应该”评判；或前后风格断裂。',
  },
];

/** 解析 turn 属于哪一段; <=0 按建立段, 非有限值抛错. */
export function resolveLongSessionPhase(turnIndex: number): LongSessionPhaseId {
  if (!Number.isFinite(turnIndex)) throw new Error(`turnIndex 必须是有限数：${turnIndex}`);
  if (turnIndex <= LONG_SESSION_PHASES[0].endTurn!) return 'engagement';
  if (turnIndex <= LONG_SESSION_PHASES[1].endTurn!) return 'working';
  return 'closing';
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round6(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function dimensionValue(snapshot: LongSessionBdiSnapshot, dimension: LongSessionDimension): number {
  switch (dimension) {
    case 'trust':
      return snapshot.trust;
    case 'safety':
      return snapshot.safety;
    case 'bond':
      return snapshot.bond;
    case 'depth':
      return snapshot.resistanceDepth;
    case 'verbal':
      return snapshot.resistanceVerbal;
    case 'style':
      return snapshot.resistanceStyle;
  }
}

/**
 * 按三段汇总 trace; 只汇总有 bdiSnapshot 的点.
 *
 * 注意: depth/verbal/style 直接取 resistance* 原值 (与 batch-metrics.compute
 * 的 dim.* 口径一致), 不在本文件另造一套方向.
 */
export function summarizeLongSession(turns: readonly LongSessionTracePoint[]): LongSessionPhaseSummary[] {
  return LONG_SESSION_PHASES.map((phase) => {
    const points = turns.filter((turn) => {
      if (!turn.bdiSnapshot) return false;
      const phaseId = resolveLongSessionPhase(turn.turnIndex);
      return phaseId === phase.id;
    });
    const dimensions = {} as Record<LongSessionDimension, number | null>;
    for (const dimension of LONG_SESSION_DIMENSIONS) {
      dimensions[dimension] = average(points.map((point) => dimensionValue(point.bdiSnapshot!, dimension)));
    }
    return {
      phase: phase.id,
      label: phase.label,
      startTurn: phase.startTurn,
      endTurn: phase.endTurn,
      turns: points.length,
      dimensions,
      arousalAvg: average(points.map((point) => point.bdiSnapshot!.arousal)),
    };
  });
}

/** 候选评估结果; gateEligible 固定 false. */
export interface LongSessionCandidateEvaluation {
  readonly version: string;
  readonly status: 'candidate';
  readonly gateEligible: false;
  readonly disclaimer: string;
  readonly phaseSummaries: readonly LongSessionPhaseSummary[];
  readonly anchors: readonly LongSessionReviewAnchor[];
}

/** 生成候选评估: 只有观测汇总 + 锚点, 没有任何 PASS/FAIL. */
export function evaluateLongSessionCandidate(turns: readonly LongSessionTracePoint[]): LongSessionCandidateEvaluation {
  return {
    version: LONG_SESSION_ACCEPTANCE_VERSION,
    status: 'candidate',
    gateEligible: false,
    disclaimer: LONG_SESSION_ACCEPTANCE_DISCLAIMER,
    phaseSummaries: summarizeLongSession(turns),
    anchors: LONG_SESSION_REVIEW_ANCHORS,
  };
}

/** 去掉推理块; 与 AF-108 的出口清洗同向, 但不依赖共享实现, 保持纯函数. */
function stripReasoning(text: string): string {
  return String(text)
    .replaceAll(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replaceAll(/<think\b[^>]*>[\s\S]*$/gi, '')
    .trim();
}

/**
 * 从 transcript 构造盲标 packet.
 *
 * 关键: 输出只有 packetId / turnIndex / role / text; 不包含 debugSessionId、
 * title、characterSlug、characterLabel、scenarioType、counselorModeId.
 * 文本本身仍可能泄露角色线索, 这是文本盲标的已知边界, 不宣称完全匿名.
 */
export function buildBlindPacket(
  transcript: TranscriptLike,
  packetId: string,
  options: { readonly stripReasoning?: boolean } = {},
): BlindPacket {
  const turns: BlindPacketTurn[] = [];
  for (const message of transcript.messages ?? []) {
    const role = message.role === 'visitor' || message.role === 'counselor' ? message.role : null;
    if (!role) continue;
    const text = options.stripReasoning === false ? String(message.text ?? '').trim() : stripReasoning(String(message.text ?? ''));
    if (text.length === 0) continue;
    turns.push({
      turnIndex: Number.isFinite(message.turnIndex) ? Number(message.turnIndex) : turns.length + 1,
      role,
      text,
    });
  }
  return {
    packetId,
    turns,
    disclaimer: LONG_SESSION_ACCEPTANCE_DISCLAIMER,
  };
}

/** 一致性输入: 同一 packet 的两位评分人对某一维的分数. */
export interface RatingPair {
  readonly packetId: string;
  readonly dimension: LongSessionDimension;
  readonly rater1: number;
  readonly rater2: number;
}

/** 一致性结果: 只描述评分人之间的一致性, 不描述临床正确性. */
export interface AgreementSummary {
  readonly n: number;
  readonly exactAgreement: number;
  readonly withinOneAgreement: number;
  readonly linearWeightedKappa: number | null;
}

/**
 * 线性加权 kappa (1–5 分, 分歧权重 |i-j|/(k-1)).
 *
 * 边界:
 *   · 无配对 → null (不伪造 0 或 1);
 *   · 只有 1 对 → null (无法估计一致性);
 *   · 期望分歧为 0 (全部落在同一格) → 1.
 */
export function computeLinearWeightedKappa(
  rater1: readonly number[],
  rater2: readonly number[],
  options: { readonly minScore?: number; readonly maxScore?: number } = {},
): number | null {
  if (rater1.length !== rater2.length) throw new Error('两位评分人的评分数必须一致');
  const n = rater1.length;
  if (n < 2) return null;
  const minScore = options.minScore ?? 1;
  const maxScore = options.maxScore ?? 5;
  const categories = maxScore - minScore + 1;
  if (categories < 2) throw new Error('评分范围至少 2 档');
  const observed = Array.from({ length: categories }, () => Array.from({ length: categories }, () => 0));
  for (let index = 0; index < n; index += 1) {
    const a = rater1[index] - minScore;
    const b = rater2[index] - minScore;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= categories || b >= categories) {
      throw new Error(`评分必须是 ${minScore}–${maxScore} 的整数：${rater1[index]} / ${rater2[index]}`);
    }
    observed[a][b] += 1;
  }
  let observedDisagreement = 0;
  let expectedDisagreement = 0;
  for (let i = 0; i < categories; i += 1) {
    const row = observed[i].reduce((sum, value) => sum + value, 0);
    for (let j = 0; j < categories; j += 1) {
      const col = observed.reduce((sum, values) => sum + values[j], 0);
      const weight = Math.abs(i - j) / (categories - 1);
      observedDisagreement += (weight * observed[i][j]) / n;
      expectedDisagreement += (weight * ((row * col) / n)) / n;
    }
  }
  if (expectedDisagreement === 0) return 1;
  return round6(1 - observedDisagreement / expectedDisagreement);
}

/** 汇总一组配对; 空/单对 kappa=null, 但 exact/withinOne 仍可算. */
export function summarizeAgreement(pairs: readonly RatingPair[]): AgreementSummary {
  if (pairs.length === 0) return { n: 0, exactAgreement: 0, withinOneAgreement: 0, linearWeightedKappa: null };
  const exact = pairs.filter((pair) => pair.rater1 === pair.rater2).length;
  const withinOne = pairs.filter((pair) => Math.abs(pair.rater1 - pair.rater2) <= 1).length;
  return {
    n: pairs.length,
    exactAgreement: round6(exact / pairs.length),
    withinOneAgreement: round6(withinOne / pairs.length),
    linearWeightedKappa: computeLinearWeightedKappa(
      pairs.map((pair) => pair.rater1),
      pairs.map((pair) => pair.rater2),
    ),
  };
}

/** 需要仲裁的 packet 级条件: 任一维差 > maxGap, 或任一评分人 notes 非空且带仲裁标记. */
export interface AdjudicationCase {
  readonly packetId: string;
  readonly dimensions: readonly LongSessionDimension[];
  readonly maxGap: number;
  readonly reason: string;
}

/**
 * 从配对里找仲裁 packet.
 *
 * 只按评分差 > maxGap (默认 1) 触发; notes 不自动升级, 避免把普通备注
 * 当成分歧. 需要人工标记时由评分表 `adjudicate=yes` 显式触发.
 */
export function findAdjudicationCases(
  pairs: readonly RatingPair[],
  options: { readonly maxGap?: number; readonly flaggedPacketIds?: readonly string[] } = {},
): AdjudicationCase[] {
  const maxGap = options.maxGap ?? 1;
  const flagged = new Set(options.flaggedPacketIds);
  const grouped = new Map<string, { dimensions: LongSessionDimension[]; maxGap: number; reasons: string[] }>();
  for (const pair of pairs) {
    const gap = Math.abs(pair.rater1 - pair.rater2);
    const hit = gap > maxGap || flagged.has(pair.packetId);
    if (!hit) continue;
    const current = grouped.get(pair.packetId) ?? { dimensions: [], maxGap: 0, reasons: [] };
    if (!current.dimensions.includes(pair.dimension)) current.dimensions.push(pair.dimension);
    current.maxGap = Math.max(current.maxGap, gap);
    if (gap > maxGap) current.reasons.push(`${pair.dimension} 差 ${gap}`);
    if (flagged.has(pair.packetId)) current.reasons.push('评分人标记仲裁');
    grouped.set(pair.packetId, current);
  }
  return [...grouped.entries()].map(([packetId, value]) => ({
    packetId,
    dimensions: value.dimensions,
    maxGap: value.maxGap,
    reason: value.reasons.join('；'),
  }));
}
