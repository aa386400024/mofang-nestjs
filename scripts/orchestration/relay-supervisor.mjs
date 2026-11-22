/**
 * AF-069 · Relay Supervisor（本地回执回收）。
 *
 * 设计口径：框架 §8.1 / §8.2。
 * - 事件优先：fs.watch 只监听 pending 目录，命中已注册任务的精确文件名。
 * - 兜底扫描：每个 job 按 profile 计算 nextCheckAt；定时器只检查到期 job，不扫目录。
 * - 任务级账本：taskId / 精确文件 / profile / nextCheckAt / attempts / deadline / state。
 * - 可靠性：单实例锁、原子账本、文件稳定判定、命中后归档与通知、超时停止、审计 JSONL。
 * - 边界：只读 pending 回执文件；不读业务数据；通知只存路径、大小、哈希与状态。
 *
 * 本文件同时提供可测试的纯函数与 CLI：
 *   register / list / tick / watch / inbox / ack / cancel
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PATHS, REPO_ROOT, nowIso, writeJsonAtomic } from './state-store.mjs';
import { createWatcher } from './file-watcher.mjs';
import { acquireRunLock } from './run-lock.mjs';

export const RELAY_PROFILES = Object.freeze({
  S: Object.freeze({ intervals: [10, 10, 15], deadlineMinutes: 45 }),
  M: Object.freeze({ intervals: [10, 15, 15, 20], deadlineMinutes: 90 }),
  L: Object.freeze({ intervals: [15, 15, 20, 30, 30], deadlineMinutes: 180 }),
  XL: Object.freeze({ intervals: [15, 20, 30, 45, 60], deadlineMinutes: 240 }),
});

export const DEFAULT_RELAY_PROFILE = 'M';
export const RELAY_FILE_PATTERN = /^relay-response-[A-Za-z0-9._-]+\.md$/;
export const RELAY_STATE_VERSION = 1;
export const RELAY_STATE_FILE = join(PATHS.transportDir, 'relay-jobs.json');
export const RELAY_NOTIFICATIONS_DIR = join(PATHS.transportDir, 'relay-notifications');
export const RELAY_AUDIT_FILE = join(PATHS.transportDir, 'relay-audit.jsonl');
export const RELAY_PENDING_DIR = join(REPO_ROOT, 'docs', 'worklog', 'pending');
export const RELAY_ARCHIVE_DIR = PATHS.receiptArchiveDir;
export const RELAY_REGISTRY_LOCK_DIR = join(PATHS.transportDir, 'relay-registry-lock');
export const RELAY_SUPERVISOR_LOCK_DIR = join(PATHS.transportDir, 'relay-supervisor-lock');
export const RELAY_SETTLE_MS = 2500;
export const RELAY_SETTLE_MAX_RETRIES = 5;
export const RELAY_WATCH_INTERVAL_MS = 15000;
export const RELAY_WATCH_DEBOUNCE_MS = 500;

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`无效时间：${String(value)}`);
  return date;
}

function toIso(value) {
  return toDate(value).toISOString();
}

function addMinutes(value, minutes) {
  return new Date(toDate(value).getTime() + minutes * 60_000).toISOString();
}

function profileConfig(profile) {
  const key = String(profile ?? DEFAULT_RELAY_PROFILE).toUpperCase();
  const cfg = RELAY_PROFILES[key];
  if (!cfg) throw new Error(`未知 relay profile：${profile}（可用：${Object.keys(RELAY_PROFILES).join('/')}）`);
  return { key, ...cfg };
}

function safeTaskId(taskId) {
  return String(taskId).replace(/[^A-Za-z0-9._-]/g, '_');
}

function normalizeRelativePath(path) {
  return String(path).replaceAll('\\', '/');
}

function toDisplayPath(absPath) {
  return normalizeRelativePath(relative(REPO_ROOT, absPath));
}

function pushHistory(job, at, action, detail = {}) {
  job.history = [...(job.history ?? []), { at: toIso(at), action, detail }].slice(-50);
}

export function resolveRelayFile(file, { pendingDir = RELAY_PENDING_DIR } = {}) {
  if (!file || typeof file !== 'string') throw new Error('回执文件路径不能为空');
  const absolute = isAbsolute(file) ? resolve(file) : resolve(REPO_ROOT, file);
  const fileName = basename(absolute);
  if (!RELAY_FILE_PATTERN.test(fileName)) {
    throw new Error(`回执文件名不合法：${fileName}（应匹配 relay-response-<任务号或短话题>.md）`);
  }
  const insidePending = relative(pendingDir, absolute);
  if (insidePending.startsWith('..') || isAbsolute(insidePending)) {
    throw new Error(`回执文件必须位于 ${toDisplayPath(pendingDir)}：${absolute}`);
  }
  return { absolute, fileName, relative: toDisplayPath(absolute) };
}

export function buildRelayJob({
  taskId,
  file,
  profile = DEFAULT_RELAY_PROFILE,
  now = new Date(),
  deadline = null,
  pendingDir = RELAY_PENDING_DIR,
}) {
  if (!TASK_ID_PATTERN.test(String(taskId ?? ''))) throw new Error(`任务号不合法：${taskId}`);
  const target = resolveRelayFile(file, { pendingDir });
  const cfg = profileConfig(profile);
  const createdAt = toIso(now);
  const deadlineAt = deadline ? toIso(deadline) : addMinutes(now, cfg.deadlineMinutes);
  if (Date.parse(deadlineAt) <= Date.parse(createdAt)) throw new Error('deadline 必须晚于注册时间');

  const firstCheckAt = addMinutes(now, cfg.intervals[0]);
  const firstCheck = Date.parse(firstCheckAt) > Date.parse(deadlineAt) ? deadlineAt : firstCheckAt;

  return {
    taskId: String(taskId),
    profile: cfg.key,
    file: target.relative,
    fileName: target.fileName,
    state: 'pending',
    createdAt,
    deadlineAt,
    nextCheckAt: firstCheck,
    attempts: 0,
    settleRetries: 0,
    lastCheckAt: null,
    lastResult: null,
    notifiedAt: null,
    archivedFile: null,
    history: [{ at: createdAt, action: 'registered', detail: { profile: cfg.key, fileName: target.fileName } }],
  };
}

function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('relay job 不是对象');
  if (!TASK_ID_PATTERN.test(String(raw.taskId ?? ''))) throw new Error(`relay job 任务号不合法：${raw.taskId}`);
  const fileName = raw.fileName ?? (raw.file ? basename(raw.file) : null);
  if (!fileName || !RELAY_FILE_PATTERN.test(fileName)) throw new Error(`relay job 文件名不合法：${fileName}`);
  const profile = profileConfig(raw.profile).key;
  return {
    taskId: String(raw.taskId),
    profile,
    file: raw.file ? normalizeRelativePath(raw.file) : `docs/worklog/pending/${fileName}`,
    fileName,
    state: raw.state ?? 'pending',
    createdAt: raw.createdAt ?? nowIso(),
    deadlineAt: raw.deadlineAt ?? addMinutes(raw.createdAt ?? new Date(), RELAY_PROFILES[profile].deadlineMinutes),
    nextCheckAt: raw.nextCheckAt ?? null,
    attempts: Number.isInteger(raw.attempts) ? raw.attempts : 0,
    settleRetries: Number.isInteger(raw.settleRetries) ? raw.settleRetries : 0,
    lastCheckAt: raw.lastCheckAt ?? null,
    lastResult: raw.lastResult ?? null,
    notifiedAt: raw.notifiedAt ?? null,
    archivedFile: raw.archivedFile ?? null,
    history: Array.isArray(raw.history) ? raw.history.slice(-50) : [],
  };
}

export function emptyRelayState() {
  return { version: RELAY_STATE_VERSION, updatedAt: nowIso(), jobs: [] };
}

export function readRelayState(file = RELAY_STATE_FILE) {
  if (!existsSync(file)) return emptyRelayState();
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return emptyRelayState();
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error(`relay 账本不是对象：${file}`);
  return {
    version: raw.version ?? RELAY_STATE_VERSION,
    updatedAt: raw.updatedAt ?? nowIso(),
    jobs: Array.isArray(raw.jobs) ? raw.jobs.map(normalizeJob) : [],
  };
}

export function saveRelayState(file, state) {
  const next = { ...state, version: RELAY_STATE_VERSION, updatedAt: nowIso(), jobs: [...state.jobs] };
  writeJsonAtomic(file, next);
  return next;
}

export function isRelayJobDue(job, now = new Date()) {
  if (job.state !== 'pending') return false;
  if (!job.nextCheckAt) return false;
  return Date.parse(job.nextCheckAt) <= toDate(now).getTime();
}

function nextIntervalMinutes(job) {
  const cfg = RELAY_PROFILES[job.profile];
  const index = Math.min(job.attempts, cfg.intervals.length - 1);
  return cfg.intervals[index];
}

function scheduleNextCheck(job, now, minutes) {
  const candidate = addMinutes(now, minutes);
  job.nextCheckAt = Date.parse(candidate) > Date.parse(job.deadlineAt) ? job.deadlineAt : candidate;
}

export function inspectRelayFile(
  job,
  { pendingDir = RELAY_PENDING_DIR, now = new Date(), settleMs = RELAY_SETTLE_MS, maxSettleRetries = RELAY_SETTLE_MAX_RETRIES } = {},
) {
  const absolute = join(pendingDir, job.fileName);
  if (!existsSync(absolute)) return { kind: 'missing', path: absolute };
  const stat = statSync(absolute);
  if (stat.size <= 0) return { kind: 'empty', path: absolute, size: 0, mtimeMs: stat.mtimeMs };
  const ageMs = toDate(now).getTime() - stat.mtimeMs;
  if (ageMs < settleMs && job.settleRetries < maxSettleRetries) {
    return { kind: 'settling', path: absolute, size: stat.size, mtimeMs: stat.mtimeMs, ageMs };
  }
  return { kind: 'ready', path: absolute, size: stat.size, mtimeMs: stat.mtimeMs, ageMs };
}

function relayNotificationPath(taskId, notificationDir) {
  return join(notificationDir, `${safeTaskId(taskId)}.json`);
}

function relayNotificationMarkdownPath(taskId, notificationDir) {
  return join(notificationDir, `${safeTaskId(taskId)}.md`);
}

export function readRelayNotification(taskId, { notificationDir = RELAY_NOTIFICATIONS_DIR } = {}) {
  const file = relayNotificationPath(taskId, notificationDir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function writeRelayNotification({ job, archivedFile, size, sha256, now, notificationDir }) {
  mkdirSync(notificationDir, { recursive: true });
  const jsonPath = relayNotificationPath(job.taskId, notificationDir);
  const mdPath = relayNotificationMarkdownPath(job.taskId, notificationDir);
  const existing = readRelayNotification(job.taskId, { notificationDir });
  if (existing) return existing;

  const notification = {
    taskId: job.taskId,
    profile: job.profile,
    state: 'unread',
    file: job.file,
    archivedFile,
    size,
    sha256,
    notifiedAt: toIso(now),
    readAt: null,
  };
  writeJsonAtomic(jsonPath, notification);
  const markdown = [
    `# Relay 回执已到达：${job.taskId}`,
    '',
    `- 档位：${job.profile}`,
    `- 原文件：${job.file}`,
    `- 归档文件：${archivedFile}`,
    `- 大小：${size} bytes`,
    `- SHA-256：${sha256}`,
    `- 到达时间：${toIso(now)}`,
    '',
    '请主控读取归档文件并摘要给用户；验收仍走既有回执链。',
    '',
  ].join('\n');
  writeFileSync(mdPath, markdown, 'utf8');
  return notification;
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function archiveRelayFile(source, { archiveDir = RELAY_ARCHIVE_DIR, now = new Date() } = {}) {
  mkdirSync(archiveDir, { recursive: true });
  let target = join(archiveDir, basename(source));
  if (existsSync(target)) {
    const stamp = toIso(now).replace(/[:.]/g, '-');
    target = join(archiveDir, `${basename(source, '.md')}-${stamp}.md`);
  }
  try {
    renameSync(source, target);
  } catch {
    copyFileSync(source, target);
    unlinkSync(source);
  }
  return target;
}

function appendAudit({ taskId, action, detail = {}, file = RELAY_AUDIT_FILE, at = new Date() }) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: toIso(at), taskId, action, detail })}\n`, 'utf8');
}

/**
 * 处理单个 job。调用方负责持久化 state；本函数只做检查、归档、通知与状态变更。
 * @returns {{kind:string, taskId:string, file?:string, archivedFile?:string, reason?:string}}
 */
