// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · 入口层):
//   职责: 串起整条链路 (加载 → 清洗 → 跑 → 算指标 → 出报告 → 存库), 并兜住异常.
//   边界: 入口层不写业务判定 —— 判定在数据层 / 真值层, 计算在计算层, 执行在执行层.
//
//   为什么"出错不抛, 改成一份 failed 报告":
//     评测是**离线批处理** —— 一批跑崩了就崩了, 不该把整批结果全丢掉.
//     把失败做成一份 status=failed 的报告 (带失败原因), 调用方仍然拿到"这次没跑成"的结构化事实.
//
//   ⚠️ 报告里**只写结构化数值与枚举**, 不写任何对话原文 —— 心理内容不进日志 / 报告 / 异常消息.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/eval/eval.runner.spec.ts 覆盖链路串接与兜异常

import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  cleanEvalDataset,
  loadEvalDatasetFromDirectory,
  resolveEvalDatasetDirectory,
  type EvalCleaningThresholds,
  type EvalDroppedSession,
} from './eval.dataset.js';
import {
  computeBaselineComparison,
  computeRunsSummary,
  computeSuggestionQuality,
  computeTriggerQuality,
  type EvalSuggestionSample,
  type EvalTriggerPair,
} from './eval.metrics.js';
import { buildEvalReport, diffEvalReports, EVAL_REPORT_REPOSITORY, type EvalReportDiff, type EvalReportRepository } from './eval.report.js';
import { DEFAULT_EVAL_GATE_POLICY, EvalRunner, type EvalDeliberationExecutorPort, type EvalPredictionSample } from './eval.runner.js';
import type {
  EvalBaselineComparison,
  EvalCost,
  EvalDataQuality,
  EvalDelta,
  EvalMode,
  EvalReport,
  EvalReportConfig,
  EvalRunSnapshot,
  EvalRunsSummary,
  EvalSplit,
  EvalSuggestionQuality,
  EvalTriggerQuality,
} from './eval.types.js';

/** 数据集根目录的缺省位置 (相对仓库根). */
export const DEFAULT_EVAL_DATASET_ROOT = 'data/eval-datasets';

/** 跑一次评测的入参. */
export interface EvalRunRequest {
  /** 评测模式. */
  readonly mode: EvalMode;
  /** 数据集版本 (目录名). */
  readonly datasetVersion: string;
  /** 数据集根目录. */
  readonly datasetRoot?: string;
  /** 运行次数 (离线评测默认 1 —— 读历史数据没有随机性; 全量重跑默认 3). */
  readonly runs?: number;
  /** 模型标识 (写进报告). */
  readonly model?: string;
  /** prompt 版本 (写进报告). */
  readonly promptVersion?: string;
  /** 闸门策略 (全量重跑时用). */
  readonly gatePolicy?: EvalRunner['options']['gatePolicy'];
  /** 闸门模式. */
  readonly gateMode?: EvalRunner['options']['gateMode'];
  /** 清洗门槛覆写. */
  readonly cleaning?: Partial<EvalCleaningThresholds>;
  /** 审议重跑端口 (全量重跑时可选). */
  readonly deliberationExecutor?: EvalDeliberationExecutorPort;
  /** 上一版报告 (用于回归对比). */
  readonly previousReport?: EvalReport | null;
}

/** 链路的外部依赖 (便于单测注入假实现). */
export interface EvalPipelineDeps {
  /** 取时钟. */
  readonly now?: () => Date;
  /** 生成报告 id. */
  readonly reportId?: () => string;
  /** 加载数据集 (缺省读文件). */
  readonly loadDataset?: (root: string, version: string) => ReturnType<typeof loadEvalDatasetFromDirectory>;
}

/** 链路结果. */
export interface EvalPipelineResult {
  /** 报告. */
  readonly report: EvalReport;
  /** 与上一版的差异 (没有上一版则为 null). */
  readonly diff: EvalReportDiff | null;
  /** 被清洗丢弃的会话. */
  readonly dropped: readonly EvalDroppedSession[];
}

/**
 * 生成一个报告 id.
 *
 * ⚠️ 格式 eval-YYYYMMDD-HHmmss-随机后缀 —— 日期段让人一眼看出是哪天的评测,
 *   随机后缀保证同一秒跑两次也不撞 id (id 唯一是"人工抽检口子"的前提).
 *
 * @param now 当前时刻
 * @returns 报告 id
 */
export function buildEvalReportId(now: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = randomUUID().slice(0, 8);
  return `eval-${stamp}-${suffix}`;
}

