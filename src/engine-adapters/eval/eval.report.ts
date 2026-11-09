// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · 报告层):
//   职责: 把指标 / 数据质量 / 成本装配成**结构化报告**, 存进数据库, 并与上一版做对比.
//   边界: 纯函数部分 (装配 / 对比) 零 IO; 落库走窄端口 (EvalReportRepository), 实现另置.
//
//   为什么报告要"一次跑完就存" (而不是只打印):
//     调参是**跨版本**的事: 今天的阈值和昨天的阈值必须能并排放在一起比.
//     只有落库 (eval_reports 表) 才能回答"这周改了两次阈值, 哪一次让 F1 掉了".
//
//   ⚠️ 报告里保留**基线**指标是为了回归保护:
//     纯规则模式不该受审议改动影响 —— 它的方向准确率一跌, 说明**代码改坏了**
//     (不是"审议变差了"). 任务单 §6.3 的红线: baseline 跌 > 0.03 → 报告标红.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/eval/eval.metrics.spec.ts 覆盖报告装配 / 基线回归告警

import type {
  EvalBaselineComparison,
  EvalCost,
  EvalDataQuality,
  EvalReport,
  EvalReportConfig,
  EvalReportSummary,
  EvalRunsSummary,
  EvalSuggestionQuality,
  EvalTriggerQuality,
} from './eval.types.js';

/** 报告仓储的注入 token (单例绑定, 不给两个 provider). */
export const EVAL_REPORT_REPOSITORY = 'EVAL_REPORT_REPOSITORY';

/**
 * 报告仓储端口.
 *
 * ⚠️ 为什么是接口而不是直接用 TypeORM Repository:
 *   CLI 跑评测时**没有数据库** (零基础设施依赖是离线评测的意义所在) ——
 *   端口让"落库"变成可选步骤, 而不是"跑评测必须先起 MySQL".
 */
export interface EvalReportRepository {
  /** 存一份报告. */
  save(report: EvalReport): Promise<void>;
  /** 列出最近的报告摘要. */
  list(limit: number): Promise<EvalReportSummary[]>;
  /**
   * 取上一版报告 (同数据集版本).
   *
   * ⚠️ 回归对比需要**完整**的上一版报告 (不只是摘要) —— 摘要里没有阈值 / 告警,
   *   拿摘要做对比会漏掉"基线跌了"这条告警.
   *
   * @param datasetVersion 数据集版本 (缺省 = 任意版本最近一份)
   * @returns 上一版报告 (没有则为 null)
   */
  latest(datasetVersion?: string): Promise<EvalReport | null>;
}

/** 内存实现 (CLI / 单测用). */
export class InMemoryEvalReportRepository implements EvalReportRepository {
  private readonly reports: EvalReport[] = [];

  async save(report: EvalReport): Promise<void> {
    this.reports.push(report);
  }

  async list(limit: number): Promise<EvalReportSummary[]> {
    return this.reports
      .slice(-limit)
      .reverse()
      .map((report) => ({
        reportId: report.reportId,
        createdAt: report.createdAt,
        datasetVersion: report.config.datasetVersion,
        mode: report.config.mode,
        triggerF1: report.triggerQuality.f1,
        directionAccuracy: report.suggestionQuality.macroAverage,
      }));
  }

  async latest(datasetVersion?: string): Promise<EvalReport | null> {
    const matching = this.reports.filter((report) => !datasetVersion || report.config.datasetVersion === datasetVersion);
    return matching.at(-1) ?? null;
  }
}

/** 装配报告的入参. */
export interface BuildEvalReportInput {
  /** 报告 id. */
  readonly reportId: string;
  /** 生成时刻 (ISO). */
  readonly createdAt: string;
  /** 运行配置快照. */
  readonly config: EvalReportConfig;
  /** 数据质量. */
  readonly dataQuality: EvalDataQuality;
  /** 触发质量. */
  readonly triggerQuality: EvalTriggerQuality;
  /** 建议质量. */
  readonly suggestionQuality: EvalSuggestionQuality;
  /** 基线对比. */
  readonly baselineComparison: EvalBaselineComparison;
  /** 多轮汇总. */
  readonly runs: EvalRunsSummary;
  /** 成本. */
  readonly cost: EvalCost;
  /** 耗时 (秒). */
  readonly durationSec: number;
  /** 样本 id (人工抽检口子). */
  readonly sampleIds: readonly string[];
  /** 备注. */
  readonly notes: readonly string[];
  /** 上一版报告 (有则做回归对比). */
  readonly previous?: EvalReport | null;
}

/**
 * 基线回归阈值 (任务单 §6.3): 纯规则基线的方向准确率跌超过它 = 代码可能改坏了.
 */
export const BASELINE_REGRESSION_THRESHOLD = 0.03;

/**
 * 结果不稳定阈值 (任务单 §6.2): 标准差超过它 = 建议多跑几次.
 */
export const UNSTABLE_STDDEV_THRESHOLD = 0.05;

/**
 * 装配一份报告.
 *
 * ⚠️ 告警只写**人话结论**, 不写"指标是多少" —— 指标在结构化字段里,
 *   告警是给人第一眼看的 (看板 / 群里贴一行).
 *
 * @param input 入参
 * @returns 报告
 */
