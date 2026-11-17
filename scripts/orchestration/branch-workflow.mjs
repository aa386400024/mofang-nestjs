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
import { TASK_ID_PATTERN } from './contract-enums.mjs';

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
        // Git 标准参数是 --is-ancestor：name 是 integrate 的祖先即已合并。
        runGit(['merge-base', '--is-ancestor', name, 'integrate']);
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
    /**
     * 分支当前指向的提交（AF-046-O1：合并门禁要判「被合并的那条分支」，不是当前工作 HEAD）。
     * 分支不存在抛错，由调用方判 null，不静默回退到别的 SHA。
     */
    branchHead(name) {
      return runGit(['rev-parse', `${name}`]);
    },
    /**
     * AF-043-I1：某提交改动的文件清单（V7 按 commit 事实比对的数据源）。
     * 解析不到（提交不存在 / 非本仓对象）返回 null，由验收层判 fail，不静默当空集。
     */
    filesInCommit(sha) {
      try {
        const raw = runGit(['show', '--name-only', '--pretty=format:', String(sha)]);
        return raw.split('\n').filter(Boolean);
      } catch {
        return null;
      }
    },
    createBranch(name, from) {
      return runGit(['checkout', '-b', name, from]);
    },
    squashMerge(name) {
      // 仅执行 squash 暂存；提交动作由 finalizeSquashMerge 在闸门全绿后补上（IM-012）。
      return runGit(['merge', '--squash', name]);
    },
    commitSquash(message) {
      // IM-012：squash 暂存后的提交动作，标题必须带 taskId（由调用方组装 message）。
      return runGit(['commit', '-m', message]);
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
 * 任务类型 → conventional commit 类型。合并提交的语义是「把一条任务分支落进主干」，
 * 所以实现类是 feat、修复类是 fix、文档类是 docs，只读类（审阅 / 调查 / 验证）回到 chore。
 */
const SQUASH_TYPE_BY_TASK_TYPE = {
  implementation: 'feat',
  fix: 'fix',
  documentation: 'docs',
  investigation: 'chore',
  review: 'chore',
  verification: 'chore',
};

/**
 * 组装 squash 合并提交标题：`<type>(orchestration): <taskId> <title>`。
 * 必须满足仓内 commit-msg 钩子（`^(feat|fix|docs|...)(\(...\))?: .+`），否则合并会在
 * 提交阶段被钩子拒绝——这条由 CI 门禁实弹（AF-046）实测暴露，假端口单测覆盖不到钩子。
 * @param {{taskId:string, taskType?:string, title?:string}} opts
 * @returns {string}
 */
export function buildSquashCommitMessage(opts = {}) {
  const type = SQUASH_TYPE_BY_TASK_TYPE[opts.taskType] ?? 'chore';
  const subject = `${opts.taskId ?? ''} ${opts.title ?? 'squash merge into integrate'}`.trim();
  return `${type}(orchestration): ${subject}`.trim();
}

/**
 * IM-012 · squash 合并收口：暂存 → 闸门全绿后补提交 → 清理源分支。
 *
 * 为什么把提交与清理放在同一个函数：这两步在旧实现里都「留给人工」，结果是
 * squash 暂存后没人提交，任务分支也留在原地越堆越多。企业级口径应当是
 * **一次调用完成「合并即删」**，失败时按阶段返回，绝不在半途假装成功。
 *
 * 阶段顺序（任一阶段抛错即停，后续不执行）：
 *   1. `squashMerge(source)` —— `git merge --squash`，只暂存不提交；
 *   2. `commitSquash(message)` —— 提交，`message` 由 `buildSquashCommitMessage` 组装（conventional + taskId）；
 *   3. `deleteLocal(source)` / `deleteRemote(source, remote)` —— 合并已提交成功后才删，远端删除失败不回滚本地。
 *
 * @param {{source:string, remote?:string, taskId:string, taskType?:string, title?:string, gitPort:object}} opts
 * @returns {{stages:string[], branchName:string, commitMessage:string|null, errors:string[]}}
 */
export function finalizeSquashMerge(opts = {}) {
  const { source, taskId, gitPort } = opts;
  const stages = [];
  const errors = [];
  if (!source || !taskId) return { stages, branchName: source ?? null, commitMessage: null, errors: ['source / taskId 必填'] };
  if (!gitPort || typeof gitPort.squashMerge !== 'function') {
    return { stages, branchName: source, commitMessage: null, errors: ['缺少 git 端口或 squashMerge 能力'] };
  }
  const commitMessage = buildSquashCommitMessage({ taskId, taskType: opts.taskType, title: opts.title });
  try {
    gitPort.squashMerge(source);
    stages.push('squash-merge');
  } catch (err) {
    errors.push(`squash 暂存失败：${err.message}`);
    return { stages, branchName: source, commitMessage, errors };
  }
  try {
    if (typeof gitPort.commitSquash !== 'function') throw new Error('git 端口缺少 commitSquash 能力');
    gitPort.commitSquash(commitMessage);
    stages.push('commit');
  } catch (err) {
    errors.push(`squash 提交失败：${err.message}`);
    return { stages, branchName: source, commitMessage, errors };
  }
  try {
    gitPort.deleteLocal?.(source);
    stages.push('delete-local');
  } catch (err) {
    errors.push(`本地分支删除失败：${err.message}`);
  }
  if (opts.remote) {
    try {
      gitPort.deleteRemote?.(source, opts.remote);
      stages.push('delete-remote');
    } catch (err) {
      errors.push(`远端分支删除失败：${err.message}`);
    }
  }
  return { stages, branchName: source, commitMessage, errors };
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
