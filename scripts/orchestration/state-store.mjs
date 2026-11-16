/**
 * L2 编排状态存储。
 *
 * 职责：加载 / 保存任务状态索引与 L2 附加运行态；原子写；租约字段读写。
 * 边界：不解析业务语义，不重排既有索引字段；既有索引契约见框架仓
 * `schemas/task-state-index.schema.json`，L2 运行态字段独立落在
 * `orchestration-state.json`，避免污染既有索引契约。
 *
 * 持久层为 JSON 文件 + 原子写；store 接口在此隔离，后续迁移 DB / 工作流引擎
 * 只替换本模块实现，上层流程不变（见设计备忘 §11）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 仓根：scripts/orchestration/ 向上两级。 */
export const REPO_ROOT = resolve(__dirname, '..', '..');

export const PATHS = {
  index: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'task-state-index.json'),
  journal: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'state', 'journal.jsonl'),
  journalLock: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'state', 'journal.lock'),
  archivedNotes: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'state', 'archived-notes.json'),
  runtimeState: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'orchestration-state.json'),
  snapshot: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'orchestration-snapshot.json'),
  improvementLog: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'improvement-log.json'),
  auditLog: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'tool-audit-log.json'),
  sqliteDb: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'orchestration-store.sqlite'),
  transportDir: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'transport'),
  receiptArchiveDir: join(REPO_ROOT, 'docs', 'worklog', 'pending', 'archive'),
  webDataJs: join(REPO_ROOT, 'web', 'orchestration', 'data.js'),
  deliveryPackDir: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'delivery-packs'),
  agentCardsDir: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'agent-cards'),
  toolsDir: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'tools'),
  config: join(__dirname, 'config.json'),
};

/** 当前 ISO 时间戳。 */
export function nowIso() {
  return new Date().toISOString();
}

function readJson(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  return JSON.parse(text);
}

/**
 * 原子写 JSON：先写临时文件，再替换目标。
 * Windows 下 rename 不覆盖已存在目标，先删目标再替换；非严格事务，
 * 当前单进程规模可接受，崩溃恢复以状态外置 + 工件为准（设计备忘 §9）。
 */
export function writeJsonAtomic(file, value) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' });
  if (existsSync(file)) unlinkSync(file);
  renameSync(tmp, file);
}

/**
 * 配置结构校验：非法取值抛错，避免静默兜底掩盖配置缺陷；返回归一化配置。
 * 仅做结构与取值合法性校验，不解析业务语义。
 */
export function validateConfig(raw) {
  const errors = [];
  const reworkLimit = Number(raw.reworkLimit ?? 2);
  if (!Number.isInteger(reworkLimit) || reworkLimit < 0) {
    errors.push(`reworkLimit 须为非负整数，实际 ${raw.reworkLimit}`);
  }
  const lease = Number(raw.leaseDefaultMinutes ?? 30);
  if (!Number.isFinite(lease) || lease <= 0) {
    errors.push(`leaseDefaultMinutes 须为正数，实际 ${raw.leaseDefaultMinutes}`);
  }
  if (raw.allowedTaskTypes !== undefined && !Array.isArray(raw.allowedTaskTypes)) {
    errors.push('allowedTaskTypes 须为数组');
  }
  if (raw.frozenActions !== undefined && !Array.isArray(raw.frozenActions)) {
    errors.push('frozenActions 须为数组');
  }
  const backend = raw.store?.backend ?? 'json';
  if (!['json', 'sqlite'].includes(backend)) {
    errors.push(`store.backend 非法：${String(backend)}（允许 json / sqlite）`);
  }
  const transportType = raw.transport?.type ?? 'file';
  if (!['file', 'mcp', 'http'].includes(transportType)) {
    errors.push(`transport.type 非法：${String(transportType)}（允许 file / mcp / http）`);
  }
  const refreshEnabled = raw.web?.refresh?.enabled !== false;
  const refreshInterval = Number(raw.web?.refresh?.intervalMs ?? 3000);
  if (!Number.isInteger(refreshInterval) || refreshInterval < 1000) {
    errors.push(`web.refresh.intervalMs 须为不小于 1000 的整数，实际 ${String(raw.web?.refresh?.intervalMs)}`);
  }
  if (errors.length > 0) throw new Error(`编排配置非法：${errors.join('；')}`);
  return {
    schemaVersion: raw.schemaVersion ?? '1.0.0',
    autoLoop: { enabled: raw.autoLoop?.enabled === true },
    reworkLimit,
    leaseDefaultMinutes: lease,
    allowedTaskTypes: Array.isArray(raw.allowedTaskTypes) ? raw.allowedTaskTypes : [],
    frozenActions: Array.isArray(raw.frozenActions) ? raw.frozenActions : [],
    store: { backend },
    transport: { type: transportType },
    web: { refresh: { enabled: refreshEnabled === true, intervalMs: refreshInterval } },
    notes: raw.notes ?? {},
  };
}

/** 加载配置；结构非法时抛错。 */
export function loadConfig() {
  return validateConfig(readJson(PATHS.config) ?? {});
}

/** 局部更新配置（仅开关与数值字段），保留 notes。 */
export function saveConfigPatch(patch) {
  const current = loadConfig();
  const next = { ...current, ...patch };
  writeJsonAtomic(PATHS.config, next);
  return next;
}

