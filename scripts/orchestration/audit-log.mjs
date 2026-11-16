/**
 * AF-007 · 工具调用审计台账（adapter 层扩展）。
 *
 * 职责：记录工具注册表每次调用（允许 / 拒绝）的审计痕迹，对齐框架
 * tool-contract schema 的 audit 字段组（actorRef / correlationId / recordedAt），
 * resources 与作用任务作为 adapter 附加字段。审计是只追加日志，不修改历史条目。
 *
 * 边界：本模块只做记录、去重与只读投影；权限收口在 tool-registry.mjs。
 * 审计日志独立落 `tool-audit-log.json`，不污染状态索引契约。
 */
import { existsSync, readFileSync } from 'node:fs';
import { PATHS, nowIso, writeJsonAtomic } from './state-store.mjs';

/** 空审计日志骨架。 */
function emptyLog() {
  return { schemaVersion: '1.0.0', updatedAt: null, audits: [] };
}

function readJson(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 加载审计日志；缺省返回空骨架并归一化 audits 数组。 */
export function loadAuditLog() {
  const raw = readJson(PATHS.auditLog) ?? emptyLog();
  if (!Array.isArray(raw.audits)) raw.audits = [];
  raw.schemaVersion = raw.schemaVersion ?? '1.0.0';
  return raw;
}

/** 保存审计日志（原子写）。 */
export function saveAuditLog(log) {
  log.updatedAt = nowIso();
  writeJsonAtomic(PATHS.auditLog, log);
  return log;
}

/** 下一审计编号：AUD-001 起，按既有最大序号递增。 */
function nextAuditId(audits) {
  let max = 0;
  for (const entry of audits) {
    const match = /^AUD-(\d+)$/.exec(entry.auditId ?? '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `AUD-${String(max + 1).padStart(3, '0')}`;
}

/**
 * 去重签名：调用方 + 关联标识 + 工具 + 结果；同一调用重复登记不重复落条（时间戳不参与判重）。
 */
function dedupeKey(entry) {
  return [entry.actorRef, entry.correlationId ?? '', entry.toolId, entry.result].join('|');
}

function normalizeResources(resources) {
  return Array.isArray(resources) ? resources.filter((r) => typeof r === 'string' && r.trim() !== '') : [];
}

/**
 * 登记一条审计记录（只追加）。
 * @param {object} log 审计日志（loadAuditLog 返回对象）
 * @param {object} raw { actorRef, correlationId?, toolId, category?, sideEffect?, resources?, taskId?, result, reason? }
 * @returns {object} 落库后的审计条目；命中去重签名时返回既有条目
 */
export function recordAudit(log, raw) {
  if (!raw.actorRef || typeof raw.actorRef !== 'string') throw new Error('审计记录缺 actorRef');
  if (!raw.toolId || typeof raw.toolId !== 'string') throw new Error('审计记录缺 toolId');
  if (raw.result !== 'allowed' && raw.result !== 'denied') throw new Error(`审计结果非法：${String(raw.result)}`);

  const now = nowIso();
  const entry = {
    auditId: nextAuditId(log.audits),
    actorRef: raw.actorRef,
    correlationId: raw.correlationId ? String(raw.correlationId) : null,
    toolId: raw.toolId,
    category: raw.category ?? null,
    sideEffect: raw.sideEffect ?? null,
    resources: normalizeResources(raw.resources),
    taskId: raw.taskId ? String(raw.taskId) : null,
    result: raw.result,
    reason: raw.reason ?? null,
    recordedAt: now,
  };

  const seen = new Set(log.audits.map((e) => dedupeKey(e)));
  if (seen.has(dedupeKey(entry))) {
    return log.audits.find((e) => dedupeKey(e) === dedupeKey(entry)) ?? entry;
  }

  log.audits.push(entry);
  log.updatedAt = now;
  return entry;
}

/**
 * 审计只读投影（供快照 / CLI / 网页视图）：默认倒序最近 limit 条，只保留展示字段。
 * @param {object} log 审计日志
 * @param {{limit?: number, toolId?: string, taskId?: string, result?: string}} opts
 * @returns {object[]}
 */
export function listAudits(log, opts = {}) {
  const { limit = 20, toolId, taskId, result } = opts;
  let rows = [...log.audits];
  if (toolId) rows = rows.filter((e) => e.toolId === toolId);
  if (taskId) rows = rows.filter((e) => e.taskId === taskId);
  if (result) rows = rows.filter((e) => e.result === result);
  rows.sort((a, b) => String(b.recordedAt ?? '').localeCompare(String(a.recordedAt ?? '')));
  return rows.slice(0, limit).map((e) => ({
    auditId: e.auditId,
    recordedAt: e.recordedAt,
    actorRef: e.actorRef,
    correlationId: e.correlationId,
    toolId: e.toolId,
    category: e.category,
    sideEffect: e.sideEffect,
    taskId: e.taskId,
    result: e.result,
    reason: e.reason,
    resources: e.resources,
  }));
}

/** 审计汇总计数（按工具、结果、角色）。 */
export function summarizeAudits(log) {
  const byResult = { allowed: 0, denied: 0 };
  const byTool = {};
  const byActor = {};
  for (const e of log.audits) {
    byResult[e.result] = (byResult[e.result] ?? 0) + 1;
    byTool[e.toolId] = (byTool[e.toolId] ?? 0) + 1;
    byActor[e.actorRef] = (byActor[e.actorRef] ?? 0) + 1;
  }
  return { total: log.audits.length, byResult, byTool, byActor };
}
