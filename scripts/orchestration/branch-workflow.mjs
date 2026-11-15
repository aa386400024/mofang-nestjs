/**
 * AF-012 · 任务分支流程与治理（adapter 层；纯函数 + 注入式 git 端口）。
 *
 * 口径（设计备忘 §4 分支策略与治理）：
 *   - 长期分支 `master`（受保护）/ `integrate`（集成落点）；短期任务分支 `task/<taskId>-<slug>`，一单一分支；
 *   - 任务分支从 `integrate` 最新 HEAD 切出；验收通过后 squash 合并回 integrate，合并即删本地与远端源分支；
 *   - 分支名必须含 taskId；删除前必须确认已合并；未合并分支只报告不删除；
 *   - L4（master / tag / release / 部署）不在脚本自动路径内。
 *
 * 边界：纯函数不直接 spawn git；git 交互经端口注入，便于单测替身与后续替换。
 * 默认端口用 node:child_process 内置 execFileSync，无第三方依赖。
 */
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './state-store.mjs';

const TASK_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;

/** 长期分支（不参与任务分支巡检与自动清理）。 */
export const LONG_LIVED_BRANCHES = ['master', 'integrate'];

/** 未合并分支超期天数阈值（超过仅标注 stale，不删除）。 */
export const DEFAULT_STALE_DAYS = 14;