export function processRelayJob({
  job,
  state,
  now = new Date(),
  pendingDir = RELAY_PENDING_DIR,
  archiveDir = RELAY_ARCHIVE_DIR,
  notificationDir = RELAY_NOTIFICATIONS_DIR,
  auditFile = RELAY_AUDIT_FILE,
  settleMs = RELAY_SETTLE_MS,
  maxSettleRetries = RELAY_SETTLE_MAX_RETRIES,
}) {
  void state;
  if (job.state !== 'pending') return { kind: 'skipped', taskId: job.taskId };
  const current = toDate(now);
  const existingNotification = readRelayNotification(job.taskId, { notificationDir });

  if (existingNotification) {
    // 崩溃恢复：通知已落盘但账本未写。原文件若仍在 pending，补一次归档。
    const absolute = join(pendingDir, job.fileName);
    if (existsSync(absolute)) {
      archiveRelayFile(absolute, { archiveDir, now: current });
    }
    job.state = 'notified';
    job.notifiedAt = job.notifiedAt ?? existingNotification.notifiedAt;
    job.archivedFile = job.archivedFile ?? existingNotification.archivedFile;
    job.nextCheckAt = null;
    pushHistory(job, current, 'notified-recovered', { archivedFile: job.archivedFile });
    appendAudit({
      taskId: job.taskId,
      action: 'notified-recovered',
      detail: { archivedFile: job.archivedFile },
      file: auditFile,
      at: current,
    });
    return { kind: 'notified', taskId: job.taskId, archivedFile: job.archivedFile, recovered: true };
  }

  const inspection = inspectRelayFile(job, { pendingDir, now: current, settleMs, maxSettleRetries });

  if (inspection.kind === 'ready') {
    const sha256 = sha256File(inspection.path);
    const archivedAbsolute = archiveRelayFile(inspection.path, { archiveDir, now: current });
    const archivedFile = toDisplayPath(archivedAbsolute);
    const notification = writeRelayNotification({
      job,
      archivedFile,
      size: inspection.size,
      sha256,
      now: current,
      notificationDir,
    });
    job.state = 'notified';
    job.notifiedAt = notification.notifiedAt;
    job.archivedFile = archivedFile;
    job.attempts += 1;
    job.lastCheckAt = toIso(current);
    job.lastResult = 'notified';
    job.nextCheckAt = null;
    pushHistory(job, current, 'notified', { archivedFile, size: inspection.size, sha256 });
    appendAudit({
      taskId: job.taskId,
      action: 'notified',
      detail: { archivedFile, size: inspection.size, sha256 },
      file: auditFile,
      at: current,
    });
    return { kind: 'notified', taskId: job.taskId, archivedFile, size: inspection.size, sha256 };
  }

  const deadlineMs = Date.parse(job.deadlineAt);
  if (current.getTime() >= deadlineMs) {
    job.state = 'timed-out';
    job.attempts += 1;
    job.lastCheckAt = toIso(current);
    job.lastResult = 'timed-out';
    job.nextCheckAt = null;
    pushHistory(job, current, 'timed-out', { deadlineAt: job.deadlineAt, lastInspection: inspection.kind });
    appendAudit({
      taskId: job.taskId,
      action: 'timed-out',
      detail: { deadlineAt: job.deadlineAt, lastInspection: inspection.kind },
      file: auditFile,
      at: current,
    });
    return { kind: 'timed-out', taskId: job.taskId, reason: 'deadline-reached' };
  }

  if (inspection.kind === 'settling') {
    job.settleRetries += 1;
    job.lastCheckAt = toIso(current);
    job.lastResult = 'settling';
    job.nextCheckAt = new Date(current.getTime() + 2000).toISOString();
    pushHistory(job, current, 'settling', { size: inspection.size, ageMs: inspection.ageMs });
    appendAudit({
      taskId: job.taskId,
      action: 'settling',
      detail: { size: inspection.size, ageMs: inspection.ageMs },
      file: auditFile,
      at: current,
    });
    return { kind: 'settling', taskId: job.taskId };
  }

  job.attempts += 1;
  job.lastCheckAt = toIso(current);
  job.lastResult = inspection.kind;
  scheduleNextCheck(job, current, nextIntervalMinutes(job));
  pushHistory(job, current, inspection.kind === 'empty' ? 'empty' : 'missing', { nextCheckAt: job.nextCheckAt });
  appendAudit({
    taskId: job.taskId,
    action: inspection.kind === 'empty' ? 'empty' : 'missing',
    detail: { nextCheckAt: job.nextCheckAt },
    file: auditFile,
    at: current,
  });
  return { kind: inspection.kind, taskId: job.taskId, nextCheckAt: job.nextCheckAt };
}

