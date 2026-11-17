#!/usr/bin/env node
/**
 * AF-056 · GitHub 服务端逐提交编排门。
 *
 * 本地 Husky 只能约束自觉启用钩子的提交；本模块在 CI 中对 base..head 的每个提交
 * 重新读取「该提交 / 其父提交」的任务索引，复用 task-entry-gate 的同一套状态机：
 *   - 在办任务提交：taskId + scope.files + 任务单存在性；
 *   - 纯状态面提交：沿用 state-plane-only；
 *   - squash 归档提交：沿用 archived-transition（父在办、当前 completed/archived）。
 *
 * 纯判定函数不碰 git；IO 适配层只读 git 对象，不改工作区、不写状态面。
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { evaluateTaskEntry } from './task-entry-gate.mjs';

export const TASK_STATE_INDEX_PATH = 'docs/team/agent-orchestration/task-state-index.json';
const TASK_ID_RE = /\b(?=[A-Z0-9]*[A-Z])[A-Z0-9]+-[0-9]+\b/g;

/** 从提交标题解析唯一 AF 编号；同编号重复出现允许，多编号拒绝。 */
export function extractCommitTaskId(subject) {
  const ids = [...new Set(String(subject ?? '').match(TASK_ID_RE) ?? [])];
  if (ids.length > 1) throw new Error(`提交标题含多个任务编号：${ids.join('、')}`);
  return ids[0] ?? null;
}

/**
 * 单提交快照纯判定。taskSheetExists 仅在解析到 taskId 且判定需要任务时强制 true。
 * @returns {{pass:boolean,reason:string,taskId:string|null,commitTaskId:string|null,errors:string[],files:string[],covered:string[]}}
 */
export function evaluateCommitSnapshot({ subject, changedFiles, currentIndex, parentIndex, taskSheetExists, taskSheetPath = null }) {
  let commitTaskId = null;
  try {
    commitTaskId = extractCommitTaskId(subject);
  } catch (error) {
    return {
      pass: false,
      reason: 'ambiguous-task-id',
      taskId: null,
      commitTaskId: null,
      errors: [error.message],
      files: changedFiles ?? [],
      covered: [],
    };
  }
  const result = evaluateTaskEntry({
    changedFiles,
    tasks: currentIndex?.tasks ?? [],
    archivedTasks: currentIndex?.archivedTasks ?? [],
    headTasks: parentIndex?.tasks ?? [],
    explicitTaskId: commitTaskId,
  });
  const output = {
    ...result,
    ok: result.ok,
    pass: result.ok,
    commitTaskId,
    files: changedFiles ?? [],
    errors: result.ok ? [] : [result.message ?? result.reason],
  };
  if (output.pass && output.taskId && taskSheetExists === false) {
    return {
      ...output,
      ok: false,
      pass: false,
      reason: 'task-sheet-missing',
      errors: [taskSheetPath ? `提交中缺少任务单：${taskSheetPath}` : `任务 ${output.taskId} 未声明可读取的 artifacts.taskSheet`],
    };
  }
  return output;
}

/** PR 最终 HEAD 的验收硬门：防止绕开 pr-release，直接从 GitHub 页面合并。 */
export function evaluateAcceptanceSnapshot({ taskId, currentIndex, receipts = [] }) {
  const archived = (currentIndex?.archivedTasks ?? []).find((task) => task?.taskId === taskId);
  if (!archived || archived.status !== 'completed') {
    return {
      pass: false,
      reason: 'task-not-archived-completed',
      taskId,
      receipts,
      errors: [`任务 ${taskId} 在当前 HEAD 不是 completed/archived，禁止 PR 合并`],
    };
  }
  const passed = receipts.filter(
    (receipt) => receipt.verdict === 'passed' && receipt.scopeCheck === 'in-scope' && receipt.finalStatus === 'completed',
  );
  if (passed.length === 0) {
    return {
      pass: false,
      reason: 'passed-durable-receipt-missing',
      taskId,
      receipts,
      errors: [`任务 ${taskId} 缺少 reviewVerdict=passed + scopeCheck=in-scope + finalStatus=completed 的 durable 回执`],
    };
  }
  return { pass: true, reason: 'accepted', taskId, receipts, errors: [] };
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const stderr = String(error.stderr ?? '').trim();
    throw new Error(`git ${args.join(' ')} 失败${stderr ? `：${stderr}` : ''}`);
  }
}

function readIndexAt(ref) {
  if (!ref) return { tasks: [], archivedTasks: [] };
  const raw = git(['show', `${ref}:${TASK_STATE_INDEX_PATH}`], { allowFailure: true });
  if (raw === null || raw === '') return { tasks: [], archivedTasks: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      archivedTasks: Array.isArray(parsed.archivedTasks) ? parsed.archivedTasks : [],
    };
  } catch (error) {
    throw new Error(`${ref} 的任务索引不是合法 JSON：${error.message}`);
  }
}

function readAcceptanceReceiptsAt(sha, taskId) {
  const prefix = 'docs/worklog/pending/archive';
  const files = git(['ls-tree', '-r', '--name-only', sha, '--', prefix])
    .split(/\r?\n/)
    .filter((path) => path.startsWith(`${prefix}/${taskId}-receipt-`) && path.endsWith('.json'));
  return files.map((path) => {
    try {
      const receipt = JSON.parse(git(['show', `${sha}:${path}`]));
      return {
        path,
        verdict: receipt.payload?.reviewVerdict ?? receipt.reviewVerdict ?? null,
        scopeCheck: receipt.payload?.scopeCheck ?? receipt.scopeCheck ?? null,
        finalStatus: receipt.payload?.finalStatus ?? receipt.finalStatus ?? null,
      };
    } catch {
      return { path, verdict: 'invalid-json', scopeCheck: null, finalStatus: null };
    }
  });
}

