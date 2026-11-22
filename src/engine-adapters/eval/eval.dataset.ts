// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · 数据层):
//   职责: 数据集的**加载** (IO) 与**清洗** (纯判定) —— 脏数据不进主指标.
//   边界: 清洗逻辑是纯函数 (零 IO); 只有 load* 系列碰文件系统.
//
//   为什么清洗门槛集中在这一个文件:
//     任务单 §5.1 列了四条过滤条件. 这四条一旦分散到"算指标的时候顺手判一下",
//     就会出现"这次算 F1 用 A 口径, 下次用 B 口径"的漂移 —— 指标跨版本就不可比.
//     所以: **判定只有一份** —— 过滤逻辑只在这里, 指标层只负责算干净数据上的分.
//
//   ⚠️ 四条门槛与任务单的偏差 (有意为之, 已写进交付记录):
//     任务单写的是"BDI 状态异常 (突然跳到 100 或 0, 或连续 3 轮不变)".
//     这里实现为三条更严的判据: 越界 (<0 或 >值域上界) / 单轮跳变 >= 0.5 / 连续 3 轮全维度不变.
//     理由: 内核对信任类维度做了 clamp, 0 与 1 都是**合法**端点值 (完全无信任 / 完全信任),
//     直接把"等于 0/1"判成脏数据会误杀极端但真实的会话 —— 宁可少杀, 不可错杀.
//     真正该抓的"跳到 100 或 0"是**突变**, 由"单轮跳变"这条兜住.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/eval/eval.dataset.spec.ts 覆盖四条门槛 + 督导案例解析

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  EVAL_STATE_DIMS,
  type EvalCompactState,
  type EvalDataQuality,
  type EvalDataset,
  type EvalDelta,
  type EvalDropReason,
  type EvalSessionRecord,
  type EvalSplit,
  type EvalTurnRecord,
} from './eval.types.js';
import { createEmptyBdiSnapshot } from '../../engine-core/index.js';
import type { BdiSnapshot } from '../../engine-core/index.js';

/** 清洗门槛 (可被调用方覆写). */
export interface EvalCleaningThresholds {
  /** 最少轮次 (少于它 = 太短, 没有统计意义). */
  readonly minTurns: number;
  /** 单轮跳变上限 (任一维度变化 >= 它 = 状态突变). */
  readonly maxTurnJump: number;
  /** 连续不变轮数 (全维度连续这么多轮不变 = 引擎卡死). */
  readonly freezeTurns: number;
}

/** 默认清洗门槛 (任务单 §5.1). */
export const DEFAULT_EVAL_CLEANING_THRESHOLDS: EvalCleaningThresholds = {
  minTurns: 5,
  maxTurnJump: 0.5,
  freezeTurns: 3,
};

/** 被丢弃的一场会话 (含原因, 报告里能追责). */
export interface EvalDroppedSession {
  /** 会话 id. */
  readonly sessionId: string;
  /** 丢弃原因. */
  readonly reason: EvalDropReason;
  /** 原因细节 (人话). */
  readonly detail: string;
}

/** 清洗结果. */
export interface EvalCleanResult {
  /** 通过清洗的数据集 (只含有效会话). */
  readonly dataset: EvalDataset;
  /** 数据质量统计. */
  readonly quality: EvalDataQuality;
  /** 被丢弃的会话明细. */
  readonly dropped: readonly EvalDroppedSession[];
}

/**
 * 把紧凑状态还原成内核 BDI 快照.
 *
 * ⚠️ 为什么必须走内核工厂 (createEmptyBdiSnapshot) 而不是自己拼一个对象:
 *   内核快照有信念层 / 愿望层 / 记忆层 / 情绪标签等十几个槽位, 少填一个就可能
 *   让 buildStateComparison 少算维度 —— 闸门重算结果全错, 而且**不报错** (静默失效).
 *   走工厂 = 缺的槽位由内核自己给中性值, 维度映射永远跟内核一致.
 *
 * @param compact 紧凑状态 (11 维数值)
 * @returns BDI 快照
 */
