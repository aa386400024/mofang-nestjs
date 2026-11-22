// V2026-11-23 建立 (AF-342 · 真人度签名判据 v1):
//   职责: 用"人设签名事件是否保留 + 密度是否过载"两个轴给出三态判定, 替代只看密度的窗口判据.
//   边界: 纯函数, 零 IO / 零随机 / 零文本; 不替代人工判读, 不宣称临床真人度.

import { EVENT_TYPE_IDS, type EventTypeCounts, type EventTypeId } from './realism-event-type-profile.js';

export const SIGNATURE_JUDGE_VERSION = 'realism-signature-judge-v1' as const;

/**
 * 密度过载线, 沿用 AF-335/AF-337 full-only 报警线的统一点中 `4.943817`.
 * 来源: off 16 上界 4.280156 与 full 16 下界 5.685619 的中点附近, 只作"过载"提示, 不作真人认证.
 */
export const SIGNATURE_DENSITY_CAP_PER100 = 4.943817;

/** 焦虑依恋的签名事件是改口; off 16 次从未出现改口, 阈值取每 20 轮一次留余量. */
export const ANXIOUS_REPAIR_PER_TURN_MIN = 0.05;

/** 回避依恋的签名之一是把停顿保持到接近每轮; off 16 次最高 0.666667, 阈值取 0.9 留余量. */
export const GUARDED_PAUSE_PER_TURN_MIN = 0.9;

/** 回避依恋的签名之二是半截话; off 16 次最高 0.083333, 阈值取 0.15 留余量. */
export const GUARDED_TRAILOFF_PER_TURN_MIN = 0.15;

export type SignatureVerdict = 'off-like' | 'humanized' | 'overloaded';

export type SignaturePersonaFamily = 'anxious' | 'guarded';

export interface SignatureJudgeInput {
  readonly persona: string;
  readonly turns: number;
  readonly densityPer100: number;
  readonly counts: Partial<Record<EventTypeId, number>>;
}

export interface SignatureJudgeResult {
  readonly version: typeof SIGNATURE_JUDGE_VERSION;
  readonly persona: string;
  readonly personaFamily: SignaturePersonaFamily;
  readonly verdict: SignatureVerdict;
  readonly signaturePassed: boolean;
  readonly signatureRule: string;
  /** 签名强度相对阈值倍数; >=1 视为保留签名. */
  readonly signatureScore: number;
  readonly densityPer100: number;
  readonly densityCapPer100: number;
  readonly reasons: readonly string[];
}

export interface SignatureSample extends SignatureJudgeInput {
  readonly arm: string;
}

export interface SignatureCellSummary {
  readonly persona: string;
  readonly arm: string;
  readonly samples: number;
  readonly offLike: number;
  readonly humanized: number;
  readonly overloaded: number;
  readonly signatureRate: number;
  readonly humanizedRate: number;
  readonly meanDensityPer100: number;
}