export function runRelayTick({
  stateFile = RELAY_STATE_FILE,
  now = new Date(),
  pendingDir = RELAY_PENDING_DIR,
  archiveDir = RELAY_ARCHIVE_DIR,
  notificationDir = RELAY_NOTIFICATIONS_DIR,
  auditFile = RELAY_AUDIT_FILE,
  settleMs = RELAY_SETTLE_MS,
  maxSettleRetries = RELAY_SETTLE_MAX_RETRIES,
} = {}) {
  const state = readRelayState(stateFile);
  const current = toDate(now);
  const results = [];
  for (const job of state.jobs) {
    if (!isRelayJobDue(job, current)) continue;
    results.push(
      processRelayJob({
        job,
        state,
        now: current,
        pendingDir,
        archiveDir,
        notificationDir,
        auditFile,
        settleMs,
        maxSettleRetries,
      }),
    );
  }
  if (results.length > 0) saveRelayState(stateFile, state);
  return {
    checked: results.length,
    notified: results.filter((item) => item.kind === 'notified').length,
    timeouts: results.filter((item) => item.kind === 'timed-out').length,
    pending: state.jobs.filter((job) => job.state === 'pending').length,
    results,
  };
}

export function runRegisteredRelayJobs({
  taskIds,
  stateFile = RELAY_STATE_FILE,
  now = new Date(),
  pendingDir = RELAY_PENDING_DIR,
  archiveDir = RELAY_ARCHIVE_DIR,
  notificationDir = RELAY_NOTIFICATIONS_DIR,
  auditFile = RELAY_AUDIT_FILE,
  settleMs = RELAY_SETTLE_MS,
  maxSettleRetries = RELAY_SETTLE_MAX_RETRIES,
} = {}) {
  const state = readRelayState(stateFile);
  const ids = new Set(taskIds ?? []);
  const results = [];
  for (const job of state.jobs) {
    if (!ids.has(job.taskId) || job.state !== 'pending') continue;
    results.push(processRelayJob({ job, state, now, pendingDir, archiveDir, notificationDir, auditFile, settleMs, maxSettleRetries }));
  }
  if (results.length > 0) saveRelayState(stateFile, state);
  return { checked: results.length, results };
}

