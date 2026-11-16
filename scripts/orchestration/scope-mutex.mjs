/**
 * AF-011 · 文件域 scope 互斥护栏（adapter 层纯函数，零 IO 副作用）。
 *
 * 职责：
 *   1. scope.files 路径归一化（相对仓根、目录前缀、通配段降级前缀）；
 *   2. 派发前与在办（submitted / working）任务文件域求交集，冲突清单透出供调度拦截；
 *   3. 验收残留识别：变更文件清单与 scope 比对，清单外文件判残留（只识别报告，不删除、不归集）。
 *
 * 边界：纯函数不读文件系统、不调 git；目录覆盖按路径前缀判定，不展开目录枚举；
 * 角色资源域真相源在 Agent Card resources 与框架 roles.md，本模块不另抄目录白名单；
 * 只读 / 调研类任务不占写域，与实现任务互斥豁免。
 */

/** 不占写域的任务类型（调研 / 评审 / 验证类）。 */
export const READONLY_TASK_TYPES = ['investigation', 'review', 'verification'];

/** 在办状态（参与文件域互斥的活跃任务集合）。 */
export const ACTIVE_SCOPE_STATUSES = ['submitted', 'working'];

function normalizePath(raw) {
  if (typeof raw !== 'string') return null;
  let path = raw.trim().replace(/\\/g, '/');
  if (!path) return null;
  path = path.replace(/^\.\//, '');
  if (/^[A-Za-z]:/.test(path) || path.startsWith('/')) {
    return { valid: false, error: `绝对路径或盘符路径：${raw}` };
  }
  const segments = path.split('/');
  if (segments.includes('..')) return { valid: false, error: `路径越界（.. 段）：${raw}` };
  const starIdx = segments.findIndex((s) => s.includes('*'));
  const wildcard = starIdx >= 0;
  if (wildcard) {
    // 纯函数无法列目录：通配段及其后段降级为目录前缀，不做 glob 展开。
    segments.length = starIdx;
  }
  const clean = segments.join('/').replace(/\/+$/, '');
  if (!clean) return null;
  const isDir = wildcard || raw.trim().endsWith('/') || (segments.length > 0 && segments[segments.length - 1] === '');
  return { valid: true, path: clean, isDir };
}

/** 判断某 scope 条目是否覆盖目标文件路径。 */
function entryCovers(entry, targetFile) {
  if (entry.path === targetFile) return true;
  if (entry.isDir) return targetFile.startsWith(`${entry.path}/`);
  return false;
}

/** 两个 scope 条目是否存在文件域冲突。 */
function entriesConflict(a, b) {
  if (a.path === b.path) return true;
  if (a.isDir && b.isDir) return a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`);
  if (a.isDir) return entryCovers(a, b.path);
  if (b.isDir) return entryCovers(b, a.path);
  return false;
}

/**
 * 归一化任务文件域。
 * @param {object} task 索引任务条目
 * @returns {{readOnly: boolean, entries: Array<{path:string,isDir:boolean}>, errors: string[]}}
 */
export function normalizeScope(task) {
  const files = task?.scope?.files ?? [];
  const readOnly = task?.scope?.readOnly === true || READONLY_TASK_TYPES.includes(task?.type);
  const entries = [];
  const errors = [];
  for (const raw of files) {
    const n = normalizePath(raw);
    if (n === null) continue;
    if (!n.valid) {
      errors.push(n.error);
      continue;
    }
    entries.push({ path: n.path, isDir: n.isDir });
  }
  return { readOnly, entries, errors };
}

/** 目标文件是否被任一 scope 条目覆盖。 */
export function scopeCovers(task, file) {
  const normalized = normalizeScope(task);
  return normalized.entries.some((entry) => entryCovers(entry, file));
}

/**
 * 查找在办任务中与目标任务文件域冲突的条目。
 * 只读任务不占写域，既不作为冲突方，也不与其他任务产生写冲突。
 * @param {object} task 待派发任务
 * @param {object[]} activeTasks 在办任务（含 submitted / working）
 * @returns {Array<{taskId:string, conflicts: string[]}>} 冲突清单（空数组即无冲突）
 */
export function findScopeConflicts(task, activeTasks) {
  const self = normalizeScope(task);
  if (self.readOnly) return [];
  const conflicts = [];
  for (const other of activeTasks ?? []) {
    if (other.taskId === task.taskId) continue;
    if (!ACTIVE_SCOPE_STATUSES.includes(other.status)) continue;
    const otherScope = normalizeScope(other);
    if (otherScope.readOnly) continue;
    const hit = [];
    for (const a of self.entries) {
      for (const b of otherScope.entries) {
        if (entriesConflict(a, b)) hit.push(`${a.path}${a.isDir ? '/' : ''} ↔ ${b.path}${b.isDir ? '/' : ''}`);
      }
    }
    if (hit.length > 0) conflicts.push({ taskId: other.taskId, conflicts: [...new Set(hit)] });
  }
  return conflicts;
}

/**
 * 验收残留识别：变更文件清单与 scope 比对。
 * 清单内文件计入 covered；scope 未覆盖文件判 residual（只识别，不删除、不归集提交）。
 * @param {string[]} changedFiles 本次变更文件相对路径清单（由调用方采集 git diff 传入）
 * @param {object} task 索引任务条目（读 scope.files）
 * @returns {{covered: string[], residual: string[]}}
 */
export function detectResidualFiles(changedFiles, task) {
  const normalized = normalizeScope(task);
  const covered = [];
  const residual = [];
  for (const raw of changedFiles ?? []) {
    const n = normalizePath(raw);
    if (!n || !n.valid) {
      residual.push(typeof raw === 'string' ? raw : String(raw));
      continue;
    }
    if (normalized.entries.some((entry) => entryCovers(entry, n.path))) covered.push(n.path);
    else residual.push(n.path);
  }
  return { covered, residual };
}
