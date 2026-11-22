/**
 * AF-332 真人度短会话基线方差分析。
 *
 * 读取多份 AF-331 单重复报告（每份只含 2 人设 × 3 分支 = 6 个 cell），
 * 对每个 cell 的重复样本计算均值、中位数、极值、窗口内计数与假设性 active 判据。
 *
 * 不调模型、不写库；只读本地 JSON 并输出汇总。
 *
 * 用法：
 *   pnpm exec tsx bin/visitor-realism-baseline-variance.ts --dir data/phase25-exit/af332-realism-baseline/reps
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { evaluateHumanization, type HumanizationEvaluationStatus } from '../src/auto-practice/metrics/humanization-acceptance.js';
import { countAtMost, countWithinWindow, statisticsOf, type MetricStatistics } from '../src/shared/realism/realism-metric-distribution.js';

const METRIC_IDS = {
  eventsPerTurn: 'text.disfluency.events_per_turn',
  eventTurnRate: 'text.disfluency.event_turn_rate',
  density: 'text.disfluency.density_per100',
  repairPerTurn: 'text.disfluency.repair_per_turn',
} as const;

const EXPECTATIONS = {
  eventsPerTurn: { min: undefined, max: 0.8, tol: 0.02 },
  eventTurnRate: { min: 0.15, max: 0.6, tol: 0.02 },
  density: { min: 0.2, max: 2.5, tol: 0.05 },
  repairPerTurn: { min: undefined, max: 0.1, tol: 0.01 },
} as const;

interface SourceCell {
  readonly persona: string;
  readonly arm: string;
  readonly personaLabel: string;
  readonly meanMetrics: Readonly<Record<string, number | null>>;
  readonly humanizationStatuses: readonly string[];
}

interface SourceReport {
  readonly turns: number;
  readonly personas: readonly string[];
  readonly arms: readonly string[];
  readonly cells: readonly SourceCell[];
}

interface MetricSummary {
  readonly statistics: MetricStatistics;
  readonly samples: readonly (number | null)[];
  readonly withinWindow: number;
}

interface CellSummary {
  readonly persona: string;
  readonly arm: string;
  readonly personaLabel: string;
  readonly samples: number;
  readonly metrics: Readonly<Record<string, MetricSummary>>;
  readonly densitySamples: readonly (number | null)[];
  readonly hypotheticalStatuses: readonly HumanizationEvaluationStatus[];
  readonly reportedStatuses: readonly string[];
}

interface SummaryReport {
  readonly inputs: readonly string[];
  readonly turns: number;
  readonly personas: readonly string[];
  readonly arms: readonly string[];
  readonly cells: readonly CellSummary[];
}

function stringArg(name: string, fallback: string | null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function loadReports(dir: string): { inputs: string[]; reports: SourceReport[] } {
  if (!existsSync(dir)) throw new Error(`目录不存在: ${dir}`);
  const files = readdirSync(dir)
    .filter((name) => /^rep-\d+\.json$/.test(name))
    .sort((left, right) => Number(/\d+/.exec(left)?.[0] ?? 0) - Number(/\d+/.exec(right)?.[0] ?? 0));
  if (files.length === 0) throw new Error(`目录中没有 rep-*.json: ${dir}`);
  const inputs = files.map((name) => join(dir, name));
  const reports = inputs.map((path) => JSON.parse(readFileSync(path, 'utf8')) as SourceReport);
  return { inputs, reports };
}

function summarizeCell(persona: string, arm: string, personaLabel: string, reports: readonly SourceReport[]): CellSummary {
  const samples = reports.map((report) => {
    const cell = report.cells.find((entry) => entry.persona === persona && entry.arm === arm);
    if (cell === undefined) throw new Error(`报告缺少 cell persona=${persona} arm=${arm}`);
    return cell;
  });

  const metricSummaries: Record<string, MetricSummary> = {};
  for (const [key, id] of Object.entries(METRIC_IDS)) {
    const values = samples.map((cell) => cell.meanMetrics[id] ?? null);
    const expectation = EXPECTATIONS[key as keyof typeof EXPECTATIONS];
    metricSummaries[key] = {
      statistics: statisticsOf(values),
      samples: values,
      withinWindow: countWithinWindow(values, expectation.min, expectation.max, expectation.tol),
    };
  }
  // eventsPerTurn / repairPerTurn 只有上限, 用 atMost 计数覆盖 withinWindow 的语义.
  metricSummaries['eventsPerTurn'] = {
    ...metricSummaries['eventsPerTurn'],
    withinWindow: countAtMost(metricSummaries['eventsPerTurn'].samples, 0.8, 0.02),
  };
  metricSummaries['repairPerTurn'] = {
    ...metricSummaries['repairPerTurn'],
    withinWindow: countAtMost(metricSummaries['repairPerTurn'].samples, 0.1, 0.01),
  };

  const hypotheticalStatuses = samples.map((cell) => {
    const metrics = {
      'text.disfluency.events_per_turn': cell.meanMetrics[METRIC_IDS.eventsPerTurn] ?? null,
      'text.disfluency.event_turn_rate': cell.meanMetrics[METRIC_IDS.eventTurnRate] ?? null,
      'text.disfluency.density_per100': cell.meanMetrics[METRIC_IDS.density] ?? null,
      'text.disfluency.repair_per_turn': cell.meanMetrics[METRIC_IDS.repairPerTurn] ?? null,
    };
    return evaluateHumanization(metrics, { realismMode: 'active', turns: reports[0]?.turns ?? null }).status;
  });

  return {
    persona,
    arm,
    personaLabel,
    samples: samples.length,
    metrics: metricSummaries,
    densitySamples: metricSummaries['density'].samples,
    hypotheticalStatuses,
    reportedStatuses: samples.flatMap((cell) => cell.humanizationStatuses),
  };
}

function buildSummary(dir: string, personas: readonly string[], arms: readonly string[]): SummaryReport {
  const { inputs, reports } = loadReports(dir);
  const first = reports.at(0);
  if (!first) throw new Error('没有可用报告');
  const cells = personas.flatMap((persona) =>
    arms.map((arm) => {
      const label = first.cells.find((cell) => cell.persona === persona)?.personaLabel ?? persona;
      return summarizeCell(persona, arm, label, reports);
    }),
  );
  return { inputs, turns: first.turns, personas, arms, cells };
}

function format(value: number | null, digits = 6): string {
  return value === null ? 'n/a' : value.toFixed(digits);
}

function printHuman(report: SummaryReport): void {
  console.log('真人度短会话基线方差与配对中位数');
  console.log(
    `输入 ${report.inputs.length} 份 | 每份 ${report.turns} 轮 | 人设 ${report.personas.join(' / ')} | 分支 ${report.arms.join(' / ')}`,
  );
  for (const persona of report.personas) {
    const cells = report.cells.filter((cell) => cell.persona === persona);
    console.log(`\n人设 ${persona}（${cells[0]?.personaLabel ?? '未知'}）`);
    console.log('arm       n  density(mean/median/min/max)                 inWin  events/turn  rate    repair  hyp-active');
    for (const cell of cells) {
      const density = cell.metrics['density'].statistics;
      const events = cell.metrics['eventsPerTurn'].statistics;
      const rate = cell.metrics['eventTurnRate'].statistics;
      const repair = cell.metrics['repairPerTurn'].statistics;
      console.log(
        `${cell.arm.padEnd(9)} ${String(cell.samples).padStart(2)}  ` +
          `${format(density.mean)}/${format(density.median)}/${format(density.min)}/${format(density.max)}  ` +
          `${String(cell.metrics['density'].withinWindow).padStart(4)}/${String(cell.samples).padStart(1)}  ` +
          `${format(events.mean)}     ${format(rate.mean)}  ${format(repair.mean)}  ` +
          `${cell.hypotheticalStatuses.filter((status) => status === 'passed').length}/${cell.samples}`,
      );
      console.log(`          density samples: ${cell.densitySamples.map((value) => format(value, 4)).join(' | ')}`);
    }
  }
}

function main(): void {
  const dirArg = stringArg('--dir', null);
  if (dirArg === null) throw new Error('缺少 --dir');
  const outArg = stringArg('--out', null);
  const personas = (stringArg('--personas', 'anxious,guarded') ?? 'anxious,guarded').split(',').map((entry) => entry.trim());
  const arms = (stringArg('--arms', 'off,full,minimal') ?? 'off,full,minimal').split(',').map((entry) => entry.trim());
  const summary = buildSummary(resolve(process.cwd(), dirArg), personas, arms);
  if (outArg !== null) writeFileSync(resolve(process.cwd(), outArg), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else printHuman(summary);
  console.log(`\n输出 ${outArg ?? '仅控制台'}`);
}

try {
  main();
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