/**
 * 把多次运行的预测合并成一份指标.
 *
 * ⚠️ 触发质量的计数是**跨运行累加**的 (pooled), 比率由累加后的计数推出 ——
 *   这样"跑了 3 次"的计数是真实的总样本量, 而不是某一轮的切片;
 *   单次运行的波动由 runs.mean / runs.stdDev 表达 (两套口径各管一件事).
 *
 * @param runResults 逐次运行结果
 * @returns 触发质量 / 建议质量 / 基线对比 / 多轮汇总
 */
export function aggregateRuns(runResults: readonly { samples: readonly EvalPredictionSample[] }[]): {
  triggerQuality: EvalTriggerQuality;
  suggestionQuality: EvalSuggestionQuality;
  baselineComparison: EvalBaselineComparison;
  runs: EvalRunsSummary;
} {
  const triggerPairs: EvalTriggerPair[] = [];
  const subjectSamples: EvalSuggestionSample[] = [];
  const baselineSamples: EvalSuggestionSample[] = [];
  const snapshots: EvalRunSnapshot[] = [];

  for (const runResult of runResults) {
    const pairs: EvalTriggerPair[] = [];
    for (const sample of runResult.samples) {
      if (sample.truthShouldRun === null || sample.predictedShouldRun === null) continue;
      pairs.push({ truth: sample.truthShouldRun, predicted: sample.predictedShouldRun });
    }
    triggerPairs.push(...pairs);
    const runTrigger = computeTriggerQuality(pairs);

    for (const sample of runResult.samples) {
      subjectSamples.push({ predicted: sample.predictedDelta, truth: sample.truthDelta });
      baselineSamples.push({ predicted: sample.baselineDelta, truth: sample.truthDelta });
    }

    const runSubject = computeSuggestionQuality(subjectSamplesForRun(runResult));
    snapshots.push({
      triggerF1: runTrigger.f1,
      precision: runTrigger.precision,
      recall: runTrigger.recall,
      directionAccuracy: runSubject.macroAverage,
      amplitudeMAE: runSubject.amplitudeMAE,
    });
  }

  const triggerQuality = computeTriggerQuality(triggerPairs);
  const subjectQuality = computeSuggestionQuality(subjectSamples, suggestionUnavailableReason(subjectSamples));
  const baselineQuality = computeSuggestionQuality(baselineSamples, suggestionUnavailableReason(baselineSamples));
  const baselineComparison = computeBaselineComparison(baselineQuality, subjectQuality);

  return {
    triggerQuality,
    suggestionQuality: subjectQuality,
    baselineComparison,
    runs: computeRunsSummary(snapshots),
  };
}

/**
 * 取单次运行里的建议质量样本 (用于算该次的均值 / 标准差).
 *
 * @param runResult 单次运行结果
 * @returns 样本
 */
function subjectSamplesForRun(runResult: { samples: readonly EvalPredictionSample[] }): EvalSuggestionSample[] {
  return runResult.samples.map((sample) => ({ predicted: sample.predictedDelta, truth: sample.truthDelta }));
}

/**
 * 建议质量不可算的原因 (区分"没真值"与"没样本").
 *
 * @param samples 样本
 * @returns 原因 (可算时 null)
 */
function suggestionUnavailableReason(samples: readonly EvalSuggestionSample[]): string | null {
  const withTruth = samples.filter((sample) => sample.truth !== null).length;
  if (withTruth === 0) {
    return '数据集没有人类真值 (督导标注): 建议质量不可算 —— 不用规则 delta 冒充真值';
  }
  if (samples.every((sample) => sample.predicted === null)) {
    return '没有审议输出样本: 建议质量不可算';
  }
  return null;
}

/**
 * 跑一次完整评测 (纯链路, 零 Nest 依赖 —— CLI 也走这一条).
 *
 * @param request 入参
 * @param deps 依赖
 * @returns 链路结果
 */
