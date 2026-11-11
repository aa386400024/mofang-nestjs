#!/usr/bin/env node
// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · CLI 入口):
//   职责: 命令行触发一次评测, 把报告写成 JSON 文件并打印摘要.
//   边界: **不起 Nest 容器 / 不连数据库** —— 离线评测的意义就是"零成本、秒级".
//
//   为什么 CLI 直接 import 源码而不是编译产物:
//     评测是开发期工具 (调参时一天能跑十几次), 等 tsc build 再跑多一道手续.
//     仓库既有脚本 (bin/seed-*.ts) 也是同一路子.
//
//   用法:
//     npx tsx scripts/eval-runner.ts --mode offline
//     npx tsx scripts/eval-runner.ts --mode offline --dataset synthetic-train-v1 --runs 3
//     npx tsx scripts/eval-runner.ts --mode full --dataset synthetic-supervisor-v1
//
//   ⚠️ 报告里只落数值化指标 / 枚举 / id —— 不含任何对话原文.

import 'reflect-metadata';

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_EVAL_DATASET_ROOT, runEvaluationPipeline } from '../src/engine-adapters/eval/eval.service.js';
import type { EvalMode, EvalReport } from '../src/engine-adapters/eval/eval.types.js';

/** 命令行参数. */
interface EvalCliOptions {
  /** 评测模式. */
  mode: EvalMode;
  /** 数据集版本. */
  dataset: string;
  /** 数据集根目录. */
  datasetRoot: string;
  /** 运行次数 (缺省: 离线 1 / 全量 3). */
  runs?: number;
  /** 报告输出路径 (缺省写到 reports 目录; '-' 表示只打到 stdout). */
  out?: string;
  /** 模型标识 (写进报告). */
  model: string;
  /** prompt 版本 (写进报告). */
  promptVersion: string;
  /** 是否把完整 JSON 打到 stdout. */
  printJson: boolean;
}

/** 默认报告目录. */
const DEFAULT_REPORT_DIR = 'data/eval-reports';

/**
 * 解析命令行参数.
 *
 * ⚠️ 只认长参数 (--key value / --key=value) —— 评测参数名多, 短参数反而难记.
 *
 * @param argv 参数数组
 * @returns 解析结果
 */
// ⚠️ 本函数被 test/engine-adapters/eval/eval.runner.spec.ts 直接 import 消费 (单测覆盖参数解析), 不能去 export.
// eslint-disable-next-line unicorn/no-exports-in-scripts
export function parseEvalCliArgs(argv: readonly string[]): EvalCliOptions {
  const options: EvalCliOptions = {
    mode: 'offline',
    dataset: 'synthetic-supervisor-v1',
    datasetRoot: DEFAULT_EVAL_DATASET_ROOT,
    model: 'unknown',
    promptVersion: 'unknown',
    printJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const inlineValue = eq === -1 ? undefined : raw.slice(eq + 1);
    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      return argv[index] ?? '';
    };

    switch (key) {
      case 'mode':
        options.mode = takeValue() === 'full' ? 'full' : 'offline';
        break;
      case 'dataset':
        options.dataset = takeValue();
        break;
      case 'dataset-root':
        options.datasetRoot = takeValue();
        break;
      case 'runs': {
        const parsed = Number(takeValue());
        options.runs = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
        break;
      }
      case 'out':
        options.out = takeValue();
        break;
      case 'model':
        options.model = takeValue();
        break;
      case 'prompt-version':
        options.promptVersion = takeValue();
        break;
      case 'print-json':
        options.printJson = true;
        break;
      default:
        break;
    }
  }

  return options;
}

/**
 * 找上一版报告 (同数据集) —— 用于回归对比.
 *
 * ⚠️ 只认本目录自己写出去的 eval-*.json —— 别的文件不猜.
 *
 * @param dir 报告目录
 * @param datasetVersion 数据集版本
 * @returns 上一版报告 (没有则为 null)
 */
function loadPreviousReport(dir: string, datasetVersion: string): EvalReport | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => name.startsWith('eval-') && name.endsWith('.json'))
    .toSorted();
  for (const name of files.reverse()) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as EvalReport;
      if (parsed?.config?.datasetVersion === datasetVersion) return parsed;
    } catch {
      // 报告文件损坏不算致命: 跳过, 继续找上一版.
    }
  }
  return null;
}

