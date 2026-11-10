#!/usr/bin/env node
// V2026-11-11 WP-K (批次回归报告 CLI):
//   职责: 离线构建 / 回填批次指标快照, 产出可 diff 的 JSON + 可阅读的 MD, 并按
//         回归结论给语义化退出码, 可直接进 CI.
//   边界: 显式建 DataSource (ormconfig 的 entities glob 扫不到 auto-practice 实体).
//
//   退出码: 0 全部 OK | 1 检出回归 | 2 数据不可用/覆盖不足 | 3 参数错误.
//
//   隐私: 本脚本只输出计数 / 指标 / 结论, 不打印任何对话文本或 prompt.

/// <reference types="../typings/global" />
import { mkdir, writeFile } from 'node:fs/promises';

import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';

import ormconfig from './ormconfig.js';
import { PracticeBatch } from '../src/auto-practice/entities/practice-batch.entity.js';
import { PracticeSession } from '../src/auto-practice/entities/practice-session.entity.js';
import { evaluateIntakeAcceptance } from '../src/auto-practice/metrics/acceptance-thresholds.js';
import { assertBatchMetricsV1, type BatchMetricsV1 } from '../src/auto-practice/metrics/batch-metrics.schema.js';
import { BatchMetricsService } from '../src/auto-practice/metrics/batch-metrics.service.js';
import { evaluateRegression } from '../src/auto-practice/metrics/regression-evaluator.js';

interface CliArgs {
  readonly batches: readonly string[];
  readonly all: boolean;
  readonly since: string | null;
  readonly outDir: string;
  readonly baseline: string | null;
  readonly failOnRegression: boolean;
  readonly strict: boolean;
  readonly format: 'json' | 'md' | 'both';
}

function parseArgs(argv: readonly string[]): CliArgs {
  const batches: string[] = [];
  let all = false;
  let since: string | null = null;
  let outDir = 'data/batch-reports';
  let baseline: string | null = null;
  let failOnRegression = false;
  let strict = false;
  let format: CliArgs['format'] = 'both';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      if (i + 1 >= argv.length) throw new Error(`参数 ${arg} 缺少取值`);
      const value = argv[i + 1];
      i += 1;
      return value;
    };
    switch (arg) {
      case '--batch': {
        batches.push(next());
        break;
      }
      case '--all': {
        all = true;
        break;
      }
      case '--since': {
        since = next();
        break;
      }
      case '--out': {
        outDir = next();
        break;
      }
      case '--baseline': {
        baseline = next();
        break;
      }
      case '--fail-on-regression': {
        failOnRegression = true;
        break;
      }
      case '--strict': {
        strict = true;
        break;
      }
      case '--format': {
        const value = next();
        if (value !== 'json' && value !== 'md' && value !== 'both') throw new Error(`--format 仅支持 json|md|both`);
        format = value;

        break;
      }
      case '--help':
      case '-h': {
        printHelp();
        process.exit(0);

        break;
      }
      default: {
        throw new Error(`未知参数: ${arg}`);
      }
    }
  }
  if (!all && batches.length === 0) throw new Error('必须指定 --batch <id> 或 --all');
  if (all && batches.length > 0) throw new Error('--batch 与 --all 互斥');
  return { batches, all, since, outDir, baseline, failOnRegression, strict, format };
}

function printHelp(): void {
  const lines = [
    'batch-report — 批次回归报告',
    '',
    '--batch <id>            可重复; 与 --all 互斥',
    '--all                   全部批次',
    '--since <YYYY-MM-DD>    按创建时间过滤',
    '--out <dir>             缺省 data/batch-reports',
    '--baseline <id>         对比基准 (缺省 = 时间上前一批)',
    '--fail-on-regression    出现 regressed 时退出码 1',
    '--strict                覆盖率 < 0.9 即退出码 2',
    '--format json|md|both   缺省 both',
    '',
    '退出码: 0 OK | 1 回归 | 2 数据不可用 | 3 参数错误',
  ];
  console.log(lines.join('\n'));
}

