// V2026-11-13 建立 (I-11 方向 3 · 探索门槛可达性离线对账 · CLI 编排):
//   职责: 读归档会话快照序列 → 逐场实测对账 → 跨场 × 角色聚合 → 离线状态机外推
//         → 与台账线性外推三列对照 + 档位归类 → 打印取证表.
//
//   ⚠️ **边界** (任务单 §1.2.6):
//     本脚本只出**证据 / 区间 / 对照** —— 不替临床拍板门槛取值, 不拆门槛结构,
//     不标定阈值 / delta 速率 / 倍率. 方向 2 (临床结构复核) 另案.
//
//   ⚠️ **阈值唯一真相源**:
//     src/engine-core/cognition/alliance-config.ts
//       · DEFAULT_ALLIANCE_CONFIG.thresholds.open     = 0.6
//       · DEFAULT_ALLIANCE_CONFIG.thresholds.openDepth = 0.35 (DEFAULT_OPEN_DEPTH)
//     判定式逐字对齐 src/engine-core/cognition/intention-planner.ts:61,74:
//       allianceGate = Math.min(trust, safety)
//       reachable   = allianceGate >= open && depth < openDepth
//     脚本**不 import src/** (避免 build rootDir 耦合) —— 常量在此逐字抄一份,
//     注释标注真相源文件与行号; 真相源改了本脚本常量会漂, 复核时对照即可.
//
//   ⚠️ **状态取值范围** (外推 clamp 上下限 · 待决策点 2):
//     src/engine-core/domain/emotion.ts clamp01 → [0, 1];
//     src/engine-core/cognition/state-transition.ts applyDeltaVector (:784-810) 用它落快照.
//     trust / safety / resistance.depth 三维都落在 [0, 1] → 外推 clamp 同款.
//
//   ⚠️ **隐私红线** (AGENTS.md §5.4):
//     · 输出只出角色 slug / label、批次目录名、轮次、数值、计数、标签;
//     · **不读 messages[].text** (归档里含来访者台词原文), 不读 kernelState / renderSpec;
//     · **不输出单场会话 id** —— 逐场明细只在内存里算, 落盘只出聚合表.
//
//   用法 (pnpm, 禁裸 npx):
//     pnpm exec tsx scripts/ops/quality/i11-accessibility-reconciliation.ts
//     pnpm exec tsx scripts/ops/quality/i11-accessibility-reconciliation.ts --dir data/archives
//     pnpm exec tsx scripts/ops/quality/i11-accessibility-reconciliation.ts --dir data/archives/debug-sessions-baseline-20261109
//     pnpm exec tsx scripts/ops/quality/i11-accessibility-reconciliation.ts --out data/quality/i11-accessibility-reconciliation.md
//     pnpm exec tsx scripts/ops/quality/i11-accessibility-reconciliation.ts --min-samples 30 --max-horizon 500
//
//   ⚠️ **外推假设** (任务单 §3.1-4 · 结论只在这些假设下成立):
//     ① 恒定增量速率 (中位 Δ 每轮照搬); ② 无阻抗反弹 (depth 单调);
//     ③ 无危机 / 破裂态; ④ 无跨会话衰减; ⑤ 无事件类型结构变化;
//     ⑥ 状态 clamp 到 [0,1] (内核 clamp01 同款).
//     外推是**模型估算**, 不是实测 —— 报告里必须标「外推 · 非实测」.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 探索门槛 · 同盟短板 (真相源: alliance-config.ts DEFAULT_ALLIANCE_CONFIG.thresholds.open). */
const OPEN_THRESHOLD = 0.6;
/** 探索门槛 · 深度阻抗上限 (真相源: alliance-config.ts DEFAULT_OPEN_DEPTH = thresholds.openDepth). */
const OPEN_DEPTH_THRESHOLD = 0.35;
/** 快照取值下限 (真相源: domain/emotion.ts clamp01). */
const SNAPSHOT_MIN = 0;
/** 快照取值上限 (真相源: domain/emotion.ts clamp01). */
const SNAPSHOT_MAX = 1;

/** 增量分位估计的**最小差分样本数** (工程口径, 非临床; 待决策点 1). */
const DEFAULT_MIN_SAMPLES = 20;
/** 外推视界 (轮) —— 超出即判「不可达」, 不硬凑单点轮次. */
const DEFAULT_MAX_HORIZON = 2000;
/** 12 轮档轮数上限 (C5-1 分层口径). */
const TIER_12 = 12;
/** 40 轮档轮数上限 (C5-1 分层口径). */
const TIER_40 = 40;
/** 台账对照的「同量级」带宽 (工程口径: ±50%). */
const SAME_ORDER_BAND = 0.5;

/** 依恋风格 (内核 AttachmentStyle). */
type AttachmentStyle = 'secure' | 'avoidant' | 'anxious' | 'disorganized';

/** 台账 I-11 现有线性外推表 —— **只读引用**, 不改写历史口径 (台账 :296-302). */
interface LedgerRow {
  readonly characterSlug: string;
  readonly characterLabel: string;
  readonly safetyBaseline: number;
  readonly needDelta: number;
  readonly ratePerTurn: number | null;
  readonly rounds: number | null;
}

/** 台账旧表 (5 角色) —— 数值逐字照抄台账, 本脚本不重算. */
const LEDGER_TABLE: readonly LedgerRow[] = [
  { characterSlug: 'vpt_general_secure_l1', characterLabel: '安然', safetyBaseline: 0.7, needDelta: 0, ratePerTurn: null, rounds: 0 },
  { characterSlug: 'vpt_social_anxious_l1', characterLabel: '语桐', safetyBaseline: 0.4, needDelta: 0.2, ratePerTurn: 0.004, rounds: 50 },
  {
    characterSlug: 'vpt_self_worth_intellectualization_l1',
    characterLabel: '小满',
    safetyBaseline: 0.35,
    needDelta: 0.25,
    ratePerTurn: 0.002,
    rounds: 125,
  },
  {
    characterSlug: 'vpt_depression_avoidant_l1',
    characterLabel: '沉舟',
    safetyBaseline: 0.2,
    needDelta: 0.4,
    ratePerTurn: 0.002,
    rounds: 200,
  },
  {
    characterSlug: 'vpt_trauma_disorganized_l1',
    characterLabel: '惊尘',
    safetyBaseline: 0.1,
    needDelta: 0.5,
    ratePerTurn: 0.002,
    rounds: 250,
  },
];

/**
 * 角色 slug → 依恋风格 (供分组回退用).
 *
 * ⚠️ 真相源与任务单 §2.3 的**两处分歧** (以仓内为准):
 *   · 小满 (vpt_self_worth_intellectualization_l1) → **anxious**
 *     (仓内: src/engine-adapters/wiring/character/character-profile.seed.ts:285)
 *   · 晚晴 (vpt_intimate_avoidance_l1) → **anxious**
 *     (仓内: 同文件 :259)
 *   任务单 §2.3 按 **slug 字面** 归成了 avoidant; 但任务单同一栏注明
 *   「以内核 AttachmentStyle 为准」, 而内核 AttachmentStyle 的仓内真相源
 *   (character-profile.seed.ts) 写的是 anxious —— 本脚本按**仓内真相源**取,
 *   差异登记在交付记录偏差节 (只影响分组回退的成员构成, 不影响实测列).
 *
 * 其余 4 个角色 (安然 / 语桐 / 沉舟 / 惊尘) 是 DB-only 角色
 * (bin/seed-character-profiles.ts 头注释: A 类 4 个有 seed 规格 / B 类 4 个 DB-only),
 * 仓内无 attachmentStyle 定义 —— 取 slug 语义 (secure / anxious / avoidant / disorganized),
 * 与任务单 §2.3 一致.
 */
