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
import { gzipSync, gunzipSync } from 'node:zlib';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS, loadIndex, nowIso, writeJsonAtomic } from './state-store.mjs';
import { TERMINAL_STATUSES, TRANSITIONS } from './contract-enums.mjs';
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
  if (snapshot.createdAt) snapshot.createdAt = toUtcIso(snapshot.createdAt);
  return snapshot;
}

/**
 * 读取事件日志；空文件返回 []，坏行直接抛错（不允许静默忽略）。
 *
 * 分段归档后，日志由「归档段（按首事件序号升序）」+「当前 journal.jsonl」组成。
 * 段文件支持 `.jsonl` 与 `.jsonl.gz`；读取顺序不依赖文件名时间戳，而是按段内
 * 首条 `eventSeq` 排序，保证跨段 `eventSeq` 连续、`prevHash` 链可验证。
 */
export function loadJournal() {
  const files = [...listJournalSegments(), PATHS.journal].filter((file) => existsSync(file));
  const events = [];
  for (const file of files) {
    events.push(...readJournalFile(file));
  }
  return events;
}

/** 归档段文件（不含当前 journal），按首事件序号升序。 */
export function listJournalSegments() {
  if (!existsSync(PATHS.journalArchiveDir)) return [];
  const names = readdirSync(PATHS.journalArchiveDir).filter((name) => /^journal-\d{6}-\d{6}\.jsonl(?:\.gz)?$/.test(name));
  const segments = names.map((name) => {
    const file = `${PATHS.journalArchiveDir}/${name}`;
    const match = /^journal-(\d{6})-(\d{6})\.jsonl/.exec(name);
    return { file, name, firstSeq: Number(match?.[1] ?? Number.MAX_SAFE_INTEGER) };
  });
  segments.sort((a, b) => a.firstSeq - b.firstSeq || a.name.localeCompare(b.name));
  return segments.map((segment) => segment.file);
}

/** 当前 journal 段（不含已轮转的归档段；归档段只读）。 */
export function loadJournalSegment() {
  return existsSync(PATHS.journal) ? readJournalFile(PATHS.journal) : [];
}

/**
 * 覆写当前 journal 段：仅用于「本地未发布段」的链纠偏，归档段永不重写。
 * 纠偏必须先在内存里用 rechainEvents 重算，再由调用方显式 --apply 落盘。
 */
export function saveJournalSegment(events) {
  const dir = dirname(PATHS.journal);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = events.map((event) => JSON.stringify(event)).join('\n');
  writeFileSync(PATHS.journal, body.length > 0 ? `${body}\n` : '', { encoding: 'utf8' });
}

function readJournalFile(file) {
  const raw = readFileSync(file);
  const text = file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const events = [];
  let lineNo = 0;
  for (const line of text.split(/\r?\n/)) {
    lineNo += 1;
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`事件日志 ${file} 第 ${lineNo} 行不是合法 JSON：${err.message}`);
    }
  }
  return events;
}

/**
 * 将当前 journal 切成不可变归档段，并重建空的活动日志。
 *
 * 为什么不是「压缩重写」：append-only 是审计前提，删改历史会让哈希链失去意义。
 * 本实现只做**分段 + 可选 gzip**，事件本身逐字保留，`eventSeq` / `prevHash` /
 * `hash` 跨段连续，因此 `verify` 仍能检出任何篡改。归档段永不删除，长期保留。
 *
 * @param {{maxEvents?:number, force?:boolean, compress?:boolean, dryRun?:boolean}} opts
 * @returns {{rotated:boolean, reason?:string, segment?:string, events?:number, firstSeq?:number, lastSeq?:number}}
 */