function renderMarkdown(snapshot: BatchMetricsV1, verdictLine: string | null): string {
  const acceptance = evaluateIntakeAcceptance(snapshot.metrics);
  const lines: string[] = [];
  lines.push(
    `# 批次 ${snapshot.batchId}`,
    '',
    `- 计算时间: ${snapshot.computedAt}`,
    `- 配置指纹 combined: \`${snapshot.fingerprint.combined}\``,
    `- 纳入/期望: ${snapshot.coverage.includedSessions}/${snapshot.coverage.expectedSessions}, 总轮数 ${snapshot.coverage.totalTurns}`,
    `- intake 验收: **${acceptance.passed ? 'PASS' : 'FAIL'}**`,
  );
  if (verdictLine) lines.push(`- 回归结论: ${verdictLine}`);
  lines.push('', '## 指标', '', '| 指标 | 值 |', '|---|---|');
  for (const [id, value] of Object.entries(snapshot.metrics)) {
    lines.push(`| \`${id}\` | ${value ?? 'null'} |`);
  }
  if (!acceptance.passed) {
    const failed = acceptance.results.filter((result) => !result.passed);
    lines.push('', '## 未达标项', '');
    for (const result of failed) lines.push(`- \`${result.metricId}\` (实际 ${result.actual}): ${result.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

async function selectBatchRows(args: CliArgs, batchRepo: Repository<PracticeBatch>): Promise<PracticeBatch[]> {
  if (!args.all) {
    return batchRepo.find({ where: args.batches.map((id) => ({ batchId: id })) });
  }
  const rows = await batchRepo.find({ order: { createdAt: 'asc' } });
  if (!args.since) return rows;
  const sinceTime = new Date(`${args.since}T00:00:00`);
  return rows.filter((row) => row.createdAt >= sinceTime);
}

async function buildSnapshots(
  batchRows: PracticeBatch[],
  metricsService: BatchMetricsService,
): Promise<{ readonly snapshots: BatchMetricsV1[]; readonly coverageBlocked: boolean }> {
  const snapshots: BatchMetricsV1[] = [];
  let coverageBlocked = false;
  for (const row of batchRows) {
    const snapshot = await metricsService.buildBatchSnapshot(row.batchId);
    assertBatchMetricsV1(snapshot, row.batchId);
    snapshots.push(snapshot);
    if (snapshot.coverage.includedSessions / Math.max(snapshot.coverage.expectedSessions, 1) < 0.9) coverageBlocked = true;
  }
  return { snapshots, coverageBlocked };
}

async function writeReports(snapshots: BatchMetricsV1[], args: CliArgs): Promise<void> {
  for (const snapshot of snapshots) {
    if (args.format !== 'md') {
      await writeFile(join(args.outDir, `${snapshot.batchId}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    }
    if (args.format !== 'json') {
      await writeFile(join(args.outDir, `${snapshot.batchId}.md`), renderMarkdown(snapshot, null), 'utf8');
    }
  }
}

function runComparisons(ordered: BatchMetricsV1[], args: CliArgs): number {
  let verdictExit = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const base = args.baseline ? (ordered.find((s) => s.batchId === args.baseline) ?? ordered[i - 1]) : ordered[i - 1];
    const report = evaluateRegression({ base, candidate: ordered[i] });
    if (report.verdict === 'regressed' && args.failOnRegression) verdictExit = 1;
    if (report.verdict === 'incomparable') {
      console.warn(`[${ordered[i].batchId}] incomparable: ${report.reasons.join('; ')}`);
    } else {
      console.log(`[${ordered[i].batchId}] ${report.verdict} (changed: ${report.changedSegments.join(',') || 'none'})`);
    }
  }
  return verdictExit;
}

async function writeIndex(ordered: BatchMetricsV1[], outDir: string): Promise<void> {
  const indexLines = ['# 批次时间轴', '', '| 批次 | 计算时间 | 纳入/期望 | 探索率 | 深度变化 | 指纹 |', '|---|---|---|---|---|---|'];
  for (const snapshot of ordered) {
    indexLines.push(
      `| ${snapshot.batchId} | ${snapshot.computedAt} | ${snapshot.coverage.includedSessions}/${snapshot.coverage.expectedSessions} | ${snapshot.metrics['exploration.rate']} | ${snapshot.metrics['dim.depth.delta_avg']} | \`${snapshot.fingerprint.combined}\` |`,
    );
  }
  await writeFile(join(outDir, 'index.md'), `${indexLines.join('\n')}\n`, 'utf8');
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 3;
  }

  // ormconfig 默认导出已 new 好的 DataSource 实例 (未 initialize); 基于其 options
  // 重建并显式补上 auto-practice 实体 (原 entities glob 只扫 src/entity).
  const base = await ormconfig;
  const dataSource = new DataSource({ ...base.options, entities: [PracticeBatch, PracticeSession] });
  await dataSource.initialize();

  try {
    const batchRepo = dataSource.getRepository(PracticeBatch);
    const sessionRepo = dataSource.getRepository(PracticeSession);
    const batchRows = await selectBatchRows(args, batchRepo);

    const configStub = { get: (key: string): string | undefined => process.env[key] };
    const metricsService = new BatchMetricsService(configStub as never, sessionRepo);
    await mkdir(args.outDir, { recursive: true });

    const { snapshots, coverageBlocked } = await buildSnapshots(batchRows, metricsService);
    await writeReports(snapshots, args);

    const ordered = [...snapshots].sort((a, b) => a.computedAt.localeCompare(b.computedAt));
    const verdictExit = runComparisons(ordered, args);
    await writeIndex(ordered, args.outDir);

    if (args.strict && coverageBlocked) return 2;
    return verdictExit;
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(2);
  });