const ATTACHMENT_STYLE_BY_SLUG: Readonly<Record<string, AttachmentStyle>> = {
  vpt_general_secure_l1: 'secure',
  vpt_social_anxious_l1: 'anxious',
  vpt_self_worth_intellectualization_l1: 'anxious',
  vpt_intimate_avoidance_l1: 'anxious',
  vpt_grief_avoidance_l1: 'avoidant',
  vpt_workplace_intellectualization_l1: 'avoidant',
  vpt_depression_avoidant_l1: 'avoidant',
  vpt_trauma_disorganized_l1: 'disorganized',
};

/** 归档 trace (只取本脚本要用的字段 —— 不读 messages / kernelState / renderSpec). */
interface ArchiveTrace {
  readonly turnIndex?: number;
  readonly bdiSnapshot?: {
    readonly trust?: number;
    readonly safety?: number;
    readonly bond?: number;
    readonly resistanceDepth?: number;
  };
  readonly degraded?: boolean;
  readonly llmUsage?: { readonly completionTokens?: number | null };
}

/** 归档会话 (顶层字段). */
interface ArchiveSession {
  readonly characterSlug?: string;
  readonly characterLabel?: string;
  readonly turnCount?: number;
  readonly traces?: readonly ArchiveTrace[];
}

/** 逐轮投影点 (判据输入). */
interface SessionPoint {
  readonly turnIndex: number;
  readonly trust: number;
  readonly safety: number;
  readonly bond: number;
  readonly depth: number;
  readonly gate: number;
  readonly reachable: boolean;
  readonly degradedRound: boolean;
}

/** 逐场实测对账结果. */
interface SessionReconciliation {
  readonly dir: string;
  readonly characterSlug: string;
  readonly characterLabel: string;
  readonly turns: number;
  readonly skippedTurns: number;
  readonly firstReachTurn: number | null;
  readonly first: SessionPoint;
  readonly last: SessionPoint;
  readonly allianceGap: number;
  readonly depthGap: number;
  readonly blocker: 'none' | 'alliance' | 'depth' | 'both';
  readonly degradedTurns: number;
  readonly degradedSession: boolean;
  /** 净变化率: (末轮 − 首轮) / (有效轮数 − 1) —— 补充口径的增量 (线性速率对照用). */
  readonly netRateTrust: number;
  readonly netRateSafety: number;
  readonly netRateDepth: number;
  /** 活跃轮数: 本轮三维里有任一维发生变化的轮次 (诊断「状态是否在动」). */
  readonly activeTurns: number;
}

/** 相邻轮差分 (外推增量样本). */
interface DeltaPair {
  readonly dir: string;
  readonly characterSlug: string;
  readonly dTrust: number;
  readonly dSafety: number;
  readonly dDepth: number;
  readonly degraded: boolean;
}

/** 一组差分样本的统计量. */
interface DeltaStats {
  readonly count: number;
  readonly trustMedian: number;
  readonly trustP25: number;
  readonly trustP75: number;
  readonly safetyMedian: number;
  readonly safetyP25: number;
  readonly safetyP75: number;
  readonly depthMedian: number;
  readonly depthP25: number;
  readonly depthP75: number;
}

/** 增量来源层级 (外推用了哪一层样本). */
type DeltaSourceLevel = 'character' | 'style-group' | 'all-sample';

/** 外推结论. */
interface Extrapolation {
  readonly characterSlug: string;
  readonly sourceLevel: DeltaSourceLevel | 'none';
  readonly sourceLabel: string;
  readonly stats: DeltaStats | null;
  readonly degradedSampleCount: number;
  readonly status: 'reached-in-sequence' | 'reachable' | 'unreachable-direction' | 'unreachable-horizon' | 'insufficient-sample';
  readonly roundsMedian: number | null;
  readonly roundsFast: number | null;
  readonly roundsSlow: number | null;
  readonly notes: readonly string[];
  /** 补充口径 · 会话净变化率外推 (线性速率; 与台账 I-09 线性表同量纲). */
  readonly net: {
    readonly stats: DeltaStats | null;
    readonly sourceLabel: string;
    readonly status: 'reachable' | 'unreachable-direction' | 'unreachable-horizon' | 'insufficient-sample' | 'reached-in-sequence';
    readonly roundsMedian: number | null;
    readonly roundsFast: number | null;
    readonly roundsSlow: number | null;
  };
  /** 活跃轮占比 (三维有变化的轮次 ÷ 相邻轮差分数) —— 诊断「状态到底动不动」. */
  readonly activeTurnRate: number | null;
}

/** 分组聚合 (批次目录 × 角色). */
interface GroupAggregate {
  readonly dir: string;
  readonly characterSlug: string;
  readonly characterLabel: string;
  readonly sessions: number;
  readonly degradedSessions: number;
  readonly reachedSessions: number;
  readonly reachRate: number;
  readonly reachTurnMin: number | null;
  readonly reachTurnMedian: number | null;
  readonly reachTurnMax: number | null;
  readonly lastTrustMean: number;
  readonly lastSafetyMean: number;
  readonly lastBondMean: number;
  readonly lastDepthMean: number;
  readonly gapAllianceMean: number;
  readonly gapDepthMean: number;
  readonly blockerAlliance: number;
  readonly blockerDepth: number;
  readonly blockerBoth: number;
  readonly totalTurns: number;
}

/** 档位归类结果. */
interface TierVerdict {
  readonly tier12: string;
  readonly tier40: string;
}

/** 命令行参数. */
interface Options {
  readonly dir: string;
  readonly out: string | null;
  readonly minSamples: number;
  readonly maxHorizon: number;
}

/** 读档阶段的跳过计数 (不静默丢场). */
interface ReadStats {
  readonly files: number;
  readonly nonJson: number;
  readonly parseFailed: number;
  readonly missingCharacter: number;
  readonly missingTraces: number;
  /** 根目录散落的文件 (不是场次目录里的文件) —— 单独披露, 不静默忽略. */
  readonly looseFiles: number;
}

/**
 * 解析命令行参数.
 *
 * @param argv 参数数组
 * @returns 解析结果
 */
export function parseArgs(argv: readonly string[]): Options {
  let dir = 'data/archives';
  let out: string | null = null;
  let minSamples = DEFAULT_MIN_SAMPLES;
  let maxHorizon = DEFAULT_MAX_HORIZON;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dir') {
      dir = argv[index + 1] ?? dir;
      index += 1;
    } else if (token === '--out') {
      out = argv[index + 1] ?? null;
      index += 1;
    } else if (token === '--min-samples') {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) minSamples = Math.floor(parsed);
      index += 1;
    } else if (token === '--max-horizon') {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) maxHorizon = Math.floor(parsed);
      index += 1;
    }
  }
  return { dir, out, minSamples, maxHorizon };
}

/**
 * 取有限数值 (非有限 → null).
 *
 * @param value 候选值
 * @returns 有限数值或 null
 */
function toFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * clamp 到 [0,1] (同款内核 clamp01).
 *
 * @param value 数值
 * @returns clamp 后的数值
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return SNAPSHOT_MIN;
  return Math.min(SNAPSHOT_MAX, Math.max(SNAPSHOT_MIN, value));
}

/**
 * 升序数组的中位数.
 *
 * @param values 数值数组
 * @returns 中位数 (空数组 → null)
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (low === undefined || high === undefined) return null;
  return (low + high) / 2;
}

/**
 * 升序数组的分位数 (线性插值).
 *
 * @param values 数值数组
 * @param q 分位 (0~1)
 * @returns 分位值 (空数组 → null)
 */
function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  if (low === undefined || high === undefined) return null;
  if (lower === upper) return low;
  return low + (high - low) * (position - lower);
}

/**
 * 判定一个快照是否达到探索双门槛 (判定式逐字对齐 intention-planner.ts:61,74).
 *
 * @param trust 信任
 * @param safety 安全感
 * @param depth 深度阻抗
 * @returns 是否可达
 */
export function isReachable(trust: number, safety: number, depth: number): boolean {
  const allianceGate = Math.min(trust, safety);
  return allianceGate >= OPEN_THRESHOLD && depth < OPEN_DEPTH_THRESHOLD;
}

/**
 * 投影一条 trace (缺关键键 → null, 计入缺键计数).
 *
 * @param trace 归档 trace
 * @returns 投影点或 null
 */
function projectTrace(trace: ArchiveTrace): SessionPoint | null {
  const snapshot = trace.bdiSnapshot;
  if (!snapshot) return null;
  const trust = toFinite(snapshot.trust);
  const safety = toFinite(snapshot.safety);
  const depth = toFinite(snapshot.resistanceDepth);
  if (trust === null || safety === null || depth === null) return null;
  const bond = toFinite(snapshot.bond) ?? 0;
  const turnIndex = toFinite(trace.turnIndex);
  const completion = trace.llmUsage?.completionTokens;
  const degradedRound = trace.degraded === true || completion === 0;
  return {
    turnIndex: turnIndex ?? 0,
    trust,
    safety,
    bond,
    depth,
    gate: Math.min(trust, safety),
    reachable: isReachable(trust, safety, depth),
    degradedRound,
  };
}

/**
 * 逐场实测对账.
 *
 * @param dir 批次目录名
 * @param session 归档会话
 * @returns 对账结果 (无有效轮 → null)
 */
export function reconcileSession(dir: string, session: ArchiveSession): SessionReconciliation | null {
  const slug = (session.characterSlug ?? '').trim();
  const label = (session.characterLabel ?? '').trim();
  if (slug.length === 0) return null;
  const traces = session.traces ?? [];
  const points: SessionPoint[] = [];
  let skippedTurns = 0;
  for (const trace of traces) {
    const point = projectTrace(trace);
    if (point === null) {
      skippedTurns += 1;
      continue;
    }
    points.push(point);
  }
  if (points.length === 0) return null;
  points.sort((left, right) => left.turnIndex - right.turnIndex);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  let firstReachTurn: number | null = null;
  for (const point of points) {
    if (point.reachable) {
      firstReachTurn = point.turnIndex;
      break;
    }
  }
  const allianceGap = Math.max(0, OPEN_THRESHOLD - last.gate);
  const depthGap = Math.max(0, last.depth - OPEN_DEPTH_THRESHOLD);
  const allianceShort = allianceGap > 0;
  const depthShort = depthGap > 0;
  const blocker: SessionReconciliation['blocker'] =
    allianceShort && depthShort ? 'both' : allianceShort ? 'alliance' : depthShort ? 'depth' : 'none';
  const degradedTurns = points.filter((point) => point.degradedRound).length;
  const degradedSession = degradedTurns === points.length;
  const span = Math.max(1, points.length - 1);
  let activeTurns = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    if (current.trust !== previous.trust || current.safety !== previous.safety || current.depth !== previous.depth) activeTurns += 1;
  }
  return {
    dir,
    characterSlug: slug,
    characterLabel: label.length > 0 ? label : slug,
    turns: points.length,
    skippedTurns,
    firstReachTurn,
    first,
    last,
    allianceGap,
    depthGap,
    blocker,
    degradedTurns,
    degradedSession,
    netRateTrust: (last.trust - first.trust) / span,
    netRateSafety: (last.safety - first.safety) / span,
    netRateDepth: (last.depth - first.depth) / span,
    activeTurns,
  };
}

/**
 * 取一场会话的相邻轮差分 (退化轮单列, 不进主增量).
 *
 * @param dir 批次目录名
 * @param session 归档会话
 * @returns 差分数组
 */
export function deltaPairsOf(dir: string, session: ArchiveSession): DeltaPair[] {
  const slug = (session.characterSlug ?? '').trim();
  if (slug.length === 0) return [];
  const points: SessionPoint[] = [];
  for (const trace of session.traces ?? []) {
    const point = projectTrace(trace);
    if (point !== null) points.push(point);
  }
  points.sort((left, right) => left.turnIndex - right.turnIndex);
  const pairs: DeltaPair[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    pairs.push({
      dir,
      characterSlug: slug,
      dTrust: current.trust - previous.trust,
      dSafety: current.safety - previous.safety,
      dDepth: current.depth - previous.depth,
      degraded: current.degradedRound,
    });
  }
  return pairs;
}

/**
 * 汇总一组差分的统计量.
 *
 * @param pairs 差分数组
 * @returns 统计量 (空 → null)
 */
export function computeDeltaStats(pairs: readonly DeltaPair[]): DeltaStats | null {
  if (pairs.length === 0) return null;
  const trust = pairs.map((pair) => pair.dTrust);
  const safety = pairs.map((pair) => pair.dSafety);
  const depth = pairs.map((pair) => pair.dDepth);
  return {
    count: pairs.length,
    trustMedian: median(trust) ?? 0,
    trustP25: quantile(trust, 0.25) ?? 0,
    trustP75: quantile(trust, 0.75) ?? 0,
    safetyMedian: median(safety) ?? 0,
    safetyP25: quantile(safety, 0.25) ?? 0,
    safetyP75: quantile(safety, 0.75) ?? 0,
    depthMedian: median(depth) ?? 0,
    depthP25: quantile(depth, 0.25) ?? 0,
    depthP75: quantile(depth, 0.75) ?? 0,
  };
}

/**
 * 从起点按固定增量推演, 返回触达门槛所需轮次.
 *
 * ⚠️ 方向不支持 → null (不给单点轮次); 超出视界 → null (不硬凑).
 *
 * @param start 起点快照
 * @param step 每轮增量
 * @param maxHorizon 视界 (轮)
 * @returns 触达轮次或 null
 */
export function projectRounds(start: SessionPoint, step: DeltaStats, maxHorizon: number): number | null {
  return simulate(start, step, maxHorizon).rounds;
}

/**
 * 判断某一维的增量方向是否支持继续上行 / 下行.
 *
 * @param start 起点快照
 * @param step 增量统计
 * @returns 不支持的维度列表
 */