export async function runEvaluationPipeline(request: EvalRunRequest, deps: EvalPipelineDeps = {}): Promise<EvalPipelineResult> {
  const now = deps.now ? deps.now() : new Date();
  const root = request.datasetRoot ?? DEFAULT_EVAL_DATASET_ROOT;
  const load =
    deps.loadDataset ??
    ((datasetRoot: string, version: string) => loadEvalDatasetFromDirectory(resolveEvalDatasetDirectory(datasetRoot, version)));
  const dataset = load(root, request.datasetVersion);

  const cleaned = cleanEvalDataset(dataset, request.cleaning);
  const runs = Math.max(1, request.runs ?? (request.mode === 'full' ? 3 : 1));

  // ⚠️ 闸门策略缺省用生效模式的缺省策略 (阈值只有一份, 取自 WP-C 配置层).
  //   离线模式下这个策略**只用于报告上下文**: 判定用的是数据集里记录的决策, 不重算.
  const gatePolicy = request.gatePolicy ?? DEFAULT_EVAL_GATE_POLICY;
  const runner = new EvalRunner({
    mode: request.mode,
    gatePolicy,
    gateMode: request.gateMode,
    deliberationExecutor: request.deliberationExecutor,
  });

  const runResults: { samples: readonly EvalPredictionSample[] }[] = [];
  const notes: string[] = [];
  let totalTokens = 0;
  let durationSec = 0;
  for (let index = 0; index < runs; index += 1) {
    const result = await runner.run(cleaned.dataset);
    runResults.push(result);
    totalTokens += result.totalTokens;
    durationSec += result.durationSec;
    for (const note of result.notes) {
      notes.push(`[run ${index + 1}] ${note}`);
    }
  }

  const aggregated = aggregateRuns(runResults);
  const split: EvalSplit = cleaned.dataset.split;
  const config: EvalReportConfig = {
    model: request.model ?? 'unknown',
    promptVersion: request.promptVersion ?? 'unknown',
    gateThresholds: {
      alliance: gatePolicy.thresholds.alliance,
      resistance: gatePolicy.thresholds.resistance,
      calm: gatePolicy.thresholds.calm,
      cooldown: gatePolicy.cooldownTurns,
    },
    datasetVersion: cleaned.dataset.version,
    mode: request.mode,
    runs,
    split,
    groundTruthKind: detectGroundTruthKind(cleaned.dataset),
    synthetic: cleaned.dataset.synthetic,
  };

  const report = buildEvalReport({
    reportId: deps.reportId ? deps.reportId() : buildEvalReportId(now),
    createdAt: now.toISOString(),
    config,
    dataQuality: cleaned.quality,
    triggerQuality: aggregated.triggerQuality,
    suggestionQuality: aggregated.suggestionQuality,
    baselineComparison: aggregated.baselineComparison,
    runs: aggregated.runs,
    cost: { totalTokens, estimatedCostCny: estimateCostCny(totalTokens) },
    durationSec,
    sampleIds: collectSampleIds(runResults),
    notes,
    previous: request.previousReport ?? null,
  });

  const diff = diffEvalReports(request.previousReport ?? null, report);

  return { report, diff, dropped: cleaned.dropped };
}

/**
 * 判断整份数据集用哪套真值 (A 规则差异 / B 督导标注).
 *
 * ⚠️ 口径: 只要**任何一场**带督导标注, 整份按 B 口径算 —— 同一份报告里
 *   混用两套真值会让 P/R 不可比.
 *
 * @param dataset 数据集
 * @returns 真值来源
 */
export function detectGroundTruthKind(dataset: {
  sessions: readonly { turns: readonly { expectedShouldRun?: boolean }[] }[];
}): 'supervisor' | 'rule_diff' {
  for (const session of dataset.sessions) {
    for (const turn of session.turns) {
      if (turn.expectedShouldRun !== undefined) return 'supervisor';
    }
  }
  return 'rule_diff';
}

/**
 * 估算成本 (元).
 *
 * ⚠️ 单价写在这里只是**量级估算** —— 报告里的成本是给"这次评测烧了多少钱"一个数量级,
 *   不是财务口径. 真要算钱得看模型定价表.
 *
 * @param totalTokens 总 token
 * @returns 估算成本 (元)
 */
export function estimateCostCny(totalTokens: number): number {
  const PRICE_PER_MILLION_TOKENS_CNY = 6;
  return (totalTokens / 1_000_000) * PRICE_PER_MILLION_TOKENS_CNY;
}

/**
 * 收集样本 id (会话 id + 轮次) —— 人工抽检口子.
 *
 * ⚠️ 抽样 id 里**只有 id 与轮次**, 没有原文、没有情绪标签、没有 delta 数值 ——
 *   抽检的人需要的是"去哪儿找这一轮", 不是"这一轮的全部内容".
 *
 * @param runResults 逐次运行结果
 * @returns 样本 id 列表 (去重)
 */
export function collectSampleIds(runResults: readonly { samples: readonly EvalPredictionSample[] }[]): string[] {
  const ids = new Set<string>();
  for (const runResult of runResults) {
    for (const sample of runResult.samples) {
      ids.add(`${sample.sessionId}#${sample.turnIndex}`);
    }
  }
  return [...ids];
}

