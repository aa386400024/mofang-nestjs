// V2026-11-29 (Phase3 Judge Layer P0 · Shadow 编排):
//   职责: 批次跑批后, 按场次旁路调用 Judge; 失败/超时/越界一律记 null, 批次继续.
//   边界: 只做输入装配 / 排除规则 / 调用与容错; 不做 Provider SDK、不做回归判定.
//
//   关键纪律:
//     ① 危机 / 自伤轮次及其**相邻轮**在进入外部请求前被规则排除, 只留本地规则结论与引用;
//     ② 先脱敏再出境 (judge.redaction.ts), 结构化摘要也不含原文;
//     ③ Shadow 结果写进报告的 judge 段, 不改 triggerQuality / suggestionQuality / baselineComparison.

import { assertJudgeReviewInput, assertJudgeReviewResult, JudgeContractError } from './judge.contract.js';
import { computeJudgeInputFingerprint } from './judge.fingerprint.js';
import { JudgeProviderError } from './judge.provider.js';
import { redactJudgeInput, isCrisisSignal } from './judge.redaction.js';
import { JUDGE_RUBRIC_VERSION, JUDGE_PROMPT_VERSION, computeJudgeRubricFingerprint } from './judge.rubric.js';
import type { ReviewJudgePort, JudgeEventTagTurn, JudgeReviewInput, JudgeLocalRuleFinding, JudgeSnapshotSection } from './judge.types.js';
import { JUDGE_SHADOW_MODE, JUDGE_MACHINE_PROXY_LABEL } from './judge.types.js';

/** 默认单场 Judge 超时 (ms) —— 超时即记 null, 不拖住批次. */
export const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;

/** 参与 Shadow 评审的一轮 (结构最小集). */
export interface JudgeShadowTurn {
  /** 轮次. */
  readonly turnIndex: number;
  /** 风险等级. */
  readonly riskLevel: string;
  /** 事件标签. */
  readonly events: readonly string[];
  /** 轮前状态 (数值). */
  readonly before: Readonly<Record<string, number>>;
  /** 轮后状态 (数值). */
  readonly after: Readonly<Record<string, number>>;
  /** 可选原文 (仅用于本地脱敏; 不出境). */
  readonly rawText?: string;
}

/** 参与 Shadow 评审的一场. */
export interface JudgeShadowSession {
  /** 场次 id. */
  readonly sessionId: string;
  /** 逐轮. */
  readonly turns: readonly JudgeShadowTurn[];
}

/** Shadow 编排入参. */
export interface JudgeShadowOptions {
  /** 场次. */
  readonly sessions: readonly JudgeShadowSession[];
  /** 评审端口. */
  readonly port: ReviewJudgePort;
  /** 时钟. */
  readonly now?: () => Date;
  /** 单场超时. */
  readonly timeoutMs?: number;
}

/** 超时错误 (内部用). */
class JudgeTimeoutError extends Error {
  constructor() {
    super('judge_timeout');
    this.name = 'JudgeTimeoutError';
  }
}

/**
 * 选出危机 / 自伤轮及其相邻轮 (它们不进入外部请求).
 *
 * @param turns 逐轮
 * @returns 被排除的下标集合与本地规则结论
 */
export function selectExcludedTurns(turns: readonly JudgeShadowTurn[]): {
  readonly excludedIndexes: ReadonlySet<number>;
  readonly findings: readonly JudgeLocalRuleFinding[];
} {
  const crisisIndexes = turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => isCrisisSignal(turn.riskLevel, turn.events, turn.rawText))
    .map(({ index }) => index);
  const excluded = new Set<number>();
  const findings: JudgeLocalRuleFinding[] = [];

  for (const index of crisisIndexes) {
    excluded.add(index);
    findings.push({
      turnIndex: turns[index].turnIndex,
      riskLevel: turns[index].riskLevel,
      ruleRef: 'local-risk-rule',
      adjacent: false,
    });
    for (const neighbor of [index - 1, index + 1]) {
      if (neighbor < 0 || neighbor >= turns.length) continue;
      excluded.add(neighbor);
      if (!crisisIndexes.includes(neighbor)) {
        findings.push({
          turnIndex: turns[neighbor].turnIndex,
          riskLevel: turns[neighbor].riskLevel,
          ruleRef: 'crisis-adjacent-exclusion',
          adjacent: true,
        });
      }
    }
  }

  return { excludedIndexes: excluded, findings };
}

/**
 * 取并集维度.
 *
 * @param values 数值字典
 * @returns 维度名
 */
function unionKeys(values: readonly Readonly<Record<string, number>>[]): string[] {
  const keys = new Set<string>();
  for (const value of values) for (const key of Object.keys(value)) keys.add(key);
  return [...keys].toSorted((left, right) => left.localeCompare(right));
}

/**
 * 计算逐维差值.
 *
 * @param first 首值
 * @param last 末值
 * @returns 差值字典
 */
function diffRecord(first: Readonly<Record<string, number>>, last: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of unionKeys([first, last])) {
    out[key] = Number(((last[key] ?? 0) - (first[key] ?? 0)).toFixed(6));
  }
  return out;
}