function unsupportedDimensions(start: SessionPoint, step: DeltaStats): string[] {
  const notes: string[] = [];
  const allianceShort = start.gate < OPEN_THRESHOLD;
  if (allianceShort) {
    if (step.trustMedian <= 0) notes.push('trust 增量方向不支持');
    if (step.safetyMedian <= 0) notes.push('safety 增量方向不支持');
  }
  if (start.depth >= OPEN_DEPTH_THRESHOLD && step.depthMedian >= 0) notes.push('depth 增量方向不支持');
  return notes;
}

/**
 * 档位归类 (沿用 C5-1 分层, 不新建阈值).
 *
 * @param fast 最快轮次
 * @param slow 最慢轮次
 * @returns 12 轮档 / 40 轮档结论
 */
export function classifyTier(fast: number | null, slow: number | null): TierVerdict {
  if (fast === null) return { tier12: '不可达', tier40: '不可达' };
  // 慢侧 = null → 慢侧超出外推视界: **不能用它把快侧也一起判死** ——
  //   快侧仍是有效信息 (「最快多少轮能到」), 但不能当稳健结论.
  const tier12 =
    fast <= TIER_12
      ? slow === null
        ? '可达 (仅快侧; 慢侧超视界)'
        : slow <= TIER_12
          ? '可达'
          : '跨档 (12 轮档内可达, 之后不可达)'
      : '不可达';
  const tier40 =
    fast <= TIER_40
      ? slow === null
        ? '可达 (仅快侧; 慢侧超视界)'
        : slow <= TIER_40
          ? '可达'
          : '跨档 (40 轮档内可达, 之后不可达)'
      : '不可达';
  return { tier12, tier40 };
}

/**
 * 台账轮次与本单外推轮次的偏差口径.
 *
 * @param ledgerRounds 台账轮次
 * @param extrapolated 本单外推中位轮次
 * @returns 偏差描述
 */
export function compareWithLedger(ledgerRounds: number | null, extrapolated: number | null): string {
  if (extrapolated === null) {
    return ledgerRounds === null ? '两侧均无结论' : '本单判定不可达, 台账给出 ' + ledgerRounds + ' 轮';
  }
  if (ledgerRounds === null) return '台账无对照值';
  if (extrapolated === 0 && ledgerRounds === 0) return '同量级 (均为 0 轮)';
  if (extrapolated === 0) return '本单判定序列内已触达, 台账给出 ' + ledgerRounds + ' 轮';
  if (ledgerRounds === 0) return '台账 0 轮, 本单外推 ' + extrapolated + ' 轮';
  const ratio = ledgerRounds / extrapolated;
  if (ratio >= 1 + SAME_ORDER_BAND) return '台账更保守 (本单更乐观, 约 ' + ratio.toFixed(2) + 'x)';
  if (ratio <= 1 - SAME_ORDER_BAND) return '台账更乐观 (本单更保守, 约 ' + ratio.toFixed(2) + 'x)';
  return '同量级 (约 ' + ratio.toFixed(2) + 'x)';
}

/**
 * 读一个目录下的归档会话文件 (只读 · 不写任何文件).
 *
 * @param dir 目录
 * @returns 会话列表 (带批次目录名) + 跳过计数
 */
function readArchiveSessions(dir: string): {
  readonly records: readonly { dir: string; session: ArchiveSession }[];
  readonly stats: ReadStats;
} {
  const records: { dir: string; session: ArchiveSession }[] = [];
  let files = 0;
  let nonJson = 0;
  let parseFailed = 0;
  let missingCharacter = 0;
  let missingTraces = 0;
  let looseFiles = 0;
  const children = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  const subDirs = children.filter((child) => child.isDirectory()).map((child) => path.join(dir, child.name));
  const targets = subDirs.length > 0 ? subDirs : [dir];
  if (subDirs.length > 0) {
    // 根目录里的散落文件 (如批次指标 JSON) 不是场次 —— 计数披露, 不当场次读.
    for (const child of children) {
      if (child.isFile()) looseFiles += 1;
    }
  }
  for (const target of targets) {
    const targetName = path.basename(target);
    const entries = fs.existsSync(target) ? fs.readdirSync(target, { withFileTypes: true }) : [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.json')) {
        nonJson += 1;
        continue;
      }
      files += 1;
      const fullPath = path.join(target, entry.name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch {
        parseFailed += 1;
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        parseFailed += 1;
        continue;
      }
      const session = parsed as ArchiveSession;
      const slug = (session.characterSlug ?? '').trim();
      const traces = session.traces;
      if (slug.length === 0) {
        missingCharacter += 1;
        continue;
      }
      if (!Array.isArray(traces)) {
        missingTraces += 1;
        continue;
      }
      records.push({ dir: targetName, session });
    }
  }
  return { records, stats: { files, nonJson, parseFailed, missingCharacter, missingTraces, looseFiles } };
}

/**
 * 分组聚合 (批次目录 × 角色).
 *
 * @param records 对账结果
 * @returns 聚合数组
 */
export function aggregateByDir(records: readonly SessionReconciliation[]): GroupAggregate[] {
  const groups = new Map<string, SessionReconciliation[]>();
  for (const record of records) {
    const key = record.dir + '||' + record.characterSlug;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [record]);
    else bucket.push(record);
  }
  const perDir: GroupAggregate[] = [];
  for (const [key, bucket] of groups) {
    perDir.push(summarizeGroup(key.split('||')[0] ?? '', bucket));
  }
  perDir.sort((left, right) => (left.dir + left.characterSlug).localeCompare(right.dir + right.characterSlug));
  return perDir;
}

/**
 * 跨目录聚合 (角色一层).
 *
 * @param records 对账结果
 * @returns 聚合数组
 */
export function aggregateByCharacter(records: readonly SessionReconciliation[]): GroupAggregate[] {
  const groups = new Map<string, SessionReconciliation[]>();
  for (const record of records) {
    const bucket = groups.get(record.characterSlug);
    if (bucket === undefined) groups.set(record.characterSlug, [record]);
    else bucket.push(record);
  }
  const output: GroupAggregate[] = [];
  for (const bucket of groups.values()) output.push(summarizeGroup('(全部目录)', bucket));
  output.sort((left, right) => left.characterSlug.localeCompare(right.characterSlug));
  return output;
}

/**
 * 聚合一组同角色 (同目录) 的对账结果.
 *
 * @param dir 批次目录名
 * @param records 对账结果
 * @returns 聚合
 */
function summarizeGroup(dir: string, records: readonly SessionReconciliation[]): GroupAggregate {
  const first = records[0];
  const sessions = records.length;
  const degradedSessions = records.filter((record) => record.degradedSession).length;
  const reached = records.filter((record) => record.firstReachTurn !== null);
  const reachTurns = reached.map((record) => record.firstReachTurn ?? 0).sort((left, right) => left - right);
  const unreached = records.filter((record) => record.firstReachTurn === null);
  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    dir,
    characterSlug: first?.characterSlug ?? '',
    characterLabel: first?.characterLabel ?? '',
    sessions,
    degradedSessions,
    reachedSessions: reached.length,
    reachRate: sessions === 0 ? 0 : reached.length / sessions,
    reachTurnMin: reachTurns.length === 0 ? null : (reachTurns[0] ?? null),
    reachTurnMedian: median(reachTurns),
    reachTurnMax: reachTurns.length === 0 ? null : (reachTurns[reachTurns.length - 1] ?? null),
    lastTrustMean: mean(records.map((record) => record.last.trust)),
    lastSafetyMean: mean(records.map((record) => record.last.safety)),
    lastBondMean: mean(records.map((record) => record.last.bond)),
    lastDepthMean: mean(records.map((record) => record.last.depth)),
    gapAllianceMean: mean(unreached.map((record) => record.allianceGap)),
    gapDepthMean: mean(unreached.map((record) => record.depthGap)),
    blockerAlliance: unreached.filter((record) => record.blocker === 'alliance').length,
    blockerDepth: unreached.filter((record) => record.blocker === 'depth').length,
    blockerBoth: unreached.filter((record) => record.blocker === 'both').length,
    totalTurns: records.reduce((sum, record) => sum + record.turns, 0),
  };
}