export function buildEvalReport(input: BuildEvalReportInput): EvalReport {
  const warnings: string[] = [];

  if (input.config.synthetic) {
    warnings.push('数据集为合成数据: 指标只验证链路可用, 不能作为验收结论');
  }
  if (!input.suggestionQuality.available) {
    warnings.push(`建议质量不可算: ${input.suggestionQuality.unavailableReason ?? '未知原因'}`);
  }
  if (input.runs.count > 1 && (input.runs.stdDev.triggerF1 ?? 0) > UNSTABLE_STDDEV_THRESHOLD) {
    warnings.push(
      `结果不稳定 (F1 标准差 ${(input.runs.stdDev.triggerF1 ?? 0).toFixed(3)} > ${UNSTABLE_STDDEV_THRESHOLD}): 建议增加运行次数`,
    );
  }

  const regression = detectBaselineRegression(input.previous ?? null, input.baselineComparison);
  if (regression) {
    warnings.push(regression);
  }

  return {
    reportId: input.reportId,
    createdAt: input.createdAt,
    config: input.config,
    dataQuality: input.dataQuality,
    triggerQuality: input.triggerQuality,
    suggestionQuality: input.suggestionQuality,
    baselineComparison: input.baselineComparison,
    runs: input.runs,
    cost: input.cost,
    durationSec: input.durationSec,
    warnings,
    sampleIds: input.sampleIds,
    status: input.suggestionQuality.available ? 'ok' : 'degraded',
  };
}

/**
 * 检测基线回归 (纯规则指标跌太多 = 代码改坏了).
 *
 * @param previous 上一版报告
 * @param comparison 本次基线对比
 * @returns 告警文案 (无回归则 null)
 */
export function detectBaselineRegression(previous: EvalReport | null, comparison: EvalBaselineComparison): string | null {
  if (!previous) return null;
  const before = previous.baselineComparison.baselineDirectionAccuracy;
  const after = comparison.baselineDirectionAccuracy;
  if (before === null || after === null) return null;
  const drop = before - after;
  if (drop <= BASELINE_REGRESSION_THRESHOLD) return null;
  return `基线回归告警: 纯规则方向准确率从 ${before.toFixed(3)} 跌到 ${after.toFixed(3)} (跌 ${drop.toFixed(3)} > ${BASELINE_REGRESSION_THRESHOLD}): 先修回归, 再谈调参`;
}

/** 两版报告的差异. */
export interface EvalReportDiff {
  /** 本次报告 id. */
  readonly reportId: string;
  /** 上一次报告 id (没有则为 null). */
  readonly previousReportId: string | null;
  /** 触发质量的变化. */
  readonly triggerQuality: {
    /** F1 变化 (本次 - 上次). */
    readonly f1: number | null;
    /** 精确率变化. */
    readonly precision: number | null;
    /** 召回率变化. */
    readonly recall: number | null;
  };
  /** 建议质量的方向 macro F1 变化. */
  readonly directionAccuracy: number | null;
  /** 幅度 MAE 变化 (负数 = 更准). */
  readonly amplitudeMAE: number | null;
  /** 是否触发基线回归告警. */
  readonly baselineRegression: boolean;
  /** 告警文案. */
  readonly warnings: readonly string[];
}

/**
 * 对比两版报告.
 *
 * ⚠️ 只有**变化量超过标准差**才算"真的变了" (任务单 §6.2) —— 所以这里同时给出
 *   变化量与是否显著, 避免拿 0.003 的抖动当结论.
 *
 * @param previous 上一版报告
 * @param current 本次报告
 * @returns 差异
 */
export function diffEvalReports(previous: EvalReport | null, current: EvalReport): EvalReportDiff {
  if (!previous) {
    return {
      reportId: current.reportId,
      previousReportId: null,
      triggerQuality: { f1: null, precision: null, recall: null },
      directionAccuracy: null,
      amplitudeMAE: null,
      baselineRegression: false,
      warnings: [],
    };
  }

  const f1Delta = current.triggerQuality.f1 - previous.triggerQuality.f1;
  const baselineRegression = detectBaselineRegression(previous, current.baselineComparison) !== null;
  const stdDev = current.runs.stdDev.triggerF1 ?? 0;
  const warnings: string[] = [];
  if (Math.abs(f1Delta) <= stdDev && current.runs.count > 1) {
    warnings.push(`F1 变化 ${f1Delta.toFixed(3)} 未超过标准差 ${stdDev.toFixed(3)}: 视为噪声, 不算真的变了`);
  }

  const currentDirection = current.suggestionQuality.macroAverage;
  const previousDirection = previous.suggestionQuality.macroAverage;
  const currentMae = current.suggestionQuality.amplitudeMAE;
  const previousMae = previous.suggestionQuality.amplitudeMAE;

  return {
    reportId: current.reportId,
    previousReportId: previous.reportId,
    triggerQuality: {
      f1: f1Delta,
      precision: current.triggerQuality.precision - previous.triggerQuality.precision,
      recall: current.triggerQuality.recall - previous.triggerQuality.recall,
    },
    directionAccuracy: currentDirection === null || previousDirection === null ? null : currentDirection - previousDirection,
    amplitudeMAE: currentMae === null || previousMae === null ? null : currentMae - previousMae,
    baselineRegression,
    warnings,
  };
}
