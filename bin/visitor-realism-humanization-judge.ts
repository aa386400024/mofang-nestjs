/**
 * AF-342 真人度签名判据回验 CLI。
 *
 * 只读已归档的 rep-*.json，零模型调用；对每个样本跑三态判据，输出分布与审计明细。
 *
 * 用法：
 *   pnpm exec tsx bin/visitor-realism-humanization-judge.ts \
 *     --samples "off=data/phase25-exit/af336-realism-off-baseline-extension/reps,full=..." \
 *     --out data/phase25-exit/af342-realism-signature-judge/report.json --json
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { EventTypeId } from '../src/shared/realism/realism-event-type-profile.js';
import {
  ANXIOUS_REPAIR_PER_TURN_MIN,
  GUARDED_PAUSE_PER_TURN_MIN,
  GUARDED_TRAILOFF_PER_TURN_MIN,
  SIGNATURE_DENSITY_CAP_PER100,
  SIGNATURE_JUDGE_VERSION,
  detailSignatureVerdicts,
  judgeSignatureRealism,
  summarizeSignatureVerdicts,
  type SignatureJudgeInput,
  type SignatureSample,
  type SignatureVerdict,
} from '../src/shared/realism/realism-humanization-judge.js';

interface SourceCell {
  readonly persona: string;
  readonly arm: string;
  readonly meanMetrics: Readonly<Record<string, number | null>>;
  readonly meanTypeCounts: Readonly<Record<EventTypeId, number>>;
}

interface SourceReport {
  readonly turns: number;
  readonly cells: readonly SourceCell[];
}

interface SampleSpec {
  readonly arm: string;
  readonly dir: string;
}

interface ArmCheck {
  readonly arm: string;
  readonly samples: number;
  readonly signatureRate: number;
  readonly humanizedRate: number;
  readonly offLikeRate: number;
  readonly overloadedRate: number;
}

interface JudgeReport {
  readonly version: string;
  readonly densityCapPer100: number;
  readonly thresholds: Readonly<Record<string, number>>;
  readonly inputs: readonly string[];
  readonly cells: ReturnType<typeof summarizeSignatureVerdicts>;
  readonly details: ReturnType<typeof detailSignatureVerdicts>;
  readonly checks: {
    readonly offArm: string;
    readonly offSamples: number;
    readonly offFalsePositives: number;
    readonly fullArm: string;
    readonly fullSignatureCoverage: number;
    readonly arms: readonly ArmCheck[];
  };
}

function stringArg(name: string, fallback: string | null): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function parseSpecs(value: string): SampleSpec[] {
  const specs = value.split(',').map((entry) => {
    const separator = entry.indexOf('=');
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`--samples 项格式应为 arm=dir: ${entry}`);
    }
    return { arm: entry.slice(0, separator).trim(), dir: entry.slice(separator + 1).trim() };
  });
  const arms = specs.map((spec) => spec.arm);
  if (new Set(arms).size !== arms.length) throw new Error(`--samples 里 arm 重复: ${arms.join(',')}`);
  return specs;
}

function loadSamples(spec: SampleSpec): { inputs: string[]; samples: SignatureSample[] } {
  const dir = resolve(process.cwd(), spec.dir);
  if (!existsSync(dir)) throw new Error(`目录不存在: ${dir}`);
  const files = readdirSync(dir)
    .filter((name) => /^rep-\d+\.json$/.test(name))
    .sort((left, right) => Number(/\d+/.exec(left)?.[0] ?? 0) - Number(/\d+/.exec(right)?.[0] ?? 0));
  if (files.length === 0) throw new Error(`目录中没有 rep-*.json: ${dir}`);

  const inputs = files.map((name) => join(dir, name));
  const samples: SignatureSample[] = [];
  for (const path of inputs) {
    const report = JSON.parse(readFileSync(path, 'utf8')) as SourceReport;
    if (!Number.isFinite(report.turns) || report.turns <= 0) throw new Error(`报告 turns 非法: ${path}`);
    const cells = report.cells.filter((cell) => cell.arm === spec.arm);
    if (cells.length === 0) throw new Error(`报告没有 arm=${spec.arm}: ${path}`);
    for (const cell of cells) {
      const density = cell.meanMetrics['text.disfluency.density_per100'];
      if (typeof density !== 'number' || !Number.isFinite(density)) {
        throw new TypeError(`cell 缺少 density: ${path} ${cell.persona}`);
      }
      const input: SignatureJudgeInput = {
        persona: cell.persona,
        turns: report.turns,
        densityPer100: density,
        counts: cell.meanTypeCounts,
      };
      samples.push({ ...input, arm: spec.arm });
    }
  }
  return { inputs, samples };
}

function buildReport(specs: readonly SampleSpec[], offArm: string, fullArm: string): JudgeReport {
  const loaded = specs.map(loadSamples);
  const samples = loaded.flatMap((entry) => entry.samples);
  const cells = summarizeSignatureVerdicts(samples);
  const details = detailSignatureVerdicts(samples);

  const offSamples = samples.filter((sample) => sample.arm === offArm);
  const offFalsePositives = offSamples.filter((sample) => judgeVerdict(sample) !== 'off-like').length;
  const fullSamples = samples.filter((sample) => sample.arm === fullArm);
  const fullSignature = fullSamples.filter((sample) => judgeSignature(sample)).length;
  const fullSignatureCoverage = fullSamples.length > 0 ? fullSignature / fullSamples.length : 0;

  const armEntries = new Map<string, { samples: number; signatures: number; humanized: number; offLike: number; overloaded: number }>();
  for (const cell of cells) {
    const entry = armEntries.get(cell.arm) ?? { samples: 0, signatures: 0, humanized: 0, offLike: 0, overloaded: 0 };
    entry.samples += cell.samples;
    entry.signatures += Math.round(cell.signatureRate * cell.samples);
    entry.humanized += cell.humanized;
    entry.offLike += cell.offLike;
    entry.overloaded += cell.overloaded;
    armEntries.set(cell.arm, entry);
  }
  const arms = [...armEntries.entries()].map(([arm, entry]) => ({
    arm,
    samples: entry.samples,
    signatureRate: entry.samples > 0 ? entry.signatures / entry.samples : 0,
    humanizedRate: entry.samples > 0 ? entry.humanized / entry.samples : 0,
    offLikeRate: entry.samples > 0 ? entry.offLike / entry.samples : 0,
    overloadedRate: entry.samples > 0 ? entry.overloaded / entry.samples : 0,
  }));

  return {
    version: SIGNATURE_JUDGE_VERSION,
    densityCapPer100: SIGNATURE_DENSITY_CAP_PER100,
    thresholds: {
      anxiousRepairPerTurnMin: ANXIOUS_REPAIR_PER_TURN_MIN,
      guardedPausePerTurnMin: GUARDED_PAUSE_PER_TURN_MIN,
      guardedTrailoffPerTurnMin: GUARDED_TRAILOFF_PER_TURN_MIN,
    },
    inputs: loaded.flatMap((entry) => entry.inputs),
    cells,
    details,
    checks: {
      offArm,
      offSamples: offSamples.length,
      offFalsePositives,
      fullArm,
      fullSignatureCoverage,
      arms,
    },
  };
}

function judgeVerdict(sample: SignatureSample): SignatureVerdict {
  return judgeSignatureRealism(sample).verdict;
}

function judgeSignature(sample: SignatureSample): boolean {
  return judgeSignatureRealism(sample).signaturePassed;
}

function format(value: number, digits = 6): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function printHuman(report: JudgeReport): void {
  console.log(`真人度签名判据 ${report.version}`);
  console.log(
    `密度上限 ${report.densityCapPer100} | 焦虑 repair/turn >= ${report.thresholds['anxiousRepairPerTurnMin']} | ` +
      `回避 pause/turn >= ${report.thresholds['guardedPausePerTurnMin']} 或 trailoff/turn >= ${report.thresholds['guardedTrailoffPerTurnMin']}`,
  );
  console.log(`输入 ${report.inputs.length} 份 rep | 样本 ${report.details.length}`);
  for (const persona of new Set(report.cells.map((cell) => cell.persona))) {
    console.log(`\n人设 ${persona}`);
    console.log('arm            n  off-like  humanized  overloaded  signature  meanDensity');
    for (const cell of report.cells.filter((entry) => entry.persona === persona)) {
      console.log(
        `${cell.arm.padEnd(13)} ${String(cell.samples).padStart(2)}  ` +
          `${String(cell.offLike).padStart(8)}  ${String(cell.humanized).padStart(9)}  ${String(cell.overloaded).padStart(10)}  ` +
          `${format(cell.signatureRate, 3).padStart(9)}  ${format(cell.meanDensityPer100)}`,
      );
    }
  }
  console.log(
    `\n检查: off 误报 ${report.checks.offFalsePositives}/${report.checks.offSamples} | ` +
      `full 签名覆盖 ${format(report.checks.fullSignatureCoverage, 3)}`,
  );
}

function main(): void {
  const samplesArg = stringArg('--samples', null);
  if (samplesArg === null) throw new Error('缺少 --samples（格式 arm=dir,arm=dir）');
  const outArg = stringArg('--out', null);
  const offArm = stringArg('--off-arm', 'off') ?? 'off';
  const fullArm = stringArg('--full-arm', 'full') ?? 'full';
  const report = buildReport(parseSpecs(samplesArg), offArm, fullArm);
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