export function rotateJournal(opts = {}) {
  const maxEvents = Number(opts.maxEvents ?? 5000);
  if (!Number.isInteger(maxEvents) || maxEvents <= 0) throw new Error(`maxEvents 须为正整数，实际 ${opts.maxEvents}`);
  if (!existsSync(PATHS.journal)) return { rotated: false, reason: '当前 journal 不存在' };
  const active = readJournalFile(PATHS.journal);
  if (active.length === 0) return { rotated: false, reason: '当前 journal 为空' };
  if (!opts.force && active.length < maxEvents) {
    return {
      rotated: false,
      reason: `当前 ${active.length} 条，未达阈值 ${maxEvents}（需要强制轮转请加 --force）`,
    };
  }
  const firstSeq = active[0].eventSeq;
  const lastSeq = active[active.length - 1].eventSeq;
  const baseName = `journal-${String(firstSeq).padStart(6, '0')}-${String(lastSeq).padStart(6, '0')}.jsonl`;
  const segmentName = opts.compress ? `${baseName}.gz` : baseName;
  const target = `${PATHS.journalArchiveDir}/${segmentName}`;
  if (existsSync(target)) throw new Error(`归档段已存在，拒绝覆盖：${target}`);
  if (opts.dryRun) {
    return { rotated: false, reason: 'dry-run', segment: target, events: active.length, firstSeq, lastSeq };
  }

  const lock = acquireLock();
  try {
    // 双重检查：锁内重新读一次，避免与并发 append 交错。
    const locked = readJournalFile(PATHS.journal);
    if (locked.length === 0) return { rotated: false, reason: '锁内发现 journal 为空' };
    const lockedFirst = locked[0].eventSeq;
    const lockedLast = locked[locked.length - 1].eventSeq;
    const lockedBase = `journal-${String(lockedFirst).padStart(6, '0')}-${String(lockedLast).padStart(6, '0')}.jsonl`;
    const lockedSegmentName = opts.compress ? `${lockedBase}.gz` : lockedBase;
    const lockedTarget = `${PATHS.journalArchiveDir}/${lockedSegmentName}`;
    if (existsSync(lockedTarget)) throw new Error(`归档段已存在，拒绝覆盖：${lockedTarget}`);
    if (!existsSync(PATHS.journalArchiveDir)) mkdirSync(PATHS.journalArchiveDir, { recursive: true });

    const text = readFileSync(PATHS.journal, 'utf8');
    if (opts.compress) {
      const tmp = `${lockedTarget}.tmp`;
      writeFileSync(tmp, gzipSync(Buffer.from(text, 'utf8')), { flag: 'wx' });
      renameSync(tmp, lockedTarget);
      unlinkSync(PATHS.journal);
    } else {
      renameSync(PATHS.journal, lockedTarget);
    }
    // 重建空活动日志：后续 append 从 lastSeq + 1 继续，prevHash 指向段尾。
    writeFileSync(PATHS.journal, '', { encoding: 'utf8', flag: 'wx' });
    return {
      rotated: true,
      segment: lockedTarget,
      events: locked.length,
      firstSeq: lockedFirst,
      lastSeq: lockedLast,
    };
  } finally {
    releaseLock(lock);
  }
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

/**
 * 本地未发布段的哈希链纠偏：切点之前的事件逐字保留，切点起重新编号并重算 prevHash/hash。
 * 只用于「事件内容有缺陷、但尚未交付给任何下游」的本地段（例如时间戳形态非法），
 * 调用方必须显式给出切点事件 id，避免整段静默重算把历史篡改洗白。
 * @param {object[]} events 全量事件（按 eventSeq 升序）
 * @param {{fromEventId:string}} opts 切点：从该事件起重算
 * @returns {{events:object[], cutIndex:number}}
 */
export function rechainEvents(events, opts = {}) {
  const fromEventId = String(opts.fromEventId ?? '');
  if (!fromEventId) throw new Error('rechainEvents 需要显式切点 fromEventId');
  const cutIndex = events.findIndex((event) => event.eventId === fromEventId);
  if (cutIndex < 0) throw new Error(`切点事件不存在：${fromEventId}`);
  let prevSeq;
  let prevHash;
  if (cutIndex === 0) {
    // 切点是当前段首条：链接前一段的末位序号与哈希，必须由调用方显式给出，不猜。
    if (opts.prevHash === undefined || opts.prevSeq === undefined) {
      throw new Error('切点为段首时必须提供 prevSeq 与 prevHash（从前一段末条事件取）');
    }
    prevSeq = opts.prevSeq;
    prevHash = opts.prevHash;
  }
  const kept = cutIndex === 0 ? [] : events.slice(0, cutIndex).map((event) => ({ ...event }));
  if (cutIndex > 0) {
    prevSeq = kept[kept.length - 1].eventSeq;
    prevHash = kept[kept.length - 1].hash;
  }
  let seq = prevSeq;
  let chain = prevHash;
  const rechained = [];
  for (const source of events.slice(cutIndex)) {
    seq += 1;
    const event = { ...source, eventSeq: seq, eventId: `EV-${String(seq).padStart(4, '0')}`, prevHash: chain };
    delete event.hash;
    event.hash = hashEvent(event, chain);
    chain = event.hash;
    rechained.push(event);
  }
  return { events: [...kept, ...rechained], cutIndex };
}

/** 当前段首条事件所声明的 prevHash，其来源是前一段末条事件。 */
export function segmentEntryPoint(segmentEvents) {
  const first = segmentEvents[0];
  if (!first) return null;
  return { prevSeq: first.eventSeq - 1, prevHash: first.prevHash };
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

/** 最短合法迁移路径（BFS）；用于把非终态任务在归档前显式闭合到终态。 */
function transitionPath(from, to) {
  if (from === to) return [];
  const queue = [[from, []]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const [state, path] = queue.shift();
    for (const next of TRANSITIONS[state] ?? []) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath;
      seen.add(next);
      queue.push([next, nextPath]);
    }
  }
  throw new Error(`不存在从 ${from} 到 ${to} 的合法迁移路径`);
}

/** 返回一个「已闭合到终态」的任务副本，附带补齐的 history（不修改入参）。 */
function closeTaskForArchive(task, to, opts = {}) {
  const copy = { ...task, history: [...(task.history ?? [])] };
  for (const next of transitionPath(task.status, to)) {
    copy.history.push({
      at: opts.at ?? nowIso(),
      from: copy.status,
      to: next,
      by: opts.by ?? 'orchestrator-cli',
      reason: opts.reason ?? '归档前闭合终态',
    });
    copy.status = next;
  }
  return copy;
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

/**
 * 时间戳归一：任务单 frontmatter 允许写带偏移的本地时间（`+08:00`），但事件日志的 `at`
 * 必须是 UTC `Z` 形态——否则 schema 校验按 RFC3339 拒绝，且「同一任务 at 单调递增」按
 * 字符串比较会把 `10:55:00+08:00` 判成早于 `02:48:57Z`（AF-030 登记时实测踩到）。
 * 无法解析的值原样返回，交给 schema 报错而不是静默改写成 now。
 */
export function toUtcIso(value) {
  if (value === null || value === undefined) return value;
  const raw = String(value);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString();
}

/**
 * 任务创建时间口径：归一为 UTC，且**不得晚于写入时刻**。
 * 任务单 frontmatter 的 `createdAt` 由人写，常见「写成未来的整点」（AF-030/AF-031 各踩一次），
 * 会让 created 事件的 `at` 晚于其 promoted/claimed，触发「同一任务 at 倒退」。
 * 未来时间一律夹到写入时刻，既往时间保持原值，便于历史任务单保真。
 */
export function createdAtForEvent(value, now = nowIso()) {
  const normalized = toUtcIso(value ?? now);
  const parsed = new Date(normalized);
  const nowParsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) return now;
  return parsed.getTime() > nowParsed.getTime() ? nowParsed.toISOString() : normalized;
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
    at: createdAtForEvent(task.createdAt ?? first?.at ?? opts.at, opts.at ?? nowIso()),
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
    at: toUtcIso(history.at ?? opts.at ?? nowIso()),
    idempotencyKey: `${task.taskId}:${from}:${to}:${opts.index ?? 0}`,
    reason: history.reason ?? null,
    payload: {
      task: taskSnapshot(task),
      ...(to === 'input-required' ? { waitingOn: task.waitingOn ?? null, triggerReason: task.triggerReason ?? null } : {}),
      ...(to === 'completed' || to === 'rejected' || to === 'failed' ? { verdict: task.verdict ?? null } : {}),
    },
  };
}