export function toBdiSnapshot(compact: EvalCompactState): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    trust: compact.trust,
    safety: compact.safety,
    bond: compact.bond,
    emotion: { ...base.emotion, valence: compact.valence, arousal: compact.arousal },
    resistance: { verbal: compact.verbal, depth: compact.depth, style: compact.style },
    transference: { positive: compact.positive, negative: compact.negative, dependency: compact.dependency },
  };
}

/**
 * 求两个紧凑状态之间的逐维变化 (11 维, 顺序 = EVAL_STATE_DIMS).
 *
 * @param before 前
 * @param after 后
 * @returns 逐维变化量
 */
export function diffCompactStates(before: EvalCompactState, after: EvalCompactState): Record<string, number> {
  const diff: Record<string, number> = {};
  for (const dim of EVAL_STATE_DIMS) {
    diff[dim] = after[dim] - before[dim];
  }
  return diff;
}

/**
 * 判断这个维度有没有越过值域 (越界 = 引擎 bug / 数据损坏).
 *
 * ⚠️ 效价 valence 的值域是 [-1,1], 其余十维都是 [0,1] —— 统一按 [0,1] 判会把
 *   "情绪效价 -0.8" (完全正常) 误判成脏数据.
 *
 * @param dim 维度名
 * @param value 数值
 * @returns 是否越界
 */
function isOutOfRange(dim: string, value: number): boolean {
  if (!Number.isFinite(value)) return true;
  if (dim === 'valence') return Math.abs(value) > 1;
  return value < 0 || value > 1;
}

/**
 * 检测 BDI 状态异常 (越界 / 单轮突变 / 连续不变).
 *
 * @param turns 逐轮记录
 * @param thresholds 清洗门槛
 * @returns 异常描述 (null = 正常)
 */
export function detectBdiAnomaly(turns: readonly EvalTurnRecord[], thresholds: EvalCleaningThresholds): string | null {
  for (const turn of turns) {
    for (const dim of EVAL_STATE_DIMS) {
      if (isOutOfRange(dim, turn.before[dim])) return `第 ${turn.turnIndex} 轮维度 ${dim} 的起始值越界 (${turn.before[dim]})`;
      if (isOutOfRange(dim, turn.after[dim])) return `第 ${turn.turnIndex} 轮维度 ${dim} 的结束值越界 (${turn.after[dim]})`;
    }
    const diff = diffCompactStates(turn.before, turn.after);
    for (const dim of EVAL_STATE_DIMS) {
      // ⚠️ 加 1e-9 容差: 浮点减法会让"正好等于阈值"的跳变算出 0.49999999999999994,
      //   严格 >= 会漏判. 阈值判定的边界必须容差, 否则同一份数据两次判定结果可能不同.
      if (Math.abs(diff[dim]) + 1e-9 >= thresholds.maxTurnJump) {
        return `第 ${turn.turnIndex} 轮维度 ${dim} 单轮跳变 ${diff[dim]} (>= ${thresholds.maxTurnJump})`;
      }
    }
  }

  let unchangedStreak = 0;
  for (const turn of turns) {
    const diff = diffCompactStates(turn.before, turn.after);
    // ⚠️ 用 1e-9 容差判"不变": 浮点尾数 (0.1+0.2-0.3 ≈ 5.5e-17) 不该被当成状态变化.
    const allFlat = EVAL_STATE_DIMS.every((dim) => Math.abs(diff[dim]) < 1e-9);
    unchangedStreak = allFlat ? unchangedStreak + 1 : 0;
    if (unchangedStreak >= thresholds.freezeTurns) {
      return `连续 ${unchangedStreak} 轮状态全维度不变 (第 ${turn.turnIndex} 轮起)`;
    }
  }
  return null;
}

