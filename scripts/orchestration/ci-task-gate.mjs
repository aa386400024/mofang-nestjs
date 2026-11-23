#!/usr/bin/env node
/**
 * AF-056 · GitHub 服务端逐提交编排门。
 *
 * 本地 Husky 只能约束自觉启用钩子的提交；本模块在 CI 中对 base..head 的每个提交
 * 重新读取「该提交 / 其父提交」的任务索引，复用 task-entry-gate 的同一套状态机：
 *   - 在办任务提交：taskId + scope.files + 任务单存在性；
 *   - 纯状态面提交：沿用 state-plane-only；
 *   - squash 归档提交：沿用 archived-transition（父在办、当前 completed/archived）；
 *   - squash 全生命周期：父无该任务、当前 completed/archived，且存在可合并 durable 回执
 *     （passed，或已登记 backlog 且无人工复核项的 conditional-pass）。
 *
 * 纯判定函数不碰 git；IO 适配层只读 git 对象，不改工作区、不写状态面。
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { evaluateTaskEntry, isStatePlanePath } from './task-entry-gate.mjs';

/** AF-373 · trailer 强制生效时间：此后新建提交必须带 Task trailer，历史提交不受影响。 */
export const TASK_TRAILER_ENFORCED_SINCE = '2026-11-23T09:00:00Z';

export const TASK_STATE_INDEX_PATH = 'docs/team/agent-orchestration/task-state-index.json';
/** 提交标题里的任务编号 token：字母前缀（≥2）可选连字符 + 数字，全文扫描但排除技术串。 */
const TASK_ID_TOKEN_RE = /(?<![A-Za-z0-9])[A-Za-z]{2,}-?\d+/g;
/** 常见技术串归一后形似任务编号，显式排除，避免 `fix(utf-8)` 被当成任务。 */
const NON_TASK_PREFIXES = new Set(['UTF', 'UTF8', 'ISO', 'SHA', 'MD', 'IPV', 'HTTP', 'TLS', 'CSS', 'JS', 'TS', 'V2', 'BASE64']);

/**
 * `AF-219` / `af219` 统一归一为 `AF-219`；不合形态（如 `Phase2`、`utf-8`）返回 null。
 * 无连字符的紧凑写法只接受全小写 2–3 字母前缀（`af219` / `wp12`），避免把正文里的
 * `Phase2`、`base64` 之类技术串当成任务编号。
 */
export function canonicalTaskId(token) {
  const raw = String(token ?? '').trim();
  if (!raw) return null;
  const match = /^([A-Za-z]{1,})-(\d+)$/.exec(raw) ?? /^([a-z]{2,3})(\d+)$/.exec(raw);
  if (!match) return null;
  const prefix = match[1].toUpperCase();
  if (NON_TASK_PREFIXES.has(prefix)) return null;
  return `${prefix}-${match[2]}`;
}

/**
 * 从提交标题解析唯一任务编号；同编号重复出现允许，多编号拒绝。
 * 大小写不敏感（`docs(af219):` 与 `feat(AF-219):` 等价）；技术串（utf-8 / sha-1 等）不计为任务编号。
 */
export function extractCommitTaskId(subject) {
  const ids = [...new Set((String(subject ?? '').match(TASK_ID_TOKEN_RE) ?? []).map(canonicalTaskId).filter(Boolean))];
  if (ids.length > 1) throw new Error(`提交标题含多个任务编号：${ids.join('、')}`);
  return ids[0] ?? null;
}

/**
 * AF-373 · 解析 Git trailer：`Task: AF-123` 或 `Task: none`。
 * 一个提交只允许一个不同任务号；同一编号重复声明视为同一任务。
 * 返回 `{present, taskId}`，`none` 时 taskId=null。
 */
