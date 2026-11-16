/**
 * 状态事件存储（框架 2.0.0 state-event 1.0.0）。
 *
 * 单一写面：`docs/team/agent-orchestration/state/journal.jsonl`，append-only。
 * 只读投影：`task-state-index.json`，由本模块从日志重建；带 projection 块后禁止手改。
 *
 * 适配层扩展：
 *   - `archivedNotes` 外移到 `state/archived-notes.json`，重建时合并；
 *   - 每条事件追加 `prevHash` / `hash` 链，供 `verify` 检出篡改；
 *   - 事件载荷 `payload.task` 保留框架投影未覆盖的适配层字段（agentRole / groupId 等）。
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS, loadIndex, nowIso, writeJsonAtomic } from './state-store.mjs';
import { TRANSITIONS } from './contract-enums.mjs';
import { validateStateEvent } from './validator.mjs';

export const JOURNAL_POINTER = 'docs/team/agent-orchestration/state/journal.jsonl';
export const INDEX_NOTE =
  'L0 轻量 State Store：工件正文留在文件，本索引只存指针与状态。已启用事件溯源：state/journal.jsonl 为唯一写面，本索引是只读投影（projection 指向日志末条事件），禁止手改；归档条目只保留工件指针，逐条说明外移到 state/archived-notes.json 并在重建时合并。';

const STATUSES = [
  'backlog',
  'ready',
  'submitted',
  'working',
  'input-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
  'auth-required',
];
const TRANSITION_EXEMPT = new Set(['created', 'archived', 'dead-lettered']);

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeEvent(event) {
  return { ...event, payload: event.payload ?? {}, reason: event.reason ?? null };
}

function hashEvent(event, prevHash) {
  const material = { ...event };
  delete material.hash;
  delete material.prevHash;
  return sha256(`${prevHash}\n${stable(material)}`);
}

function taskSnapshot(task) {
  const snapshot = { ...task };
  delete snapshot.status;
  delete snapshot.history;
  return snapshot;
}

function withPrefix(prefix, message) {
  return `${prefix}${message}`;
}

/**
 * 读取事件日志；空文件返回 []，坏行直接抛错（不允许静默忽略）。
 */
export function loadJournal() {
  if (!existsSync(PATHS.journal)) return [];
  const text = readFileSync(PATHS.journal, 'utf8');
  const events = [];
  let lineNo = 0;
  for (const line of text.split(/\r?\n/)) {
    lineNo += 1;
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`事件日志第 ${lineNo} 行不是合法 JSON：${err.message}`);
    }
  }
  return events;
}

/** 事件日志完整性：序号 / ID / 幂等键 / 哈希链 / 同任务时间单调。 */
export function journalIntegrity(events) {
  const errors = [];
  let prevSeq = 0;
  let prevHash = 'GENESIS';
  const ids = new Set();
  const idems = new Set();
  const lastAtByTask = new Map();
  for (const [index, event] of events.entries()) {
    const at = `事件 ${index + 1}（${event.eventId ?? '?'}）`;
    if (!Number.isInteger(event.eventSeq) || event.eventSeq <= prevSeq) {
      errors.push(`${at}：eventSeq 必须严格递增，实际 ${event.eventSeq}（前一条 ${prevSeq}）`);
    } else if (event.eventSeq !== prevSeq + 1) {
      errors.push(`${at}：eventSeq 不连续，期望 ${prevSeq + 1}，实际 ${event.eventSeq}`);
    }
    if (!event.eventId || ids.has(event.eventId)) errors.push(`${at}：eventId 缺失或重复`);
    if (!event.idempotencyKey || idems.has(event.idempotencyKey)) errors.push(`${at}：idempotencyKey 缺失或重复`);
    if (event.prevHash !== prevHash) errors.push(`${at}：prevHash 断裂，期望 ${prevHash}，实际 ${String(event.prevHash)}`);
    const expected = hashEvent(event, event.prevHash ?? prevHash);
    if (event.hash !== expected) errors.push(`${at}：hash 不匹配，日志被改写或损坏`);
    if (!TRANSITION_EXEMPT.has(event.type)) {
      const allowed = TRANSITIONS[event.from] ?? [];
      if (!allowed.includes(event.to)) {
        errors.push(`${at}：非法状态迁移 ${event.from} → ${event.to}（${event.type}）`);
      }
    }
    if (event.taskId) {
      const lastAt = lastAtByTask.get(event.taskId);
      if (lastAt && new Date(event.at).getTime() < new Date(lastAt).getTime()) {
        errors.push(`${at}：同一任务 at 倒退（${lastAt} → ${event.at}）`);
      }
      lastAtByTask.set(event.taskId, event.at);
    }
    prevSeq = event.eventSeq;
    prevHash = event.hash ?? prevHash;
    ids.add(event.eventId);
    idems.add(event.idempotencyKey);
  }
  return { ok: errors.length === 0, errors };
}