/**
 * 判定一场会话是否命中"有错误"门槛.
 *
 * ⚠️ 降级 (degraded) 也算脏: 降级意味着这一轮的输出是兜底产物, 不是模型真实输出 ——
 *   拿它算"审议准不准"是在测兜底逻辑, 不是在测审议.
 *
 * @param turns 逐轮记录
 * @returns 命中原因 (null = 干净)
 */
export function detectSessionError(turns: readonly EvalTurnRecord[]): string | null {
  for (const turn of turns) {
    if (turn.hasError === true) return `第 ${turn.turnIndex} 轮报错 / 空回复 / 超时`;
    if (turn.degraded === true) return `第 ${turn.turnIndex} 轮降级 (兜底回复)`;
  }
  return null;
}

/**
 * 清洗数据集 (纯函数).
 *
 * ⚠️ 四条门槛的判定顺序固定: 轮次 → 错误 → BDI 异常 → 闸门 trace.
 *   顺序固定 = 同一份脏数据每次被丢掉的原因**一致**, 报告里的 dropReasons 才可比.
 *
 * @param dataset 原始数据集
 * @param thresholds 门槛覆写
 * @returns 清洗结果 (有效数据集 + 数据质量统计 + 丢弃明细)
 */
export function cleanEvalDataset(dataset: EvalDataset, thresholds?: Partial<EvalCleaningThresholds>): EvalCleanResult {
  const limits: EvalCleaningThresholds = { ...DEFAULT_EVAL_CLEANING_THRESHOLDS, ...thresholds };
  const validSessions: EvalSessionRecord[] = [];
  const dropped: EvalDroppedSession[] = [];
  const dropReasons: Record<EvalDropReason, number> = { too_short: 0, has_error: 0, bdi_anomaly: 0, missing_gate_trace: 0 };
  let turnsWithMissingGateTrace = 0;

  for (const session of dataset.sessions) {
    const turns = session.turns ?? [];
    const errorDetail = detectSessionError(turns);
    const anomalyDetail = detectBdiAnomaly(turns, limits);
    const missingTraceTurns = turns.filter((turn) => turn.gateDecision === null).length;
    turnsWithMissingGateTrace += missingTraceTurns;

    if (turns.length < limits.minTurns) {
      dropReasons.too_short += 1;
      dropped.push({ sessionId: session.sessionId, reason: 'too_short', detail: `只有 ${turns.length} 轮 (< ${limits.minTurns})` });
      continue;
    }
    if (errorDetail) {
      dropReasons.has_error += 1;
      dropped.push({ sessionId: session.sessionId, reason: 'has_error', detail: errorDetail });
      continue;
    }
    if (anomalyDetail) {
      dropReasons.bdi_anomaly += 1;
      dropped.push({ sessionId: session.sessionId, reason: 'bdi_anomaly', detail: anomalyDetail });
      continue;
    }
    if (missingTraceTurns === turns.length) {
      dropReasons.missing_gate_trace += 1;
      dropped.push({ sessionId: session.sessionId, reason: 'missing_gate_trace', detail: '全部轮次都没有闸门 trace' });
      continue;
    }
    validSessions.push(session);
  }

  const quality: EvalDataQuality = {
    totalSessions: dataset.sessions.length,
    validSessions: validSessions.length,
    droppedSessions: dropped.length,
    dropReasons,
    turnsWithMissingGateTrace,
  };

  return {
    dataset: { ...dataset, sessions: validSessions },
    quality,
    dropped,
  };
}

/**
 * 督导案例文件 (任务单 §5.3 的原始格式).
 *
 * ⚠️ 这个结构里含**逐字稿** —— 解析时只取"标注结果", 原文不进评测数据集.
 */
export interface EvalSupervisorCaseFile {
  /** 案例 id. */
  readonly caseId: string;
  /** 咨询师逐字稿 (解析后丢弃). */
  readonly counselorTurns?: readonly string[];
  /** 来访逐字稿 (解析后丢弃). */
  readonly visitorTurns?: readonly string[];
  /** 督导标注. */
  readonly supervisorNotes: readonly {
    /** 轮次. */
    readonly turnIndex: number;
    /** 问题描述 (自由文本, 解析后丢弃). */
    readonly issue?: string;
    /** 期望的 delta. */
    readonly expectedDeltas?: EvalDelta;
  }[];
}

