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
import { ensureStateAnchor, syncStateAnchor } from './state-anchor.mjs';

const INDEX_PATH = 'docs/team/agent-orchestration/task-state-index.json';
const JOURNAL_PATH = 'docs/team/agent-orchestration/state/journal.jsonl';
const RECEIPT_DIR = 'docs/worklog/pending/archive';
const RECORDS_DIR = 'docs/worklog/records';

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

function collectRecordReceipts(directory, taskId) {
  if (!existsSync(directory)) return [];
  const found = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (current.replace(/\\/g, '/').endsWith(`/${taskId}`) && entry.name.startsWith('receipt-') && entry.name.endsWith('.json'))
        found.push(path);
    }
  }
  return found;
}

export function hasPassedDurableReceipt(taskId, rootDir = process.cwd()) {
  const directory = join(rootDir, RECEIPT_DIR);
  const legacy = existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.startsWith(`${taskId}-receipt-`) && name.endsWith('.json'))
        .map((name) => join(directory, name))
    : [];
  const bundled = collectRecordReceipts(join(rootDir, RECORDS_DIR), taskId);
  const receipts = [];
  for (const file of [...legacy, ...bundled]) {
    const display = file
      .slice(rootDir.length + 1)
      .split('\\')
      .join('/');
    try {
      const receipt = readJson(file);
      receipts.push({
        path: display,
        verdict: receipt.payload?.reviewVerdict ?? receipt.reviewVerdict ?? null,
        scopeCheck: receipt.payload?.scopeCheck ?? receipt.scopeCheck ?? null,
        finalStatus: receipt.payload?.finalStatus ?? receipt.finalStatus ?? null,
        manualReviewList: receipt.payload?.manualReviewList ?? receipt.manualReviewList ?? null,
        backlogItems: receipt.payload?.backlogItems ?? receipt.backlogItems ?? null,
      });
    } catch {
      receipts.push({ path: display, verdict: 'invalid-json' });
    }
  }
  return { pass: mergeableDurableReceipts(receipts).length > 0, receipts };
}

/** 必需检查必须全部存在且完成；同名检查只认最新一次 run，旧 SHA/旧 run 的失败不累计。 */
export function evaluateRequiredChecks(checkRuns, required = INTEGRATE_REQUIRED_CONTEXTS) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  // AF-498：GitHub 对同一 SHA 会保留历史 check run（重跑前的 failure/cancelled 仍在列表里）。
  // 按 name 取时间最新的一条，避免一次失败之后永远被判 failing。
  const latestByName = new Map();
  runs.forEach((run, index) => {
    const time = Date.parse(run.completed_at ?? run.started_at ?? '') || index;
    const previous = latestByName.get(run.name);
    if (!previous || time >= previous.time) {
      latestByName.set(run.name, { run, time, index });
    }
  });
  const latest = [...latestByName.values()].map((entry) => entry.run);
  const names = new Set(latest.map((run) => run.name));
  const missing = required.filter((name) => !names.has(name));
  const failing = latest
    .filter((run) => run.status === 'completed' && FAILING_CONCLUSIONS.includes(String(run.conclusion ?? '').toLowerCase()))
    .map((run) => `${run.name}（${run.conclusion}）`);
  const pending = latest
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

/** 仓库级 PR 盘点：不要求在任务分支上执行。 */
async function listOpenPulls(repo, base = 'integrate') {
  const body = unwrapGithub(
    await githubRequest({
      path: `/repos/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=100&sort=updated&direction=desc`,
    }),
  );
  return Array.isArray(body) ? body : [];
}

function taskIdFromBranch(branch) {
  const match = /^task\/(AF-\d+)/.exec(String(branch ?? ''));
  return match?.[1] ?? null;
}