export function evaluateAcceptanceAt(sha, taskIdOrBranch) {
  const taskId = extractCommitTaskId(taskIdOrBranch);
  if (!taskId) throw new Error(`无法从 ${taskIdOrBranch || '(空)'} 解析 PR 任务编号`);
  return evaluateAcceptanceSnapshot({
    taskId,
    currentIndex: readIndexAt(sha),
    receipts: readAcceptanceReceiptsAt(sha, taskId),
  });
}

function taskRecordAt(taskId, currentIndex, parentIndex) {
  return (
    currentIndex.tasks.find((task) => task?.taskId === taskId) ??
    parentIndex.tasks.find((task) => task?.taskId === taskId) ??
    currentIndex.archivedTasks.find((task) => task?.taskId === taskId) ??
    null
  );
}

function taskSheetPresence(sha, taskId, currentIndex, parentIndex) {
  if (!taskId) return { exists: undefined, path: null };
  const sheetPath = taskRecordAt(taskId, currentIndex, parentIndex)?.artifacts?.taskSheet ?? null;
  if (!sheetPath) return { exists: false, path: null };
  const exists = git(['cat-file', '-e', `${sha}:${sheetPath}`], { allowFailure: true }) !== null;
  return { exists, path: sheetPath };
}

/** 读取一个真实 git 提交并执行快照判定（只读）。 */
export function evaluateCommitAt(sha) {
  const subject = git(['show', '-s', '--format=%s', sha]);
  const parents = git(['show', '-s', '--format=%P', sha]).split(/\s+/).filter(Boolean);
  if (parents.length > 1) {
    return {
      sha,
      subject,
      pass: false,
      reason: 'merge-commit-not-supported',
      taskId: null,
      commitTaskId: extractCommitTaskId(subject),
      errors: ['编排门要求线性任务历史；merge commit 请改为 squash / rebase 流程'],
      files: [],
      covered: [],
    };
  }
  const parent = parents[0] ?? null;
  const changedFiles = git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', sha])
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
  const currentIndex = readIndexAt(sha);
  const parentIndex = readIndexAt(parent);
  let commitTaskId = null;
  try {
    commitTaskId = extractCommitTaskId(subject);
  } catch {
    // 多任务编号的权威错误由纯判定器返回。
  }
  const sheet = taskSheetPresence(sha, commitTaskId, currentIndex, parentIndex);
  const result = evaluateCommitSnapshot({
    subject,
    changedFiles,
    currentIndex,
    parentIndex,
    taskSheetExists: sheet.exists,
    taskSheetPath: sheet.path,
  });
  return { sha, subject, parent, ...result };
}

/** 校验 base..head 全部非 merge 提交，聚合所有失败而不是首错即停。 */
export function runCiTaskGate({ base, head, requireAccepted = false, taskId = null }) {
  if (!base || !head) throw new Error('必须提供 --base 与 --head');
  if (/^0+$/.test(base)) throw new Error('base 不能是全零 SHA；新分支请显式传目标基线');
  const shas = git(['rev-list', '--reverse', `${base}..${head}`])
    .split(/\s+/)
    .filter(Boolean);
  const results = shas.map(evaluateCommitAt);
  const failed = results.filter((result) => !result.pass).length;
  const acceptance = requireAccepted ? evaluateAcceptanceAt(head, taskId) : null;
  return {
    base,
    head,
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    failed,
    acceptance,
    ok: failed === 0 && (!acceptance || acceptance.pass),
    results,
  };
}

function parseArgs(argv) {
  const args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--require-accepted') args.requireAccepted = true;
    else if (arg === '--task-id') args.taskId = argv[++index];
    else if (arg === '--base') args.base = argv[++index];
    else if (arg === '--head') args.head = argv[++index];
    else throw new Error(`未知参数：${arg}`);
  }
  return args;
}

function printHuman(summary) {
  for (const result of summary.results) {
    const short = result.sha.slice(0, 12);
    if (result.pass) {
      console.log(
        `[ORCH-CI-GATE] PASS ${short} task=${result.taskId ?? 'state-plane'} reason=${result.reason} files=${result.files.length}`,
      );
    } else {
      console.error(`[ORCH-CI-GATE] FAIL ${short} reason=${result.reason} subject=${result.subject}`);
      for (const error of result.errors) console.error(`  - ${error}`);
    }
  }
  if (summary.acceptance) {
    const acceptance = summary.acceptance;
    const line = `[ORCH-CI-GATE] ACCEPTANCE task=${acceptance.taskId} pass=${acceptance.pass} reason=${acceptance.reason} receipts=${acceptance.receipts.length}`;
    if (acceptance.pass) console.log(line);
    else {
      console.error(line);
      for (const error of acceptance.errors) console.error(`  - ${error}`);
    }
  }
  console.log(
    `[ORCH-CI-GATE] total=${summary.total} passed=${summary.passed} failed=${summary.failed} ok=${summary.ok} base=${summary.base} head=${summary.head}`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const summary = runCiTaskGate(args);
    if (args.json) console.log(JSON.stringify(summary, null, 2));
    else printHuman(summary);
    if (!summary.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[ORCH-CI-GATE] ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
