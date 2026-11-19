#!/usr/bin/env node
/**
 * AF-056 · 受保护 integrate 的 PR 发布路径（不依赖 gh CLI）。
 *
 *   node scripts/orchestration/pr-release.mjs create --taskId AF-0xx --apply
 *   node scripts/orchestration/pr-release.mjs status --taskId AF-0xx
 *   node scripts/orchestration/pr-release.mjs merge  --taskId AF-0xx --apply
 *
 * create 可重复执行并推送当前任务分支；merge 只在 completed + 可合并 durable 回执 +
 * PR HEAD == 本地 HEAD + 必需 checks 全绿时 squash 合并，随后同步本地并清理分支。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubRequest, unwrapGithub } from './github-api.mjs';
import { FAILING_CONCLUSIONS, PASSING_CONCLUSIONS, fetchCheckRuns } from './ci-status.mjs';
import { buildSquashCommitMessage } from './branch-workflow.mjs';
import { INTEGRATE_REQUIRED_CONTEXTS } from './branch-protection.mjs';
import { extractCommitTaskId, mergeableDurableReceipts } from './ci-task-gate.mjs';

const INDEX_PATH = 'docs/team/agent-orchestration/task-state-index.json';
const JOURNAL_PATH = 'docs/team/agent-orchestration/state/journal.jsonl';
const RECEIPT_DIR = 'docs/worklog/pending/archive';

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(' ')} 失败：${String(error.stderr ?? error.message).trim()}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function taskInfo(taskId) {
  const index = readJson(INDEX_PATH);
  const current = (index.tasks ?? []).find((task) => task.taskId === taskId);
  const archived = (index.archivedTasks ?? []).find((task) => task.taskId === taskId);
  const journal = existsSync(JOURNAL_PATH)
    ? readFileSync(JOURNAL_PATH, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const authored = [...journal].reverse().find((event) => event.taskId === taskId && event.payload?.task?.title)?.payload?.task;
  const record = current ?? archived ?? authored;
  if (!record) throw new Error(`任务 ${taskId} 不在当前状态索引 / 事件链中`);
  return {
    ...authored,
    ...record,
    status: current?.status ?? archived?.status ?? authored?.status,
    archived: Boolean(archived),
  };
}

export function hasPassedDurableReceipt(taskId, rootDir = process.cwd()) {
  const directory = join(rootDir, RECEIPT_DIR);
  if (!existsSync(directory)) return { pass: false, receipts: [] };
  const receipts = [];
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(`${taskId}-receipt-`) || !name.endsWith('.json')) continue;
    try {
      const receipt = readJson(join(directory, name));
      receipts.push({
        path: `${RECEIPT_DIR}/${name}`,
        verdict: receipt.payload?.reviewVerdict ?? receipt.reviewVerdict ?? null,
        scopeCheck: receipt.payload?.scopeCheck ?? receipt.scopeCheck ?? null,
        finalStatus: receipt.payload?.finalStatus ?? receipt.finalStatus ?? null,
        manualReviewList: receipt.payload?.manualReviewList ?? receipt.manualReviewList ?? null,
        backlogItems: receipt.payload?.backlogItems ?? receipt.backlogItems ?? null,
      });
    } catch {
      receipts.push({ path: `${RECEIPT_DIR}/${name}`, verdict: 'invalid-json' });
    }
  }
  return { pass: mergeableDurableReceipts(receipts).length > 0, receipts };
}

/** 必需检查必须全部存在且完成；任何实际失败 check 都优先判 fail。 */
export function evaluateRequiredChecks(checkRuns, required = INTEGRATE_REQUIRED_CONTEXTS) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const names = new Set(runs.map((run) => run.name));
  const missing = required.filter((name) => !names.has(name));
  const failing = runs
    .filter((run) => run.status === 'completed' && FAILING_CONCLUSIONS.includes(String(run.conclusion ?? '').toLowerCase()))
    .map((run) => `${run.name}（${run.conclusion}）`);
  const pending = runs
    .filter((run) => {
      if (!required.includes(run.name)) return false;
      if (run.status !== 'completed') return true;
      const conclusion = String(run.conclusion ?? '').toLowerCase();
      return !PASSING_CONCLUSIONS.includes(conclusion) && !FAILING_CONCLUSIONS.includes(conclusion);
    })
    .map((run) => run.name);
  return {
    verdict: failing.length ? 'fail' : missing.length || pending.length ? (runs.length ? 'pending' : 'unknown') : 'pass',
    total: runs.length,
    missing,
    failing,
    pending,
  };
}

function currentTaskBranch(taskId) {
  const branch = git(['branch', '--show-current']);
  if (!branch.startsWith('task/') || !branch.includes(taskId)) {
    throw new Error(`当前分支 ${branch || '(detached)'} 不是 ${taskId} 的任务分支`);
  }
  return branch;
}

