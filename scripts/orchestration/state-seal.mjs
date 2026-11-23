#!/usr/bin/env node
/**
 * AF-373 · 合并后状态面自愈。
 *
 * 合并 PR 后本地常见僵局：`integrate` 落后远端，但工作树里躺着上一轮生成的
 * index / journal / snapshot / data.js，`git merge --ff-only` 直接被脏文件挡住。
 * 这些文件是事件日志的派生投影，不是手工资产；本命令先备份、再丢弃本地生成态、
 * fast-forward 远端 integrate，最后跑 events verify 与 worklog verify --strict。
 *
 * 默认 dry-run；只有 --apply 才备份与写盘。任何非生成态脏文件一律拒绝，避免误删业务改动。
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isGeneratedStatePath } from './task-entry-gate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(args, opts = {}) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function runNode(args) {
  return execFileSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
}

function parseStatus() {
  return git(['status', '--porcelain'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const raw = line.slice(3).trim();
      const path = raw.includes(' -> ') ? raw.split(' -> ').pop() : raw;
      return { code: line.slice(0, 2), path: path.replace(/\\/g, '/') };
    });
}

function backup(files, stamp) {
  const dir = join(REPO_ROOT, '.tmp', 'state-seal', stamp);
  for (const file of files) {
    const source = join(REPO_ROOT, file);
    if (!existsSync(source)) continue;
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return dir;
}

/** 纯函数：状态面脏文件与阻塞项分离；只有生成态允许被自动丢弃。 */
export function classifySealStatus(entries) {
  const stateFiles = [];
  const blockers = [];
  for (const entry of entries ?? []) {
    if (isGeneratedStatePath(entry.path)) stateFiles.push(entry.path);
    else blockers.push(`${entry.code} ${entry.path}`);
  }
  return { stateFiles, blockers };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const branch = git(['branch', '--show-current']);
  if (branch !== 'integrate') {
    throw new Error(`state seal 只能在 integrate 上执行，当前分支：${branch || '(detached)'}`);
  }

  const status = parseStatus();
  const { stateFiles, blockers } = classifySealStatus(status);
  if (blockers.length > 0) {
    throw new Error(`存在非状态面脏文件，拒绝自动丢弃：${blockers.slice(0, 10).join('；')}`);
  }

  console.log(`[state seal] branch=integrate dirtyState=${stateFiles.length} mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  for (const file of stateFiles) console.log(`  - 备份并丢弃 ${file}`);
  if (!apply) {
    console.log('[state seal] dry-run 结束；确认后加 --apply。');
    return;
  }

  if (stateFiles.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = backup(stateFiles, stamp);
    git(['checkout', '--', ...stateFiles]);
    console.log(`[state seal] 已备份到 ${backupDir.replace(REPO_ROOT, '').replace(/\\/g, '/')}`);
  }

  git(['fetch', 'origin', 'integrate']);
  const before = git(['rev-parse', 'HEAD']);
  git(['merge', '--ff-only', 'origin/integrate']);
  const after = git(['rev-parse', 'HEAD']);
  console.log(`[state seal] integrate ${before.slice(0, 8)} → ${after.slice(0, 8)}`);

  runNode(['scripts/orchestration/cli.mjs', 'events', 'verify']);
  console.log('[state seal] events verify PASS');
  runNode(['scripts/orchestration/cli.mjs', 'worklog', 'verify', '--strict']);
  console.log('[state seal] worklog verify --strict PASS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[state seal] FAIL ${error.message}`);
    process.exit(1);
  }
}