/**
 * 装配一场的 Judge 输入 (先排除, 再脱敏).
 *
 * @param session 场次
 * @returns 输入; 全部轮次被排除时返回 null
 */
export function buildJudgeInput(session: JudgeShadowSession, port: Pick<ReviewJudgePort, 'providerId' | 'model'>): JudgeReviewInput | null {
  const { excludedIndexes, findings } = selectExcludedTurns(session.turns);
  const eligible = session.turns.filter((_turn, index) => !excludedIndexes.has(index));
  if (eligible.length === 0) return null;

  const firstTurn = eligible[0];
  const lastTurn = eligible.at(-1)!;
  const l0 = {
    first: { ...firstTurn.before },
    last: { ...lastTurn.after },
    delta: diffRecord(firstTurn.before, lastTurn.after),
    turnCount: session.turns.length,
  };
  const l1: JudgeEventTagTurn[] = eligible.map((turn) => ({ turnIndex: turn.turnIndex, eventTags: [...turn.events] }));
  const redacted = eligible.map((turn) =>
    redactJudgeInput({
      turnIndex: turn.turnIndex,
      rawText: turn.rawText,
      eventTags: turn.events,
      riskLevel: turn.riskLevel,
    }),
  );

  const lineageSeed = {
    providerId: port.providerId,
    model: port.model,
    rubricVersion: JUDGE_RUBRIC_VERSION,
    promptVersion: JUDGE_PROMPT_VERSION,
    rubricFingerprint: computeJudgeRubricFingerprint(),
    inputFingerprint: '',
    sessionId: session.sessionId,
    mode: JUDGE_SHADOW_MODE,
    judgeKind: 'machine_proxy' as const,
  };
  const provisional: JudgeReviewInput = {
    sessionId: session.sessionId,
    l0,
    l1,
    redactedExcerpts: redacted.map((item) => item.excerpt),
    excludedTurns: findings,
    lineage: lineageSeed,
  };
  const input: JudgeReviewInput = {
    ...provisional,
    lineage: { ...provisional.lineage, inputFingerprint: computeJudgeInputFingerprint(provisional) },
  };
  assertJudgeReviewInput(input);
  return input;
}

/**
 * 带超时的 Promise.
 *
 * @param promise 待等待
 * @param timeoutMs 超时
 * @returns 原 Promise 结果
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new JudgeTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 从异常里取失败原因码.
 *
 * @param error 异常
 * @returns 原因码
 */
function failureCodeOf(error: unknown): string {
  if (error instanceof JudgeTimeoutError) return 'timeout';
  if (error instanceof JudgeContractError) return error.code;
  if (error instanceof JudgeProviderError) return error.code;
  return 'provider_error';
}

/**
 * 跑一批 Shadow 评审.
 *
 * ⚠️ 本函数**不抛异常** —— 单场失败记 null, 批次继续; 返回段永远可被快照守卫校验.
 *
 * @param options 入参
 * @returns 快照 / 报告用的 Judge 段
 */
export async function runJudgeShadow(options: JudgeShadowOptions): Promise<JudgeSnapshotSection> {
  const now = (options.now ?? (() => new Date()))();
  const timeoutMs = options.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;
  const reviews: (Awaited<ReturnType<ReviewJudgePort['review']>> | null)[] = [];
  const failureCodes: Record<string, number> = {};
  let failedSessions = 0;

  for (const session of options.sessions) {
    try {
      const input = buildJudgeInput(session, options.port);
      if (input === null) {
        failedSessions += 1;
        failureCodes['crisis_all_turns_excluded'] = (failureCodes['crisis_all_turns_excluded'] ?? 0) + 1;
        reviews.push(null);
        continue;
      }
      const result = await withTimeout(options.port.review(input), timeoutMs);
      assertJudgeReviewResult(result, input);
      if (result.lineage.providerId !== options.port.providerId) {
        throw new JudgeContractError('review_invalid', 'Provider 回填不一致');
      }
      if (result.lineage.model !== options.port.model) {
        throw new JudgeContractError('review_invalid', '模型回填不一致');
      }
      reviews.push(result);
    } catch (error) {
      failedSessions += 1;
      const code = failureCodeOf(error);
      failureCodes[code] = (failureCodes[code] ?? 0) + 1;
      reviews.push(null);
    }
  }

  const section: JudgeSnapshotSection = {
    mode: JUDGE_SHADOW_MODE,
    machineProxy: true,
    disclaimer: JUDGE_MACHINE_PROXY_LABEL,
    providerId: options.port.providerId,
    model: options.port.model,
    rubricVersion: JUDGE_RUBRIC_VERSION,
    promptVersion: JUDGE_PROMPT_VERSION,
    rubricFingerprint: computeJudgeRubricFingerprint(),
    attemptedSessions: options.sessions.length,
    reviewedSessions: options.sessions.length - failedSessions,
    failedSessions,
    failureCodes,
    reviews,
    generatedAt: now.toISOString(),
  };
  return section;
}