export function classifyPullRequests(pulls, tasksById = new Map(), now = Date.now()) {
  const duplicates = new Map();
  for (const pull of pulls) {
    const taskId = taskIdFromBranch(pull.head?.ref);
    if (taskId) duplicates.set(taskId, [...(duplicates.get(taskId) ?? []), pull.number]);
  }
  return pulls.map((pull) => {
    const taskId = taskIdFromBranch(pull.head?.ref);
    const task = tasksById.get(taskId) ?? null;
    const ageDays = Math.floor((now - Date.parse(pull.updated_at ?? pull.created_at ?? '')) / 86_400_000);
    let state = 'ready';
    if (!taskId || !task) state = 'orphan';
    else if ((duplicates.get(taskId) ?? []).length > 1) state = 'duplicate';
    else if (!task.status || !['completed', 'archived'].includes(task.status)) state = 'blocked';
    else if (ageDays >= 14) state = 'stale';
    return {
      number: pull.number,
      title: pull.title,
      branch: pull.head?.ref ?? null,
      taskId,
      taskStatus: task?.status ?? null,
      draft: Boolean(pull.draft),
      ageDays,
      updatedAt: pull.updated_at ?? null,
      state,
      url: pull.html_url,
      headSha: pull.head?.sha ?? null,
    };
  });
}

async function listPullRequests({ repo, base, json }) {
  const pulls = await listOpenPulls(repo, base);
  const rows = pulls.map((pull) => ({
    number: pull.number,
    branch: pull.head?.ref ?? null,
    taskId: taskIdFromBranch(pull.head?.ref),
    title: pull.title,
    draft: Boolean(pull.draft),
    url: pull.html_url,
  }));
  if (json) console.log(JSON.stringify({ base, count: rows.length, pulls: rows }, null, 2));
  else {
    console.log(`[ORCH-PR] open=${rows.length} base=${base}`);
    for (const row of rows) console.log(`  #${row.number} ${row.taskId ?? '-'} ${row.branch ?? '-'} ${row.title}`);
  }
  return { base, count: rows.length, pulls: rows };
}

async function triagePullRequests({ repo, base, json }) {
  const pulls = await listOpenPulls(repo, base);
  const index = readJson(INDEX_PATH);
  const tasksById = new Map([...(index.tasks ?? []), ...(index.archivedTasks ?? [])].map((task) => [task.taskId, task]));
  const rows = classifyPullRequests(pulls, tasksById);
  if (json) console.log(JSON.stringify({ base, count: rows.length, pulls: rows }, null, 2));
  else {
    console.log(`[ORCH-PR] triage open=${rows.length} base=${base}`);
    for (const row of rows)
      console.log(`  #${row.number} ${row.state} task=${row.taskId ?? '-'} status=${row.taskStatus ?? '-'} age=${row.ageDays}d`);
    const counts = rows.reduce((acc, row) => ({ ...acc, [row.state]: (acc[row.state] ?? 0) + 1 }), {});
    console.log(
      `  汇总：${Object.entries(counts)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
    );
  }
  return { base, count: rows.length, pulls: rows };
}

async function resolvePull({ repo, base, taskId, prNumber }) {
  if (prNumber) {
    const pr = unwrapGithub(await githubRequest({ path: `/repos/${repo}/pulls/${prNumber}` }));
    if (!pr) throw new Error(`PR #${prNumber} 不存在`);
    return pr;
  }
  if (!taskId) throw new Error('close / supersede 需要 --pr 或 --taskId');
  const pulls = await listOpenPulls(repo, base);
  const pr = pulls.find((item) => taskIdFromBranch(item.head?.ref) === taskId);
  if (!pr) throw new Error(`未找到 ${taskId} 的开放 PR`);
  return pr;
}

async function closePullRequest({ repo, base, taskId, prNumber, apply, reason, deleteBranch, comment }) {
  const pr = await resolvePull({ repo, base, taskId, prNumber });
  const plan = {
    mode: apply ? 'apply' : 'dry-run',
    action: 'close',
    pr: pr.number,
    branch: pr.head?.ref,
    taskId: taskId ?? taskIdFromBranch(pr.head?.ref),
    reason,
  };
  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    return plan;
  }
  if (comment) {
    await githubRequest({ method: 'POST', path: `/repos/${repo}/issues/${pr.number}/comments`, body: { body: comment } });
  }
  const closed = await githubRequest({ method: 'PATCH', path: `/repos/${repo}/pulls/${pr.number}`, body: { state: 'closed' } });
  if (!closed.ok) throw new Error(closed.error);
  if (deleteBranch && pr.head?.ref) {
    const deleted = await githubRequest({ method: 'DELETE', path: `/repos/${repo}/git/refs/heads/${pr.head.ref}` });
    if (!deleted.ok && deleted.status !== 404 && deleted.status !== 422) throw new Error(deleted.error);
  }
  console.log(`[ORCH-PR] 已关闭 PR #${pr.number}（merged=false，reason=${reason ?? 'manual'}）`);
  return { ...plan, closed: true };
}