/** 逐条做框架 state-event schema 校验。 */
export async function validateJournalSchema(events) {
  const errors = [];
  let schemaId = null;
  for (const [index, event] of events.entries()) {
    const res = await validateStateEvent(event);
    if (res.schemaId) schemaId = res.schemaId;
    if (res.skipped) {
      errors.push(`事件 ${index + 1}：state-event schema 不可达`);
      continue;
    }
    for (const err of res.errors) {
      errors.push(`事件 ${index + 1}（${event.eventId ?? '?'}）${err.instancePath || '/'}：${err.message}`);
    }
  }
  return { ok: errors.length === 0, errors, schemaId };
}

/**
 * 追加事件：锁 + 幂等 + 哈希链 + 连续序号。
 * @param {object[]} candidates 不含 eventId / eventSeq / prevHash / hash 的事件
 * @returns {object[]} 实际追加的事件
 */
export function appendEvents(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const dir = dirname(PATHS.journal);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lock = acquireLock();
  try {
    const existing = loadJournal();
    const last = existing[existing.length - 1];
    let seq = last?.eventSeq ?? 0;
    let prevHash = last?.hash ?? 'GENESIS';
    const idems = new Set(existing.map((event) => event.idempotencyKey));
    const lines = [];
    const appended = [];
    for (const candidate of candidates) {
      const idem = String(candidate.idempotencyKey ?? '');
      if (!idem) throw new Error('事件缺少 idempotencyKey');
      if (idems.has(idem)) continue;
      seq += 1;
      const event = {
        ...normalizeEvent(candidate),
        eventSeq: seq,
        eventId: `EV-${String(seq).padStart(4, '0')}`,
        prevHash,
      };
      delete event.hash;
      event.hash = hashEvent(event, prevHash);
      lines.push(JSON.stringify(event));
      appended.push(event);
      idems.add(idem);
      prevHash = event.hash;
    }
    if (lines.length > 0) {
      appendFileSync(PATHS.journal, `${lines.join('\n')}\n`, { encoding: 'utf8' });
    }
    return appended;
  } finally {
    releaseLock(lock);
  }
}

function acquireLock() {
  const lock = PATHS.journalLock;
  try {
    writeFileSync(lock, `${JSON.stringify({ pid: process.pid, at: nowIso() })}\n`, { encoding: 'utf8', flag: 'wx' });
    return lock;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let ageMs = 0;
    try {
      ageMs = Date.now() - statSync(lock).mtimeMs;
    } catch {
      ageMs = 0;
    }
    if (ageMs > 30_000) {
      try {
        unlinkSync(lock);
      } catch {
        // 竞态下另一个写者已清理；下一次重试会给出真实状态。
      }
      return acquireLock();
    }
    throw new Error(`事件日志被占用（锁 ${lock}，${Math.round(ageMs / 1000)}s），请稍后重试`);
  }
}

function releaseLock(lock) {
  try {
    unlinkSync(lock);
  } catch {
    // 锁已被外部清理；不影响已落盘事件。
  }
}