/** 加载既有任务状态索引（契约不变，只读其字段）。 */
export function loadIndex() {
  const index = readJson(PATHS.index);
  if (!index) throw new Error(`状态索引不存在：${PATHS.index}`);
  if (!Array.isArray(index.tasks)) index.tasks = [];
  if (!Array.isArray(index.archivedTasks)) index.archivedTasks = [];
  return index;
}

/** 保存任务状态索引。 */
export function saveIndex(index) {
  writeJsonAtomic(PATHS.index, index);
}

/** L2 运行态空骨架。 */
function emptyRuntimeState() {
  return { schemaVersion: '1.0.0', updatedAt: null, tasks: {} };
}

/** 加载 L2 附加运行态。 */
export function loadRuntimeState() {
  const raw = readJson(PATHS.runtimeState) ?? emptyRuntimeState();
  if (!raw.tasks || typeof raw.tasks !== 'object') raw.tasks = {};
  return raw;
}

/** 保存 L2 附加运行态。 */
export function saveRuntimeState(state) {
  state.updatedAt = nowIso();
  writeJsonAtomic(PATHS.runtimeState, state);
}

/** 取某任务的 L2 运行态条目（不存在返回空对象，不创建）。 */
export function getRuntimeEntry(state, taskId) {
  return state.tasks[taskId] ?? {};
}

/** 读取或创建某任务的 L2 运行态条目。 */
export function ensureRuntimeEntry(state, taskId) {
  if (!state.tasks[taskId]) state.tasks[taskId] = {};
  return state.tasks[taskId];
}

/** 按 taskId 在索引中查找任务；未找到返回 null。 */
export function findTask(index, taskId) {
  return index.tasks.find((t) => t.taskId === taskId) ?? null;
}

/** 租约是否已过期。 */
export function isLeaseExpired(entry, now = nowIso()) {
  if (!entry.leaseDeadline) return false;
  return new Date(entry.leaseDeadline).getTime() <= new Date(now).getTime();
}

function safeReadJson(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

/**
 * 交付包清单（只读，供快照 / 网页）：只保留文件名、生成时间与各类计数，不复制包正文。
 * @param {number} limit 倒序保留条数
 * @returns {Array<object>}
 */
export function listDeliveryPacks(limit = 10) {
  if (!existsSync(PATHS.deliveryPackDir)) return [];
  const packs = [];
  for (const fileName of readdirSync(PATHS.deliveryPackDir)) {
    if (!fileName.startsWith('pack-') || !fileName.endsWith('.json')) continue;
    const pack = safeReadJson(join(PATHS.deliveryPackDir, fileName));
    if (!pack) continue;
    const count = (arr) => (Array.isArray(arr) ? arr.length : 0);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const counts = pack.counts ?? {};
    packs.push({
      fileName,
      ref: `docs/team/agent-orchestration/delivery-packs/${fileName}`,
      packageId: pack.packageId ?? null,
      generatedAt: pack.cycle?.endedAt ?? pack.legacy?.generatedAt ?? null,
      cycle: pack.cycle ?? null,
      counts: {
        passed: num(counts.passed),
        conditionalPass: num(counts.conditionalPass),
        rejected: num(counts.rejected),
        failed: num(counts.failed),
        deadLettered: num(counts.deadLettered),
      },
      leftovers: {
        backlogItems: count(pack.leftovers?.backlogItems),
        openQuestions: count(pack.leftovers?.openQuestions),
        manualReviewList: count(pack.leftovers?.manualReviewList),
      },
      deadLetters: count(pack.deadLetters),
      pendingApprovals: count(pack.pendingApprovals),
    });
  }
  packs.sort((a, b) => String(b.generatedAt ?? '').localeCompare(String(a.generatedAt ?? '')));
  return packs.slice(0, limit);
}

/** Agent Card 声明只读投影；目录缺失或单文件损坏时返回空数组，不阻断快照。 */
export function loadAgentCards() {
  if (!existsSync(PATHS.agentCardsDir)) return [];
  const cards = [];
  for (const fileName of readdirSync(PATHS.agentCardsDir)) {
    if (!fileName.endsWith('.json')) continue;
    const card = safeReadJson(join(PATHS.agentCardsDir, fileName));
    if (!card) continue;
    cards.push({
      agentId: card.agentId ?? null,
      role: card.role ?? null,
      availability: card.availability ?? null,
      skills: Array.isArray(card.skills) ? card.skills : [],
      tools: Array.isArray(card.tools) ? card.tools : [],
      resources: Array.isArray(card.resources) ? card.resources : [],
      note: card.note ?? null,
    });
  }
  return cards;
}

/** 工具契约声明只读投影（一工具一文件；文件缺失或损坏时跳过该条，不阻断快照）。 */
export function loadToolContracts() {
  if (!existsSync(PATHS.toolsDir)) return [];
  const tools = [];
  for (const fileName of readdirSync(PATHS.toolsDir)) {
    if (!fileName.endsWith('.json')) continue;
    const tool = safeReadJson(join(PATHS.toolsDir, fileName));
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) continue;
    tools.push({
      toolId: tool.toolId ?? null,
      category: tool.category ?? null,
      sideEffect: tool.sideEffect ?? null,
      allowedRoles: Array.isArray(tool.allowedRoles) ? tool.allowedRoles : [],
      description: tool.description ?? null,
    });
  }
  return tools;
}
