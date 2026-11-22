// V2026-11-22 (AF-313 · 调试会话远端持久化):
//   把各工作树的历史 `data/debug-sessions/*.json` 幂等回灌到 MySQL `admin_debug_sessions`.
//
//   用法:
//     pnpm exec tsx bin/import-debug-sessions.ts --source <dir> [--source <dir>]     # dry-run
//     pnpm exec tsx bin/import-debug-sessions.ts --source <dir> --apply             # 落库
//     pnpm exec tsx bin/import-debug-sessions.ts --source <dir> --apply --max 2000
//
//   纪律:
//     · 默认 dry-run; 只有显式 --apply 才写库;
//     · 同名 id 按 updatedAt 只升不降 (--overwrite 可强制);
//     · 损坏文件跳过并计数, 不中断整批;
//     · 任何日志只出文件路径/会话 id/计数, 不输出对话原文.

import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { DebugSessionMirror } from '../src/admin-debug/debug-session-mirror.js';
import { parseDebugSessionRecord, type DebugSessionRecord } from '../src/admin-debug/debug-session-record.js';
import { AdminDebugSessionEntity } from '../src/admin-debug/entities/admin-debug-session.entity.js';
import { configuration } from '../src/config/index.js';

/** 单文件结果. */
type FileOutcome = 'created' | 'updated' | 'skipped' | 'invalid' | 'failed' | 'dry-valid';

/** 单文件报告. */
interface FileReport {
  readonly source: string;
  readonly file: string;
  readonly id: string;
  readonly outcome: FileOutcome;
  readonly detail?: string;
}

/** 命令行参数. */
interface CliArgs {
  readonly sources: readonly string[];
  readonly apply: boolean;
  readonly overwrite: boolean;
  readonly max: number | null;
}

/**
 * 解析命令行.
 *
 * @param argv process.argv.slice(2)
 * @returns 参数
 */
function parseArgs(argv: readonly string[]): CliArgs | null {
  const sources: string[] = [];
  let apply = false;
  let overwrite = false;
  let max: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      const value = argv.at(i + 1);
      if (!value || value.startsWith('--')) throw new Error('--source 需要目录参数');
      sources.push(value);
      i += 1;
      continue;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--overwrite') {
      overwrite = true;
      continue;
    }
    if (arg === '--max') {
      const value = argv.at(i + 1);
      if (!value) throw new Error('--max 需要正整数');
      max = Number.parseInt(value, 10);
      if (!Number.isInteger(max) || max <= 0) throw new Error('--max 需要正整数');
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      return null;
    }
    throw new Error(`未知参数：${arg}`);
  }
  if (sources.length === 0) sources.push('data/debug-sessions');
  return { sources, apply, overwrite, max };
}

/** 打印用法. */
function printUsage(): void {
  console.log('用法: pnpm exec tsx bin/import-debug-sessions.ts --source <dir> [--source <dir>] [--apply] [--overwrite] [--max N]');
}

/**
 * 收集目录下的 JSON 文件.
 *
 * @param dir 绝对目录
 * @returns 文件路径
 */
async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith('.json')).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * 解析一个文件.
 *
 * @param source 源目录
 * @param file 文件路径
 * @returns 报告 + 记录
 */
async function readOne(source: string, file: string): Promise<{ readonly report: FileReport; readonly record: DebugSessionRecord | null }> {
  const id = basename(file, '.json');
  try {
    const raw = await readFile(file, 'utf8');
    const record = parseDebugSessionRecord(raw);
    if (record === null) {
      return { report: { source, file, id, outcome: 'invalid', detail: 'JSON 不可解析' }, record: null };
    }
    if (record.id !== id) {
      return { report: { source, file, id, outcome: 'invalid', detail: 'record.id 与文件名不一致' }, record: null };
    }
    return { report: { source, file, id, outcome: 'dry-valid' }, record };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    return { report: { source, file, id, outcome: 'failed', detail: name }, record: null };
  }
}