function eventTypeForTransition(from, to) {
  if (to === 'ready') return from === 'backlog' ? 'promoted' : 'released';
  if (to === 'submitted') return from === 'ready' ? 'claimed' : 'submitted';
  if (to === 'working') return from === 'input-required' ? 'resumed' : 'started';
  if (to === 'input-required') return 'interrupted';
  if (to === 'completed') return 'verified';
  if (to === 'rejected') return 'rejected';
  if (to === 'failed') return 'failed';
  if (to === 'canceled') return 'canceled';
  return 'submitted';
}

/** 构造 created 事件（to 取首条 history 的起点；无 history 时取当前状态）。 */
export function buildCreatedEvent(task, opts = {}) {
  const first = task.history?.[0];
  const from = first?.from ?? 'backlog';
  const to = first?.from ?? task.status ?? 'backlog';
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) throw new Error(`created 事件状态非法：${from} → ${to}`);
  return {
    taskId: task.taskId,
    type: 'created',
    from,
    to,
    by: opts.by ?? 'orchestrator-cli',
    at: task.createdAt ?? first?.at ?? opts.at ?? nowIso(),
    idempotencyKey: `${task.taskId}:created`,
    reason: null,
    payload: {
      contextId: task.contextId ?? null,
      type: task.type ?? null,
      title: task.title ?? null,
      baselineRef: task.baselineRef ?? null,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
      artifacts: task.artifacts ?? {},
      task: taskSnapshot(task),
    },
  };
}

/** 构造一条 history 迁移事件。 */
export function buildHistoryEvent(task, history, opts = {}) {
  const from = history.from;
  const to = history.to;
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) throw new Error(`迁移事件状态非法：${from} → ${to}`);
  return {
    taskId: task.taskId,
    type: eventTypeForTransition(from, to),
    from,
    to,
    by: history.by ?? opts.by ?? 'orchestrator-cli',
    at: history.at ?? opts.at ?? nowIso(),
    idempotencyKey: `${task.taskId}:${from}:${to}:${opts.index ?? 0}`,
    reason: history.reason ?? null,
    payload: {
      task: taskSnapshot(task),
      ...(to === 'input-required' ? { waitingOn: task.waitingOn ?? null, triggerReason: task.triggerReason ?? null } : {}),
      ...(to === 'completed' || to === 'rejected' || to === 'failed' ? { verdict: task.verdict ?? null } : {}),
    },
  };
}

/** 构造归档事件；归档终态由本事件携带，供投影落 status。 */
export function buildArchivedEvent(task, status, artifacts, opts = {}) {
  if (!['completed', 'failed', 'canceled', 'rejected'].includes(status)) throw new Error(`归档终态非法：${status}`);
  return {
    taskId: task.taskId,
    type: 'archived',
    from: task.status,
    to: status,
    by: opts.by ?? 'orchestrator-cli',
    at: opts.at ?? nowIso(),
    idempotencyKey: `${task.taskId}:archived`,
    reason: opts.note ?? '归档终态',
    payload: {
      artifacts: artifacts ?? task.artifacts ?? {},
      task: { ...taskSnapshot(task), artifacts: artifacts ?? task.artifacts ?? {} },
    },
  };
}

/**
 * 事件投影：纯函数，同输入必得同输出；rebuiltAt 恒为 null，保证逐字节可复现。
 * @param {object[]} events
 * @param {{journalPointer?:string, archivedNotes?:object, note?:string}} opts
 */
