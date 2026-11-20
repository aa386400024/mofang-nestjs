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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { REPO_ROOT, nowIso, writeJsonAtomic } from './state-store.mjs';

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
  };
}

function writeManifest(task, manifest, { rootDir }) {
  manifest.updatedAt = nowIso();
  writeJsonAtomic(recordManifestPath(task, { rootDir }), manifest);
}

export function normalizeTaskSheetLineEndings(path) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes('\r')) return false;
  writeFileSync(path, text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8');
  return true;
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
    if (sha256File(source) !== sha256File(target)) {
      throw new Error(`任务单已入包且内容不同，拒绝覆盖：${task.taskId} ← ${repoRelative(rootDir, source)}`);
    }
    unlinkSync(source);
  }

  const manifest = readRecordManifest(task, { rootDir }) ?? emptyManifest(task);
  normalizeTaskSheetLineEndings(target);
  manifest.taskId = task.taskId;
  manifest.contextId = task.contextId ?? manifest.contextId ?? null;
  manifest.status = opts.status ?? task.status ?? manifest.status ?? null;
  manifest.createdAt = manifest.createdAt ?? task.createdAt ?? null;
  const legacy = source && !samePath(source, target) ? repoRelative(rootDir, source) : null;
  manifest.taskSheet = {
    path: repoRelative(rootDir, target),
    sha256: sha256File(target),
    immutable: true,
  };
  if (legacy && !manifest.legacyPaths.includes(legacy)) manifest.legacyPaths.push(legacy);
  if (manifest.receipts.length === 0) manifest.receipts = [];
  writeManifest(task, manifest, { rootDir });
  return { bundleDir: taskBundleDir(task, { rootDir }), taskSheetPath: repoRelative(rootDir, target), manifest };
}

function samePath(a, b) {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/** 回执入包：同一 receiptId 内容相同幂等复用；内容不同则加摘要后缀留痕。 */
export function copyReceiptToBundle(task, receiptFile, receipt, opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const bundleDir = taskBundleDir(task, { rootDir });
  mkdirSync(bundleDir, { recursive: true });
  const receiptId = safeSegment(receipt?.receiptId ?? `${task.taskId}-${Date.now()}`);
  let target = join(bundleDir, `receipt-${receiptId}.json`);
  if (existsSync(target) && sha256File(target) !== sha256File(receiptFile)) {
    target = join(bundleDir, `receipt-${receiptId}-${sha256File(receiptFile).slice(0, 8)}.json`);
  }
  if (!existsSync(target)) copyFileSync(receiptFile, target);
  const manifest = readRecordManifest(task, { rootDir }) ?? emptyManifest(task);
  const ref = repoRelative(rootDir, target);
  const entry = { path: ref, sha256: sha256File(target), receiptId: receipt?.receiptId ?? null };
  manifest.receipts = [...manifest.receipts.filter((item) => item.path !== ref), entry];
  manifest.status = task.status ?? manifest.status ?? null;
  manifest.contextId = task.contextId ?? manifest.contextId ?? null;
  writeManifest(task, manifest, { rootDir });
  return { ref, manifest };
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

/**
 * worklog 完整性校验：索引 ↔ 记录包 ↔ 文件哈希 ↔ inbox。
 * @returns {{ok:boolean, errors:string[], stats:object, warnings:string[]}}
 */
export function verifyWorklog(index, opts = {}) {
  const rootDir = opts.rootDir ?? REPO_ROOT;
  const errors = [];
  const warnings = [];
  const missingSheets = [];
  const bundles = listRecordBundles({ rootDir });
  const indexIds = new Set(allTasks(index).map((task) => task.taskId));
  const duplicates = duplicateTaskIds(index);
  for (const taskId of duplicates) errors.push(`重复 taskId：${taskId}`);

  for (const task of allTasks(index)) {
    let manifest = null;
    try {
      manifest = readRecordManifest(task, { rootDir });
    } catch (error) {
      errors.push(`记录包 manifest 非法 JSON：${task.taskId}（${error.message}）`);
      continue;
    }
    if (!manifest) {
      errors.push(`记录包缺 manifest：${task.taskId}`);
      continue;
    }
    if (manifest.taskId !== task.taskId) errors.push(`manifest taskId 不匹配：${task.taskId} → ${manifest.taskId}`);
    if (!manifest.taskSheet?.path) {
      missingSheets.push(task.taskId);
      if (!['completed', 'failed', 'canceled', 'rejected'].includes(task.status)) {
        errors.push(`非终态任务缺任务单：${task.taskId}（status=${task.status ?? 'unknown'}）`);
      }
      continue;
    }
    const sheet = resolveTaskSheet(task, { rootDir });
    if (!sheet) {
      errors.push(`任务单不可解析：${task.taskId}（manifest=${manifest.taskSheet.path}）`);
    } else if (sha256File(sheet.path) !== manifest.taskSheet.sha256) {
      errors.push(`任务单哈希不匹配：${task.taskId}`);
    } else if (readFileSync(sheet.path, 'utf8').includes('\r')) {
      errors.push(`任务单含 CR 行尾：${task.taskId}（${repoRelative(rootDir, sheet.path)}）`);
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

  for (const bundle of bundles) {
    if (!indexIds.has(bundle.taskId)) errors.push(`孤儿记录包：${bundle.taskId}`);
    if (!bundle.manifest) errors.push(`记录包 manifest 非法 JSON：${bundle.taskId}`);
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
  };
  return { ok: errors.length === 0, errors, warnings, stats };
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

  const adoptLegacyTaskSheet = (task, entry) => {
    const source = findLegacyTaskSheet(task.taskId, rootDir);
    if (!source || !looksLikeTaskSheet(source, task.taskId)) return false;
    const target = bundleSheetTarget(task, source, rootDir);
    entry.from = repoRelative(rootDir, source);
    entry.to = repoRelative(rootDir, target);
    if (!existsSync(target)) {
      if (apply) moveFile(source, target);
      movedSheets += 1;
    } else if (sha256File(source) === sha256File(target)) {
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
        } else if (sha256File(source) === sha256File(target)) {
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
      const target = bundleSheetTarget(task, null, rootDir);
      if (existsSync(target)) {
        if (apply) ensureBundleManifest(task, target, rootDir);
      } else if (adoptLegacyTaskSheet(task, entry)) {
        // 旧 archive 里尚有任务单副本，收养进记录包。
      } else if (task.taskId === 'AF-002' || ['completed', 'failed', 'canceled', 'rejected'].includes(task.status)) {
        if (apply) ensureBundleManifest(task, null, rootDir);
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
      } else if (apply && sha256File(source) === sha256File(target)) {
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
  manifest.contextId = task.contextId ?? manifest.contextId ?? null;
  manifest.status = task.status ?? manifest.status ?? null;
  manifest.createdAt = manifest.createdAt ?? task.createdAt ?? null;
  if (taskSheetAbs) {
    manifest.taskSheet = {
      path: repoRelative(rootDir, taskSheetAbs),
      sha256: sha256File(taskSheetAbs),
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
