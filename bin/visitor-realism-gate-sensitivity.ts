/**
 * AF-335 真人度基线分离度与阈值敏感性分析。
 *
 * 读取多份 AF-332 分布 CLI 产出的 summary.json，按人设把 off 样本合并，
 * 再对 full / minimal / tightened 计算“单阈值能否完全分开”的区间与混淆矩阵。
 *
 * 不调模型、不写库；只读本地 JSON 并输出敏感性报告。
 *
 * 用法：
 *   pnpm exec tsx bin/visitor-realism-gate-sensitivity.ts --summaries data/a/summary.json,data/b/summary.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  confusionAt,
  countAbove,
  separatingBand,
  type SeparationBand,
  type ThresholdConfusion,
} from '../src/shared/realism/realism-sample-separation.js';

interface SourceCell {
  readonly persona: string;
  readonly arm: string;
  readonly densitySamples: readonly (number | null)[];
}

interface SourceSummary {
  readonly turns: number;
  readonly personas: readonly string[];
  readonly cells: readonly SourceCell[];
}

interface Comparison {
  readonly arm: string;
  readonly positives: number;
  readonly negatives: number;
  readonly negativesAboveMidpoint: number;
  readonly positivesAboveMidpoint: number;
  readonly band: SeparationBand | null;
  readonly confusionAtMidpoint: ThresholdConfusion | null;
}

interface PersonaReport {
  readonly persona: string;
  readonly turns: number;
  readonly offSamples: readonly number[];
  readonly comparisons: readonly Comparison[];
}

interface SensitivityReport {
  readonly inputs: readonly string[];
  readonly personas: readonly PersonaReport[];
}

function stringArg(name: string, fallback: string | null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function finiteNumbers(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function loadSummaries(paths: readonly string[]): SourceSummary[] {
  return paths.map((path) => {
    const absolute = resolve(process.cwd(), path);
    if (!existsSync(absolute)) throw new Error(`summary 不存在: ${path}`);
    return JSON.parse(readFileSync(absolute, 'utf8')) as SourceSummary;
  });
}

function samplesFor(summaries: readonly SourceSummary[], persona: string, arm: string): number[] {
  return summaries.flatMap((summary) => {
    const cell = summary.cells.find((entry) => entry.persona === persona && entry.arm === arm);
    return cell ? finiteNumbers(cell.densitySamples) : [];
  });
}

function format(value: number | null, digits = 6): string {
  return value === null ? 'n/a' : value.toFixed(digits);
}

function buildReport(summaries: readonly SourceSummary[], personas: readonly string[], arms: readonly string[]): SensitivityReport {
  const turns = Math.max(...summaries.map((summary) => summary.turns));
  return {
    inputs: summaries.map((summary) => `${summary.personas.join('/')} ${summary.turns} 轮 ${summary.cells.length} cells`),
    personas: personas.map((persona) => {
      const offSamples = samplesFor(summaries, persona, 'off');
      const comparisons = arms.map((arm) => {
        const positives = samplesFor(summaries, persona, arm);
        const band = separatingBand(offSamples, positives);
        const midpoint = band?.midpoint ?? null;
        return {
          arm,
          positives: positives.length,
          negatives: offSamples.length,
          negativesAboveMidpoint: midpoint === null ? 0 : countAbove(offSamples, midpoint),
          positivesAboveMidpoint: midpoint === null ? 0 : countAbove(positives, midpoint),
          band,
          confusionAtMidpoint:
            midpoint === null || offSamples.length === 0 || positives.length === 0 ? null : confusionAt(offSamples, positives, midpoint),
        };
      });
      return { persona, turns, offSamples, comparisons };
    }),
  };
}

function printHuman(report: SensitivityReport): void {
  console.log('真人度基线分离度与阈值敏感性');
  console.log(`输入 ${report.inputs.length} 份：${report.inputs.join(' | ')}`);
  for (const persona of report.personas) {
    console.log(`\n人设 ${persona.persona}（${persona.turns} 轮，off 样本 ${persona.offSamples.length} 个）`);
    console.log(`off 样本：${persona.offSamples.map((value) => value.toFixed(4)).join(' | ')}`);
    for (const comparison of persona.comparisons) {
      console.log(`\n对比 ${comparison.arm}（${comparison.positives} 个样本）`);
      if (comparison.band === null) {
        console.log('  不可分：off 与候选样本存在重叠，单一阈值无法同时接受基线与拒绝候选。');
        continue;
      }
      const { minThreshold, maxThresholdExclusive, midpoint } = comparison.band;
      console.log(`  可分区阈值：t ∈ [${format(minThreshold)}, ${format(maxThresholdExclusive)})（建议中点 ${format(midpoint)}）`);
      const confusion = comparison.confusionAtMidpoint;
      if (confusion !== null) {
        console.log(
          `  中点混淆：TP=${confusion.truePositive} FP=${confusion.falsePositive} TN=${confusion.trueNegative} FN=${confusion.falseNegative} accuracy=${format(confusion.accuracy, 4)}`,
        );
      }
    }
  }
}

function main(): void {
  const summariesArg = stringArg('--summaries', null);
  if (summariesArg === null) throw new Error('缺少 --summaries（逗号分隔的 summary.json 路径）');
  const outArg = stringArg('--out', null);
  const personas = splitList(stringArg('--personas', 'anxious,guarded') ?? 'anxious,guarded');
  const arms = splitList(stringArg('--arms', 'full,minimal,tightened') ?? 'full,minimal,tightened');
  const summaries = loadSummaries(splitList(summariesArg));
  const report = buildReport(summaries, personas, arms);
  if (outArg !== null) writeFileSync(resolve(process.cwd(), outArg), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  console.log(`\n输出 ${outArg ?? '仅控制台'}`);
}

try {
  main();
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