/**
 * 把督导案例文件解析成评测数据集.
 *
 * ⚠️ 解析只做**结构化对齐** (轮次 → 期望 delta / 该跑标记), 不做语义判断:
 *   督导标注了"这里需要咨询师反思"的那一轮 = 该跑审议 (真值 = true);
 *   没标注的轮次 = 不该跑 (真值 = false) —— 这是督导案例的天然语义:
 *   督导只标"有问题的地方", 没标的地方就是没问题.
 *
 * ⚠️ 逐字稿被丢弃: 评测只吃结构化数值, 心理原文不出评测链路.
 *
 * @param raw 督导案例文件内容
 * @param version 数据集版本
 * @returns 评测数据集 (B 方案验收集)
 */
export function parseSupervisorCases(raw: EvalSupervisorCaseFile, version: string): EvalDataset {
  const notes = new Map<number, EvalSupervisorCaseFile['supervisorNotes'][number]>();
  for (const note of raw.supervisorNotes ?? []) {
    notes.set(note.turnIndex, note);
  }
  const turnCount = Math.max(
    raw.counselorTurns?.length ?? 0,
    raw.visitorTurns?.length ?? 0,
    ...(raw.supervisorNotes ?? []).map((note) => note.turnIndex),
  );

  const turns: EvalTurnRecord[] = [];
  for (let turnIndex = 1; turnIndex <= turnCount; turnIndex += 1) {
    const note = notes.get(turnIndex);
    const neutral = createNeutralState();
    turns.push({
      turnIndex,
      before: neutral,
      after: neutral,
      events: [],
      riskLevel: 'low',
      ruleDelta: {},
      llmDelta: null,
      gateDecision: null,
      expectedShouldRun: note !== undefined,
      expectedDeltas: note?.expectedDeltas,
    });
  }

  return {
    version,
    split: 'validation',
    synthetic: false,
    sessions: [{ sessionId: raw.caseId, split: 'validation', turns }],
  };
}

/**
 * 造一份中性状态 (值域中点) —— 督导案例没有状态数据时用它占位.
 *
 * @returns 中性紧凑状态
 */
export function createNeutralState(): EvalCompactState {
  return {
    trust: 0.5,
    safety: 0.5,
    bond: 0.5,
    valence: 0,
    arousal: 0.3,
    verbal: 0.3,
    depth: 0.3,
    style: 0.3,
    positive: 0,
    negative: 0,
    dependency: 0,
  };
}

/**
 * 从目录读一个数据集 (文件 = dataset.json).
 *
 * @param dir 数据集目录
 * @returns 数据集
 */
export function loadEvalDatasetFromDirectory(dir: string): EvalDataset {
  const file = path.join(dir, 'dataset.json');
  if (!existsSync(file)) {
    throw new Error(`评测数据集文件不存在: ${file}`);
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as EvalDataset;
  if (!parsed || !Array.isArray(parsed.sessions)) {
    throw new Error(`评测数据集格式非法 (缺 sessions): ${file}`);
  }
  return parsed;
}

/**
 * 列出数据集根目录下的所有版本.
 *
 * @param root 数据集根目录
 * @returns 版本名列表 (目录名)
 */
export function listEvalDatasetVersions(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * 解析数据集目录 (版本 → 目录).
 *
 * @param root 数据集根目录
 * @param version 版本名
 * @returns 目录绝对/相对路径
 */
export function resolveEvalDatasetDirectory(root: string, version: string): string {
  return path.join(root, version);
}

/**
 * 取一场会话的切分 (场次覆盖数据集默认).
 *
 * @param session 会话
 * @param fallback 数据集默认切分
 * @returns 切分
 */
export function resolveSessionSplit(session: EvalSessionRecord, fallback: EvalSplit): EvalSplit {
  return session.split ?? fallback;
}