async function supersedePullRequest({ repo, base, taskId, prNumber, by, apply }) {
  if (!by) throw new Error('supersede 需要 --by <后继任务号或 PR 号>');
  const comment = [
    `此 PR 已被 ${by} 取代，按 AF-365 的 PR 生命周期规则关闭，不再合并。`,
    '',
    '- 代码/功能由后继任务或已合并提交承接；',
    '- 本 PR 的 checks 结果保留为历史证据；',
    '- 任务级替代关系以任务单 supersedes / supersededBy 为准。',
  ].join('\n');
  return closePullRequest({ repo, base, taskId, prNumber, apply, reason: `superseded-by-${by}`, deleteBranch: false, comment });
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
  // PR 标题只取 conventional 首行；Task trailer 放合并提交正文，GitHub 不允许标题带换行。
  return buildSquashCommitMessage({ taskId: task.taskId, taskType: task.type, title: task.title }).split('\n')[0];
}

export function buildPullRequestCreatePayload({ task, branch, base }) {
  const body = [
    `## 编排任务 ${task.taskId}`,
    '',
    `- 任务单：\`${task.artifacts?.taskSheet ?? '见状态索引'}\``,
    `- 交付记录：\`${task.artifacts?.deliveryRecord ?? '验收后补齐'}\``,
    '- 合并策略：CI 与 Orchestration Gate 全绿后 squash；禁止直接推送 integrate。',
    '- L4（master / tag / release / deploy）不在本 PR 授权范围内。',
  ].join('\n');
  return {
    title: pullRequestTitle(task),
    head: branch,
    base,
    body,
    maintainer_can_modify: true,
    // 默认 draft：PR 创建与后续 push 不触发全量 CI；merge 前显式转 ready 跑一次。
    draft: true,
  };
}

async function createOrUpdatePullRequest({ repo, base, taskId, apply }) {
  const branch = currentTaskBranch(taskId);
  const task = taskInfo(taskId);
  assertSingleTaskBranch({ branch, base, taskId, allowedTaskIds: task.priorTasks ?? [] });
  if (!apply) {
    console.log(
      JSON.stringify(
        { mode: 'dry-run', action: 'create', repo, base, branch, payload: buildPullRequestCreatePayload({ task, branch, base }) },
        null,
        2,
      ),
    );
    return;
  }
  git(['push', '-u', 'origin', branch]);
  const existing = await findPullRequest(repo, branch, base);
  if (existing) {
    console.log(`[ORCH-PR] 已存在 PR #${existing.number} ${existing.html_url} head=${existing.head.sha} draft=${existing.draft === true}`);
    return;
  }
  const payload = buildPullRequestCreatePayload({ task, branch, base });
  const pr = unwrapGithub(
    await githubRequest({
      method: 'POST',
      path: `/repos/${repo}/pulls`,
      body: payload,
    }),
  );
  console.log(`[ORCH-PR] 已创建 draft PR #${pr.number} ${pr.html_url} head=${pr.head.sha}`);
}