export function listRelayJobs({ stateFile = RELAY_STATE_FILE } = {}) {
  return readRelayState(stateFile).jobs;
}

export function listRelayNotifications({ notificationDir = RELAY_NOTIFICATIONS_DIR, unreadOnly = false } = {}) {
  if (!existsSync(notificationDir)) return [];
  const notifications = [];
  for (const fileName of readdirSync(notificationDir)) {
    if (!fileName.endsWith('.json')) continue;
    try {
      const notification = JSON.parse(readFileSync(join(notificationDir, fileName), 'utf8').replace(/^\uFEFF/, ''));
      if (unreadOnly && notification.state !== 'unread') continue;
      notifications.push(notification);
    } catch {
      // 通知文件损坏不应阻塞 inbox；跳过并保留现场。
    }
  }
  return notifications.sort((a, b) => String(b.notifiedAt).localeCompare(String(a.notifiedAt)));
}

export function markRelayNotificationRead(taskId, { notificationDir = RELAY_NOTIFICATIONS_DIR, now = new Date() } = {}) {
  const notification = readRelayNotification(taskId, { notificationDir });
  if (!notification) return null;
  const next = { ...notification, state: 'read', readAt: toIso(now) };
  writeJsonAtomic(relayNotificationPath(taskId, notificationDir), next);
  return next;
}

