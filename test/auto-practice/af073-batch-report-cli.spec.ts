import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cli = join(repoRoot, 'bin', 'batch-report.ts');
const archived96 = join(repoRoot, 'data', 'batch-reports', 'g3ONzlqSGMVJqkFMF9Lwh.json');
const archivedCurrent = join(repoRoot, 'data', 'batch-reports', 'uJHgP8uQGeM8Z6HbZY7M5.json');

/**
 * 单次 CLI 冷启动实测 16–19s（tsx + 完整 Nest 依赖图）；全量 363 文件并行时
 * 会被 CPU 争用放大到 30s 以上。120s 是 6 倍余量，同时仍是真实的挂起探测器。
 */
const CLI_TIMEOUT_MS = 120_000;

function runCli(args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [tsxCli, cli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
  });
}

function tempOut(): string {
  return mkdtempSync(join(tmpdir(), 'af073-batch-report-'));
}

describe('AF-073 batch-report 归档快照四态 CLI', () => {
  it(
    '归档 96 快照为基线、当前 8 场快照为候选时输出 incomparable',
    () => {
      const out = tempOut();
      try {
        const result = runCli(['--snapshot', archivedCurrent, '--baseline-snapshot', archived96, '--format', 'both', '--out', out]);
        expect(result.status).toBe(0);
        expect(existsSync(join(out, 'uJHgP8uQGeM8Z6HbZY7M5.json'))).toBe(true);
        const md = readFileSync(join(out, 'uJHgP8uQGeM8Z6HbZY7M5.md'), 'utf8');
        expect(md).toContain('回归结论: incomparable');
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    CLI_TIMEOUT_MS,
  );

  it(
    '--fail-on-incomparable 把不可比转为退出码 2',
    () => {
      const out = tempOut();
      try {
        const result = runCli([
          '--snapshot',
          archivedCurrent,
          '--baseline-snapshot',
          archived96,
          '--fail-on-incomparable',
          '--format',
          'json',
          '--out',
          out,
        ]);
        expect(result.status).toBe(2);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    CLI_TIMEOUT_MS,
  );

  it(
    '归档快照文件不存在时按数据不可用退出 2',
    () => {
      const out = tempOut();
      try {
        const result = runCli(['--snapshot', join(out, 'missing.json'), '--format', 'json', '--out', out]);
        expect(result.status).toBe(2);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    CLI_TIMEOUT_MS,
  );

  it(
    '--batch 与 --snapshot 互斥，参数错误退出 3',
    () => {
      const result = runCli(['--batch', 'x', '--snapshot', archivedCurrent, '--format', 'json']);
      expect(result.status).toBe(3);
    },
    CLI_TIMEOUT_MS,
  );
});