/**
 * 取某个分位变体的增量 (把 p25 / p75 折进 median 字段, 复用同一个推演函数).
 *
 * @param stats 统计量
 * @param variant 变体
 * @returns 变体统计量
 */
function variantStats(stats: DeltaStats, variant: 'p25' | 'median' | 'p75'): DeltaStats {
  if (variant === 'median') return stats;
  const pick = (medianValue: number, p25: number, p75: number): number => (variant === 'p25' ? p25 : p75);
  return {
    ...stats,
    trustMedian: pick(stats.trustMedian, stats.trustP25, stats.trustP75),
    safetyMedian: pick(stats.safetyMedian, stats.safetyP25, stats.safetyP75),
    depthMedian: pick(stats.depthMedian, stats.depthP25, stats.depthP75),
  };
}

/**
 * 从起点按固定增量推演, 返回触达门槛所需轮次 + 方向不支持的维度.
 *
 * ⚠️ 方向不支持 → rounds = null (不给单点轮次); 超出视界 → rounds = null (不硬凑).
 *
 * @param start 起点快照
 * @param step 增量 (中位字段承载本变体)
 * @param maxHorizon 视界 (轮)
 * @returns 推演结果
 */
function simulate(
  start: SessionPoint,
  step: DeltaStats,
  maxHorizon: number,
): { readonly rounds: number | null; readonly unsupported: readonly string[] } {
  const unsupported = unsupportedDimensions(start, step);
  if (unsupported.length > 0) return { rounds: null, unsupported };
  let trust = start.trust;
  let safety = start.safety;
  let depth = start.depth;
  if (isReachable(trust, safety, depth)) return { rounds: 0, unsupported };
  for (let round = 1; round <= maxHorizon; round += 1) {
    trust = clamp01(trust + step.trustMedian);
    safety = clamp01(safety + step.safetyMedian);
    depth = clamp01(depth + step.depthMedian);
    if (isReachable(trust, safety, depth)) return { rounds: round, unsupported };
  }
  return { rounds: null, unsupported };
}

/**
 * 会话净变化率统计 (补充口径: 整场净变化 / 有效轮数).
 *
 * ⚠️ 为什么需要它: 相邻轮差分在归档样本里**零膨胀** (多数轮次状态完全不动),
 *   差分中位会恒为 0 → 主口径恒判「增量方向不支持」. 净变化率把整场移动摊到每轮,
 *   与台账 I-09 的「速率 × 轮次」线性外推**同量纲**, 可直接对照.
 *
 * @param records 同角色场次
 * @returns 统计量 (空 → null)
 */
export function computeNetRateStats(records: readonly SessionReconciliation[]): DeltaStats | null {
  if (records.length === 0) return null;
  const trust = records.map((record) => record.netRateTrust);
  const safety = records.map((record) => record.netRateSafety);
  const depth = records.map((record) => record.netRateDepth);
  return {
    count: records.length,
    trustMedian: median(trust) ?? 0,
    trustP25: quantile(trust, 0.25) ?? 0,
    trustP75: quantile(trust, 0.75) ?? 0,
    safetyMedian: median(safety) ?? 0,
    safetyP25: quantile(safety, 0.25) ?? 0,
    safetyP75: quantile(safety, 0.75) ?? 0,
    depthMedian: median(depth) ?? 0,
    depthP25: quantile(depth, 0.25) ?? 0,
    depthP75: quantile(depth, 0.75) ?? 0,
  };
}

/**
 * 选净变化率的来源 (角色 → 依恋风格组 → 全样本), 与主增量同款回退链.
 *
 * @param slug 角色 slug
 * @param records 该角色场次
 * @param allRecords 全部场次
 * @param minSamples 场次数下限
 * @returns 统计量与来源标签
 */
function resolveNetRateSource(
  slug: string,
  records: readonly SessionReconciliation[],
  allRecords: readonly SessionReconciliation[],
  minSamples: number,
): { readonly stats: DeltaStats | null; readonly label: string } {
  const style = ATTACHMENT_STYLE_BY_SLUG[slug];
  const styleRecords = style === undefined ? [] : allRecords.filter((record) => ATTACHMENT_STYLE_BY_SLUG[record.characterSlug] === style);
  const candidates: { label: string; pool: readonly SessionReconciliation[] }[] = [
    { label: '角色级 (' + slug + ')', pool: records },
    { label: '依恋风格组 (' + (style ?? '未知') + ')', pool: styleRecords },
    { label: '全样本', pool: allRecords },
  ];
  for (const candidate of candidates) {
    if (candidate.pool.length < minSamples) continue;
    const stats = computeNetRateStats(candidate.pool);
    if (stats !== null) return { stats, label: candidate.label };
  }
  return { stats: null, label: '无来源 (各层场次数均不足下限 ' + minSamples + ')' };
}

/**
 * 选增量来源 (角色 → 依恋风格组 → 全样本) 并做外推.
 *
 * ⚠️ 每一层都记**实际用上的那层** —— 读者必须能看出区间是谁给的.
 *
 * @param slug 角色 slug
 * @param records 该角色的对账结果
 * @param pairs 该角色的差分
 * @param allPairs 全样本差分
 * @param options 参数
 * @returns 外推结论
 */