export function ackRelayJob({
  taskId,
  stateFile = RELAY_STATE_FILE,
  notificationDir = RELAY_NOTIFICATIONS_DIR,
  auditFile = RELAY_AUDIT_FILE,
  now = new Date(),
} = {}) {
  const state = readRelayState(stateFile);
  const job = state.jobs.find((item) => item.taskId === taskId);
  if (!job) throw new Error(`没有该 relay job：${taskId}`);
  state.jobs = state.jobs.filter((item) => item.taskId !== taskId);
  saveRelayState(stateFile, state);
  markRelayNotificationRead(taskId, { notificationDir, now });
  appendAudit({ taskId, action: 'acknowledged', detail: { previousState: job.state }, file: auditFile, at: now });
  return { taskId, previousState: job.state };
}

export function cancelRelayJob({ taskId, stateFile = RELAY_STATE_FILE, auditFile = RELAY_AUDIT_FILE, now = new Date() } = {}) {
  const state = readRelayState(stateFile);
  const job = state.jobs.find((item) => item.taskId === taskId);
  if (!job) throw new Error(`没有该 relay job：${taskId}`);
  if (job.state === 'pending') {
    job.state = 'canceled';
    job.nextCheckAt = null;
    pushHistory(job, now, 'canceled');
  }
  saveRelayState(stateFile, state);
  appendAudit({ taskId, action: 'canceled', detail: {}, file: auditFile, at: now });
  return { taskId, state: job.state };
}

