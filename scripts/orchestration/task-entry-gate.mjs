/**
 * AF-047 · 开发任务强制编排门。
 *
 * 目标：把「开发必须走 agent-collaboration-framework」从文档约定变成可执行的
 * pre-commit 门禁。门禁只做三件事：
 *   1. 本次暂存文件必须能匹配到一个在办编排任务；
 *   2. 暂存文件必须落在该任务 scope.files 内（状态面生成物按框架 V7 口径豁免）；
 *   3. ready 任务未领单、completed 任务不得再写实现文件。
 *
 * 边界：只读、不自动 stage、不改状态、不删除文件；状态面仍只经 CLI 写。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectResidualFiles } from './scope-mutex.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 允许提交的任务状态。backlog 尚未提级、终态失败类一律不允许。 */
export const GATE_ALLOWED_STATUSES = ['ready', 'submitted', 'working', 'input-required', 'completed'];

/** 编排状态面生成物：框架 V7 口径剔除，不要求写进任务 scope。 */
export const STATE_PLANE_PATHS = [
  'docs/team/agent-orchestration/task-state-index.json',
  'docs/team/agent-orchestration/orchestration-state.json',
  'docs/team/agent-orchestration/orchestration-snapshot.json',
  'docs/team/agent-orchestration/improvement-log.json',
  'docs/team/agent-orchestration/tool-audit-log.json',
  'docs/team/agent-orchestration/state/',
  'docs/team/agent-orchestration/transport/',
  'docs/team/agent-orchestration/delivery-packs/',
  'web/orchestration/data.js',
];