/**
 * 索引工件指针白名单：框架 task-state-index 1.1.0 的 `artifacts` 只允许
 * `taskSheet / deliveryRecord / reply` 三键（schema 里 additionalProperties=false）。
 * 回执 `artifactRefs.others` 属运行态证据，落 `task.receipt`，不得混入索引工件对象，
 * 否则索引 schema 校验直接失败（AF-024 归档实测踩到：others 被投影进归档条目）。
 * @param {object} artifacts 任意工件对象
 * @returns {object} 仅含白名单键的工件对象
 */
export function pickArtifactPointers(artifacts) {
  const allowed = ['taskSheet', 'deliveryRecord', 'reply'];
  const out = {};
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) return out;
  for (const key of allowed) {
    if (artifacts[key] !== undefined) out[key] = artifacts[key];
  }
  return out;
}

/** 构造归档事件；归档是终态之后的只读动作，不携带状态变更。 */
export function buildArchivedEvent(task, status, artifacts, opts = {}) {
  if (!TERMINAL_STATUSES.includes(task.status)) {
    throw new Error(`归档前置条件不满足：${task.taskId} 当前状态 ${task.status} 不是终态`);
  }
  if (status !== task.status) {
    throw new Error(`归档不得改写终态：${task.taskId} 当前 ${task.status}，请求 ${status}`);
  }
  return {
    taskId: task.taskId,
    type: 'archived',
    from: task.status,
    to: status,
    by: opts.by ?? 'orchestrator-cli',
    at: toUtcIso(opts.at ?? nowIso()),
    idempotencyKey: `${task.taskId}:archived`,
    reason: opts.note ?? '归档终态',
    payload: {
      artifacts: pickArtifactPointers(artifacts ?? task.artifacts ?? {}),
      task: { ...taskSnapshot(task), artifacts: pickArtifactPointers(artifacts ?? task.artifacts ?? {}) },
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
      // 框架 state_projection 口径：archived 是「归档动作」，不携带状态变更；
      // 归档条目落的是事件发生前 rec.status（必须是终态），不是 event.to。
      if (!TERMINAL_STATUSES.includes(rec.status)) {
        throw new Error(`${taskId} 归档时状态 ${rec.status} 不是终态，拒绝归档投影`);
      }
      if (payload.artifacts) rec.artifacts = pickArtifactPointers(payload.artifacts);
      archived.push({ taskId, status: rec.status, artifacts: pickArtifactPointers(rec.artifacts) });
      records.delete(taskId);
      const idx = order.indexOf(taskId);
      if (idx >= 0) order.splice(idx, 1);
      continue;
    }

    rec.status = to;
    if (payload.task && typeof payload.task === 'object') Object.assign(rec, payload.task);
    if (payload.artifacts) rec.artifacts = pickArtifactPointers(payload.artifacts);
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
    version: '1.2.0',
    schemaRef: 'urn:agent-collaboration-framework:schema:task-state-index:1.2.0',
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
      const closed = closeTaskForArchive(oldActive, entry.status, {
        at,
        by,
        reason: '归档前闭合终态',
      });
      for (let index = oldHistory.length; index < closed.history.length; index += 1) {
        events.push(buildHistoryEvent(closed, closed.history[index], { at, by, index }));
      }
      events.push(buildArchivedEvent(closed, entry.status, entry.artifacts, { at, by, note: opts.archiveNote ?? opts.note }));
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
  // created 事件的时间取「登记写入时刻」，不取任务单的 createdAt：任务单由人写，常写成未来整点，
  // 直接用会把 created 事件排到 promoted 之后（AF-032 实测）。createdAt 只作为任务属性保留。
  const at = opts.at ?? nowIso();
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
  const status = opts.status ?? task.status;
  if (!TERMINAL_STATUSES.includes(status)) throw new Error(`归档终态非法：${status}`);
  if (status !== task.status) {
    throw new Error(`归档不得改写终态：${taskId} 当前 ${task.status}，请求 ${status}；请先完成终态迁移`);
  }
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
