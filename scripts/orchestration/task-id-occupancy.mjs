/**
 * AF-217 · 任务编号占用检查（三源合并）。
 *
 * 背景：两台机器在同一 integrate 上并行时，编号靠人肉避让。2026-11-20/21 已连撞两次：
 *   - AF-209：本机 provider 接入单与远端已合入的真人度 R3 同号；
 *   - AF-211：本机补提交单与另一台机器在开发的 `task/AF-211-realism-r4` 同号。
 *
 * 三源检查口径（任一命中即视为占用）：
 *   1. 远端任务分支名（`task/AF-NNN-*`）——覆盖「对方正在开发、尚未合并」；
 *   2. 远端 integrate 的任务索引——覆盖「对方已合入」；
 *   3. 本地状态索引 + `docs/worklog/records/**` 目录——覆盖「本机历史与归档」。
 *
 * 边界：只读；远端不可达时跳过对应源并产出 warning，不阻塞离线登记。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './state-store.mjs';

const TASK_ID_RE = /\b(?=[A-Z0-9]*[A-Z])[A-Z0-9]+-[0-9]+\b/g;
const INDEX_PATH = 'docs/team/agent-orchestration/task-state-index.json';
const RECORDS_DIR = 'docs/worklog/records';

function defaultRunGit(args, opts = {}) {
  try {
    return execFileSync('git', args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (opts.allowFailure) return null;
    throw new Error(`git ${args.join(' ')} 失败：${String(error.stderr ?? error.message).trim()}`);
  }
}

/** 从任意文本里提取唯一任务编号（同号重复只算一次）。 */
export function extractTaskIds(text) {
  return [...new Set(String(text ?? '').match(TASK_ID_RE) ?? [])];
}

/** 从 `git ls-remote --heads origin 'task/*'` 输出解析任务分支编号。 */
export function remoteTaskBranchIds(lsRemoteOutput) {
  const ids = [];
  for (const line of String(lsRemoteOutput ?? '').split(/\r?\n/)) {
    const ref = line.split('\t')[1]?.trim();
    if (!ref || !ref.startsWith('refs/heads/task/')) continue;
    ids.push(...extractTaskIds(ref));
  }
  return [...new Set(ids)];
}

/** 扫描 records 目录下的任务目录名（`<context>/<AF-NNN>/`）。 */
export function recordDirIds(rootDir = REPO_ROOT) {
  const base = join(rootDir, RECORDS_DIR);
  if (!existsSync(base)) return [];
  const ids = [];
  for (const context of readdirSync(base, { withFileTypes: true })) {
    if (!context.isDirectory()) continue;
    const contextDir = join(base, context.name);
    for (const taskDir of readdirSync(contextDir, { withFileTypes: true })) {
      if (!taskDir.isDirectory()) continue;
      const match = /^([A-Z0-9]+-[0-9]+)$/.exec(taskDir.name);
      if (match) ids.push(match[1]);
    }
  }
  return [...new Set(ids)];
}

/** 读本地状态索引里的全部编号。 */
export function indexIds(rootDir = REPO_ROOT) {
  const file = join(rootDir, INDEX_PATH);
  if (!existsSync(file)) return [];
  try {
    const index = JSON.parse(readFileSync(file, 'utf8'));
    return [...new Set([...(index.tasks ?? []), ...(index.archivedTasks ?? [])].map((task) => task?.taskId).filter(Boolean))];
  } catch {
    return [];
  }
}

/** 读远端 integrate 的任务索引编号。 */
export function remoteIndexIds({ runGit = defaultRunGit, cwd = REPO_ROOT, branch = 'origin/integrate' } = {}) {
  const text = runGit(['show', `${branch}:${INDEX_PATH}`], { cwd, allowFailure: true });
  if (text === null) return null;
  try {
    const index = JSON.parse(text);
    return [...new Set([...(index.tasks ?? []), ...(index.archivedTasks ?? [])].map((task) => task?.taskId).filter(Boolean))];
  } catch {
    return null;
  }
}

/**
 * 三源合并占用清单。
 * @param {{rootDir?:string, runGit?:Function, cwd?:string, remote?:string, branch?:string}} opts
 * @returns {{ids:Set<string>, sources:object, warnings:string[]}}
 */
export function collectOccupiedTaskIds(opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const runGit = opts.runGit ?? defaultRunGit;
  const cwd = opts.cwd ?? rootDir;
  const remote = opts.remote ?? 'origin';
  const branch = opts.branch ?? 'origin/integrate';
  const warnings = [];

  const local = {
    index: indexIds(rootDir),
    records: recordDirIds(rootDir),
  };

  const lsRemote = runGit(['ls-remote', '--heads', remote, 'task/*'], { cwd, allowFailure: true });
  if (lsRemote === null) warnings.push(`远端 ${remote} 不可达：跳过任务分支占用检查（仅按本地口径登记）`);
  const remoteBranches = lsRemote === null ? [] : remoteTaskBranchIds(lsRemote);

  const remoteIndex = remoteIndexIds({ runGit, cwd, branch });
  if (remoteIndex === null) warnings.push(`读不到 ${branch} 的任务索引：跳过远端索引占用检查`);

  const ids = new Set([...local.index, ...local.records, ...remoteBranches, ...(remoteIndex ?? [])]);
  return {
    ids,
    sources: {
      localIndex: local.index,
      localRecords: local.records,
      remoteBranches,
      remoteIndex: remoteIndex ?? [],
    },
    warnings,
  };
}

/** 计算下一个可用编号（同前缀内最大号 +1）。 */
export function nextTaskId(ids, prefix = 'AF') {
  const numbers = [...ids]
    .map((id) => {
      const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(String(id ?? ''));
      return match ? Number(match[1]) : null;
    })
    .filter((value) => Number.isFinite(value));
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  return `${prefix}-${max + 1}`;
}

/**
 * 登记前断言：编号未被任何来源占用。
 * @param {string} taskId
 * @param {{rootDir?:string, runGit?:Function, cwd?:string, occupancy?:object}} opts
 * @returns {{ok:boolean, warnings:string[]}}
 */
export function assertTaskIdAvailable(taskId, opts = {}) {
  const occupancy = opts.occupancy ?? collectOccupiedTaskIds(opts);
  if (!occupancy.ids.has(taskId)) return { ok: true, warnings: occupancy.warnings ?? [] };
  const sources = occupancy.sources ?? {};
  const hits = Object.entries(sources)
    .filter(([, list]) => Array.isArray(list) && list.includes(taskId))
    .map(([name]) => name);
  const next = nextTaskId(occupancy.ids);
  throw new Error(
    `任务编号 ${taskId} 已被占用（来源：${hits.join('、') || '未知'}）；下一个可用编号为 ${next}。` +
      '编号不复用：历史任务（含 canceled）的号段保留，避免事件链歧义。',
  );
}