/**
 * 评测服务 (Nest 入口).
 *
 * ⚠️ 它只做三件事: 取上一版报告 → 跑链路 → 存库 + 兜异常.
 *   判定与计算一行都不在这里 —— 保持"判定只有一份".
 */
@Injectable()
export class EvalService {
  constructor(@Inject(EVAL_REPORT_REPOSITORY) private readonly repository: EvalReportRepository) {}

  /**
   * 跑一次评测并落库.
   *
   * @param request 入参
   * @returns 报告 (失败时返回 status=failed 的报告, 不抛)
   */
  async runEvaluation(request: EvalRunRequest): Promise<EvalReport> {
    try {
      const previous = request.previousReport ?? (await this.repository.latest(request.datasetVersion));
      const result = await runEvaluationPipeline({ ...request, previousReport: previous });
      await this.repository.save(result.report);
      return result.report;
    } catch (error) {
      return this.buildFailedReport(request, error);
    }
  }

  /**
   * 列出最近的报告摘要.
   *
   * @param limit 条数
   * @returns 摘要列表
   */
  async listReports(limit = 20): Promise<import('./eval.types.js').EvalReportSummary[]> {
    return this.repository.list(limit);
  }

  /**
   * 取上一版报告 (同数据集版本).
   *
   * @param datasetVersion 数据集版本
   * @returns 上一版报告 (没有则为 null)
   */
  async latestReport(datasetVersion?: string): Promise<EvalReport | null> {
    return this.repository.latest(datasetVersion);
  }

  /**
   * 造一份失败报告 (兜异常用).
   *
   * @param request 原入参
   * @param error 异常
   * @returns 失败报告
   */
  private buildFailedReport(request: EvalRunRequest, error: unknown): EvalReport {
    const message = error instanceof Error ? error.message : String(error);
    const quality: EvalDataQuality = {
      totalSessions: 0,
      validSessions: 0,
      droppedSessions: 0,
      dropReasons: { too_short: 0, has_error: 0, bdi_anomaly: 0, missing_gate_trace: 0 },
      turnsWithMissingGateTrace: 0,
    };
    const triggerQuality: EvalTriggerQuality = {
      precision: 0,
      recall: 0,
      f1: 0,
      tp: 0,
      fp: 0,
      fn: 0,
      tn: 0,
      support: 0,
    };
    const suggestionQuality: EvalSuggestionQuality = {
      available: false,
      unavailableReason: `评测未跑完: ${message}`,
      directionAccuracy: { trust: null, safety: null, bond: null, verbal: null, depth: null, style: null },
      macroAverage: null,
      perDimension: { trust: null, safety: null, bond: null, verbal: null, depth: null, style: null },
      amplitudeMAE: null,
      comparedTurns: 0,
    };
    const baselineComparison: EvalBaselineComparison = {
      available: false,
      unavailableReason: `评测未跑完: ${message}`,
      baselineDirectionAccuracy: null,
      subjectDirectionAccuracy: null,
      directionAccuracyDelta: null,
      baselineAmplitudeMAE: null,
      subjectAmplitudeMAE: null,
      amplitudeMAEDelta: null,
    };
    const runs: EvalRunsSummary = {
      count: 0,
      mean: { triggerF1: 0, precision: 0, recall: 0, directionAccuracy: null, amplitudeMAE: null },
      stdDev: { triggerF1: 0, precision: 0, recall: 0, directionAccuracy: null, amplitudeMAE: null },
    };
    const cost: EvalCost = { totalTokens: 0, estimatedCostCny: 0 };
    return {
      reportId: buildEvalReportId(new Date()),
      createdAt: new Date().toISOString(),
      config: {
        model: request.model ?? 'unknown',
        promptVersion: request.promptVersion ?? 'unknown',
        gateThresholds: { alliance: 0, resistance: 0, calm: 0, cooldown: 0 },
        datasetVersion: request.datasetVersion,
        mode: request.mode,
        runs: request.runs ?? 1,
        split: 'train',
        groundTruthKind: 'supervisor',
        synthetic: false,
      },
      dataQuality: quality,
      triggerQuality,
      suggestionQuality,
      baselineComparison,
      runs,
      cost,
      durationSec: 0,
      warnings: [`评测失败: ${message}`],
      sampleIds: [],
      status: 'failed',
    };
  }
}

/**
 * 从建议质量样本里抽出被测预测 (供外部复用).
 *
 * @param samples 样本
 * @returns 被测 delta 列表
 */
export function extractPredictedDeltas(samples: readonly EvalSuggestionSample[]): EvalDelta[] {
  return samples.map((sample) => sample.predicted ?? {});
}