export function extrapolateCharacter(
  slug: string,
  records: readonly SessionReconciliation[],
  pairs: readonly DeltaPair[],
  allPairs: readonly DeltaPair[],
  allRecords: readonly SessionReconciliation[],
  options: { readonly minSamples: number; readonly maxHorizon: number },
): Extrapolation {
  const unreached = records.filter((record) => record.firstReachTurn === null);
  const deltaSlots = records.reduce((sum, record) => sum + Math.max(0, record.turns - 1), 0);
  const activeTurnRate = deltaSlots === 0 ? null : records.reduce((sum, record) => sum + record.activeTurns, 0) / deltaSlots;
  if (unreached.length === 0) {
    return {
      characterSlug: slug,
      sourceLevel: 'none',
      sourceLabel: '无需外推 (序列内已全部触达)',
      stats: null,
      degradedSampleCount: 0,
      status: 'reached-in-sequence',
      roundsMedian: null,
      roundsFast: null,
      roundsSlow: null,
      notes: [],
      net: { stats: null, sourceLabel: 'n/a', status: 'reached-in-sequence', roundsMedian: null, roundsFast: null, roundsSlow: null },
      activeTurnRate,
    };
  }
  const style = ATTACHMENT_STYLE_BY_SLUG[slug];
  const stylePairs = style === undefined ? [] : allPairs.filter((pair) => ATTACHMENT_STYLE_BY_SLUG[pair.characterSlug] === style);
  const candidates: { level: DeltaSourceLevel; label: string; pool: readonly DeltaPair[] }[] = [
    { level: 'character', label: '角色级 (' + slug + ')', pool: pairs },
    { level: 'style-group', label: '依恋风格组 (' + (style ?? '未知') + ')', pool: stylePairs },
    { level: 'all-sample', label: '全样本', pool: allPairs },
  ];
  let chosen: { level: DeltaSourceLevel; label: string; pool: readonly DeltaPair[] } | null = null;
  for (const candidate of candidates) {
    const usable = candidate.pool.filter((pair) => !pair.degraded);
    if (usable.length >= options.minSamples) {
      chosen = { level: candidate.level, label: candidate.label, pool: usable };
      break;
    }
  }
  if (chosen === null) {
    const best = candidates.reduce((max, candidate) => Math.max(max, candidate.pool.filter((pair) => !pair.degraded).length), 0);
    return {
      characterSlug: slug,
      sourceLevel: 'none',
      sourceLabel: '无来源 (各层样本量均不足下限 ' + options.minSamples + ')',
      stats: null,
      degradedSampleCount: pairs.filter((pair) => pair.degraded).length,
      status: 'insufficient-sample',
      roundsMedian: null,
      roundsFast: null,
      roundsSlow: null,
      notes: ['最大可用样本量 ' + best + ' < 下限 ' + options.minSamples],
      net: { stats: null, sourceLabel: 'n/a', status: 'insufficient-sample', roundsMedian: null, roundsFast: null, roundsSlow: null },
      activeTurnRate,
    };
  }
  const stats = computeDeltaStats(chosen.pool);
  if (stats === null) {
    return {
      characterSlug: slug,
      sourceLevel: chosen.level,
      sourceLabel: chosen.label,
      stats: null,
      degradedSampleCount: pairs.filter((pair) => pair.degraded).length,
      status: 'insufficient-sample',
      roundsMedian: null,
      roundsFast: null,
      roundsSlow: null,
      notes: [],
      net: { stats: null, sourceLabel: 'n/a', status: 'insufficient-sample', roundsMedian: null, roundsFast: null, roundsSlow: null },
      activeTurnRate,
    };
  }
  const degradedReference = computeDeltaStats(pairs.filter((pair) => pair.degraded));
  const notes: string[] = [];
  const roundsMedianList: number[] = [];
  const roundsFastList: number[] = [];
  const roundsSlowList: number[] = [];
  let unsupportedCount = 0;
  let horizonCount = 0;
  for (const record of unreached) {
    const middle = simulate(record.last, variantStats(stats, 'median'), options.maxHorizon);
    const fast = simulate(record.last, variantStats(stats, 'p75'), options.maxHorizon);
    const slow = simulate(record.last, variantStats(stats, 'p25'), options.maxHorizon);
    if (middle.unsupported.length > 0) unsupportedCount += 1;
    else if (middle.rounds === null) horizonCount += 1;
    if (middle.rounds !== null) roundsMedianList.push(middle.rounds);
    if (fast.rounds !== null) roundsFastList.push(fast.rounds);
    if (slow.rounds !== null) roundsSlowList.push(slow.rounds);
  }
  if (unsupportedCount > 0) notes.push('增量方向不支持的未触达场次 ' + unsupportedCount + ' 场');
  if (horizonCount > 0) notes.push('超出外推视界 ' + options.maxHorizon + ' 轮的场次 ' + horizonCount + ' 场');
  if (degradedReference !== null) {
    notes.push(
      '退化轮差分参考 (不进主增量): Δtrust=' +
        degradedReference.trustMedian.toFixed(4) +
        ' Δsafety=' +
        degradedReference.safetyMedian.toFixed(4) +
        ' Δdepth=' +
        degradedReference.depthMedian.toFixed(4),
    );
  }
  const roundsMedian = median(roundsMedianList);
  const roundsFast = median(roundsFastList);
  const roundsSlow = median(roundsSlowList);
  const status: Extrapolation['status'] =
    roundsMedian === null ? (unsupportedCount > 0 ? 'unreachable-direction' : 'unreachable-horizon') : 'reachable';
  // 补充口径 · 会话净变化率 (线性速率) —— 主口径的相邻轮差分中位在「零膨胀」分布下会恒为 0,
  //   这条用「整场净变化 / 有效轮数」估速率, 与台账 I-09 线性外推同量纲, 可直接对照.
  const netSource = resolveNetRateSource(slug, records, allRecords, options.minSamples);
  const netStats = netSource.stats;
  let netStatus: Extrapolation['net']['status'] = 'insufficient-sample';
  let netRoundsMedian: number | null = null;
  let netRoundsFast: number | null = null;
  let netRoundsSlow: number | null = null;
  if (netStats !== null) {
    const netMiddleList: number[] = [];
    const netFastList: number[] = [];
    const netSlowList: number[] = [];
    let netUnsupported = 0;
    let netHorizon = 0;
    for (const record of unreached) {
      const middle = simulate(record.last, variantStats(netStats, 'median'), options.maxHorizon);
      const fast = simulate(record.last, variantStats(netStats, 'p75'), options.maxHorizon);
      const slow = simulate(record.last, variantStats(netStats, 'p25'), options.maxHorizon);
      if (middle.unsupported.length > 0) netUnsupported += 1;
      else if (middle.rounds === null) netHorizon += 1;
      if (middle.rounds !== null) netMiddleList.push(middle.rounds);
      if (fast.rounds !== null) netFastList.push(fast.rounds);
      if (slow.rounds !== null) netSlowList.push(slow.rounds);
    }
    netRoundsMedian = median(netMiddleList);
    netRoundsFast = median(netFastList);
    netRoundsSlow = median(netSlowList);
    netStatus = netRoundsMedian === null ? (netUnsupported > 0 ? 'unreachable-direction' : 'unreachable-horizon') : 'reachable';
    if (netUnsupported > 0) notes.push('补充口径: 增量方向不支持的未触达场次 ' + netUnsupported + ' 场');
    if (netHorizon > 0) notes.push('补充口径: 超出外推视界 ' + options.maxHorizon + ' 轮的场次 ' + netHorizon + ' 场');
  }
  return {
    characterSlug: slug,
    sourceLevel: chosen.level,
    sourceLabel: chosen.label,
    stats,
    degradedSampleCount: pairs.filter((pair) => pair.degraded).length,
    status,
    roundsMedian,
    roundsFast,
    roundsSlow,
    notes,
    net: {
      stats: netStats,
      sourceLabel: netSource.label,
      status: netStatus,
      roundsMedian: netRoundsMedian,
      roundsFast: netRoundsFast,
      roundsSlow: netRoundsSlow,
    },
    activeTurnRate,
  };
}

/**
 * 格式化一个区间 (快 ~ 慢).
 *
 * ⚠️ 两侧**独立**显示: 慢侧超外推视界时只把慢侧标成「不可达 (>视界)」,
 *   不用一个 n/a 把快侧也掩掉 —— 快侧是有效信息.
 *
 * @param fast 快侧轮次
 * @param slow 慢侧轮次
 * @param horizon 外推视界
 * @returns 区间字符串
 */
function formatRange(fast: number | null, slow: number | null, horizon: number): string {
  const fastText = fast === null ? '不可达 (>视界 ' + horizon + ')' : String(fast);
  const slowText = slow === null ? '不可达 (>视界 ' + horizon + ')' : String(slow);
  if (fast === null && slow === null) return '不可达 (>视界 ' + horizon + ')';
  return fastText + ' ~ ' + slowText;
}