/**
 * 建立数据源.
 *
 * @returns DataSource
 */
async function buildDataSource(): Promise<DataSource> {
  try {
    loadEnvFile();
  } catch {
    /* 允许外部已注入 env */
  }
  const config = (await configuration()) as { db: DataSourceOptions };
  return new DataSource({
    ...config.db,
    entities: [AdminDebugSessionEntity],
    migrations: [],
    synchronize: false,
    // 隐私红线: record_json 含对话原文, 导入时禁止任何 SQL 参数日志 (即使 DB_LOGGING=true).
    logging: false,
    maxQueryExecutionTime: 0,
  });
}

/**
 * 汇总计数.
 *
 * @param reports 报告
 * @returns 各结果计数
 */
function summarize(reports: readonly FileReport[]): Record<FileOutcome, number> {
  const counts: Record<FileOutcome, number> = {
    created: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    failed: 0,
    'dry-valid': 0,
  };
  for (const report of reports) counts[report.outcome] += 1;
  return counts;
}

/**
 * 导入一个文件 (或 dry-run 判定).
 *
 * @param source 源目录
 * @param file 文件路径
 * @param args 参数
 * @param existingIds 远端已有 id
 * @param mirror 远端记录层
 * @returns 报告
 */
async function importOne(
  source: string,
  file: string,
  args: CliArgs,
  existingIds: ReadonlySet<string>,
  mirror: DebugSessionMirror,
): Promise<FileReport> {
  const { report, record } = await readOne(source, file);
  if (record === null) return report;
  if (!args.apply) return { ...report, outcome: existingIds.has(record.id) ? 'updated' : 'created' };
  try {
    return { ...report, outcome: await mirror.upsert(record, { onlyIfNewer: !args.overwrite }) };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    return { ...report, outcome: 'failed', detail: name };
  }
}

/**
 * 扫描一个源目录.
 *
 * @param source 绝对目录
 * @param args 参数
 * @param existingIds 远端已有 id
 * @param mirror 远端记录层
 * @returns 报告
 */
async function scanSource(
  source: string,
  args: CliArgs,
  existingIds: ReadonlySet<string>,
  mirror: DebugSessionMirror,
): Promise<FileReport[]> {
  const files = await listJsonFiles(source);
  if (files.length === 0) {
    console.log(`[import] 源目录无 JSON 或不存在: ${source}`);
    return [];
  }
  console.log(`[import] 扫描 ${source}：${files.length} 个文件`);
  const reports: FileReport[] = [];
  for (const file of files) reports.push(await importOne(source, file, args, existingIds, mirror));
  return reports;
}

/**
 * 主流程.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) return;
  const sources = args.sources.map((source) => resolve(source));
  const ds = await buildDataSource();
  await ds.initialize();
  const mirror = new DebugSessionMirror(ds);
  const existingIds = new Set(await mirror.listIds());
  const reports: FileReport[] = [];

  for (const source of sources) reports.push(...(await scanSource(source, args, existingIds, mirror)));

  if (args.apply && args.max !== null) {
    await mirror.prune(args.max);
    console.log(`[import] 已按上限保留最近 ${args.max} 条`);
  }

  const counts = summarize(reports);
  const mode = args.apply ? 'apply' : 'dry-run';
  console.log(
    `[import] 完成 mode=${mode} sources=${sources.length} files=${reports.length} ` +
      `created=${counts.created} updated=${counts.updated} skipped=${counts.skipped} ` +
      `invalid=${counts.invalid} failed=${counts.failed}`,
  );
  for (const report of reports.filter((item) => item.outcome === 'invalid' || item.outcome === 'failed').slice(0, 20)) {
    console.log(`[import] ${report.outcome} id=${report.id} detail=${report.detail ?? '-'} source=${report.source}`);
  }
  await ds.destroy();
  if (counts.failed > 0 || counts.invalid > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'unknown';
  console.error(`[import] 失败：${name}`);
  process.exitCode = 1;
});