export function extractTaskTrailer(message) {
  const lines = String(message ?? '')
    .split(/\r?\n/)
    .map((line) => /^Task:\s*(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => match[1].trim());
  if (lines.length === 0) return { present: false, taskId: null };
  const raw = [...new Set(lines)];
  if (raw.length > 1) throw new Error(`提交包含多个不同 Task trailer：${raw.join('、')}`);
  if (raw[0].toLowerCase() === 'none') return { present: true, taskId: null };
  const taskId = canonicalTaskId(raw[0]);
  if (!taskId) throw new Error(`Task trailer 非法：${raw[0]}`);
  return { present: true, taskId };
}

/**
 * 提交任务号唯一真相：有 trailer 用 trailer，并校验与 subject 不冲突；
 * 没有 trailer 时回退 subject（仅用于 trailer 强制生效前的历史提交）。
 */
export function resolveCommitTaskId({ message, subject }) {
  const trailer = extractTaskTrailer(message);
  const subjectId = extractCommitTaskId(subject);
  if (!trailer.present) return { taskId: subjectId, source: 'subject' };
  if (trailer.taskId === null && subjectId) {
    throw new Error(`Task: none 与 subject 中的任务号冲突：${subjectId}`);
  }
  if (trailer.taskId !== null && subjectId !== null && trailer.taskId !== subjectId) {
    throw new Error(`Task trailer ${trailer.taskId} 与 subject 任务号 ${subjectId} 不一致`);
  }
  return { taskId: trailer.taskId, source: 'trailer', none: trailer.taskId === null };
}

/**
 * 单提交快照纯判定。taskSheetExists 仅在解析到 taskId 且判定需要任务时强制 true。
 * @returns {{pass:boolean,reason:string,taskId:string|null,commitTaskId:string|null,errors:string[],files:string[],covered:string[]}}
 */
export function evaluateCommitSnapshot({
  subject,
  changedFiles,
  currentIndex,
  parentIndex,
  taskSheetExists,
  taskSheetPath = null,
  taskSheetSnapshot = null,
  receipts = [],
  rootDir = null,
  message = null,
  commitDate = null,
}) {
  let commitTaskId = null;
  let trailer = { present: false, taskId: null };
  try {
    const resolved = resolveCommitTaskId({ message, subject });
    commitTaskId = resolved.taskId;
    trailer = { present: resolved.source === 'trailer', taskId: resolved.taskId };
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
  if (trailer.present && trailer.taskId === null) {
    const impl = (changedFiles ?? []).filter((file) => !isStatePlanePath(file));
    if (impl.length > 0) {
      return {
        pass: false,
        reason: 'state-none-with-impl',
        taskId: null,
        commitTaskId: null,
        errors: [`Task: none 只允许纯状态面提交，实际含实现文件：${impl.slice(0, 10).join(',')}`],
        files: changedFiles ?? [],
        covered: [],
      };
    }
  }
  const requiresTrailer = commitDate !== null && String(commitDate) >= TASK_TRAILER_ENFORCED_SINCE;
  if (requiresTrailer && !trailer.present) {
    return {
      pass: false,
      reason: 'missing-task-trailer',
      taskId: null,
      commitTaskId,
      errors: [`提交缺少 Task trailer（强制生效时间 ${TASK_TRAILER_ENFORCED_SINCE}）：请写 Task: ${commitTaskId ?? 'none'}`],
      files: changedFiles ?? [],
      covered: [],
    };
  }
  const parentTasks = parentIndex?.tasks ?? [];
  const parentArchivedTasks = parentIndex?.archivedTasks ?? [];
  const taskSheetTask =
    taskSheetSnapshot && commitTaskId && taskSheetSnapshot.taskId === commitTaskId
      ? {
          taskId: commitTaskId,
          status: 'submitted',
          agentRole: taskSheetSnapshot.agentRole,
          scope: { files: taskSheetSnapshot.scopeFiles ?? [], modules: [], interfaces: [] },
          artifacts: {
            taskSheet: taskSheetPath ?? undefined,
            deliveryRecord: taskSheetSnapshot.artifactPaths?.[0] ?? undefined,
          },
        }
      : null;
  const currentTasks = [...(currentIndex?.tasks ?? [])];
  if (taskSheetTask && !currentTasks.some((task) => task?.taskId === commitTaskId)) currentTasks.push(taskSheetTask);
  const recordedArchived = (currentIndex?.archivedTasks ?? []).find(
    (task) => task?.taskId === commitTaskId && task?.status === 'completed',
  );
  // 状态面解耦：任务分支不提交 index，最终 HEAD 以「任务单 + 可合并 durable 回执」合成 archived。
  const currentArchived =
    recordedArchived ??
    (taskSheetTask && mergeableDurableReceipts(receipts).length > 0 ? { ...taskSheetTask, status: 'completed' } : undefined);
  const parentHasTask = [...parentTasks, ...parentArchivedTasks].some((task) => task?.taskId === commitTaskId);
  // squash 会把 register → implement → receipt → archive 压成一个提交，parent 根本没有任务。
  // 仅在可合并 durable 回执证明已验收时，合成“父在办”快照复用 archived-transition；否则仍拒绝。
  const squashLifecycle = Boolean(commitTaskId && currentArchived && !parentHasTask && mergeableDurableReceipts(receipts).length > 0);
  const effectiveParentTasks = squashLifecycle ? [...parentTasks, { ...currentArchived, status: 'submitted' }] : parentTasks;
  const result = evaluateTaskEntry({
    changedFiles,
    tasks: currentTasks,
    archivedTasks: currentIndex?.archivedTasks ?? [],
    headTasks: effectiveParentTasks,
    explicitTaskId: commitTaskId,
    rootDir,
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

/**
 * 可合并的 durable 回执：
 *   - passed：scopeCheck=in-scope 且 finalStatus=completed；
 *   - conditional-pass：在 passed 基础上，manualReviewList 必须为空，且每条 backlogItems
 *     都有非空编号——遗留已登记，才能作为非阻塞项合入。人工复核项存在时仍拒绝。
 */
export function mergeableDurableReceipts(receipts = []) {
  return receipts.filter((receipt) => {
    if (receipt.scopeCheck !== 'in-scope' || receipt.finalStatus !== 'completed') return false;
    if (receipt.verdict === 'passed') return true;
    if (receipt.verdict !== 'conditional-pass') return false;
    if (Array.isArray(receipt.manualReviewList) && receipt.manualReviewList.length > 0) return false;
    const backlog = Array.isArray(receipt.backlogItems) ? receipt.backlogItems : [];
    return backlog.every((item) => item && typeof item.id === 'string' && item.id.trim() !== '');
  });
}

/**
 * AF-365 · 状态面解耦后的任务快照：从任务单 frontmatter 读取 taskId / scope.files / artifacts。
 * 任务分支不再提交状态索引时，逐提交门禁以任务单为在办事实来源；durable 回执仍只在
 * 最终 HEAD 用于验收判定，不允许用任务单自行宣告 completed。
 */
export function parseTaskSheetSnapshotForGate(text, taskSheetPath = null) {
  const source = String(text ?? '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return null;
  const front = match[1];
  const taskId = /^taskId:\s*(?:["']?)([A-Z]+-\d+)(?:["']?)\s*$/m.exec(front)?.[1] ?? null;
  const agentRole = /^agentRole:\s*(?:["']?)([a-z-]+)(?:["']?)\s*$/m.exec(front)?.[1] ?? null;
  const lines = front.split(/\r?\n/);
  const scopeStart = lines.findIndex((line) => line === 'scope:' || line.startsWith('scope:'));
  const files = [];
  if (scopeStart >= 0) {
    let inFiles = false;
    for (let index = scopeStart + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      if (/^\S/.test(line)) break;
      if (/^\s+files:/i.test(line)) {
        inFiles = true;
        continue;
      }
      if (inFiles) {
        const item = /^\s*-\s*(.+)$/.exec(line);
        if (item) files.push(item[1].trim().replace(/^"|"$/g, ''));
        else if (/^\s+\w+:/.test(line)) inFiles = false;
      }
    }
  }
  return {
    taskId,
    agentRole,
    scopeFiles: files,
    artifactPaths: parseTaskSheetArtifactPathsForGate(source),
    taskSheetPath,
  };
}
export function parseTaskSheetArtifactPathsForGate(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(text ?? ''));
  if (!match) return [];
  const lines = match[1].split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'artifacts:' || line.startsWith('artifacts:'));
  if (start < 0) return [];
  const paths = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (/^\S/.test(line)) break;
    const item = /^\s+(?:-\s+)?path:\s*(.+)$/.exec(line);
    if (!item) continue;
    const raw = item[1].trim();
    let value = raw;
    if (raw.startsWith('"')) {
      try {
        value = JSON.parse(raw);
      } catch {
        continue;
      }
    }
    if (typeof value === 'string' && value.trim()) paths.push(value.trim());
  }
  return paths;
}

/**
 * AF-220 · 两阶段提交对账：实现提交只带业务文件与记录包任务单，claim 写入的索引在
 * 后续状态面提交才入库，因此实现提交的树内索引里根本还没有这个任务 —— 逐提交门
 * 会把合法历史判成 no-active-task。
 *
 * 这里给出一条受限入场：标题含唯一任务编号、提交 diff 内新增该任务的 records 任务单、
 * 且提交索引与父索引都没有这个任务时，用任务单文本重建 scope 并以 submitted 入场。
 * 受限条件缺任意一项即返回 task=null，调用方仍走原有判定（no-active-task 不会因此放宽）。
 *
 * @returns {{task: object|null, sheetPath: string|null, reason: string}}
 */
export function deriveImplementationTaskFromCommitSheet({
  commitTaskId,
  changedFiles = [],
  currentIndex = {},
  parentIndex = {},
  sheetText = null,
} = {}) {
  if (!commitTaskId) return { task: null, sheetPath: null, reason: 'no-commit-task-id' };
  const known = [
    ...(currentIndex.tasks ?? []),
    ...(currentIndex.archivedTasks ?? []),
    ...(parentIndex.tasks ?? []),
    ...(parentIndex.archivedTasks ?? []),
  ].some((task) => task?.taskId === commitTaskId);
  if (known) return { task: null, sheetPath: null, reason: 'task-known' };
  const sheetPath =
    (changedFiles ?? []).find(
      (path) => /^docs\/worklog\/records\/[^/]+\/[^/]+\/task-sheet\.md$/.test(path) && path.includes(`/${commitTaskId}/`),
    ) ?? null;
  if (!sheetPath) return { task: null, sheetPath: null, reason: 'sheet-not-in-commit' };
  if (typeof sheetText !== 'string' || sheetText.trim() === '') return { task: null, sheetPath, reason: 'sheet-unreadable' };
  const parsed = tryParseTaskSheetScopeForGate(sheetText, commitTaskId);
  if (!parsed) return { task: null, sheetPath, reason: 'sheet-unparsable' };
  const plannedArtifacts = parseTaskSheetArtifactPathsForGate(sheetText).map((path) => ({ path }));
  return {
    sheetPath,
    reason: 'impl-entry-from-commit-sheet',
    task: { ...parsed, status: 'submitted', artifacts: { taskSheet: sheetPath }, plannedArtifacts },
  };
}

/** PR 最终 HEAD 的验收硬门：防止绕开 pr-release，直接从 GitHub 页面合并。 */ export function evaluateAcceptanceSnapshot({
  taskId,
  currentIndex,
  receipts = [],
}) {
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
  const passed = mergeableDurableReceipts(receipts);
  if (passed.length === 0) {
    return {
      pass: false,
      reason: 'passed-durable-receipt-missing',
      taskId,
      receipts,
      errors: [
        `任务 ${taskId} 缺少可合并的 durable 回执：reviewVerdict=passed 或已登记 backlog 且无人工复核项的 conditional-pass，scopeCheck=in-scope，finalStatus=completed`,
      ],
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
  const legacyPrefix = 'docs/worklog/pending/archive';
  const legacyFiles = git(['ls-tree', '-r', '--name-only', sha, '--', legacyPrefix])
    .split(/\r?\n/)
    .filter((path) => path.startsWith(`${legacyPrefix}/${taskId}-receipt-`) && path.endsWith('.json'));
  const recordFiles = git(['ls-tree', '-r', '--name-only', sha, '--', 'docs/worklog/records'])
    .split(/\r?\n/)
    .filter((path) => path.includes(`/${taskId}/receipt-`) && path.endsWith('.json'));
  return [...new Set([...legacyFiles, ...recordFiles])].map((path) => {
    try {
      const receipt = JSON.parse(git(['show', `${sha}:${path}`]));
      return {
        path,
        verdict: receipt.payload?.reviewVerdict ?? receipt.reviewVerdict ?? null,
        scopeCheck: receipt.payload?.scopeCheck ?? receipt.scopeCheck ?? null,
        finalStatus: receipt.payload?.finalStatus ?? receipt.finalStatus ?? null,
        manualReviewList: receipt.payload?.manualReviewList ?? receipt.manualReviewList ?? null,
        backlogItems: receipt.payload?.backlogItems ?? receipt.backlogItems ?? null,
      };
    } catch {
      return { path, verdict: 'invalid-json', scopeCheck: null, finalStatus: null };
    }
  });
}

export function evaluateAcceptanceAt(sha, taskIdOrBranch) {
  const taskId = extractCommitTaskId(taskIdOrBranch);
  if (!taskId) throw new Error(`无法从 ${taskIdOrBranch || '(空)'} 解析 PR 任务编号`);
  const currentIndex = readIndexAt(sha);
  const receipts = readAcceptanceReceiptsAt(sha, taskId);
  const strict = evaluateAcceptanceSnapshot({ taskId, currentIndex, receipts });
  if (strict.pass) return strict;
  // AF-365 · 状态面解耦：任务分支不再提交 index 时，用任务单存在 + 可合并 durable 回执判定验收。
  const sheetPath = findTaskSheetAt(sha, taskId);
  if (strict.reason === 'task-not-archived-completed' && sheetPath && mergeableDurableReceipts(receipts).length > 0) {
    return { pass: true, reason: 'accepted-state-free', taskId, receipts, taskSheetPath: sheetPath, errors: [] };
  }
  return sheetPath ? { ...strict, taskSheetPath: sheetPath } : strict;
}

function taskRecordAt(taskId, currentIndex, parentIndex) {
  return (
    currentIndex.tasks.find((task) => task?.taskId === taskId) ??
    parentIndex.tasks.find((task) => task?.taskId === taskId) ??
    currentIndex.archivedTasks.find((task) => task?.taskId === taskId) ??
    null
  );
}

function readRecordManifestAt(sha, taskId) {
  const files = git(['ls-tree', '-r', '--name-only', sha, '--', 'docs/worklog/records'])
    .split(/\r?\n/)
    .filter((path) => path.endsWith(`/${taskId}/manifest.json`));
  if (files.length === 0) return null;
  try {
    return JSON.parse(git(['show', `${sha}:${files[0]}`]));
  } catch {
    return null;
  }
}

/** 不依赖索引，按记录包目录直接找任务单（AF-365 状态面解耦路径）。 */
function findTaskSheetAt(sha, taskId) {
  const files = git(['ls-tree', '-r', '--name-only', sha, '--', 'docs/worklog/records'])
    .split(/\r?\n/)
    .filter((path) => path.endsWith(`/${taskId}/task-sheet.md`));
  return files.find((path) => git(['cat-file', '-e', `${sha}:${path}`], { allowFailure: true }) !== null) ?? null;
}

function sheetPathAt(sha, task) {
  const pointer = task?.artifacts?.taskSheet ?? null;
  if (pointer && git(['cat-file', '-e', `${sha}:${pointer}`], { allowFailure: true }) !== null) return pointer;
  const manifestPath = readRecordManifestAt(sha, task?.taskId)?.taskSheet?.path ?? null;
  if (manifestPath && git(['cat-file', '-e', `${sha}:${manifestPath}`], { allowFailure: true }) !== null) return manifestPath;
  return pointer;
}

function taskSheetPresence(sha, taskId, currentIndex, parentIndex) {
  if (!taskId) return { exists: undefined, path: null };
  const task = taskRecordAt(taskId, currentIndex, parentIndex);
  const pointer = task?.artifacts?.taskSheet ?? null;
  const resolved = task ? sheetPathAt(sha, task) : pointer;
  if (!resolved) {
    const fallback = findTaskSheetAt(sha, taskId);
    return fallback ? { exists: true, path: fallback } : { exists: false, path: null };
  }
  const exists = git(['cat-file', '-e', `${sha}:${resolved}`], { allowFailure: true }) !== null;
  return { exists, path: resolved };
}

function parseScalar(raw, label) {
  const value = raw.trim();
  if (!value) throw new Error(`${label} 为空`);
  if (value.startsWith('"')) {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'string') throw new Error(`${label} 必须是字符串`);
    return parsed;
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(`${label} 引号不完整`);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/[{}[\]]/.test(value)) throw new Error(`${label} 含不支持的 YAML 结构`);
  return value;
}

/** 轻量门只解析 scope 所需字段；完整任务单 schema 仍由登记 CLI / Contracts 校验。 */
export function parseTaskSheetScopeForGate(text, expectedTaskId) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('任务单 frontmatter 缺失');
  const lines = match[1].split(/\r?\n/);
  const readTopLevel = (key) => {
    const prefix = `${key}:`;
    const line = lines.find((item) => item.startsWith(prefix));
    return line ? parseScalar(line.slice(prefix.length), key) : null;
  };
  const taskId = readTopLevel('taskId');
  if (!taskId || taskId !== expectedTaskId) throw new Error(`任务单 taskId 不匹配：${taskId ?? '(missing)'}`);

  const scopeIndex = lines.findIndex((line) => line === 'scope:');
  if (scopeIndex < 0) throw new Error('任务单 scope 缺失');
  let filesIndex = -1;
  for (let index = scopeIndex + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) break;
    if (/^ {2}files:/.test(lines[index])) {
      filesIndex = index;
      break;
    }
  }
  if (filesIndex < 0) throw new Error('任务单 scope.files 缺失');

  const rawFiles = lines[filesIndex].slice(lines[filesIndex].indexOf(':') + 1).trim();
  const files = [];
  if (rawFiles) {
    if (!rawFiles.startsWith('[') || !rawFiles.endsWith(']')) throw new Error('scope.files 行内值必须是数组');
    const inner = rawFiles.slice(1, -1).trim();
    if (inner) for (const item of inner.split(',')) files.push(parseScalar(item, 'scope.files'));
  } else {
    for (let index = filesIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      const item = /^\s{4,}-\s+(.+)$/.exec(line);
      if (!item) break;
      files.push(parseScalar(item[1], 'scope.files'));
    }
  }
  if (files.length === 0) throw new Error('任务单 scope.files 为空');
  return {
    taskId,
    type: readTopLevel('type') ?? 'implementation',
    agentRole: readTopLevel('agentRole') ?? 'orchestrator',
    scope: { files, modules: [], interfaces: [] },
  };
}

/**
 * 非主任务（stacked squash 的次要任务）容错解析：历史任务单可能早于 1.1.0 契约、
 * 缺少 frontmatter，不能让它把整条发布门打挂；无法解析的任务不贡献 scope。
 * 主任务仍走 parseTaskSheetScopeForGate 严格解析。
 */
export function tryParseTaskSheetScopeForGate(text, expectedTaskId) {
  try {
    return parseTaskSheetScopeForGate(text, expectedTaskId);
  } catch {
    return null;
  }
}

function readTaskSheetAt(sha, sheetPath, status, expectedTaskId) {
  if (!sheetPath) throw new Error('squash 归档投影缺任务单路径，无法重建 scope');
  const text = git(['show', `${sha}:${sheetPath}`]);
  return { ...parseTaskSheetScopeForGate(text, expectedTaskId), status };
}

/** squash 多任务 scope 并集：只合并已通过验收筛选的任务，保持文件顺序去重。 */
export function unionSquashScopeFiles(tasks = [], fallbackFiles = []) {
  const files = [...new Set((tasks ?? []).flatMap((task) => task?.scope?.files ?? []).filter(Boolean))];
  return files.length > 0 ? files : fallbackFiles;
}

/** 读取一个真实 git 提交并执行快照判定（只读）。 */
export function evaluateCommitAt(sha) {
  const subject = git(['show', '-s', '--format=%s', sha]);
  const message = git(['show', '-s', '--format=%B', sha]);
  const commitDate = git(['show', '-s', '--format=%cI', sha]).trim();
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
    commitTaskId = resolveCommitTaskId({ message, subject }).taskId;
  } catch {
    // 多任务编号 / trailer 冲突的权威错误由纯判定器返回。
  }
  let evaluatedCurrentIndex = currentIndex;
  const parentHasTask = [...parentIndex.tasks, ...parentIndex.archivedTasks].some((task) => task?.taskId === commitTaskId);
  const archived = currentIndex.archivedTasks.find((task) => task?.taskId === commitTaskId);
  if (commitTaskId && archived && !parentHasTask) {
    // archivedTasks 投影只保留 taskId/status/artifacts；squash 没有父任务可取 scope，
    // 必须从当前提交的任务单恢复完整声明，再交给同一个 scope 判定器。
    const hydratedTasks = [];
    for (const task of currentIndex.archivedTasks) {
      if (task?.status !== 'completed' || !task?.artifacts?.taskSheet) continue;
      const sheetPath = sheetPathAt(sha, task);
      if (!sheetPath || !changedFiles.includes(sheetPath)) continue;
      const taskReceipts = readAcceptanceReceiptsAt(sha, task.taskId);
      if (mergeableDurableReceipts(taskReceipts).length === 0) continue;
      // 发布批次会把大量历史 record bundle 一起入库；其中早于 1.1.0 契约、
      // 缺少 frontmatter 的任务单无法提供 scope，跳过即可，不能让整条门失败。
      const text = git(['show', `${sha}:${sheetPath}`], { allowFailure: true });
      if (text === null) continue;
      const fullScope = tryParseTaskSheetScopeForGate(text, task.taskId);
      if (!fullScope) continue;
      const fullTask = { ...fullScope, ...task, scope: fullScope.scope };
      hydratedTasks.push(fullTask);
    }
    const primarySheet = sheetPathAt(sha, archived);
    const primary = hydratedTasks.find((task) => task.taskId === commitTaskId) ?? {
      ...readTaskSheetAt(sha, primarySheet, archived.status, commitTaskId),
      ...archived,
    };
    // 一条任务分支可以叠加多个已完成任务；squash 后这些任务单会一起进入同一提交。
    // 只按标题主任务的 scope 校验会把后续任务的合法改动误判越界，因此用本次提交
    // 实际携带、且各自已验收的任务单 scope 并集。
    const unionFiles = unionSquashScopeFiles(hydratedTasks, primary.scope?.files ?? []);
    const primaryWithUnion = {
      ...primary,
      scope: { ...primary.scope, files: unionFiles.length > 0 ? unionFiles : (primary.scope?.files ?? []) },
    };
    evaluatedCurrentIndex = {
      ...currentIndex,
      archivedTasks: currentIndex.archivedTasks.map((task) => {
        if (task?.taskId === commitTaskId) return primaryWithUnion;
        return hydratedTasks.find((candidate) => candidate.taskId === task?.taskId) ?? task;
      }),
    };
  }
  let implEntrySource = null;
  if (commitTaskId && !archived) {
    const probe = deriveImplementationTaskFromCommitSheet({
      commitTaskId,
      changedFiles,
      currentIndex: evaluatedCurrentIndex,
      parentIndex,
    });
    if (probe.sheetPath) {
      const sheetText = git(['show', `${sha}:${probe.sheetPath}`], { allowFailure: true });
      const derived = deriveImplementationTaskFromCommitSheet({
        commitTaskId,
        changedFiles,
        currentIndex: evaluatedCurrentIndex,
        parentIndex,
        sheetText,
      });
      if (derived.task) {
        implEntrySource = derived.reason;
        evaluatedCurrentIndex = { ...evaluatedCurrentIndex, tasks: [...(evaluatedCurrentIndex.tasks ?? []), derived.task] };
      }
    }
  }
  const sheet = taskSheetPresence(sha, commitTaskId, evaluatedCurrentIndex, parentIndex);
  const receipts = commitTaskId ? readAcceptanceReceiptsAt(sha, commitTaskId) : [];
  let taskSheetSnapshot = null;
  if (sheet.path) {
    const sheetText = git(['show', `${sha}:${sheet.path}`], { allowFailure: true });
    if (typeof sheetText === 'string' && sheetText.trim() !== '') {
      taskSheetSnapshot = parseTaskSheetSnapshotForGate(sheetText, sheet.path);
    }
  }
  const result = evaluateCommitSnapshot({
    subject,
    changedFiles,
    currentIndex: evaluatedCurrentIndex,
    parentIndex,
    taskSheetExists: sheet.exists,
    taskSheetPath: sheet.path,
    taskSheetSnapshot,
    receipts,
    rootDir: process.cwd(),
    message,
    commitDate,
  });
  return { sha, subject, parent, ...result, implEntrySource };
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