/** 统一 git 路径分隔符，避免 Windows 反斜杠造成 scope 比对错位。 */
function normalizeFile(file) {
  return String(file ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function normalizeFiles(files) {
  return [...new Set((files ?? []).map(normalizeFile).filter(Boolean))];
}

/** 是否属于编排状态面生成物。 */
export function isStatePlanePath(file) {
  const target = normalizeFile(file);
  return STATE_PLANE_PATHS.some((entry) => (entry.endsWith('/') ? target.startsWith(entry) : target === entry));
}

/** 任务自身声明的工件文件（任务单 / 交付记录 / 回执）。 */
function isTaskArtifact(file, task) {
  const target = normalizeFile(file);
  const artifacts = task?.artifacts ?? {};
  return [artifacts.taskSheet, artifacts.deliveryRecord, artifacts.reply, task?.receipt?.archiveRef]
    .filter((value) => typeof value === 'string' && value.trim())
    .map(normalizeFile)
    .includes(target);
}

/** 回执归档副本属于交付产物，允许在任务 completed 后提交。 */
function isReceiptArchive(file) {
  return normalizeFile(file).startsWith('docs/worklog/pending/archive/');
}

function isExemptForTask(file, task) {
  return isStatePlanePath(file) || isTaskArtifact(file, task) || isReceiptArchive(file);
}

function hasTaskSheet(task) {
  return typeof task?.artifacts?.taskSheet === 'string' && task.artifacts.taskSheet.trim().length > 0;
}

function statusAllowsWrite(status) {
  return GATE_ALLOWED_STATUSES.includes(status);
}

/**
 * 纯函数门禁判定：不读文件系统，供单测与 pre-commit 共用。
 *
 * @param {{
 *   changedFiles: string[],
 *   tasks: object[],
 *   explicitTaskId?: string|null
 * }} input
 * @returns {{
 *   ok: boolean,
 *   reason: string,
 *   message: string,
 *   taskId: string|null,
 *   status: string|null,
 *   covered: string[],
 *   residual: string[],
 *   candidates: string[]
 * }}
 */
export function evaluateTaskEntry({ changedFiles = [], tasks = [], explicitTaskId = null } = {}) {
  const changed = normalizeFiles(changedFiles);
  if (changed.length === 0) {
    return {
      ok: true,
      reason: 'no-staged-files',
      message: '没有暂存文件，跳过编排门禁',
      taskId: null,
      status: null,
      covered: [],
      residual: [],
      candidates: [],
    };
  }

  // 归档后的索引 / 事件 / 快照只能由 CLI 生成；纯状态面提交不伪装成开发任务。
  // 只要混入一个非状态面文件，就继续走下面的在办任务与 scope 硬校验。
  if (changed.every(isStatePlanePath)) {
    return {
      ok: true,
      reason: 'state-plane-only',
      message: '暂存文件全部为编排状态面生成物，按 V7 口径放行',
      taskId: null,
      status: null,
      covered: changed,
      residual: [],
      candidates: [],
    };
  }

  const eligible = (tasks ?? []).filter((task) => task?.taskId && statusAllowsWrite(task.status) && hasTaskSheet(task));
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: 'no-active-task',
      message: '没有处于 ready/submitted/working/input-required/completed 的编排任务',
      taskId: null,
      status: null,
      covered: [],
      residual: changed,
      candidates: [],
    };
  }

  let selected = null;
  if (explicitTaskId) {
    selected = eligible.find((task) => task.taskId === explicitTaskId) ?? null;
    if (!selected) {
      return {
        ok: false,
        reason: 'task-not-found',
        message: `指定任务 ${explicitTaskId} 不在可提交状态或不存在`,
        taskId: explicitTaskId,
        status: null,
        covered: [],
        residual: changed,
        candidates: eligible.map((task) => task.taskId),
      };
    }
  } else {
    const sheetMatches = eligible.filter((task) => changed.includes(normalizeFile(task.artifacts.taskSheet)));
    if (sheetMatches.length === 1) {
      selected = sheetMatches[0];
    } else if (sheetMatches.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous-task-sheet',
        message: '一次暂存了多个任务单，无法判断归属；请显式设置 ORCH_TASK_ID',
        taskId: null,
        status: null,
        covered: [],
        residual: changed,
        candidates: sheetMatches.map((task) => task.taskId),
      };
    }

    if (!selected) {
      if (eligible.length === 1) {
        selected = eligible[0];
      }
      const candidates = selected
        ? [selected]
        : eligible.filter((task) => {
            const relevant = changed.filter((file) => !isExemptForTask(file, task));
            return detectResidualFiles(relevant, task).residual.length === 0;
          });
      if (!selected && candidates.length === 1) {
        selected = candidates[0];
      } else if (!selected && candidates.length > 1) {
        return {
          ok: false,
          reason: 'ambiguous-task',
          message: '多个在办任务都覆盖本次暂存文件；请显式设置 ORCH_TASK_ID',
          taskId: null,
          status: null,
          covered: [],
          residual: changed,
          candidates: candidates.map((task) => task.taskId),
        };
      }
    }
  }

  if (!selected) {
    return {
      ok: false,
      reason: 'no-scope-match',
      message: '暂存文件没有任何在办任务 scope 覆盖',
      taskId: null,
      status: null,
      covered: [],
      residual: changed,
      candidates: eligible.map((task) => task.taskId),
    };
  }

  const relevant = changed.filter((file) => !isExemptForTask(file, selected));
  const { covered, residual } = detectResidualFiles(relevant, selected);

  if (residual.length > 0) {
    return {
      ok: false,
      reason: 'scope-residual',
      message: `暂存文件越出任务 ${selected.taskId} 的 scope`,
      taskId: selected.taskId,
      status: selected.status,
      covered,
      residual,
      candidates: eligible.map((task) => task.taskId),
    };
  }

  if (selected.status === 'ready') {
    const implementationFiles = relevant.filter((file) => !isTaskArtifact(file, selected));
    if (implementationFiles.length > 0) {
      return {
        ok: false,
        reason: 'run-once-required',
        message: `任务 ${selected.taskId} 仍在 ready，必须先 run-once 领单才能提交实现文件`,
        taskId: selected.taskId,
        status: selected.status,
        covered,
        residual: implementationFiles,
        candidates: eligible.map((task) => task.taskId),
      };
    }
  }

  if (selected.status === 'completed') {
    const implementationFiles = relevant.filter((file) => !isTaskArtifact(file, selected));
    if (implementationFiles.length > 0) {
      return {
        ok: false,
        reason: 'completed-write-blocked',
        message: `任务 ${selected.taskId} 已 completed；实现文件不能再挂在该任务下提交，请新开任务`,
        taskId: selected.taskId,
        status: selected.status,
        covered,
        residual: implementationFiles,
        candidates: eligible.map((task) => task.taskId),
      };
    }
  }

  return {
    ok: true,
    reason: 'pass',
    message: `任务 ${selected.taskId}（${selected.status}）覆盖 ${covered.length} 个暂存文件`,
    taskId: selected.taskId,
    status: selected.status,
    covered,
    residual: [],
    candidates: eligible.map((task) => task.taskId),
  };
}