function withRegistryLock(fn) {
  const lock = acquireRunLock({ dir: RELAY_REGISTRY_LOCK_DIR, staleMs: 15_000, actor: 'relay-registry' });
  if (!lock.acquired) {
    throw new Error(`relay 账本被占用：${JSON.stringify(lock.holder)}`);
  }
  try {
    return fn();
  } finally {
    lock.release();
  }
}

export function registerRelayJob({
  taskId,
  file,
  profile = DEFAULT_RELAY_PROFILE,
  deadline = null,
  stateFile = RELAY_STATE_FILE,
  auditFile = RELAY_AUDIT_FILE,
  now = new Date(),
} = {}) {
  return withRegistryLock(() => {
    const state = readRelayState(stateFile);
    const existing = state.jobs.find((job) => job.taskId === taskId);
    if (existing && existing.state === 'pending') throw new Error(`该任务已有在途 relay job：${taskId}`);
    if (existing) state.jobs = state.jobs.filter((job) => job.taskId !== taskId);
    const job = buildRelayJob({ taskId, file, profile, deadline, now });
    state.jobs.push(job);
    saveRelayState(stateFile, state);
    appendAudit({
      taskId: job.taskId,
      action: 'registered',
      detail: { profile: job.profile, file: job.file, deadlineAt: job.deadlineAt },
      file: auditFile,
      at: now,
    });
    return job;
  });
}

