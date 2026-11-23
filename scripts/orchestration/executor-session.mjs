/**
 * AF-365 · 执行器会话心跳（框架 v2.1 executor-session 1.0.0）。
 *
 * 区分「投递证据」与「执行存活证据」：
 *   - GUI 窗口 PID / HWND / 焦点只证明 brief 被送到某个窗口，不证明执行体还活着；
 *   - 只有 session 的 heartbeatAt / leaseExpiresAt 才能判定 active / lost；
 *   - 终态必须写 terminalAt，且不得继续 heartbeat。
 */
import { existsSync, readFileSync } from 'node:fs';

export const SESSION_STATUSES = ['starting', 'active', 'blocked', 'completed', 'failed', 'lost', 'canceled'];
export const TERMINAL_STATUSES = ['completed', 'failed', 'lost', 'canceled'];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isValidIso(value) {
  return typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * 新建会话。leaseMinutes 默认 15；starting 会话也必须有 heartbeatAt，避免“只写 start 不写心跳”。
 * @param {{sessionId:string, taskId:string, executor:string, now?:string, leaseMinutes?:number}} input
 */
export function createSession({ sessionId, taskId, executor, now = new Date().toISOString(), leaseMinutes = 15 }) {
  if (!sessionId || !taskId || !executor) throw new Error('sessionId / taskId / executor 必填');
  if (!isValidIso(now)) throw new Error(`now 不是合法 ISO 时间：${now}`);
  if (!Number.isFinite(leaseMinutes) || leaseMinutes <= 0) throw new Error('leaseMinutes 必须为正数');
  const startedAt = now;
  const heartbeatAt = now;
  const leaseExpiresAt = new Date(Date.parse(now) + leaseMinutes * 60_000).toISOString();
  return {
    contractRef: 'urn:agent-collaboration-framework:schema:executor-session:1.0.0',
    sessionId,
    taskId,
    executor,
    status: 'starting',
    startedAt,
    heartbeatAt,
    leaseExpiresAt,
    progressPercent: null,
    progressNote: null,
    cancelRequestedAt: null,
    terminalAt: null,
    artifactRefs: [],
    evidenceRef: null,
    note: null,
  };
}

/**
 * 确认投递：starting → active，同时刷新心跳与租约。ack 是「执行体已接手」的事实，
 * 不是 GUI 窗口焦点证据。
 */
export function ackSession(session, { now = new Date().toISOString(), leaseMinutes, note } = {}) {
  if (session?.status !== 'starting') throw new Error(`只有 starting 会话可 ack：${session?.status}`);
  return heartbeatSession(session, { now, status: 'active', leaseMinutes, note });
}

/**
 * 进度上报。progress 同时是存活事实：刷新 heartbeatAt 与租约，避免长任务被误判 lost。
 * 百分比必须是 0–100 的整数或 null；null 表示没有可靠进度，不允许编造。
 */
export function progressSession(
  session,
  { now = new Date().toISOString(), progressPercent = session?.progressPercent ?? null, progressNote = null, artifactRefs, evidenceRef, leaseMinutes } = {},
) {
  if (isTerminal(session?.status)) throw new Error(`终态会话不得上报进度：${session.status}`);
  if (progressPercent !== null && (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100)) {
    throw new Error(`progressPercent 必须是 0-100 整数或 null：${progressPercent}`);
  }
  if (progressPercent !== null && session.progressPercent !== null && progressPercent < session.progressPercent) {
    throw new Error(`progressPercent 不得回退：${session.progressPercent} → ${progressPercent}`);
  }
  const next = heartbeatSession(session, { now, status: 'active', leaseMinutes, note: progressNote });
  const nextArtifacts = artifactRefs === undefined ? [...(session.artifactRefs ?? [])] : [...artifactRefs];
  return {
    ...next,
    progressPercent,
    progressNote: progressNote ?? next.progressNote ?? null,
    artifactRefs: nextArtifacts,
    evidenceRef: evidenceRef === undefined ? (session.evidenceRef ?? null) : evidenceRef,
  };
}

/**
 * 编排侧请求取消。只写 cancelRequestedAt，不直接改终态；
 * 执行器必须在下一个心跳点确认（terminal canceled）或给出拒绝理由。
 */
export function requestCancel(session, { now = new Date().toISOString(), note = null } = {}) {
  if (!isValidIso(now)) throw new Error(`now 不是合法 ISO 时间：${now}`);
  if (isTerminal(session?.status)) throw new Error(`终态会话不得再请求取消：${session.status}`);
  return {
    ...session,
    cancelRequestedAt: now,
    status: session.status === 'starting' ? 'blocked' : session.status,
    note: note ?? session.note ?? null,
  };
}

/**
 * 心跳。终态会话拒绝继续心跳；时间必须单调。
 * @param {object} session
 * @param {{now?:string, status?:string, leaseMinutes?:number, note?:string}} input
 */
export function heartbeatSession(session, { now = new Date().toISOString(), status, leaseMinutes, note } = {}) {
  if (!isValidIso(now)) throw new Error(`now 不是合法 ISO 时间：${now}`);
  if (isTerminal(session?.status)) throw new Error(`终态会话不得继续心跳：${session.status}`);
  const previous = Date.parse(session?.heartbeatAt ?? '');
  if (Number.isNaN(previous)) throw new Error('会话 heartbeatAt 缺失或非法');
  if (Date.parse(now) < previous) throw new Error('heartbeatAt 不得回退');
  const nextStatus = status ?? session.status ?? 'active';
  if (!SESSION_STATUSES.includes(nextStatus) || isTerminal(nextStatus)) throw new Error(`非终态心跳状态非法：${nextStatus}`);
  const nextLeaseMinutes = leaseMinutes ?? Math.max(1, Math.round((Date.parse(session.leaseExpiresAt) - previous) / 60_000));
  return {
    ...session,
    status: nextStatus,
    heartbeatAt: now,
    leaseExpiresAt: new Date(Date.parse(now) + nextLeaseMinutes * 60_000).toISOString(),
    note: note ?? session.note ?? null,
  };
}

/**
 * 终止会话。terminalAt 必填且不得早于 heartbeatAt。
 * @param {object} session
 * @param {{now?:string, status:string, note?:string}} input
 */
export function terminalSession(session, { now = new Date().toISOString(), status, note } = {}) {
  if (!TERMINAL_STATUSES.includes(status)) throw new Error(`终态必须为 ${TERMINAL_STATUSES.join(' / ')}`);
  if (!isValidIso(now)) throw new Error(`now 不是合法 ISO 时间：${now}`);
  if (Date.parse(now) < Date.parse(session?.heartbeatAt ?? '')) throw new Error('terminalAt 不得早于 heartbeatAt');
  return { ...session, status, terminalAt: now, note: note ?? session.note ?? null };
}

/**
 * 判定会话健康度：
 *   - 终态：检查 terminalAt 自洽；
 *   - 非终态：now > leaseExpiresAt 判 lost；now 接近租约（剩余 < 20%）判 lease-warning。
 * @param {object} session
 * @param {{now?:string}} input
 */
export function evaluateSession(session, { now = new Date().toISOString() } = {}) {
  const errors = [];
  const started = Date.parse(session?.startedAt ?? '');
  const heartbeat = Date.parse(session?.heartbeatAt ?? '');
  const lease = Date.parse(session?.leaseExpiresAt ?? '');
  const current = Date.parse(now);
  if (!SESSION_STATUSES.includes(session?.status)) errors.push(`status 非法：${session?.status}`);
  if (Number.isNaN(started) || Number.isNaN(heartbeat) || Number.isNaN(lease)) errors.push('时间字段缺失或非法');
  if (!Number.isNaN(started) && !Number.isNaN(heartbeat) && started > heartbeat) errors.push('startedAt > heartbeatAt');
  if (!Number.isNaN(heartbeat) && !Number.isNaN(lease) && heartbeat > lease) errors.push('heartbeatAt > leaseExpiresAt');
  if (isTerminal(session?.status)) {
    if (!isValidIso(session?.terminalAt)) errors.push('终态缺 terminalAt');
    else if (Date.parse(session.terminalAt) < heartbeat) errors.push('terminalAt < heartbeatAt');
    return { state: errors.length ? 'invalid' : 'terminal', errors };
  }
  if (Number.isNaN(current)) errors.push('now 非法');
  if (errors.length) return { state: 'invalid', errors };
  if (current > lease) return { state: 'lost', errors: [], reason: `心跳超租约 ${Math.round((current - lease) / 1000)}s` };
  if (lease - current < (lease - heartbeat) * 0.2) {
    return { state: 'lease-warning', errors: [], reason: '剩余租约不足 20%，需要尽快心跳' };
  }
  return { state: 'active', errors: [] };
}

/** 从 JSON 文件读取会话（不存在返回 null，损坏抛错，不静默当空）。 */
export function readSessionFile(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}
