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
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 仓根：scripts/orchestration/ 向上两级。 */
export const REPO_ROOT = resolve(__dirname, '..', '..');

export const PATHS = {
  index: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'task-state-index.json'),
  runtimeState: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'orchestration-state.json'),
  snapshot: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'orchestration-snapshot.json'),
  webDataJs: join(REPO_ROOT, 'web', 'orchestration', 'data.js'),
  deliveryPackDir: join(REPO_ROOT, 'docs', 'team', 'agent-orchestration', 'delivery-packs'),
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

/** 加载配置；缺省值兜底。 */
export function loadConfig() {
  const raw = readJson(PATHS.config) ?? {};
  return {
    schemaVersion: raw.schemaVersion ?? '1.0.0',
    autoLoop: { enabled: raw.autoLoop?.enabled === true },
    reworkLimit: Number(raw.reworkLimit ?? 2),
    leaseDefaultMinutes: Number(raw.leaseDefaultMinutes ?? 30),
    allowedTaskTypes: Array.isArray(raw.allowedTaskTypes) ? raw.allowedTaskTypes : [],
    frozenActions: Array.isArray(raw.frozenActions) ? raw.frozenActions : [],
    notes: raw.notes ?? {},
  };
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