export function projectJournal(events, opts = {}) {
  const seenSeq = new Set();
  const seenIdem = new Set();
  const records = new Map();
  const order = [];
  const archived = [];

  for (const event of [...events].sort((a, b) => a.eventSeq - b.eventSeq)) {
    if (seenSeq.has(event.eventSeq)) throw new Error(`eventSeq 重复：${event.eventSeq}`);
    seenSeq.add(event.eventSeq);
    if (seenIdem.has(event.idempotencyKey)) continue;
    seenIdem.add(event.idempotencyKey);

    const { taskId, type, from, to, at, by, reason } = event;
    const payload = event.payload ?? {};
    if (type === 'created') {
      if (records.has(taskId)) throw new Error(`${taskId} 重复 created`);
      const rec = { taskId, status: to, history: [] };
      if (payload.task && typeof payload.task === 'object') Object.assign(rec, payload.task);
      for (const key of ['contextId', 'type', 'title', 'baselineRef', 'dependsOn', 'artifacts']) {
        if (payload[key] !== undefined) rec[key] = payload[key];
      }
      rec.taskId = taskId;
      rec.status = to;
      rec.history = [];
      rec.createdAt = at;
      records.set(taskId, rec);
      order.push(taskId);
      continue;
    }

    const rec = records.get(taskId);
    if (!rec) throw new Error(`${taskId} 的 ${type} 事件早于 created`);

    if (type === 'archived') {
      if (payload.artifacts) rec.artifacts = payload.artifacts;
      rec.status = to;
      archived.push({ taskId, status: to, artifacts: rec.artifacts ?? {} });
      records.delete(taskId);
      const idx = order.indexOf(taskId);
      if (idx >= 0) order.splice(idx, 1);
      continue;
    }

    rec.status = to;
    if (payload.task && typeof payload.task === 'object') Object.assign(rec, payload.task);
    if (payload.artifacts) rec.artifacts = payload.artifacts;
    if (payload.verdict) rec.verdict = payload.verdict;
    if (type === 'interrupted') {
      if (payload.waitingOn) rec.waitingOn = payload.waitingOn;
      if (payload.triggerReason) rec.triggerReason = payload.triggerReason;
    }
    if (type === 'resumed') {
      delete rec.waitingOn;
      delete rec.triggerReason;
    }
    rec.history = Array.isArray(rec.history) ? rec.history : [];
    rec.history.push({ at, from, to, by, reason: reason ?? null });
  }

  const lastEventSeq = events.length > 0 ? Math.max(...events.map((event) => event.eventSeq)) : 0;
  return {
    version: '1.1.0',
    schemaRef: 'urn:agent-collaboration-framework:schema:task-state-index:1.1.0',
    note: opts.note ?? INDEX_NOTE,
    projection: {
      journalPointer: opts.journalPointer ?? JOURNAL_POINTER,
      lastEventSeq,
      rebuiltAt: null,
    },
    tasks: order.map((taskId) => records.get(taskId)).filter(Boolean),
    archivedTasks: archived,
    archivedNotes: opts.archivedNotes ?? {},
  };
}

/** 读取归档说明侧车；缺失时回落到索引内的 archivedNotes。 */
export function loadArchivedNotes() {
  if (existsSync(PATHS.archivedNotes)) {
    const notes = readJson(PATHS.archivedNotes);
    if (notes && typeof notes === 'object' && !Array.isArray(notes)) return notes;
  }
  try {
    return loadIndex().archivedNotes ?? {};
  } catch {
    return {};
  }
}

/** 保存归档说明侧车。 */
export function saveArchivedNotes(notes) {
  writeJsonAtomic(PATHS.archivedNotes, notes ?? {});
}

/** 从日志重建索引（默认落盘）。 */
export function rebuildIndex(opts = {}) {
  const events = loadJournal();
  const notes = opts.archivedNotes ?? loadArchivedNotes();
  const index = projectJournal(events, { archivedNotes: notes, note: opts.note ?? INDEX_NOTE });
  if (opts.write !== false) writeJsonAtomic(PATHS.index, index);
  return index;
}