/**
 * 格式化数值 (null → n/a).
 *
 * @param value 数值
 * @param digits 小数位
 * @returns 格式化字符串
 */
function fmt(value: number | null, digits = 3): string {
  return value === null ? 'n/a' : value.toFixed(digits);
}

/**
 * 打印一段 Markdown 表.
 *
 * @param lines 输出行
 * @param headers 表头
 * @param rows 表体
 */
function pushTable(lines: string[], headers: readonly string[], rows: readonly (readonly string[])[]): void {
  lines.push('| ' + headers.join(' | ') + ' |');
  lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');
  for (const row of rows) lines.push('| ' + row.join(' | ') + ' |');
  lines.push('');
}

/**
 * 生成全部取证表 (stdout 与 --out 落盘同构).
 *
 * @param input 取证输入
 * @returns Markdown 行数组
 */
function buildReport(input: {
  readonly options: Options;
  readonly stats: ReadStats;
  readonly records: readonly SessionReconciliation[];
  readonly perDir: readonly GroupAggregate[];
  readonly perCharacter: readonly GroupAggregate[];
  readonly extrapolations: readonly Extrapolation[];
}): string[] {
  const lines: string[] = [];
  const { options, stats, records, perDir, perCharacter, extrapolations } = input;
  lines.push('=== I-11 方向 3 · 探索门槛可达性离线对账 ===');
  lines.push('归档目录   ' + options.dir);
  lines.push('门槛       open=' + OPEN_THRESHOLD + ' / openDepth=' + OPEN_DEPTH_THRESHOLD + ' (真相源 alliance-config.ts)');
  lines.push('样本下限   ' + options.minSamples + ' 个有效差分 | 外推视界 ' + options.maxHorizon + ' 轮');
  lines.push('场次       ' + records.length + ' 场 | 有效轮次 ' + records.reduce((sum, record) => sum + record.turns, 0));
  lines.push(
    '跳过披露   非 JSON 文件 ' +
      stats.nonJson +
      ' | 解析失败 ' +
      stats.parseFailed +
      ' | 无角色字段 ' +
      stats.missingCharacter +
      ' | 无 traces ' +
      stats.missingTraces +
      ' | 根目录散落文件 ' +
      stats.looseFiles,
  );
  lines.push('');
  lines.push('-- 表 A · 逐场实测对账 (角色 × 批次目录) --');
  pushTable(
    lines,
    [
      '批次目录',
      '角色',
      '场次',
      '退化场次',
      '触达场次',
      '触达率',
      '触达轮次 min/中位/max',
      '末轮 trust 均值',
      '末轮 safety 均值',
      '末轮 bond 均值',
      '末轮 depth 均值',
      '未触达末轮同盟短板',
      '未触达末轮深度短板',
      '卡点 同盟/深度/双',
    ],
    perDir.map((group) => [
      group.dir,
      group.characterLabel,
      String(group.sessions),
      String(group.degradedSessions),
      String(group.reachedSessions),
      (group.reachRate * 100).toFixed(1) + '%',
      fmt(group.reachTurnMin, 0) + ' / ' + fmt(group.reachTurnMedian, 0) + ' / ' + fmt(group.reachTurnMax, 0),
      fmt(group.lastTrustMean),
      fmt(group.lastSafetyMean),
      fmt(group.lastBondMean),
      fmt(group.lastDepthMean),
      fmt(group.gapAllianceMean),
      fmt(group.gapDepthMean),
      group.blockerAlliance + ' / ' + group.blockerDepth + ' / ' + group.blockerBoth,
    ]),
  );
  lines.push('-- 表 B · 跨目录总览 (角色一层 · 参考汇总, 不掩盖分层差异) --');
  pushTable(
    lines,
    [
      '角色',
      '场次',
      '退化场次',
      '触达场次',
      '触达率',
      '触达轮次 min/中位/max',
      '末轮 trust 均值',
      '末轮 safety 均值',
      '末轮 bond 均值',
      '末轮 depth 均值',
      '未触达末轮同盟短板',
      '未触达末轮深度短板',
      '卡点 同盟/深度/双',
    ],
    perCharacter.map((group) => [
      group.characterLabel,
      String(group.sessions),
      String(group.degradedSessions),
      String(group.reachedSessions),
      (group.reachRate * 100).toFixed(1) + '%',
      fmt(group.reachTurnMin, 0) + ' / ' + fmt(group.reachTurnMedian, 0) + ' / ' + fmt(group.reachTurnMax, 0),
      fmt(group.lastTrustMean),
      fmt(group.lastSafetyMean),
      fmt(group.lastBondMean),
      fmt(group.lastDepthMean),
      fmt(group.gapAllianceMean),
      fmt(group.gapDepthMean),
      group.blockerAlliance + ' / ' + group.blockerDepth + ' / ' + group.blockerBoth,
    ]),
  );
  lines.push('-- 方法退化诊断 (为什么主口径 A 可能恒判「不可达」) --');
  pushTable(
    lines,
    [
      '角色',
      '活跃轮占比',
      'A · Δtrust 中位',
      'A · Δsafety 中位',
      'A · Δdepth 中位',
      'B · 净 Δtrust/轮',
      'B · 净 Δsafety/轮',
      'B · 净 Δdepth/轮',
    ],
    extrapolations.map((extrapolation) => {
      const stats = extrapolation.stats;
      const net = extrapolation.net.stats;
      return [
        extrapolation.characterSlug,
        extrapolation.activeTurnRate === null ? 'n/a' : (extrapolation.activeTurnRate * 100).toFixed(1) + '%',
        stats === null ? 'n/a' : stats.trustMedian.toFixed(4),
        stats === null ? 'n/a' : stats.safetyMedian.toFixed(4),
        stats === null ? 'n/a' : stats.depthMedian.toFixed(4),
        net === null ? 'n/a' : net.trustMedian.toFixed(4),
        net === null ? 'n/a' : net.safetyMedian.toFixed(4),
        net === null ? 'n/a' : net.depthMedian.toFixed(4),
      ];
    }),
  );
  lines.push(
    'A = 任务单主口径 (相邻轮差分中位); B = 补充口径 (整场净变化 / 有效轮数). 归档样本的相邻轮差分高度零膨胀 → A 的中位常为 0 → A 恒判「方向不支持」, 这是**方法退化**, 不是临床不可达结论.',
  );
  lines.push('');
  lines.push('-- 表 C · 实测 / 外推 / 台账 三列对照 (外推列 = 非实测) --');
  pushTable(
    lines,
    [
      '角色',
      '台账线性外推轮次 (只读对照)',
      '本单外推 A · 相邻轮差分中位 (非实测)',
      '外推 A 区间',
      '本单外推 B · 会话净变化率 (非实测)',
      '外推 B 区间',
      '序列内实测触达轮次 (实测)',
      '序列内实测触达率',
      '偏差方向与量级 (A)',
      '偏差方向与量级 (B)',
    ],
    perCharacter.map((group) => {
      const slug = group.characterSlug;
      const ledger = LEDGER_TABLE.find((row) => row.characterSlug === slug);
      const extrapolation = extrapolations.find((item) => item.characterSlug === slug);
      const range = formatRange(extrapolation?.roundsFast ?? null, extrapolation?.roundsSlow ?? null, options.maxHorizon);
      const statusText =
        extrapolation?.status === 'unreachable-direction'
          ? '不可达 (增量方向不支持)'
          : extrapolation?.status === 'unreachable-horizon'
            ? '不可达 (超出外推视界)'
            : extrapolation?.status === 'insufficient-sample'
              ? '样本不足 (不出结论)'
              : extrapolation?.status === 'reached-in-sequence'
                ? '序列内已全部触达'
                : fmt(extrapolation?.roundsMedian ?? null, 0);
      const net = extrapolation?.net;
      const netRange = formatRange(net?.roundsFast ?? null, net?.roundsSlow ?? null, options.maxHorizon);
      const netStatusText =
        net?.status === 'unreachable-direction'
          ? '不可达 (增量方向不支持)'
          : net?.status === 'unreachable-horizon'
            ? '不可达 (超出外推视界)'
            : net?.status === 'insufficient-sample'
              ? '样本不足 (不出结论)'
              : net?.status === 'reached-in-sequence'
                ? '序列内已全部触达'
                : fmt(net?.roundsMedian ?? null, 0);
      return [
        group.characterLabel,
        ledger?.rounds === null || ledger === undefined ? 'n/a' : String(ledger.rounds),
        statusText,
        range,
        netStatusText,
        netRange,
        fmt(group.reachTurnMin, 0) + ' / ' + fmt(group.reachTurnMedian, 0) + ' / ' + fmt(group.reachTurnMax, 0),
        (group.reachRate * 100).toFixed(1) + '%',
        compareWithLedger(ledger?.rounds ?? null, extrapolation?.roundsMedian ?? null),
        compareWithLedger(ledger?.rounds ?? null, net?.roundsMedian ?? null),
      ];
    }),
  );
  lines.push('-- 表 D · 档位归类 (沿用 C5-1 分层, 不新建阈值, 不进判据表/门禁/verdict) --');
  pushTable(
    lines,
    [
      '角色',
      '外推 A 区间 (非实测)',
      '外推 B 区间 (非实测)',
      '12 轮档 (按 B · intake 不验探索)',
      '40 轮档 (按 B · 验探索)',
      '主增量来源层级',
      '有效差分样本数',
      '退化轮差分样本数',
      '活跃轮占比 (三维有变化的轮次占比)',
    ],
    perCharacter.map((group) => {
      const extrapolation = extrapolations.find((item) => item.characterSlug === group.characterSlug);
      const verdict = classifyTier(extrapolation?.roundsFast ?? null, extrapolation?.roundsSlow ?? null);
      const net = extrapolation?.net;
      const netVerdict = classifyTier(net?.roundsFast ?? null, net?.roundsSlow ?? null);
      const range = formatRange(extrapolation?.roundsFast ?? null, extrapolation?.roundsSlow ?? null, options.maxHorizon);
      const netRange = formatRange(net?.roundsFast ?? null, net?.roundsSlow ?? null, options.maxHorizon);
      return [
        group.characterLabel,
        range,
        netRange,
        netVerdict.tier12,
        netVerdict.tier40,
        extrapolation?.sourceLabel ?? 'n/a',
        extrapolation?.stats === null || extrapolation === undefined ? 'n/a' : String(extrapolation.stats.count),
        String(extrapolation?.degradedSampleCount ?? 0),
        extrapolation?.activeTurnRate === null || extrapolation === undefined
          ? 'n/a'
          : (extrapolation.activeTurnRate * 100).toFixed(1) + '%',
      ];
    }),
  );
  lines.push('-- 表 E · 增量样本明细 (主增量 = 非退化轮差分) --');
  pushTable(
    lines,
    [
      '角色',
      'A · Δtrust 中位 (p25 / p75)',
      'A · Δsafety 中位 (p25 / p75)',
      'A · Δdepth 中位 (p25 / p75)',
      'A 样本数',
      'B · 净 Δtrust/轮 (p25 / p75)',
      'B · 净 Δsafety/轮 (p25 / p75)',
      'B · 净 Δdepth/轮 (p25 / p75)',
      'B 来源',
      '备注',
    ],
    extrapolations.map((extrapolation) => {
      const stats = extrapolation.stats;
      const net = extrapolation.net.stats;
      return [
        extrapolation.characterSlug,
        stats === null ? 'n/a' : stats.trustMedian.toFixed(4) + ' (' + stats.trustP25.toFixed(4) + ' / ' + stats.trustP75.toFixed(4) + ')',
        stats === null
          ? 'n/a'
          : stats.safetyMedian.toFixed(4) + ' (' + stats.safetyP25.toFixed(4) + ' / ' + stats.safetyP75.toFixed(4) + ')',
        stats === null ? 'n/a' : stats.depthMedian.toFixed(4) + ' (' + stats.depthP25.toFixed(4) + ' / ' + stats.depthP75.toFixed(4) + ')',
        stats === null ? 'n/a' : String(stats.count),
        net === null ? 'n/a' : net.trustMedian.toFixed(4) + ' (' + net.trustP25.toFixed(4) + ' / ' + net.trustP75.toFixed(4) + ')',
        net === null ? 'n/a' : net.safetyMedian.toFixed(4) + ' (' + net.safetyP25.toFixed(4) + ' / ' + net.safetyP75.toFixed(4) + ')',
        net === null ? 'n/a' : net.depthMedian.toFixed(4) + ' (' + net.depthP25.toFixed(4) + ' / ' + net.depthP75.toFixed(4) + ')',
        extrapolation.net.sourceLabel,
        extrapolation.notes.join('; '),
      ];
    }),
  );
  lines.push('-- 外推假设 (结论只在这些假设下成立) --');
  lines.push('恒定增量速率 / 无阻抗反弹 / 无危机-破裂态 / 无跨会话衰减 / 无事件类型结构变化 / 状态 clamp [0,1].');
  lines.push('外推是模型估算, 不是实测 —— 不得与实测列混排解读.');
  lines.push('');
  return lines;
}

