/**
 * AF-011 · 文件域 scope 互斥护栏（adapter 层纯函数，零 IO 副作用）。
 *
 * 职责：
 *   1. scope.files 路径归一化（相对仓根、目录前缀、通配段降级前缀）；
 *   2. 派发前与在办（submitted / working）任务文件域求交集，冲突清单透出供调度拦截；
 *   3. 验收残留识别：变更文件清单与 scope 比对，清单外文件判残留（只识别报告，不删除、不归集）。
 *
 * 边界：纯函数不读文件系统、不调 git；目录覆盖按路径前缀判定，不展开目录枚举；
 * 通配展开由采集层 `expandScopePattern` 承担（读目录只读，不修改状态）；
 * 角色资源域真相源在 Agent Card resources 与框架 roles.md，本模块不另抄目录白名单；
 * 只读 / 调研类任务不占写域，与实现任务互斥豁免。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
 * 展开 scope 通配条目为真实目录清单（IM-011 采集层补位）。
 *
 * 纯函数 `normalizePath` 只能把通配段降级成目录前缀（没有文件系统能力），
 * 于是 `src/**` 与 `src/foo/` 的互斥判定永远停在「父目录前缀」这一层，粗但安全。
 * 本函数把枚举能力放到**采集层**：由调用方给 rootDir，按段逐级 readdir，
 * 只做只读列目录，不修改任何状态；命中数量设上限防止超大目录拖垮派发。
 *
 * @param {string} pattern scope 条目原文（可含 * 段）
 * @param {{rootDir:string, maxDepth?:number, maxEntries?:number}} opts
 * @returns {string[]} 具体相对路径（目录或文件），无通配时原样返回归一结果
 */
export function expandScopePattern(pattern, opts = {}) {
  const rootDir = opts.rootDir;
  if (typeof rootDir !== 'string' || !rootDir) throw new Error('expandScopePattern 需要 rootDir');
  const maxDepth = Number(opts.maxDepth ?? 6);
  const maxEntries = Number(opts.maxEntries ?? 500);
  const n = normalizePath(pattern);
  if (!n) return [];
  if (!n.valid) return [];
  if (!pattern.includes('*')) return [n.path];
  const segments = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(Boolean);
  let current = [''];
  for (const [index, segment] of segments.entries()) {
    const next = [];
    for (const prefix of current) {
      const base = prefix ? join(rootDir, prefix) : rootDir;
      if (!existsSync(base)) continue;
      if (segment.includes('*')) {
        const matcher = new RegExp(`^${segment.split('*').map(escapeRegExp).join('[^/]*')}$`);
        if (index > maxDepth - 1) continue;
        for (const entry of readdirSync(base, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (!matcher.test(entry.name)) continue;
          next.push(prefix ? `${prefix}/${entry.name}` : entry.name);
          if (next.length >= maxEntries) break;
        }
      } else {
        const candidate = prefix ? `${prefix}/${segment}` : segment;
        if (existsSync(join(rootDir, candidate))) next.push(candidate);
      }
    }
    current = next;
    if (current.length >= maxEntries) break;
  }
  return current.filter(Boolean).slice(0, maxEntries);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 归一化任务文件域。
 * 给出 rootDir 时，无尾斜杠但真实存在为目录的条目按目录覆盖；
 * 未给 rootDir 保持旧口径（只能按尾斜杠 / 通配识别目录），纯函数行为不变。
 * @param {object} task 索引任务条目
 * @param {{rootDir?:string}} [opts]
 * @returns {{readOnly: boolean, entries: Array<{path:string,isDir:boolean}>, errors: string[]}}
 */
export function normalizeScope(task, opts = {}) {
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
    let isDir = n.isDir;
    if (!isDir && typeof opts.rootDir === 'string' && opts.rootDir) {
      const abs = join(opts.rootDir, n.path);
      if (existsSync(abs) && statSync(abs).isDirectory()) isDir = true;
    }
    entries.push({ path: n.path, isDir });
  }
  return { readOnly, entries, errors };
}

/** 目标文件是否被任一 scope 条目覆盖。 */
export function scopeCovers(task, file, opts = {}) {
  const normalized = normalizeScope(task, opts);
  return normalized.entries.some((entry) => entryCovers(entry, file));
}

/**
 * 带通配展开的 scope 条目（纯函数的采集层外壳）。
 * 只在调用方给出 rootDir 时才读目录；没给就退回纯函数的前缀语义，行为与既有口径一致。
 * 通配段展开为空（目录不存在 / 无匹配）时保留原前缀条目，避免「配了等于没配」。
 */
export function scopeEntriesWithExpansion(task, opts = {}) {
  const normalized = normalizeScope(task, opts);
  if (!opts.rootDir) return normalized;
  const rawFiles = task?.scope?.files ?? [];
  const expanded = [];
  for (const raw of rawFiles) {
    if (typeof raw !== 'string' || !raw.includes('*')) continue;
    const base = normalizePath(raw);
    if (!base || !base.valid) continue;
    const matches = expandScopePattern(raw, opts);
    if (matches.length === 0) continue; // 展开为空时保留归一后的前缀条目（下面统一补回）
    for (const match of matches) {
      const last = match.split('/').pop() ?? '';
      const isFile = /\.[A-Za-z0-9]+$/.test(last);
      expanded.push({ path: match, isDir: !isFile });
    }
  }
  const wildcardPaths = new Set(
    rawFiles.filter((raw) => typeof raw === 'string' && raw.includes('*')).map((raw) => normalizePath(raw)?.path),
  );
  const kept = normalized.entries.filter((entry) => !wildcardPaths.has(entry.path));
  return { ...normalized, entries: [...kept, ...expanded] };
}

/**
 * 查找在办任务中与目标任务文件域冲突的条目。
 * 只读任务不占写域，既不作为冲突方，也不与其他任务产生写冲突。
 * @param {object} task 待派发任务
 * @param {object[]} activeTasks 在办任务（含 submitted / working）
 * @param {{rootDir?:string,maxDepth?:number}} [opts] 给出 rootDir 时通配条目按真实目录展开
 * @returns {Array<{taskId:string, conflicts: string[]}>} 冲突清单（空数组即无冲突）
 */
export function findScopeConflicts(task, activeTasks, opts = {}) {
  const self = scopeEntriesWithExpansion(task, opts);
  if (self.readOnly) return [];
  const conflicts = [];
  for (const other of activeTasks ?? []) {
    if (other.taskId === task.taskId) continue;
    if (!ACTIVE_SCOPE_STATUSES.includes(other.status)) continue;
    const otherScope = scopeEntriesWithExpansion(other, opts);
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
 * @param {{rootDir?:string}} [opts] 给出 rootDir 时把真实目录的无尾斜杠条目按目录覆盖
 * @returns {{covered: string[], residual: string[]}}
 */
export function detectResidualFiles(changedFiles, task, opts = {}) {
  const normalized = normalizeScope(task, opts);
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