/** 校验当前索引与日志重建结果一致（忽略 rebuiltAt）。 */
export function verifyProjection() {
  const events = loadJournal();
  if (events.length === 0) return { ok: false, errors: ['事件日志为空，无法验证投影'], rebuilt: null };
  let rebuilt;
  try {
    rebuilt = projectJournal(events, { archivedNotes: loadArchivedNotes() });
  } catch (err) {
    return { ok: false, errors: [`投影失败：${err.message}`], rebuilt: null };
  }
  let current;
  try {
    current = loadIndex();
  } catch (err) {
    return { ok: false, errors: [`索引读取失败：${err.message}`], rebuilt };
  }
  const normalize = (index) => {
    const copy = JSON.parse(JSON.stringify(index));
    if (copy.projection && typeof copy.projection === 'object') copy.projection.rebuiltAt = null;
    return copy;
  };
  const a = stable(normalize(current));
  const b = stable(normalize(rebuilt));
  if (a === b) return { ok: true, errors: [], rebuilt };
  const errors = [];
  if (!current.projection) errors.push('索引缺 projection 块，可能仍是手改索引');
  else if (current.projection.lastEventSeq !== rebuilt.projection.lastEventSeq) {
    errors.push(`projection.lastEventSeq=${current.projection.lastEventSeq} 与日志末条 ${rebuilt.projection.lastEventSeq} 不一致`);
  }
  errors.push('索引内容与日志重建结果不一致（索引被手改或日志不完整）');
  return { ok: false, errors, rebuilt };
}

/** 历史索引回填：仅在日志为空时执行；每条归档任务生成 created + archived。 */
export function backfillJournalFromIndex(opts = {}) {
  const existing = loadJournal();
  if (existing.length > 0) return { ok: false, appended: 0, errors: [`事件日志非空（${existing.length} 条），拒绝重复回填`] };
  const index = loadIndex();
  const notes = index.archivedNotes ?? {};
  saveArchivedNotes(notes);
  const at = opts.at ?? '2026-11-16T00:00:00.000Z';
  const by = opts.by ?? 'AF-020-backfill';
  const candidates = [];
  for (const entry of index.archivedTasks ?? []) {
    const task = { taskId: entry.taskId, status: entry.status, artifacts: entry.artifacts ?? {} };
    candidates.push({
      taskId: entry.taskId,
      type: 'created',
      from: 'backlog',
      to: entry.status,
      by,
      at,
      idempotencyKey: `${entry.taskId}:backfill:created`,
      reason: '事件溯源基线回填（归档任务）',
      payload: { artifacts: entry.artifacts ?? {}, task: { artifacts: entry.artifacts ?? {} } },
    });
    candidates.push({
      taskId: entry.taskId,
      type: 'archived',
      from: entry.status,
      to: entry.status,
      by,
      at,
      idempotencyKey: `${entry.taskId}:backfill:archived`,
      reason: '事件溯源基线回填（归档任务）',
      payload: { artifacts: entry.artifacts ?? {} },
    });
  }
  const appended = appendEvents(candidates);
  rebuildIndex({ write: true });
  return { ok: true, appended: appended.length, errors: [] };
}

/** 从当前索引 diff 出新事件：新建 / 迁移 / 归档。 */
export function deriveEvents(oldIndex, newIndex, opts = {}) {
  const at = opts.at ?? nowIso();
  const by = opts.actor ?? 'orchestrator-cli';
  const events = [];
  const oldTasks = new Map((oldIndex.tasks ?? []).map((task) => [task.taskId, task]));
  const oldArchived = new Map((oldIndex.archivedTasks ?? []).map((task) => [task.taskId, task]));
  const newTasks = new Map((newIndex.tasks ?? []).map((task) => [task.taskId, task]));

  for (const task of newIndex.tasks ?? []) {
    const old = oldTasks.get(task.taskId);
    if (!old) {
      events.push(buildCreatedEvent(task, { at, by }));
      for (const [index, history] of (task.history ?? []).entries()) {
        events.push(buildHistoryEvent(task, history, { at, by, index }));
      }
      continue;
    }
    const oldHistory = old.history ?? [];
    const newHistory = task.history ?? [];
    if (newHistory.length > oldHistory.length) {
      for (let index = oldHistory.length; index < newHistory.length; index += 1) {
        events.push(buildHistoryEvent(task, newHistory[index], { at, by, index }));
      }
    } else if (task.status !== old.status) {
      events.push(
        buildHistoryEvent(
          task,
          { at, from: old.status, to: task.status, by, reason: '索引状态变更（无显式 history）' },
          { at, by, index: newHistory.length },
        ),
      );
    }
  }

  for (const entry of newIndex.archivedTasks ?? []) {
    if (oldArchived.has(entry.taskId)) continue;
    const oldActive = oldTasks.get(entry.taskId);
    if (oldActive) {
      const oldHistory = oldActive.history ?? [];
      const newHistory = oldActive.history ?? [];
      if (newHistory.length > oldHistory.length) {
        for (let index = oldHistory.length; index < newHistory.length; index += 1) {
          events.push(buildHistoryEvent(oldActive, newHistory[index], { at, by, index }));
        }
      }
      events.push(buildArchivedEvent(oldActive, entry.status, entry.artifacts, { at, by, note: opts.archiveNote ?? opts.note }));
    } else {
      events.push(buildCreatedEvent({ ...entry, history: [] }, { at, by }));
      events.push(
        buildArchivedEvent({ ...entry, history: [] }, entry.status, entry.artifacts, { at, by, note: opts.archiveNote ?? opts.note }),
      );
    }
  }

  // 仍活跃但被移出索引且未归档：不静默伪造归档；由调用方显式处理。
  return events;
}

