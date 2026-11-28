/**
 * AF-161 · worklog 记录包（Task Record Bundle）。
 *
 * 现状：`docs/worklog/pending` 混放未登记草稿、历史任务单、回执与常驻参考文档。
 * 归档只写回执与交付记录，任务单正文原地不动，`artifacts.taskSheet` 永久指向
 * pending，目录噪声越积越大。本模块把 worklog 拆成：
 *
 *   inbox/                     未登记草稿（登记后清空）
 *   records/<context>/<task>/  manifest + 不可变任务单 + 回执副本
 *   pending/                   历史参考文档与旧路径兼容层（只读）
 *
 * 边界：不写状态索引与事件日志；索引仍是唯一状态真相。记录包只承载工件与
 * 哈希，迁移历史任务单不重写已归档指针，读取侧用 manifest 解析。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { REPO_ROOT, nowIso, writeJsonAtomic } from './state-store.mjs';
import { normalizeLf, normalizeTextFile } from './text-normalize.mjs';

export const WORKLOG_DIRS = {
  inbox: join(REPO_ROOT, 'docs', 'worklog', 'inbox'),
  records: join(REPO_ROOT, 'docs', 'worklog', 'records'),
  pending: join(REPO_ROOT, 'docs', 'worklog', 'pending'),
  legacyReceipts: join(REPO_ROOT, 'docs', 'worklog', 'pending', 'archive'),
};

export const RECORD_MANIFEST_VERSION = 'worklog-record-manifest:1.0.0';

function posix(value) {
  return String(value).split('\\').join('/');
}

function repoRelative(rootDir, absPath) {
  return posix(relative(rootDir, absPath));
}

export function safeSegment(value) {
  const text = String(value ?? '').trim();
  const safe = text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'unknown';
}

export function taskBundleDir(task, { rootDir = REPO_ROOT } = {}) {
  const context = safeSegment(task?.contextId ?? 'legacy');
  const taskId = safeSegment(task?.taskId ?? 'unknown');
  return join(rootDir, 'docs', 'worklog', 'records', context, taskId);
}

export function canonicalTaskSheetPath(task, { rootDir = REPO_ROOT, ext = 'md' } = {}) {
  return join(taskBundleDir(task, { rootDir }), `task-sheet.${ext}`);
}

function sheetExtension(sourcePath) {
  return extname(sourcePath ?? '').toLowerCase() === '.json' ? 'json' : 'md';
}

function bundleSheetTarget(task, sourcePath, rootDir) {
  const primary = canonicalTaskSheetPath(task, { rootDir, ext: sheetExtension(sourcePath) });
  if (existsSync(primary)) return primary;
  const other = canonicalTaskSheetPath(task, { rootDir, ext: primary.endsWith('.json') ? 'md' : 'json' });
  return existsSync(other) ? other : primary;
}

export function recordManifestPath(task, { rootDir = REPO_ROOT } = {}) {
  return join(taskBundleDir(task, { rootDir }), 'manifest.json');
}

/** 归档投影会剥离 contextId，按 taskId 在 records 下回退定位记录包。 */
export function findRecordBundleDir(taskId, { rootDir = REPO_ROOT } = {}) {
  const records = join(rootDir, 'docs', 'worklog', 'records');
  if (!existsSync(records)) return null;
  for (const context of readdirSync(records, { withFileTypes: true })) {
    if (!context.isDirectory()) continue;
    const bundle = join(records, context.name, safeSegment(taskId));
    const manifestFile = join(bundle, 'manifest.json');
    if (!existsSync(manifestFile)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      if (manifest.taskId === taskId) return bundle;
    } catch {
      // manifest 非法时由 verify 统一报错，这里只做定位。
    }
  }
  return null;
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256File(file) {
  return sha256Text(readFileSync(file, 'utf8'));
}

/**
 * 任务单哈希唯一口径：先按 UTF-8 去 BOM、CRLF/CR → LF 规范化，再计算 SHA-256。
 * 同一逻辑内容在 Windows / Linux、不同 autocrlf 检出下必须得到同一 manifest 哈希。
 */
export function sha256TaskSheet(file) {
  return sha256Text(normalizeLf(readFileSync(file, 'utf8')));
}

export function readRecordManifest(task, { rootDir = REPO_ROOT } = {}) {
  let file = recordManifestPath(task, { rootDir });
  if (!existsSync(file)) {
    const fallback = findRecordBundleDir(task?.taskId, { rootDir });
    if (!fallback) return null;
    file = join(fallback, 'manifest.json');
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

function emptyManifest(task) {
  return {
    schemaVersion: RECORD_MANIFEST_VERSION,
    taskId: task?.taskId ?? null,
    contextId: task?.contextId ?? null,
    status: task?.status ?? null,
    createdAt: task?.createdAt ?? null,
    updatedAt: null,
    taskSheet: null,
    receipts: [],
    deliveryRecord: null,
    legacyPaths: [],
    tombstone: null,
  };
}

function writeManifest(task, manifest, { rootDir }) {
  manifest.updatedAt = nowIso();
  writeJsonAtomic(recordManifestPath(task, { rootDir }), manifest);
}

function comparableManifest(manifest) {
  const copy = { ...(manifest ?? {}) };
  delete copy.updatedAt;
  return JSON.stringify(copy);
}

/** 记录包写入幂等：内容（除 updatedAt）没有变化时不再落盘，避免归档后产生脏文件与哈希噪声。 */
function writeManifestIfChanged(task, manifest, { rootDir }) {
  const file = recordManifestPath(task, { rootDir });
  if (existsSync(file)) {
    try {
      const current = JSON.parse(readFileSync(file, 'utf8'));
      if (comparableManifest(current) === comparableManifest(manifest)) return false;
    } catch {
      // 旧 manifest 非法时必须重写，让 verify 看到可诊断的新内容。
    }
  }
  writeManifest(task, manifest, { rootDir });
  return true;
}

/** 任务记录包是否已经落在 records（登记/冻结后不再允许归档阶段回写）。 */
export function isTaskSheetBundled(task, { rootDir = REPO_ROOT } = {}) {
  const pointer = typeof task?.artifacts?.taskSheet === 'string' ? task.artifacts.taskSheet : null;
  if (!pointer || !pointer.startsWith('docs/worklog/records/')) return false;
  return existsSync(resolve(rootDir, pointer));
}

/** 任务单落盘前统一为 UTF-8 无 BOM + LF，并返回是否发生改写。 */
export function normalizeTaskSheetLineEndings(path) {
  return normalizeTextFile(path, { apply: true }).applied;
}

/**
 * 记录包是交付指针的规范位置：索引指针失效时保留 manifest 已核验的路径，
 * 不把坏指针覆盖进 manifest。任务单缺失的终态任务写 tombstone 证据块。
 */
function applyTaskArtifacts(task, manifest, { rootDir, taskSheetPath }) {
  const delivery = task?.artifacts?.deliveryRecord;
  if (typeof delivery === 'string' && delivery && existsSync(resolve(rootDir, delivery))) {
    manifest.deliveryRecord = delivery;
  } else if (!manifest.deliveryRecord && typeof delivery === 'string') {
    manifest.deliveryRecord = delivery;
  }
  if (taskSheetPath) {
    manifest.tombstone = null;
    return;
  }
  if (!manifest.tombstone) {
    manifest.tombstone = {
      status: 'missing',
      reason: 'task-sheet-not-found-in-git-history',
      recordedAt: nowIso(),
      deliveryRecord: manifest.deliveryRecord ?? null,
    };
  }
}

/**
 * 登记即入包：把任务单搬到 records，写 manifest 与哈希。调用方需先确认 taskId
 * 尚未登记，避免事务失败后留下半包。
 */
export function ensureTaskRecordBundle(task, opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const source = typeof opts.sourceSheetPath === 'string' ? resolve(rootDir, opts.sourceSheetPath) : null;
  let target = canonicalTaskSheetPath(task, { rootDir, ext: opts.ext ?? sheetExtension(source) });
  if (!source && !existsSync(target)) {
    const other = canonicalTaskSheetPath(task, { rootDir, ext: target.endsWith('.json') ? 'md' : 'json' });
    if (existsSync(other)) target = other;
  }
  mkdirSync(dirname(target), { recursive: true });

  if (!existsSync(target)) {
    if (source && existsSync(source)) {
      if (samePath(source, target)) {
        // 已经是 canonical，无需迁移。
      } else if (!isTaskSheetFor(source, task.taskId)) {
        throw new Error(`任务单内容与 taskId 不匹配，拒绝入包：${task.taskId} ← ${repoRelative(rootDir, source)}`);
      } else {
        renameSync(source, target);
      }
    } else if (typeof opts.text === 'string') {
      writeFileSync(target, opts.text, 'utf8');
    } else {
      throw new Error(`任务单既不在源路径也不在记录包：${task.taskId}`);
    }
  } else if (source && existsSync(source) && !samePath(source, target)) {
    // 目标已存在：内容一致才删重复源；内容不同说明任务单被改写，拒绝静默覆盖。
    if (sha256TaskSheet(source) !== sha256TaskSheet(target)) {
      throw new Error(`任务单已入包且内容不同，拒绝覆盖：${task.taskId} ← ${repoRelative(rootDir, source)}`);
    }
    unlinkSync(source);
  }

  const manifest = readRecordManifest(task, { rootDir }) ?? emptyManifest(task);
  normalizeTaskSheetLineEndings(target);
  manifest.taskId = task.taskId;
  manifest.contextId = task.contextId ?? manifest.contextId ?? 'legacy';
  manifest.status = opts.status ?? task.status ?? manifest.status ?? null;
  manifest.createdAt = manifest.createdAt ?? task.createdAt ?? null;
  applyTaskArtifacts(task, manifest, { rootDir, taskSheetPath: target });
  const legacy = source && !samePath(source, target) ? repoRelative(rootDir, source) : null;
  manifest.taskSheet = {
    path: repoRelative(rootDir, target),
    sha256: sha256TaskSheet(target),
    immutable: true,
  };
  if (legacy && !manifest.legacyPaths.includes(legacy)) manifest.legacyPaths.push(legacy);
  if (opts.recoveredFrom) manifest.recoveredFrom = opts.recoveredFrom;
  if (manifest.receipts.length === 0) manifest.receipts = [];
  writeManifestIfChanged(task, manifest, { rootDir });
  return { bundleDir: taskBundleDir(task, { rootDir }), taskSheetPath: repoRelative(rootDir, target), manifest };
}

function samePath(a, b) {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/** 回执入包：同一 receiptId 内容相同幂等复用；内容不同则加摘要后缀留痕，绝不原地覆盖已入库副本。 */
export function copyReceiptToBundle(task, receiptFile, receipt, opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const bundleDir = taskBundleDir(task, { rootDir });
  mkdirSync(bundleDir, { recursive: true });
  const receiptId = safeSegment(receipt?.receiptId ?? `${task.taskId}-${Date.now()}`);
  const sourceHash = sha256File(receiptFile);
  let target = join(bundleDir, `receipt-${receiptId}.json`);
  if (existsSync(target) && sha256File(target) !== sourceHash) {
    target = join(bundleDir, `receipt-${receiptId}-${sourceHash.slice(0, 8)}.json`);
  }
  if (!existsSync(target)) copyFileSync(receiptFile, target);
  const manifest = readRecordManifest(task, { rootDir }) ?? emptyManifest(task);
  const ref = repoRelative(rootDir, target);
  const entry = { path: ref, sha256: sha256File(target), receiptId: receipt?.receiptId ?? null };
  const existingIndex = manifest.receipts.findIndex((item) => item.path === ref);
  if (existingIndex >= 0) manifest.receipts[existingIndex] = entry;
  else manifest.receipts.push(entry);
  manifest.status = task.status ?? manifest.status ?? null;
  manifest.contextId = task.contextId ?? manifest.contextId ?? null;
  writeManifestIfChanged(task, manifest, { rootDir });
  return { ref, manifest };
}

/**
 * 回执冻结校验：记录包必须已有同一 receiptId、同一内容哈希的副本。
 * run-once 摄入只认已随实现一起提交的副本，不再在提交后补写记录包。
 */
export function findBundledReceipt(task, receiptFile, receipt, { rootDir = REPO_ROOT } = {}) {
  const manifest = readRecordManifest(task, { rootDir }) ?? emptyManifest(task);
  const receiptId = receipt?.receiptId ?? null;
  if (!receiptId || !existsSync(receiptFile)) return null;
  const hash = sha256File(receiptFile);
  const entry = manifest.receipts.find((item) => item.receiptId === receiptId && item.sha256 === hash);
  if (!entry) return null;
  if (!existsSync(resolve(rootDir, entry.path))) return null;
  return { ...entry, manifest };
}

/** 记录包内任务单解析：canonical → manifest → 旧 pending 指针。 */
export function resolveTaskSheet(task, { rootDir = REPO_ROOT } = {}) {
  const pointer = typeof task?.artifacts?.taskSheet === 'string' ? resolve(rootDir, task.artifacts.taskSheet) : null;
  if (pointer && existsSync(pointer)) return { path: pointer, source: 'pointer' };
  const manifest = readRecordManifest(task, { rootDir });
  const manifestSheet = typeof manifest?.taskSheet?.path === 'string' ? resolve(rootDir, manifest.taskSheet.path) : null;
  if (manifestSheet && existsSync(manifestSheet)) return { path: manifestSheet, source: 'manifest' };
  const canonical = canonicalTaskSheetPath(task, { rootDir });
  if (existsSync(canonical)) return { path: canonical, source: 'canonical' };
  const canonicalJson = canonicalTaskSheetPath(task, { rootDir, ext: 'json' });
  if (existsSync(canonicalJson)) return { path: canonicalJson, source: 'canonical' };
  return null;
}

/** 扫描 records 下的全部 manifest，返回 taskId → 记录包信息。 */
export function listRecordBundles({ rootDir = REPO_ROOT } = {}) {
  const root = join(rootDir, 'docs', 'worklog', 'records');
  if (!existsSync(root)) return [];
  const bundles = [];
  for (const context of readdirSync(root, { withFileTypes: true })) {
    if (!context.isDirectory()) continue;
    const contextDir = join(root, context.name);
    for (const task of readdirSync(contextDir, { withFileTypes: true })) {
      if (!task.isDirectory()) continue;
      const manifestFile = join(contextDir, task.name, 'manifest.json');
      if (!existsSync(manifestFile)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
        bundles.push({ contextId: context.name, taskId: task.name, dir: join(contextDir, task.name), manifest });
      } catch {
        bundles.push({ contextId: context.name, taskId: task.name, dir: join(contextDir, task.name), manifest: null });
      }
    }
  }
  return bundles;
}

function allTasks(index) {
  return [...(index?.tasks ?? []), ...(index?.archivedTasks ?? [])];
}

function duplicateTaskIds(index) {
  const seen = new Set();
  const duplicates = new Set();
  for (const task of allTasks(index)) {
    if (seen.has(task.taskId)) duplicates.add(task.taskId);
    seen.add(task.taskId);
  }
  return [...duplicates];
}

/** 解析记录包内的任意历史工件指针（任务单 / 回复 / 评审稿），旧 pending 失效时按 basename 回退 legacy。 */
export function resolveWorklogArtifact(task, ref, { rootDir = REPO_ROOT } = {}) {
  if (typeof ref !== 'string' || ref.length === 0) return ref;
  const abs = resolve(rootDir, ref);
  if (existsSync(abs)) return ref;
  if (!ref.startsWith('docs/worklog/pending/')) return ref;
  const manifest = readRecordManifest(task, { rootDir });
  const base = basename(ref);
  const legacy = (manifest?.legacyPaths ?? []).find((item) => basename(item) === base);
  if (!legacy) return ref;
  const legacyAbs = resolve(rootDir, legacy);
  return existsSync(legacyAbs) ? legacy : ref;
}

export const LEGACY_RECORD_PACKAGES_VERSION = 'legacy-record-packages:1.0.0';

export function legacyRecordPackagesPath({ rootDir = REPO_ROOT } = {}) {
  return join(rootDir, 'docs', 'team', 'agent-orchestration', 'legacy-record-packages.json');
}

/**
 * AF-423：继承清单读取与校验。
 *
 * 历史孤儿记录包（有 manifest 与交付记录、但缺 journal 事件）不能用全局
 * `ORCH_STATE_FREE` 跳过——那会把新出现的孤儿一起放过。改为逐条登记：
 * taskId + reason + evidence，verify 只豁免清单内的包，清单外照旧报错。
 * @returns {{ok:boolean, entries:Array<{taskId:string,reason:string,evidence:string[]}>, errors:string[]}}
 */
export function loadLegacyRecordPackages({ rootDir = REPO_ROOT } = {}) {
  const file = legacyRecordPackagesPath({ rootDir });
  if (!existsSync(file)) return { ok: true, entries: [], errors: [] };
  const errors = [];
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, entries: [], errors: [`继承清单非法 JSON：${error.message}`] };
  }
  if (parsed?.version !== LEGACY_RECORD_PACKAGES_VERSION) {
    errors.push(`继承清单版本不符：${parsed?.version ?? 'missing'}（期望 ${LEGACY_RECORD_PACKAGES_VERSION}）`);
  }
  if (!Array.isArray(parsed?.packages)) {
    errors.push('继承清单缺 packages 数组');
    return { ok: false, entries: [], errors };
  }
  const entries = [];
  const seen = new Set();
  for (const raw of parsed.packages) {
    const taskId = String(raw?.taskId ?? '').trim();
    if (!/^AF-\d+$/.test(taskId)) {
      errors.push(`继承清单 taskId 非法：${taskId || '<empty>'}`);
      continue;
    }
    if (seen.has(taskId)) {
      errors.push(`继承清单重复 taskId：${taskId}`);
      continue;
    }
    seen.add(taskId);
    const reason = String(raw?.reason ?? '').trim();
    if (!reason) errors.push(`继承清单缺 reason：${taskId}`);
    const evidence = Array.isArray(raw?.evidence) ? raw.evidence.map((item) => String(item)) : [];
    if (evidence.length === 0) errors.push(`继承清单缺 evidence：${taskId}`);
    for (const ref of evidence) {
      if (!existsSync(resolve(rootDir, ref))) errors.push(`继承清单证据文件不存在：${taskId} → ${ref}`);
    }
    entries.push({ taskId, reason, evidence });
  }
  return { ok: errors.length === 0, entries, errors };
}

/**
 * 记录包缺 manifest 时，尝试在本地 git 里定位任务单所在的未合并分支。
 * 只做只读诊断；仓库不是 git、CI 浅检出或对象已回收时返回空，不阻塞 verify。
 */
function taskSheetBranches(task, rootDir) {
  const ref = typeof task?.artifacts?.taskSheet === 'string' ? posix(task.artifacts.taskSheet) : null;
  if (!ref || ref.startsWith('../')) return [];
  try {
    const commit = execFileSync('git', ['-C', rootDir, 'log', '--all', '-1', '--format=%H', '--', ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!commit) return [];
    const output = execFileSync('git', ['-C', rootDir, 'branch', '-a', '--contains', commit, '--format=%(refname:short)'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * worklog 完整性校验：索引 ↔ 记录包 ↔ 文件哈希 ↔ inbox。
 * @returns {{ok:boolean, errors:string[], stats:object, warnings:string[]}}
 */
export function verifyWorklog(index, opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const errors = [];
  const warnings = [];
  const missingSheets = [];
  const missingDeliveries = [];
  const bundles = listRecordBundles({ rootDir });
  const indexIds = new Set(allTasks(index).map((task) => task.taskId));
  const duplicates = duplicateTaskIds(index);
  for (const taskId of duplicates) errors.push(`重复 taskId：${taskId}`);
  const legacy = opts.legacyPackages ?? loadLegacyRecordPackages({ rootDir });
  for (const error of legacy.errors) errors.push(error);
  const legacyIds = new Set(legacy.entries.map((entry) => entry.taskId));

  for (const task of allTasks(index)) {
    let manifest = null;
    try {
      manifest = readRecordManifest(task, { rootDir });
    } catch (error) {
      errors.push(`记录包 manifest 非法 JSON：${task.taskId}（${error.message}）`);
      continue;
    }
    if (!manifest) {
      const branches = taskSheetBranches(task, rootDir);
      const hint = branches.length
        ? `记录包只存在于未合并分支：${branches.join('、')}；先合并该任务分支或把记录包恢复到当前基线`
        : '若记录包只存在于未合并任务分支，请先合并或恢复记录包；不要手写 manifest 绕过';
      errors.push(`记录包缺 manifest：${task.taskId}（${hint}）`);
      continue;
    }
    if (manifest.taskId !== task.taskId) errors.push(`manifest taskId 不匹配：${task.taskId} → ${manifest.taskId}`);
    const terminal = ['completed', 'failed', 'canceled', 'rejected'].includes(task.status);
    const delivery = manifest.deliveryRecord ?? task?.artifacts?.deliveryRecord ?? null;
    if (task.status === 'completed') {
      // 只有 completed 才必须交付记录；缺文件直接失败。
      if (!(typeof delivery === 'string' && delivery && existsSync(resolve(rootDir, delivery)))) {
        missingDeliveries.push(task.taskId);
        errors.push(
          delivery
            ? `交付记录缺文件：${task.taskId} → ${delivery}`
            : `completed 任务缺交付记录：${task.taskId}`,
        );
      }
    } else if (typeof delivery === 'string' && delivery && !existsSync(resolve(rootDir, delivery))) {
      // IM-076：canceled / rejected / failed 任务的声明指针可能从未产出。
      // 把它降为告警而不是错误，避免一次重签发额外拖一个补齐任务。
      warnings.push(`非 completed 任务交付指针失效（已忽略）：${task.taskId} → ${delivery}（status=${task.status}）`);
    }
    if (!manifest.taskSheet?.path) {
      missingSheets.push(task.taskId);
      if (!terminal) {
        errors.push(`非终态任务缺任务单：${task.taskId}（status=${task.status ?? 'unknown'}）`);
      } else if (!manifest.tombstone) {
        errors.push(`墓碑缺证据块：${task.taskId}`);
      }
      continue;
    }
    const sheet = resolveTaskSheet(task, { rootDir });
    if (!sheet) {
      errors.push(`任务单不可解析：${task.taskId}（manifest=${manifest.taskSheet.path}）`);
    } else {
      const rawText = readFileSync(sheet.path, 'utf8');
      const canonicalText = normalizeLf(rawText);
      const sheetRef = repoRelative(rootDir, sheet.path);
      if (sha256Text(canonicalText) !== manifest.taskSheet.sha256) {
        errors.push(
          `任务单哈希不匹配：${task.taskId}（若仅 CRLF/BOM 差异，执行 docs normalize --path ${sheetRef} --apply 后 worklog migrate --apply 重算）`,
        );
      } else if (canonicalText !== rawText) {
        errors.push(`任务单未规范化：${task.taskId}（${sheetRef}：BOM 或 CR 行尾，执行 docs normalize --path ${sheetRef} --apply）`);
      }
    }
    for (const receipt of manifest.receipts ?? []) {
      const abs = resolve(rootDir, receipt.path);
      if (!existsSync(abs)) {
        errors.push(`回执缺文件：${task.taskId} → ${receipt.path}`);
      } else if (sha256File(abs) !== receipt.sha256) {
        errors.push(`回执哈希不匹配：${task.taskId} → ${receipt.path}`);
      }
    }
  }

  const skippedOrphans = [];
  const legacyOrphans = [];
  const bundleIds = new Set(bundles.map((bundle) => bundle.taskId));
  for (const bundle of bundles) {
    if (!indexIds.has(bundle.taskId)) {
      // 状态面解耦：任务分支不提交索引，记录包必然暂时不在索引里；
      // 只有状态面同步后的 integrate 才具备判孤儿条件。显式记录跳过，不静默。
      // AF-423：继承清单内的历史包判 legacy 并计数，清单外的孤儿照旧报错。
      if (legacyIds.has(bundle.taskId)) legacyOrphans.push(bundle.taskId);
      else if (opts.stateFree) skippedOrphans.push(bundle.taskId);
      else errors.push(`孤儿记录包：${bundle.taskId}`);
    }
    if (!bundle.manifest) errors.push(`记录包 manifest 非法 JSON：${bundle.taskId}`);
  }
  const staleLegacy = legacy.entries.map((entry) => entry.taskId).filter((taskId) => indexIds.has(taskId) || !bundleIds.has(taskId));
  for (const taskId of staleLegacy) {
    errors.push(`继承清单已过期：${taskId}（已进入索引或记录包不存在，请从 legacy-record-packages.json 移除）`);
  }

  const inboxDir = join(rootDir, 'docs', 'worklog', 'inbox');
  if (existsSync(inboxDir)) {
    for (const name of readdirSync(inboxDir)) {
      if (!/^af\d+-/i.test(name) || !name.endsWith('.md')) continue;
      const taskId = `AF-${/^af(\d+)/i.exec(name)[1]}`;
      const known = allTasks(index).find((task) => task.taskId === taskId);
      if (known && ['completed', 'failed', 'canceled', 'rejected'].includes(known.status)) {
        errors.push(`终态任务单仍在 inbox：${name}`);
      }
    }
  }

  const legacyPointers = allTasks(index).filter((task) => {
    const ref = task?.artifacts?.taskSheet;
    return typeof ref === 'string' && ref.startsWith('docs/worklog/pending/');
  }).length;
  const inboxFiles = existsSync(inboxDir)
    ? readdirSync(inboxDir).filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md').length
    : 0;
  const stats = {
    activeTasks: (index?.tasks ?? []).length,
    archivedTasks: (index?.archivedTasks ?? []).length,
    bundles: bundles.length,
    inboxFiles,
    legacyPointers,
    missingTaskSheets: missingSheets.length,
    missingTaskSheetIds: missingSheets,
    tombstones: missingSheets.length,
    missingDeliveryRecords: missingDeliveries.length,
    missingDeliveryRecordIds: missingDeliveries,
    legacyRecordPackages: legacy.entries.length,
    legacyOrphans: legacyOrphans.length,
    legacyOrphanIds: legacyOrphans,
    staleLegacyIds: staleLegacy,
  };
  return { ok: errors.length === 0, errors, warnings, stats, skippedOrphans, legacyOrphans, staleLegacy };
}

function looksLikeTaskSheet(file, taskId) {
  const text = readFileSync(file, 'utf8').slice(0, 500);
  if (/^\s*{/.test(text)) {
    return text.includes(`"taskId"`) && text.includes(taskId);
  }
  if (text.includes(`taskId: ${taskId}`)) return true;
  return new RegExp(`^#\\s+${taskId}\\s*[·\\-—]`, 'm').test(text);
}

export function isTaskSheetFor(file, taskId) {
  return existsSync(file) && looksLikeTaskSheet(file, taskId);
}

function moveFile(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    if (sha256File(source) === sha256File(target)) {
      unlinkSync(source);
      return 'deduped';
    }
    throw new Error(`目标已存在且内容不同：${target}`);
  }
  renameSync(source, target);
  return 'moved';
}

/** 旧 pending/archive 里以 `<taskId>-task-sheet*` 命名的任务单副本（历史遗留）。 */
function findLegacyTaskSheet(taskId, rootDir) {
  const dir = join(rootDir, 'docs', 'worklog', 'pending', 'archive');
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((entry) => entry.startsWith(`${taskId}-task-sheet`) && /\.(md|json)$/i.test(entry));
  return name ? join(dir, name) : null;
}

/** 历史迁移：任务单与旧回执入包，不重写索引指针（读取侧由 manifest 解析）。 */
export function migrateWorklog(index, opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const apply = opts.apply === true;
  const entries = [];
  const errors = [];
  const warnings = [];
  let movedSheets = 0;
  let movedReceipts = 0;
  let orphanSheets = 0;
  const existingBundles = new Map(listRecordBundles({ rootDir }).map((bundle) => [bundle.taskId, bundle]));

  const adoptLegacyTaskSheet = (task, entry) => {
    const source = findLegacyTaskSheet(task.taskId, rootDir);
    if (!source || !looksLikeTaskSheet(source, task.taskId)) return false;
    const target = bundleSheetTarget(task, source, rootDir);
    entry.from = repoRelative(rootDir, source);
    entry.to = repoRelative(rootDir, target);
    if (!existsSync(target)) {
      if (apply) moveFile(source, target);
      movedSheets += 1;
    } else if (sha256TaskSheet(source) === sha256TaskSheet(target)) {
      if (apply) unlinkSync(source);
      movedSheets += 1;
    } else {
      errors.push(`旧任务单目标冲突：${task.taskId}`);
      return true;
    }
    if (apply) ensureBundleManifest(task, target, rootDir);
    return true;
  };

  for (const task of allTasks(index)) {
    const entry = { taskId: task.taskId, contextId: task.contextId ?? null, status: task.status ?? null };
    const pointer = task?.artifacts?.taskSheet;
    if (typeof pointer === 'string' && pointer.trim() && !pointer.startsWith('docs/worklog/records/')) {
      const source = resolve(rootDir, pointer);
      if (existsSync(source)) {
        if (!looksLikeTaskSheet(source, task.taskId)) {
          errors.push(`任务单指针指向非任务单：${task.taskId} → ${pointer}`);
          entries.push(entry);
          continue;
        }
        const target = bundleSheetTarget(task, source, rootDir);
        entry.from = pointer;
        entry.to = repoRelative(rootDir, target);
        if (!existsSync(target)) {
          if (apply) moveFile(source, target);
          movedSheets += 1;
        } else if (sha256TaskSheet(source) === sha256TaskSheet(target)) {
          if (apply) unlinkSync(source);
          movedSheets += 1;
        } else {
          errors.push(`任务单目标冲突：${task.taskId}`);
        }
        if (apply) {
          ensureBundleManifest(task, target, rootDir);
        }
      } else {
        const target = bundleSheetTarget(task, pointer, rootDir);
        if (existsSync(target)) {
          if (apply) ensureBundleManifest(task, target, rootDir);
        } else if (adoptLegacyTaskSheet(task, entry)) {
          // 旧 archive 里尚有任务单副本，收养进记录包，不写墓碑。
        } else if (['completed', 'failed', 'canceled', 'rejected'].includes(task.status)) {
          if (apply) ensureBundleManifest(task, null, rootDir);
          entry.taskSheet = null;
          entry.note = 'task-sheet-missing:tombstone';
        } else {
          errors.push(`任务单源缺失：${task.taskId} → ${pointer}`);
        }
      }
    } else {
      const bundle = existingBundles.get(task.taskId);
      const sheet = bundle?.manifest?.taskSheet?.path;
      const bundleScopedTask = bundle ? { ...task, contextId: bundle.contextId } : task;
      if (sheet) {
        if (apply) ensureBundleManifest(bundleScopedTask, resolve(rootDir, sheet), rootDir);
      } else if (adoptLegacyTaskSheet(bundleScopedTask, entry)) {
        // 旧 archive 里尚有任务单副本，收养进记录包，不写墓碑。
      } else if (['completed', 'failed', 'canceled', 'rejected'].includes(task.status)) {
        if (apply) ensureBundleManifest(bundleScopedTask, null, rootDir);
        entry.taskSheet = null;
        entry.note = 'task-sheet-missing:tombstone';
      } else {
        errors.push(`任务单不存在：${task.taskId}`);
      }
    }

    const legacyReceiptDir = join(rootDir, 'docs', 'worklog', 'pending', 'archive');
    const legacyReceipts = existsSync(legacyReceiptDir)
      ? readdirSync(legacyReceiptDir).filter((name) => name.startsWith(`${task.taskId}-receipt-`) && name.endsWith('.json'))
      : [];
    for (const name of legacyReceipts) {
      const source = join(legacyReceiptDir, name);
      const receipt = readJsonSafe(source);
      const receiptId = safeSegment(receipt?.payload?.receiptId ?? receipt?.receiptId ?? basename(name, '.json'));
      const target = join(taskBundleDir(task, { rootDir }), `receipt-${receiptId}.json`);
      if (!existsSync(target)) {
        if (apply) {
          mkdirSync(dirname(target), { recursive: true });
          moveFile(source, target);
        }
        movedReceipts += 1;
      } else if (apply) {
        if (sha256File(source) === sha256File(target)) unlinkSync(source);
        else errors.push(`回执目标冲突：${task.taskId} → ${name}`);
      }
    }
    entries.push(entry);
  }

  const pendingDir = join(rootDir, 'docs', 'worklog', 'pending');
  if (existsSync(pendingDir)) {
    for (const name of readdirSync(pendingDir)) {
      if (!/^af\d+-.*\.md$/i.test(name)) continue;
      const taskId = `AF-${/^af(\d+)/i.exec(name)[1]}`;
      const task = allTasks(index).find((item) => item.taskId === taskId);
      if (!task) {
        warnings.push(`pending 残留未登记任务单：${name}`);
        continue;
      }
      const manifest = readRecordManifest(task, { rootDir });
      if (!manifest) {
        errors.push(`pending 残留任务单但无记录包：${name}`);
        continue;
      }
      const source = join(pendingDir, name);
      const target = join(taskBundleDir(task, { rootDir }), 'legacy', basename(name));
      if (!existsSync(target)) {
        if (apply) {
          mkdirSync(dirname(target), { recursive: true });
          moveFile(source, target);
        }
        orphanSheets += 1;
      } else if (apply && sha256TaskSheet(source) === sha256TaskSheet(target)) {
        unlinkSync(source);
      }
      if (apply) {
        const rel = repoRelative(rootDir, target);
        manifest.legacyPaths = [...new Set([...(manifest.legacyPaths ?? []), rel])];
        writeManifest(task, manifest, { rootDir });
      }
    }
  }

  const report = {
    schemaVersion: 'worklog-migration-report:1.0.0',
    generatedAt: nowIso(),
    apply,
    totals: {
      tasks: entries.length,
      movedSheets,
      movedReceipts,
      orphanSheets,
      errors: errors.length,
    },
    entries,
    warnings,
    errors,
  };
  if (apply) {
    const reportDir = join(rootDir, 'docs', 'worklog', 'records');
    mkdirSync(reportDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    writeFileSync(join(reportDir, `migration-report-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return report;
}

function ensureBundleManifest(task, taskSheetAbs, rootDir) {
  const manifest = readRecordManifest(task, { rootDir }) ?? emptyManifest(task);
  manifest.taskId = task.taskId;
  manifest.contextId = task.contextId ?? manifest.contextId ?? 'legacy';
  manifest.status = task.status ?? manifest.status ?? null;
  manifest.createdAt = manifest.createdAt ?? task.createdAt ?? null;
  applyTaskArtifacts(task, manifest, { rootDir, taskSheetPath: taskSheetAbs });
  if (taskSheetAbs) {
    normalizeTaskSheetLineEndings(taskSheetAbs);
    manifest.taskSheet = {
      path: repoRelative(rootDir, taskSheetAbs),
      sha256: sha256TaskSheet(taskSheetAbs),
      immutable: true,
    };
  }
  const receipts = (manifest.receipts ?? []).map((item) => {
    const abs = resolve(rootDir, item.path);
    return existsSync(abs) ? { ...item, sha256: sha256File(abs) } : item;
  });
  manifest.receipts = receipts;
  writeManifest(task, manifest, { rootDir });
}

function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 看板/CI 摘要。 */
export function worklogStats(index, opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const bundles = listRecordBundles({ rootDir });
  const pendingDir = join(rootDir, 'docs', 'worklog', 'pending');
  const inboxDir = join(rootDir, 'docs', 'worklog', 'inbox');
  const pending = existsSync(pendingDir)
    ? readdirSync(pendingDir).filter((name) => !statSync(join(pendingDir, name)).isDirectory()).length
    : 0;
  return {
    activeTasks: (index?.tasks ?? []).length,
    archivedTasks: (index?.archivedTasks ?? []).length,
    bundles: bundles.length,
    pendingFiles: pending,
    inboxFiles: existsSync(inboxDir)
      ? readdirSync(inboxDir).filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md').length
      : 0,
    tombstones: bundles.filter(
      (bundle) => !bundle.manifest?.taskSheet?.path && ['completed', 'failed', 'canceled', 'rejected'].includes(bundle.manifest?.status),
    ).length,
    recordBytes: bundles.reduce((sum, bundle) => sum + directorySize(bundle.dir), 0),
  };
}

function directorySize(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(path);
    else total += statSync(path).size;
  }
  return total;
}

export { allTasks };
export { worklogStats as statsWorklog };