/**
 * 常驻 supervisor：事件监听 + 到期兜底。
 * 返回 stop() 供测试 / 信号处理；CLI watch 依赖内部 interval 保持进程存活。
 */
export async function watchRelaySupervisor({
  stateFile = RELAY_STATE_FILE,
  pendingDir = RELAY_PENDING_DIR,
  archiveDir = RELAY_ARCHIVE_DIR,
  notificationDir = RELAY_NOTIFICATIONS_DIR,
  auditFile = RELAY_AUDIT_FILE,
  lockDir = RELAY_SUPERVISOR_LOCK_DIR,
  debounceMs = RELAY_WATCH_DEBOUNCE_MS,
  intervalMs = RELAY_WATCH_INTERVAL_MS,
  settleMs = RELAY_SETTLE_MS,
  maxSettleRetries = RELAY_SETTLE_MAX_RETRIES,
  logger = console,
} = {}) {
  const lock = acquireRunLock({ dir: lockDir, staleMs: 15 * 60_000, actor: 'relay-supervisor' });
  if (!lock.acquired) throw new Error(`已有 relay supervisor 在运行：${JSON.stringify(lock.holder)}`);
  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(notificationDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  let stopped = false;
  const timers = new Set();

  const runDue = () => {
    if (stopped) return;
    try {
      const summary = runRelayTick({
        stateFile,
        now: new Date(),
        pendingDir,
        archiveDir,
        notificationDir,
        auditFile,
        settleMs,
        maxSettleRetries,
      });
      if (summary.notified || summary.timeouts) {
        logger.log(
          `[relay] tick checked=${summary.checked} notified=${summary.notified} timeouts=${summary.timeouts} pending=${summary.pending}`,
        );
      }
    } catch (err) {
      logger.error(`[relay] tick failed: ${err.message}`);
    }
  };

  const runMatching = (fileNames) => {
    if (stopped) return;
    try {
      const state = readRelayState(stateFile);
      const ids = state.jobs.filter((job) => job.state === 'pending' && fileNames.has(job.fileName)).map((job) => job.taskId);
      if (!ids.length) return;
      const summary = runRegisteredRelayJobs({
        taskIds: ids,
        stateFile,
        now: new Date(),
        pendingDir,
        archiveDir,
        notificationDir,
        auditFile,
        settleMs,
        maxSettleRetries,
      });
      if (summary.checked) logger.log(`[relay] event checked=${summary.checked} files=${[...fileNames].join(',')}`);
    } catch (err) {
      logger.error(`[relay] event failed: ${err.message}`);
    }
  };

  const watcher = createWatcher({
    dirs: [pendingDir],
    debounceMs,
    onChange: (events) => {
      const names = new Set(events.map((event) => basename(event.path ?? '')));
      if (!names.size) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        runMatching(names);
      }, settleMs);
      timers.add(timer);
    },
    onError: (err) => logger.error(`[relay] watcher failed: ${err.message}`),
  });

  const timer = setInterval(runDue, intervalMs);
  timer.unref?.();
  runDue();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const pendingTimer of timers) clearTimeout(pendingTimer);
    timers.clear();
    watcher.stop();
    lock.release();
  };

  logger.log(`[relay] watching ${toDisplayPath(pendingDir)} interval=${intervalMs}ms`);
  return { stop, lock, watcher, timer, runDue };
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (!value || value === true) throw new Error(`缺少参数 --${name}`);
  return String(value);
}