export interface SignatureSampleDetail {
  readonly persona: string;
  readonly arm: string;
  readonly densityPer100: number;
  readonly signatureScore: number;
  readonly verdict: SignatureVerdict;
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function personaFamilyOf(persona: string): SignaturePersonaFamily {
  const normalized = typeof persona === 'string' ? persona.trim().toLowerCase() : '';
  if (normalized.includes('anxious') || normalized.includes('焦虑')) return 'anxious';
  if (normalized.includes('guarded') || normalized.includes('回避')) return 'guarded';
  throw new Error(`未知人设 "${persona}", 无法应用签名判据`);
}

/**
 * 对单个 12 轮级会话样本给出三态判定.
 *
 * 规则:
 * 1. 先看人设签名: 焦虑看改口频次, 回避看"接近每轮停顿"或半截话频次; 签名不保留即 off-like.
 * 2. 签名保留后再看密度: 超过 `SIGNATURE_DENSITY_CAP_PER100` 记 overloaded, 否则 humanized.
 * 3. 缺失 / 非有限 / 负数计数按 0; turns <=0 或 density 非法抛错, 不静默给结论.
 *
 * @param input 会话级密度与六类事件计数
 * @returns 三态判定与可解释原因
 */
export function judgeSignatureRealism(input: SignatureJudgeInput): SignatureJudgeResult {
  const family = personaFamilyOf(input.persona);
  if (!Number.isFinite(input.turns) || input.turns <= 0) {
    throw new Error(`turns 非法: ${String(input.turns)}`);
  }
  if (!Number.isFinite(input.densityPer100) || input.densityPer100 < 0) {
    throw new Error(`densityPer100 非法: ${String(input.densityPer100)}`);
  }

  const counts = Object.fromEntries(EVENT_TYPE_IDS.map((id) => [id, finiteNonNegative(input.counts[id])])) as Record<EventTypeId, number>;
  const repairPerTurn = counts.repair / input.turns;
  const pausePerTurn = counts.pause / input.turns;
  const trailoffPerTurn = counts.trailoff / input.turns;

  let signatureScore: number;
  let signatureRule: string;
  if (family === 'anxious') {
    signatureScore = repairPerTurn / ANXIOUS_REPAIR_PER_TURN_MIN;
    signatureRule = `repair/turn ${repairPerTurn.toFixed(6)} vs >= ${ANXIOUS_REPAIR_PER_TURN_MIN}`;
  } else {
    const pauseScore = pausePerTurn / GUARDED_PAUSE_PER_TURN_MIN;
    const trailoffScore = trailoffPerTurn / GUARDED_TRAILOFF_PER_TURN_MIN;
    signatureScore = Math.max(pauseScore, trailoffScore);
    signatureRule =
      `pause/turn ${pausePerTurn.toFixed(6)} vs >= ${GUARDED_PAUSE_PER_TURN_MIN} ` +
      `或 trailoff/turn ${trailoffPerTurn.toFixed(6)} vs >= ${GUARDED_TRAILOFF_PER_TURN_MIN}`;
  }
  const signaturePassed = signatureScore >= 1;

  const reasons: string[] = [
    `persona=${family}`,
    `signature ${signaturePassed ? 'pass' : 'fail'}: ${signatureRule}`,
    `density ${input.densityPer100.toFixed(6)} cap ${SIGNATURE_DENSITY_CAP_PER100}`,
  ];
  let verdict: SignatureVerdict;
  if (!signaturePassed) {
    verdict = 'off-like';
    reasons.push('无签名事件: 判 off-like');
  } else if (input.densityPer100 > SIGNATURE_DENSITY_CAP_PER100) {
    verdict = 'overloaded';
    reasons.push('签名保留但密度过载: 判 overloaded');
  } else {
    verdict = 'humanized';
    reasons.push('签名保留且密度未过载: 判 humanized');
  }

  return {
    version: SIGNATURE_JUDGE_VERSION,
    persona: input.persona,
    personaFamily: family,
    verdict,
    signaturePassed,
    signatureRule,
    signatureScore,
    densityPer100: input.densityPer100,
    densityCapPer100: SIGNATURE_DENSITY_CAP_PER100,
    reasons,
  };
}

/**
 * 按 persona + arm 汇总三态分布; 输出稳定排序, 不修改输入.
 *
 * @param samples 带 arm 标签的样本列表
 * @returns 每个 persona + arm 一条汇总
 */
export function summarizeSignatureVerdicts(samples: readonly SignatureSample[]): SignatureCellSummary[] {
  const groups = new Map<string, { persona: string; arm: string; densitySum: number; verdicts: SignatureVerdict[]; signatures: number }>();

  for (const sample of samples) {
    const persona = typeof sample.persona === 'string' && sample.persona.trim().length > 0 ? sample.persona.trim() : 'unknown';
    const arm = typeof sample.arm === 'string' && sample.arm.trim().length > 0 ? sample.arm.trim() : 'unknown';
    const key = `${persona}\u0000${arm}`;
    const group = groups.get(key) ?? { persona, arm, densitySum: 0, verdicts: [], signatures: 0 };
    const result = judgeSignatureRealism(sample);
    group.densitySum += result.densityPer100;
    group.verdicts.push(result.verdict);
    if (result.signaturePassed) group.signatures += 1;
    groups.set(key, group);
  }

  return [...groups.values()]
    .toSorted((left, right) => left.persona.localeCompare(right.persona) || left.arm.localeCompare(right.arm))
    .map((group) => {
      const samplesCount = group.verdicts.length;
      const offLike = group.verdicts.filter((verdict) => verdict === 'off-like').length;
      const humanized = group.verdicts.filter((verdict) => verdict === 'humanized').length;
      const overloaded = group.verdicts.filter((verdict) => verdict === 'overloaded').length;
      return {
        persona: group.persona,
        arm: group.arm,
        samples: samplesCount,
        offLike,
        humanized,
        overloaded,
        signatureRate: samplesCount > 0 ? group.signatures / samplesCount : 0,
        humanizedRate: samplesCount > 0 ? humanized / samplesCount : 0,
        meanDensityPer100: samplesCount > 0 ? group.densitySum / samplesCount : 0,
      };
    });
}

/**
 * 输出逐样本判定明细, 供审计与回归对照.
 *
 * @param samples 带 arm 标签的样本列表
 * @returns 逐样本明细, 稳定排序
 */
export function detailSignatureVerdicts(samples: readonly SignatureSample[]): SignatureSampleDetail[] {
  return samples
    .map((sample) => {
      const result = judgeSignatureRealism(sample);
      return {
        persona: sample.persona,
        arm: sample.arm,
        densityPer100: result.densityPer100,
        signatureScore: result.signatureScore,
        verdict: result.verdict,
      };
    })
    .toSorted(
      (left, right) =>
        left.persona.localeCompare(right.persona) || left.arm.localeCompare(right.arm) || left.densityPer100 - right.densityPer100,
    );
}

/** 导出计数类型, 方便 CLI 复用. */
export type SignatureJudgeCounts = Partial<EventTypeCounts>;