/**
 * 提交索引：diff 出事件 → 追加日志 → 从日志重建并落盘。
 * 这是 scheduler / CLI 的唯一状态写入入口；不要直接写 task-state-index.json。
 */
export function commitIndex(nextIndex, opts = {}) {
  let oldIndex;
  try {
    oldIndex = loadIndex();
  } catch {
    oldIndex = { version: '1.1.0', tasks: [], archivedTasks: [], archivedNotes: {} };
  }
  const events = deriveEvents(oldIndex, nextIndex, opts);
  const notes = opts.archivedNotes ?? nextIndex.archivedNotes ?? loadArchivedNotes();
  saveArchivedNotes(notes);
  appendEvents(events);
  return rebuildIndex({ write: true, archivedNotes: notes, note: opts.indexNote ?? INDEX_NOTE });
}

/** 通过事件创建任务（供 CLI / 手工补登）。 */
export function createTask(task, opts = {}) {
  const index = loadIndex();
  if ([...index.tasks, ...index.archivedTasks].some((item) => item.taskId === task.taskId)) {
    throw new Error(`任务已存在：${task.taskId}`);
  }
  const at = opts.at ?? task.createdAt ?? nowIso();
  const next = {
    ...index,
    tasks: [...index.tasks, { ...task, status: task.status ?? 'backlog', history: task.history ?? [], createdAt: task.createdAt ?? at }],
  };
  return commitIndex(next, { at, actor: opts.actor ?? 'orchestrator-cli' });
}

/** 通过事件归档任务（供 CLI archive）。 */
export function archiveTask(taskId, opts = {}) {
  const index = loadIndex();
  if (index.archivedTasks.some((item) => item.taskId === taskId)) throw new Error(`任务已归档：${taskId}`);
  const task = index.tasks.find((item) => item.taskId === taskId);
  if (!task) throw new Error(`归档失败：任务不在活跃列表：${taskId}`);
  const status = opts.status ?? 'completed';
  if (!['completed', 'failed', 'canceled', 'rejected'].includes(status)) throw new Error(`归档终态非法：${status}`);
  const artifacts = { ...(task.artifacts ?? {}), ...(opts.artifacts ?? {}) };
  const notes = { ...(index.archivedNotes ?? loadArchivedNotes()) };
  if (opts.note) notes[taskId] = opts.note;
  const entry = { taskId, status, artifacts };
  const next = {
    ...index,
    tasks: index.tasks.filter((item) => item.taskId !== taskId),
    archivedTasks: [...index.archivedTasks, entry],
    archivedNotes: notes,
  };
  commitIndex(next, { actor: opts.actor ?? 'orchestrator-cli', archiveNote: opts.note, archivedNotes: notes });
  return entry;
}

export { eventTypeForTransition, hashEvent, stable, taskSnapshot };