/**
 * CLI 入口 (只读 · 无副作用 · 不连 DB / 不发网络 / 不调模型).
 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { records: rawRecords, stats } = readArchiveSessions(options.dir);
  const reconciliations: SessionReconciliation[] = [];
  const allPairs: DeltaPair[] = [];
  for (const record of rawRecords) {
    const reconciliation = reconcileSession(record.dir, record.session);
    if (reconciliation !== null) reconciliations.push(reconciliation);
    allPairs.push(...deltaPairsOf(record.dir, record.session));
  }
  const perCharacter = aggregateByCharacter(reconciliations);
  const extrapolations: Extrapolation[] = [];
  for (const group of perCharacter) {
    const pairs = allPairs.filter((pair) => pair.characterSlug === group.characterSlug);
    const characterRecords = reconciliations.filter((record) => record.characterSlug === group.characterSlug);
    extrapolations.push(extrapolateCharacter(group.characterSlug, characterRecords, pairs, allPairs, reconciliations, options));
  }
  const perDir = aggregateByDir(reconciliations);
  const report = buildReport({ options, stats, records: reconciliations, perDir, perCharacter, extrapolations });
  for (const line of report) console.log(line);
  if (options.out !== null) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, report.join('\n') + '\n', 'utf8');
    console.log('已写出 ' + options.out);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