async function findPullRequest(repo, branch, base = 'integrate') {
  const owner = repo.split('/')[0];
  const body = unwrapGithub(
    await githubRequest({
      path: `/repos/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=10`,
    }),
  );
  return Array.isArray(body) ? (body[0] ?? null) : null;
}

/**
 * 一个 PR 只能承载一个主任务，但允许携带任务单 `priorTasks` 声明的返修链。
 * 逐提交门禁仍按各自任务判定；squash 后按任务链 scope 并集校验。create 阶段扫描
 * base..branch 的提交标题，只有链外任务编号才拒绝。纯状态面提交没有任务号，直接放行。
 */
export function findForeignCommitTaskIds(subjects, taskId, allowedTaskIds = []) {
  const allowed = new Set([taskId, ...(allowedTaskIds ?? [])].filter(Boolean));
  const foreign = [];
  for (const subject of subjects ?? []) {
    let commitTaskId = null;
    try {
      commitTaskId = extractCommitTaskId(subject);
    } catch (error) {
      throw new Error(`${subject}：${error.message}`);
    }
    if (commitTaskId && !allowed.has(commitTaskId)) foreign.push({ taskId: commitTaskId, subject });
  }
  return foreign;
}

function assertSingleTaskBranch({ branch, base, taskId, allowedTaskIds = [] }) {
  const baseRef = git(['rev-parse', '--verify', base], { allowFailure: true }) ? base : `origin/${base}`;
  const subjects = git(['log', '--format=%s', `${baseRef}..${branch}`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const foreign = findForeignCommitTaskIds(subjects, taskId, allowedTaskIds);
  if (foreign.length > 0) {
    const detail = foreign.map((item) => `${item.taskId}（${item.subject}）`).join('、');
    throw new Error(
      `分支 ${branch} 混入任务链之外的任务提交：${detail}。一个 PR 只能承载 ${taskId} 及其 priorTasks 链；请先把链外任务单独合并到 ${base}`,
    );
  }
}

function pullRequestTitle(task) {
  return buildSquashCommitMessage({ taskId: task.taskId, taskType: task.type, title: task.title });
}

async function createOrUpdatePullRequest({ repo, base, taskId, apply }) {
  const branch = currentTaskBranch(taskId);
  const task = taskInfo(taskId);
  assertSingleTaskBranch({ branch, base, taskId, allowedTaskIds: task.priorTasks ?? [] });
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', action: 'create', repo, base, branch, title: pullRequestTitle(task) }, null, 2));
    return;
  }
  git(['push', '-u', 'origin', branch]);
  const existing = await findPullRequest(repo, branch, base);
  if (existing) {
    console.log(`[ORCH-PR] 已存在 PR #${existing.number} ${existing.html_url} head=${existing.head.sha}`);
    return;
  }
  const body = [
    `## 编排任务 ${taskId}`,
    '',
    `- 任务单：\`${task.artifacts?.taskSheet ?? '见状态索引'}\``,
    `- 交付记录：\`${task.artifacts?.deliveryRecord ?? '验收后补齐'}\``,
    '- 合并策略：CI 与 Orchestration Gate 全绿后 squash；禁止直接推送 integrate。',
    '- L4（master / tag / release / deploy）不在本 PR 授权范围内。',
  ].join('\n');
  const pr = unwrapGithub(
    await githubRequest({
      method: 'POST',
      path: `/repos/${repo}/pulls`,
      body: { title: pullRequestTitle(task), head: branch, base, body, maintainer_can_modify: true },
    }),
  );
  console.log(`[ORCH-PR] 已创建 PR #${pr.number} ${pr.html_url} head=${pr.head.sha}`);
}

async function statusPullRequest({ repo, base, taskId }) {
  const branch = currentTaskBranch(taskId);
  const pr = await findPullRequest(repo, branch, base);
  if (!pr) throw new Error(`未找到 ${branch} → ${base} 的开放 PR`);
  const checks = await fetchCheckRuns({ repo, sha: pr.head.sha });
  if (!checks.ok) throw new Error(checks.error);
  const verdict = evaluateRequiredChecks(checks.checkRuns);
  console.log(JSON.stringify({ pr: pr.number, url: pr.html_url, head: pr.head.sha, ...verdict }, null, 2));
  return { pr, verdict };
}

async function waitForRequiredChecks({ repo, sha, timeoutMinutes, intervalSeconds }) {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let last = null;
  while (Date.now() <= deadline) {
    const fetched = await fetchCheckRuns({ repo, sha });
    if (!fetched.ok) throw new Error(fetched.error);
    const verdict = evaluateRequiredChecks(fetched.checkRuns);
    last = verdict;
    console.log(
      `[ORCH-PR] checks=${verdict.verdict} total=${verdict.total} missing=${verdict.missing.length} pending=${verdict.pending.length} failing=${verdict.failing.length}`,
    );
    if (verdict.verdict === 'pass') return verdict;
    if (verdict.verdict === 'fail') throw new Error(`远端检查失败：${verdict.failing.join('、')}`);
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
  throw new Error(`等待远端检查超时（${timeoutMinutes} 分钟）：${JSON.stringify(last)}`);
}

async function mergePullRequest({ repo, base, taskId, apply, timeoutMinutes, intervalSeconds }) {
  const branch = currentTaskBranch(taskId);
  const task = taskInfo(taskId);
  const receipt = hasPassedDurableReceipt(taskId);
  const pr = await findPullRequest(repo, branch, base);
  const plan = {
    mode: apply ? 'apply' : 'dry-run',
    action: 'merge',
    taskId,
    status: task.status,
    archived: task.archived,
    receipt,
    branch,
    pr: pr?.number ?? null,
    localHead: git(['rev-parse', 'HEAD']),
    remoteHead: pr?.head?.sha ?? null,
  };
  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!task.archived || task.status !== 'completed') throw new Error(`任务 ${taskId} 尚未 completed/archived`);
  if (!receipt.pass) throw new Error(`任务 ${taskId} 没有可合并的 durable 回执（passed，或已登记 backlog 且无人工复核项的 conditional-pass）`);
  if (!pr) throw new Error(`未找到 ${branch} → ${base} 的开放 PR`);
  if (pr.head.sha !== plan.localHead) throw new Error(`PR HEAD ${pr.head.sha} 不等于本地 HEAD ${plan.localHead}；请先推送最新状态`);
  await waitForRequiredChecks({ repo, sha: pr.head.sha, timeoutMinutes, intervalSeconds });
  const merged = unwrapGithub(
    await githubRequest({
      method: 'PUT',
      path: `/repos/${repo}/pulls/${pr.number}/merge`,
      body: {
        merge_method: 'squash',
        commit_title: pullRequestTitle(task),
        commit_message: `任务 ${taskId} 已完成机读验收与远端必需检查；由受保护 PR 流程 squash 合并。`,
      },
    }),
  );
  if (!merged.merged || !merged.sha) throw new Error(`GitHub 未确认合并：${merged.message ?? 'unknown'}`);
  console.log(`[ORCH-PR] 已 squash 合并 PR #${pr.number} mergeSha=${merged.sha}`);
  // 远端分支可能已被仓库自动删除；404 不作为合并后的失败。
  git(['fetch', 'origin', 'integrate']);
  git(['checkout', 'integrate']);
  git(['merge', '--ff-only', 'origin/integrate']);
  const localHead = git(['rev-parse', 'HEAD']);
  if (localHead !== merged.sha) throw new Error(`本地 integrate HEAD ${localHead} 与合并 SHA ${merged.sha} 不一致`);
  const treeSame = git(['diff', '--quiet', branch, merged.sha], { allowFailure: true }) !== null;
  if (treeSame) git(['branch', '-D', branch]);
  const remoteDelete = await githubRequest({ method: 'DELETE', path: `/repos/${repo}/git/refs/heads/${branch}` });
  if (!remoteDelete.ok && remoteDelete.status !== 404 && remoteDelete.status !== 422) throw new Error(remoteDelete.error);
  console.log(
    JSON.stringify(
      { merged: true, mergeSha: merged.sha, localHead, localBranchDeleted: treeSame, remoteBranchDeleted: remoteDelete.ok },
      null,
      2,
    ),
  );
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const valueAfter = (flag, fallback) => {
    const index = rest.indexOf(flag);
    return index >= 0 ? rest[index + 1] : fallback;
  };
  return {
    command,
    repo: valueAfter('--repo', 'aa386400024/mofang-nestjs'),
    base: valueAfter('--base', 'integrate'),
    taskId: valueAfter('--taskId', null),
    apply: rest.includes('--apply'),
    timeoutMinutes: Number(valueAfter('--timeout-minutes', '45')),
    intervalSeconds: Number(valueAfter('--interval-seconds', '30')),
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!['create', 'status', 'merge'].includes(args.command) || !args.taskId) {
    throw new Error('用法：create|status|merge --taskId AF-0xx [--apply] [--repo owner/repo] [--base integrate]');
  }
  if (args.command === 'create') return createOrUpdatePullRequest(args);
  if (args.command === 'status') return statusPullRequest(args);
  return mergePullRequest(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[ORCH-PR] ${error.message}`);
    process.exitCode = 1;
  });
}
