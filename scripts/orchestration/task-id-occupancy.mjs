/**
 * AF-217 · 任务编号占用检查（三源合并）；AF-223 扩展为「三源 + 远端占号」。
 *
 * 背景：两台机器在同一 integrate 上并行时，编号靠人肉避让。2026-11-20/21 已连撞两次：
 *   - AF-209：本机 provider 接入单与远端已合入的真人度 R3 同号；
 *   - AF-211：本机补提交单与另一台机器在开发的 `task/AF-211-realism-r4` 同号。
 *
 * 检查口径（任一命中即视为占用）：
 *   1. 远端任务分支名（`task/AF-NNN-*`）——覆盖「对方正在开发、尚未合并」；
 *   2. 远端 integrate 的任务索引——覆盖「对方已合入」；
 *   3. 本地状态索引 + `docs/worklog/records/**` 目录——覆盖「本机历史与归档」；
 *   4. 远端占号 ref（`orchestration-task-ids/AF-NNN`）——覆盖「已 CAS 预约、尚未登记」。
 *
 * AF-223 追加两条口径：
 *   - `excludeRefs`：重建同一任务时排除本机已推送的同名任务分支（否则重建被自己挡住）；
 *     被排除的编号单列在 `selfOnlyIds`，仅当它没出现在其它任何源时才允许放行，并在输出中明示。
 *   - 远端占号 ref 是真正的仲裁面：三源只能「事后发现」，占号是「事前抢下」。
 *
 * 边界：只读；远端不可达时跳过对应源并产出 warning，不阻塞离线登记。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './state-store.mjs';
import { remoteReservationIds } from './task-id-reservation.mjs';
import { stateAnchorDir, stateAnchorEnabled } from './state-anchor.mjs';

const TASK_ID_RE = /\b(?=[A-Z0-9]*[A-Z])[A-Z0-9]+-[0-9]+\b/g;
const INDEX_PATH = 'docs/team/agent-orchestration/task-state-index.json';
const RECORDS_DIR = 'docs/worklog/records';

/**
 * AF-498 · 编号退役台账。
 *
 * 任务进入终态（completed / rejected / canceled / failed）即永久退役，编号不复用。
 * 台账放在状态锚点目录，而不是记录目录：记录包被清理、分支被重建、工作树被切回旧基线，
 * 都不会让一个用过的号重新「可用」。
 */
function retiredLedgerPath(rootDir = REPO_ROOT) {
  return join(stateAnchorDir(rootDir), 'retired-task-ids.json');
}

export function loadRetiredTaskIds(rootDir = REPO_ROOT) {
  const file = retiredLedgerPath(rootDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.ids) ? parsed.ids : [];
  } catch {
    return [];
  }
}

export function recordRetiredTaskId(taskId, rootDir = REPO_ROOT) {
  const id = String(taskId ?? '').trim();
  if (!id || !stateAnchorEnabled()) return false;
  const file = retiredLedgerPath(rootDir);
  const current = loadRetiredTaskIds(rootDir);
  if (current.includes(id)) return false;
  const next = { ids: [...current, id].sort(), updatedAt: new Date().toISOString() };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  if (existsSync(file)) unlinkSync(file);
  renameSync(tmp, file);
  return true;
}

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
 * 三源合并占用清单；AF-223 追加远端占号源与「排除自身分支」口径。
 * @param {{rootDir?:string, runGit?:Function, cwd?:string, remote?:string, branch?:string, excludeRefs?:string[]}} opts
 * @returns {{ids:Set<string>, sources:object, selfOnlyIds:string[], warnings:string[]}}
 */
export function collectOccupiedTaskIds(opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const runGit = opts.runGit ?? defaultRunGit;
  const cwd = opts.cwd ?? rootDir;
  const remote = opts.remote ?? 'origin';
  const branch = opts.branch ?? 'origin/integrate';
  const excludeRefs = new Set(opts.excludeRefs ?? []);
  const warnings = [];

  const local = {
    index: indexIds(rootDir),
    records: recordDirIds(rootDir),
  };

  const lsRemote = runGit(['ls-remote', '--heads', remote, 'task/*'], { cwd, allowFailure: true });
  if (lsRemote === null) warnings.push(`远端 ${remote} 不可达：跳过任务分支占用检查（仅按本地口径登记）`);
  const excludedBranchIds = [];
  const keptLines = [];
  for (const line of String(lsRemote ?? '').split(/\r?\n/)) {
    const ref = line.split('\t')[1]?.trim();
    if (!ref) continue;
    if (excludeRefs.has(ref)) {
      excludedBranchIds.push(...extractTaskIds(ref));
      continue;
    }
    keptLines.push(line);
  }
  const remoteBranches = lsRemote === null ? [] : remoteTaskBranchIds(keptLines.join('\n'));
  if (excludedBranchIds.length > 0) {
    warnings.push(`已按重建口径排除本机同名分支：${[...new Set(excludedBranchIds)].join('、')}`);
  }

  const remoteIndex = remoteIndexIds({ runGit, cwd, branch });
  if (remoteIndex === null) warnings.push(`读不到 ${branch} 的任务索引：跳过远端索引占用检查`);

  const lsReservations = runGit(['ls-remote', '--heads', remote, 'orchestration-task-ids/*'], { cwd, allowFailure: true });
  if (lsReservations === null) warnings.push(`远端 ${remote} 不可达：跳过占号 ref 检查`);
  const remoteReservations = lsReservations === null ? [] : remoteReservationIds(lsReservations);
  const retired = loadRetiredTaskIds(rootDir);

  const ids = new Set([...local.index, ...local.records, ...remoteBranches, ...(remoteIndex ?? []), ...remoteReservations, ...retired]);
  // 只被「自己已推送的同名分支」占用的编号：允许重建，但仍要过远端占号 CAS。
  const excludedSet = new Set(excludedBranchIds);
  const selfOnlyIds = [...excludedSet].filter((id) => !ids.has(id));

  return {
    ids,
    sources: {
      localIndex: local.index,
      localRecords: local.records,
      remoteBranches,
      remoteIndex: remoteIndex ?? [],
      remoteReservations,
      retired,
      excludedRemoteBranches: [...excludedSet],
    },
    selfOnlyIds,
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
 *
 * AF-223：若编号只出现在「被排除的本机同名分支」里（`selfOnlyIds`），按重建放行并返回 warning，
 * 而不是直接拒绝——重建被自己推送的分支挡住是纯摩擦，真正的并发由远端占号 ref 仲裁。
 *
 * @param {string} taskId
 * @param {{rootDir?:string, runGit?:Function, cwd?:string, occupancy?:object}} opts
 * @returns {{ok:boolean, warnings:string[], reason?:string}}
 */
export function assertTaskIdAvailable(taskId, opts = {}) {
  const occupancy = opts.occupancy ?? collectOccupiedTaskIds(opts);
  const baseWarnings = occupancy.warnings ?? [];
  if (occupancy.selfOnlyIds?.includes(taskId)) {
    return {
      ok: true,
      warnings: [...baseWarnings, `${taskId} 仅被本机已推送的同名分支占用，按重建放行（并发由远端占号 ref 仲裁）`],
      reason: 'self-branch-only',
    };
  }
  if (!occupancy.ids.has(taskId)) return { ok: true, warnings: baseWarnings };
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