function formatJob(job) {
  return [
    job.taskId,
    `[${job.state}]`,
    `profile=${job.profile}`,
    `file=${job.fileName}`,
    job.nextCheckAt ? `next=${job.nextCheckAt}` : 'next=-',
    `attempts=${job.attempts}`,
    `deadline=${job.deadlineAt}`,
  ].join(' ');
}

function printHelp() {
  console.log(`Relay Supervisor（AF-069）

用法：
  node scripts/orchestration/relay-supervisor.mjs register --taskId AF-0xx --file docs/worklog/pending/relay-response-AF-0xx-YYYYMMDD-HHMM.md [--profile S|M|L|XL] [--deadline ISO]
  node scripts/orchestration/relay-supervisor.mjs list [--json]
  node scripts/orchestration/relay-supervisor.mjs tick
  node scripts/orchestration/relay-supervisor.mjs watch
  node scripts/orchestration/relay-supervisor.mjs inbox [--unread] [--json]
  node scripts/orchestration/relay-supervisor.mjs ack --taskId AF-0xx
  node scripts/orchestration/relay-supervisor.mjs cancel --taskId AF-0xx

说明：事件优先，兜底按 profile 的 10–15 分钟档位；不创建永久 cron，不扫描无关回执。`);
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseFlags(argv);
  const command = flags._[0] ?? 'help';

  if (command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'register') {
    const taskId = requireFlag(flags, 'taskId');
    const file = requireFlag(flags, 'file');
    const job = registerRelayJob({ taskId, file, profile: flags.profile ?? DEFAULT_RELAY_PROFILE, deadline: flags.deadline ?? null });
    console.log(`[relay] registered ${formatJob(job)}`);
    return;
  }

  if (command === 'list') {
    const jobs = listRelayJobs();
    if (flags.json) {
      console.log(JSON.stringify(jobs, null, 2));
      return;
    }
    if (!jobs.length) {
      console.log('[relay] 没有 relay job');
      return;
    }
    for (const job of jobs) console.log(formatJob(job));
    return;
  }

  if (command === 'tick') {
    const summary = withRegistryLock(() => runRelayTick());
    console.log(
      `[relay] tick checked=${summary.checked} notified=${summary.notified} timeouts=${summary.timeouts} pending=${summary.pending}`,
    );
    return;
  }

  if (command === 'watch') {
    const controller = await watchRelaySupervisor();
    const shutdown = () => {
      controller.stop();
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  if (command === 'inbox') {
    const notifications = listRelayNotifications({ unreadOnly: Boolean(flags.unread) });
    if (flags.json) {
      console.log(JSON.stringify(notifications, null, 2));
      return;
    }
    if (!notifications.length) {
      console.log('[relay] inbox 为空');
      return;
    }
    for (const notification of notifications) {
      console.log(
        `${notification.taskId} [${notification.state}] ${notification.file} -> ${notification.archivedFile} (${notification.size} bytes, ${notification.notifiedAt})`,
      );
    }
    return;
  }

  if (command === 'ack') {
    const taskId = requireFlag(flags, 'taskId');
    const result = withRegistryLock(() => ackRelayJob({ taskId }));
    console.log(`[relay] ack ${taskId}（previous=${result.previousState}）`);
    return;
  }

  if (command === 'cancel') {
    const taskId = requireFlag(flags, 'taskId');
    const result = withRegistryLock(() => cancelRelayJob({ taskId }));
    console.log(`[relay] cancel ${taskId}（state=${result.state}）`);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`[relay] ${err.message}`);
    process.exitCode = 1;
  });
}