/** 仓库级 status：不在任务分支时按 branch 前缀反查，避免只能在分支内用。 */
async function statusAnyPullRequest({ repo, base, taskId, prNumber }) {
  let pr;
  if (prNumber) pr = unwrapGithub(await githubRequest({ path: `/repos/${repo}/pulls/${prNumber}` }));
  else {
    const branch = git(['branch', '--show-current']);
    if (branch.startsWith('task/') && branch.includes(taskId)) pr = await findPullRequest(repo, branch, base);
    else {
      const pulls = await listOpenPulls(repo, base);
      pr = pulls.find((item) => taskIdFromBranch(item.head?.ref) === taskId) ?? null;
    }
  }
  if (!pr) throw new Error(`未找到 ${taskId ?? `#${prNumber}`} → ${base} 的开放 PR`);
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
  // AF-498：允许从当前任务分支反推任务号。任务归档后不再要求“先切回 индекс里的 active 任务”，
  // 否则已完成任务永远找不到自己的分支，只能手工改 state 才能合并。
  const resolvedTaskId = taskId ?? taskIdFromBranch(git(['branch', '--show-current']));
  if (!resolvedTaskId) throw new Error('merge 需要 --taskId，或从 task/AF-NNN-* 分支反推任务号');
  const branch = currentTaskBranch(resolvedTaskId);
  const task = taskInfo(resolvedTaskId);
  const receipt = hasPassedDurableReceipt(resolvedTaskId);
  const pr = await findPullRequest(repo, branch, base);
  const plan = {
    mode: apply ? 'apply' : 'dry-run',
    action: 'merge',
    taskId: resolvedTaskId,
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
  if (task.status !== 'completed') throw new Error(`任务 ${resolvedTaskId} 尚未 completed（当前 ${task.status}）`);
  if (!receipt.pass)
    throw new Error(`任务 ${resolvedTaskId} 没有可合并的 durable 回执（passed，或已登记 backlog 且无人工复核项的 conditional-pass）`);
  if (!pr) throw new Error(`未找到 ${branch} → ${base} 的开放 PR`);
  if (pr.head.sha !== plan.localHead) throw new Error(`PR HEAD ${pr.head.sha} 不等于本地 HEAD ${plan.localHead}；请先推送最新状态`);
  if (pr.draft) {
    if (!pr.node_id) throw new Error(`draft PR #${pr.number} 缺少 node_id，无法转 ready`);
    // REST 没有 ready_for_review 端点（实测 404）；GitHub 只提供 GraphQL mutation。
    const ready = await githubRequest({
      method: 'POST',
      path: '/graphql',
      body: {
        query: 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}',
        variables: { id: pr.node_id },
      },
    });
    if (!ready.ok) throw new Error(`draft PR #${pr.number} 转 ready 失败：${ready.error}`);
    if (Array.isArray(ready.body?.errors) && ready.body.errors.length > 0) {
      throw new Error(`draft PR #${pr.number} 转 ready 失败：${ready.body.errors.map((item) => item.message).join('；')}`);
    }
    console.log(`[ORCH-PR] draft PR #${pr.number} 已转 ready，等待 required checks`);
  }
  await waitForRequiredChecks({ repo, sha: pr.head.sha, timeoutMinutes, intervalSeconds });
  const merged = unwrapGithub(
    await githubRequest({
      method: 'PUT',
      path: `/repos/${repo}/pulls/${pr.number}/merge`,
      body: {
        merge_method: 'squash',
        commit_title: pullRequestTitle(task),
        commit_message: `任务 ${resolvedTaskId} 已完成机读验收与远端必需检查；由受保护 PR 流程 squash 合并。\n\nTask: ${resolvedTaskId}`,
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
    prNumber: valueAfter('--pr', null),
    by: valueAfter('--by', null),
    reason: valueAfter('--reason', null),
    comment: valueAfter('--comment', null),
    deleteBranch: rest.includes('--delete-branch'),
    json: rest.includes('--json'),
    apply: rest.includes('--apply'),
    timeoutMinutes: Number(valueAfter('--timeout-minutes', '45')),
    intervalSeconds: Number(valueAfter('--interval-seconds', '30')),
  };
}

async function main(argv) {
  // AF-498：pr-release 也依赖状态面，入口先恢复锚点，避免分支切换后读到旧索引。
  ensureStateAnchor();
  process.on('exit', () => {
    try {
      syncStateAnchor();
    } catch {
      /* ignore */
    }
  });
  const args = parseArgs(argv);
  if (!['create', 'status', 'merge', 'list', 'triage', 'close', 'supersede'].includes(args.command)) {
    throw new Error(
      '用法：create|status|merge|list|triage|close|supersede [--taskId AF-0xx] [--pr N] [--apply] [--repo owner/repo] [--base integrate]',
    );
  }
  if (args.command === 'list') return listPullRequests(args);
  if (args.command === 'triage') return triagePullRequests(args);
  if (args.command === 'close') return closePullRequest(args);
  if (args.command === 'supersede') return supersedePullRequest(args);
  if (!args.taskId && !args.prNumber) throw new Error(`${args.command} 需要 --taskId 或 --pr`);
  if (args.command === 'create') return createOrUpdatePullRequest(args);
  if (args.command === 'status') return statusAnyPullRequest(args);
  return mergePullRequest(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[ORCH-PR] ${error.message}`);
    process.exitCode = 1;
  });
}
