#!/usr/bin/env node
/**
 * AF-373 · commit-msg 自动补 Task trailer。
 *
 * 任务号不再靠提交标题猜：暂存文件能唯一归属到在办任务时写 `Task: AF-xxx`，
 * 纯状态面提交写 `Task: none`。已有 trailer 一律不覆盖；无法唯一归属则拒绝，
 * 让提交在本地就暴露歧义，而不是等 CI 报 ambiguous-task-id。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateTaskEntry, isGeneratedStatePath } from './task-entry-gate.mjs';
import { extractTaskTrailer } from './ci-task-gate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_PATH = 'docs/team/agent-orchestration/task-state-index.json';

function git(rootDir, args) {
  return execFileSync('git', ['-C', rootDir, ...args], { encoding: 'utf8' }).trim();
}

function stagedFiles(rootDir) {
  return git(rootDir, ['diff', '--cached', '--name-only'])
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function readIndex(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, INDEX_PATH), 'utf8'));
}

/** 纯函数：根据暂存文件与索引决定 trailer 任务号；无法唯一归属时抛出可诊断错误。 */
export function deriveCommitTrailer({ changedFiles, index }) {
  if (changedFiles.length === 0) throw new Error('没有暂存文件，无法生成 Task trailer');
  if (changedFiles.every(isGeneratedStatePath)) return { taskId: null, none: true };
  const result = evaluateTaskEntry({
    changedFiles,
    tasks: index.tasks ?? [],
    archivedTasks: index.archivedTasks ?? [],
    headTasks: [],
    explicitTaskId: null,
  });
  if (result.ok && result.reason === 'state-plane-only') return { taskId: null, none: true };
  if (!result.ok || !result.taskId) {
    throw new Error(`暂存文件无法唯一归属到在办任务：${result.message ?? result.reason}`);
  }
  return { taskId: result.taskId, none: false };
}

/** 纯函数：只补缺失 trailer；已有 Task 行保持原文。 */
export function withTaskTrailer(message, taskId) {
  const text = String(message ?? '');
  if (extractTaskTrailer(text).present) return text;
  const line = taskId ? `Task: ${taskId}` : 'Task: none';
  const base = text.replace(/\s*$/, '');
  return `${base}\n\n${line}\n`;
}

function main() {
  const messageFile = process.argv[2];
  if (!messageFile) throw new Error('用法：commit-trailer.mjs <commit-msg-file>');
  const file = resolve(REPO_ROOT, messageFile);
  const message = readFileSync(file, 'utf8');
  const firstLine = message.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'));
  if (/^(Merge |Revert |fixup! |squash! )/.test(firstLine ?? '')) return;
  // 契约：已有 Task trailer 一律不覆盖；其正确性由逐提交门校验。
  if (extractTaskTrailer(message).present) return;
  const changedFiles = stagedFiles(REPO_ROOT);
  const index = readIndex(REPO_ROOT);
  const trailer = deriveCommitTrailer({ changedFiles, index });
  const next = withTaskTrailer(message, trailer.taskId);
  if (next !== message) {
    writeFileSync(file, next, 'utf8');
    console.log(`[ORCH-TRAILER] 已写入 ${trailer.none ? 'Task: none' : `Task: ${trailer.taskId}`}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[ORCH-TRAILER] FAIL ${error.message}`);
    process.exit(1);
  }
}