/** 采集 git 暂存文件（相对仓根）。 */
export function collectStagedFiles(rootDir = REPO_ROOT) {
  const raw = execFileSync('git', ['-C', rootDir, 'diff', '--cached', '--name-only', '--diff-filter=ACMRD', '-z'], {
    encoding: 'utf8',
  });
  return raw
    .split('\0')
    .map((file) => normalizeFile(file))
    .filter(Boolean);
}

function readIndex(rootDir) {
  const file = resolve(rootDir, 'docs', 'team', 'agent-orchestration', 'task-state-index.json');
  if (!existsSync(file)) throw new Error(`状态索引不存在：${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function assertTaskSheetsExist(rootDir, tasks, taskId) {
  const task = tasks.find((item) => item.taskId === taskId);
  if (!task) return;
  const sheet = resolve(rootDir, task.artifacts.taskSheet);
  if (!existsSync(sheet)) throw new Error(`任务单不存在：${task.artifacts.taskSheet}`);
}

function printFailure(result) {
  console.error(`[ORCH-GATE] FAIL reason=${result.reason} task=${result.taskId ?? '-'}`);
  console.error(`[ORCH-GATE] ${result.message}`);
  if (result.residual.length > 0) {
    console.error(`[ORCH-GATE] 越界文件：${result.residual.join(', ')}`);
  }
  if (result.candidates.length > 0) {
    console.error(`[ORCH-GATE] 候选任务：${result.candidates.join(', ')}`);
  }
  console.error('[ORCH-GATE] 修复：先落任务单 → pnpm orchestration:task register --sheet <md> → task promote → pnpm orchestration:run');
  console.error('[ORCH-GATE] 只读问答 / 搜索 / 纯分析不需要建任务；任何写入都必须有在办任务。');
}

function main() {
  const args = process.argv.slice(2);
  const rootDir = resolve(argValue(args, '--root') ?? REPO_ROOT);
  const explicitTaskId = argValue(args, '--task-id') ?? process.env.ORCH_TASK_ID ?? null;
  const filesArg = argValue(args, '--files');
  const changedFiles = filesArg
    ? filesArg
        .split(/[,;]/)
        .map((file) => file.trim())
        .filter(Boolean)
    : collectStagedFiles(rootDir);

  const index = readIndex(rootDir);
  const tasks = index.tasks ?? [];
  const result = evaluateTaskEntry({ changedFiles, tasks, explicitTaskId });
  if (result.taskId) assertTaskSheetsExist(rootDir, tasks, result.taskId);

  if (result.ok) {
    if (argValue(args, '--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        `[ORCH-GATE] PASS task=${result.taskId ?? '-'} status=${result.status ?? '-'} files=${changedFiles.length} covered=${result.covered.length}`,
      );
    }
    return;
  }

  if (argValue(args, '--json')) console.log(JSON.stringify(result, null, 2));
  printFailure(result);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main();
}