/**
 * 打印摘要 (人看的那部分).
 *
 * @param report 报告
 * @param outPath 报告文件路径 (null = 只打到 stdout)
 */
function printSummary(report: EvalReport, outPath: string | null): void {
  const trigger = report.triggerQuality;
  const suggestion = report.suggestionQuality;
  const baseline = report.baselineComparison;
  const quality = report.dataQuality;
  // 基线对比文案拆成两步 —— 嵌套三元 (ternary 套 ternary) 会被 sonarjs/no-nested-conditional 拦下.
  const deltaSign = (baseline.directionAccuracyDelta ?? 0) >= 0 ? '+' : '';
  const baselineText = baseline.available
    ? `${(baseline.baselineDirectionAccuracy ?? 0).toFixed(3)} → ${(baseline.subjectDirectionAccuracy ?? 0).toFixed(3)} (${deltaSign}${(baseline.directionAccuracyDelta ?? 0).toFixed(3)})`
    : `不可算 (${baseline.unavailableReason})`;
  const lines = [
    outPath ? `报告已写入: ${outPath}` : '报告 (stdout)',
    `  触发质量: P=${trigger.precision.toFixed(3)} R=${trigger.recall.toFixed(3)} F1=${trigger.f1.toFixed(3)} (TP=${trigger.tp} FP=${trigger.fp} FN=${trigger.fn} TN=${trigger.tn})`,
    `  建议质量: ${suggestion.available ? `macro F1=${(suggestion.macroAverage ?? 0).toFixed(3)} 幅度 MAE=${(suggestion.amplitudeMAE ?? 0).toFixed(3)} (对比轮次 ${suggestion.comparedTurns})` : `不可算 (${suggestion.unavailableReason})`}`,
    `  基线对比: ${baselineText}`,
    `  数据质量: 总 ${quality.totalSessions} / 有效 ${quality.validSessions} / 丢弃 ${quality.droppedSessions} (tooShort=${quality.dropReasons.too_short} errors=${quality.dropReasons.has_error} bdiAnomaly=${quality.dropReasons.bdi_anomaly} noTrace=${quality.dropReasons.missing_gate_trace})`,
    `  运行 ${report.runs.count} 次 (F1 标准差 ${(report.runs.stdDev.triggerF1 ?? 0).toFixed(4)}) / 耗时 ${report.durationSec.toFixed(2)}s / token ${report.cost.totalTokens}`,
  ];
  for (const warning of report.warnings) {
    lines.push(`  ⚠ ${warning}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * CLI 主流程.
 *
 * @param argv 参数数组
 * @returns 退出码
 */
async function main(argv: readonly string[]): Promise<number> {
  const options = parseEvalCliArgs(argv);
  const reportDir = options.out && options.out !== '-' ? path.resolve(options.out).replace(/[\\/][^\\/]*$/, '') : DEFAULT_REPORT_DIR;
  const previous = loadPreviousReport(reportDir, options.dataset);

  const result = await runEvaluationPipeline(
    {
      mode: options.mode,
      datasetVersion: options.dataset,
      datasetRoot: options.datasetRoot,
      runs: options.runs,
      model: options.model,
      promptVersion: options.promptVersion,
      previousReport: previous,
    },
    {
      loadDataset: (root, version) => {
        const file = path.join(root, version, 'dataset.json');
        if (!existsSync(file)) {
          throw new Error(`找不到数据集文件: ${file} (可用版本见 ${root})`);
        }
        return JSON.parse(readFileSync(file, 'utf8'));
      },
    },
  );

  const report = result.report;
  let outPath: string | null = null;
  if (options.out !== '-') {
    const target = options.out ? path.resolve(options.out) : path.join(reportDir, `${report.reportId}.json`);
    mkdirSync(path.resolve(target).replace(/[\\/][^\\/]*$/, ''), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8');
    outPath = target;
  }

  if (options.printJson || options.out === '-') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
  printSummary(report, outPath);
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('eval-runner.ts');
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`评测执行失败: ${message}\n`);
      process.exitCode = 1;
    });
}