/** slug 规范化：小写、非字母数字折叠为连字符、去首尾连字符。 */
function normalizeSlug(slug) {
  return String(slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 构造并校验任务分支名 `task/<taskId>-<slug>`。
 * @returns {{valid:boolean, errors:string[], branchName:string|null}}
 */
export function buildBranchName(taskId, slug) {
  const errors = [];
  if (!TASK_ID_PATTERN.test(taskId ?? '')) errors.push(`taskId 不符合标识模式：${String(taskId)}`);
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) errors.push('slug 为空或规范化后为空');
  if (errors.length > 0) return { valid: false, errors, branchName: null };
  return { valid: true, errors: [], branchName: `task/${taskId}-${normalizedSlug}` };
}

/** 校验既有分支名合规（前缀、含 taskId、非空任务段）。 */
export function validateBranchName(branchName, taskId) {
  const errors = [];
  if (typeof branchName !== 'string' || !branchName.startsWith('task/')) errors.push('分支名须以 task/ 开头');
  else if (branchName === 'task/') errors.push('分支名缺任务段');
  if (taskId && typeof branchName === 'string' && !branchName.includes(taskId)) errors.push(`分支名未含 taskId：${taskId}`);
  return { valid: errors.length === 0, errors };
}

/** 分支距提交日期的天数（纯函数；now 由调用方注入以便测试）。 */
export function branchAgeDays(committerDateIso, nowIso) {
  const committed = Date.parse(committerDateIso ?? '');
  const now = Date.parse(nowIso ?? new Date().toISOString());
  if (Number.isNaN(committed)) return null;
  return Math.max(0, Math.floor((now - committed) / 86_400_000));
}

/**
 * 巡检分类：已合并（可清理）/ 未合并（保留）/ 未合并且落后基线（needsRebase）/ 未合并且超期（stale，仅标注不删）。
 * 长期分支不进入任一清理集合。behindBy>0 表示分支落后基线（integrate），需 rebase，优先于超期标注。
 * @param {Array<{name:string, remote?:string, merged:boolean, ageDays:number|null, aheadBy?:number, behindBy?:number}>} branches
 * @param {{staleDays?:number, base?:string}} opts
 */
export function classifyBranches(branches, opts = {}) {
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const merged = [];
  const unmerged = [];
  const stale = [];
  const needsRebase = [];
  for (const branch of branches ?? []) {
    if (LONG_LIVED_BRANCHES.includes(branch.name)) continue;
    if (branch.merged) {
      merged.push(branch);
      continue;
    }
    const behind = Number(branch.behindBy ?? 0);
    if (Number.isFinite(behind) && behind > 0) {
      needsRebase.push({ ...branch, behindBy: behind });
    } else if (branch.ageDays !== null && branch.ageDays > staleDays) {
      stale.push(branch);
    } else {
      unmerged.push(branch);
    }
  }
  return { merged, unmerged, stale, needsRebase };
}

/**
 * 清理计划：只对已合并分支生成本地 / 远端删除项；未合并、待 rebase 与超期分支只列名保留。
 * @returns {{toDelete: Array<{name:string, ref:string}>, keptUnmerged: string[], stale: string[], needsRebase: string[]}}
 */
export function planCleanup(branches, opts = {}) {
  const { merged, unmerged, stale, needsRebase } = classifyBranches(branches, opts);
  const toDelete = [];
  for (const branch of merged) {
    toDelete.push({ name: branch.name, ref: 'local' });
    if (branch.remote) toDelete.push({ name: branch.name, ref: `remote:${branch.remote}` });
  }
  return {
    toDelete,
    keptUnmerged: unmerged.map((b) => b.name),
    stale: stale.map((b) => b.name),
    needsRebase: needsRebase.map((b) => b.name),
  };
}

/**
 * 基线核对：任务登记的 baselineRef 与当前 integrate HEAD 比对（设计备忘 §4.3）。
 * @param {object} task 索引任务条目（读 baselineRef）
 * @param {string} integrateHead 当前 integrate HEAD 完整哈希
 * @returns {{matches: boolean|null, expected: string|null, actual: string, reason: string|null}}
 */
export function verifyBaseline(task, integrateHead) {
  const expected = task?.baselineRef ?? task?.artifacts?.baselineRef ?? null;
  if (!expected) return { matches: null, expected: null, actual: integrateHead, reason: '任务记录未登记 baselineRef' };
  const matches = expected === integrateHead;
  return {
    matches,
    expected,
    actual: integrateHead,
    reason: matches ? null : `基线漂移：任务基线 ${expected} ≠ integrate HEAD ${integrateHead}`,
  };
}

function runGit(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

/**
 * 默认 git 端口（真实子进程）。CLI 写动作默认干跑，仅显式 --apply 时调用变更方法。
 * 变更方法：createBranch / squashMerge / deleteLocal / deleteRemote；只读方法：其余。
 */
export function createGitPort() {
  return {
    currentBranch() {
      return runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    },
    headRef() {
      return runGit(['rev-parse', 'HEAD']);
    },
    branchExists(name) {
      try {
        runGit(['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
        return true;
      } catch {
        return false;
      }
    },
    listBranches() {
      const local = runGit(['branch', '--format=%(refname:short)']).split('\n').filter(Boolean);
      const remoteRaw = runGit(['branch', '-r', '--format=%(refname:short)']);
      const remote = remoteRaw ? remoteRaw.split('\n').filter(Boolean) : [];
      return { local, remote };
    },
    isMerged(name) {
      try {
        runGit(['merge-base', '--is-merged', name, 'integrate']);
        return true;
      } catch {
        return false;
      }
    },
    aheadBehind(name, base = 'integrate') {
      const ahead = Number(runGit(['rev-list', '--count', `${base}..${name}`]) || 0);
      const behind = Number(runGit(['rev-list', '--count', `${name}..${base}`]) || 0);
      return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 };
    },
    ageFor(name) {
      try {
        return runGit(['log', '-1', '--format=%cs', name]) || null;
      } catch {
        return null;
      }
    },
    worktreeClean() {
      try {
        runGit(['diff', '--quiet']);
        runGit(['diff', '--cached', '--quiet']);
        return true;
      } catch {
        return false;
      }
    },
    changedFiles() {
      const raw = runGit(['diff', '--name-only', 'HEAD']);
      return raw ? raw.split('\n').filter(Boolean) : [];
    },
    createBranch(name, from) {
      return runGit(['checkout', '-b', name, from]);
    },
    squashMerge(name) {
      // 仅执行 squash 暂存；提交动作归编排者闸门，脚本不自动 commit。
      return runGit(['merge', '--squash', name]);
    },
    deleteLocal(name) {
      return runGit(['branch', '-d', name]);
    },
    deleteRemote(name, remote) {
      return runGit(['push', remote, '--delete', name]);
    },
  };
}

/**
 * IM-009：经注入 git 端口采集本次变更文件清单（相对仓根）。
 * 端口缺 changedFiles 方法或返回非数组时返回空清单（V7 记 skip，不阻断）。
 * @param {object} gitPort 注入式 git 端口（createGitPort 返回值或测试替身）
 * @returns {string[]} 变更文件相对路径清单
 */
export function collectChangedFiles(gitPort) {
  if (!gitPort || typeof gitPort.changedFiles !== 'function') return [];
  const files = gitPort.changedFiles();
  return Array.isArray(files) ? files.filter((f) => typeof f === 'string' && f.trim() !== '') : [];
}
