/**
 * AF-023 · 任务单立项解析与索引登记（adapter 层）。
 *
 * 职责：把 `docs/worklog/pending/*.md` 的 YAML frontmatter 转成状态索引任务记录，
 * 让“任务单（契约本体）→ 状态索引（运行态指针）”这条链路不再靠手工抄字段。
 *
 * 边界：只读任务单文件、只调用框架 schema 校验与 `createTask` 事件写入；不派发、
 * 不迁移状态、不写交付记录；执行代理与分支流程仍由 scheduler / CLI 负责。
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createTask } from './event-store.mjs';
import { REPO_ROOT } from './state-store.mjs';
import { TASK_STATUSES, TASK_TYPES } from './contract-enums.mjs';
import { validateTaskSheet } from './validator.mjs';

/** 可派发角色默认映射：review / verification / investigation 只读，其余写实现。 */
const READONLY_TYPES = ['review', 'verification', 'investigation'];

/** 仓根相对路径（统一正斜杠，供索引指针与验收反查）。 */
export function repoRelativePath(absPath) {
  const rel = relative(REPO_ROOT, resolve(absPath)).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) throw new Error(`任务单路径不在仓库内：${absPath}`);
  return rel;
}

/**
 * 解析 Markdown frontmatter（只接受首行 `---` 的 YAML 块）。
 * @param {string} text 任务单全文
 * @returns {{meta: object, body: string}}
 */
export function parseTaskSheetFrontmatter(text) {
  if (typeof text !== 'string') throw new Error('任务单内容不是字符串');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) throw new Error('任务单缺少 YAML frontmatter（首行须为 ---）');
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) throw new Error('任务单 frontmatter 缺少结束分隔符 ---');
  const yamlText = normalized.slice(4, end);
  let meta;
  try {
    meta = parseYaml(yamlText);
  } catch (err) {
    throw new Error(`任务单 frontmatter YAML 解析失败：${err.message}`);
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('任务单 frontmatter 须为对象');
  return { meta, body: normalized.slice(end + 4).replace(/^\n/, '') };
}

function artifactPointer(taskSheetPath) {
  return { taskSheet: taskSheetPath, deliveryRecord: null, reply: null };
}

function defaultAgentRole(type) {
  if (READONLY_TYPES.includes(type)) return 'reviewer';
  return 'executor';
}

/**
 * 把 frontmatter 投影成状态索引任务记录。
 * `artifacts` 在任务单契约里是产出清单数组，在状态索引里是运行态指针对象；
 * 两者不能混用：索引侧 `plannedArtifacts` 保留任务单数组，`artifacts` 只存指针。
 * @param {object} meta frontmatter
 * @param {{taskSheetPath:string, status?:string}} opts
 * @returns {object}
 */
export function buildTaskRecord(meta, opts) {
  const taskSheetPath = opts.taskSheetPath;
  if (!taskSheetPath) throw new Error('任务单路径缺失');
  const plannedArtifacts = Array.isArray(meta.artifacts) ? meta.artifacts : [];
  const status = opts.status ?? meta.status ?? 'ready';
  const type = meta.type;
  const record = {
    ...meta,
    taskId: meta.taskId,
    status,
    history: [],
    createdAt: meta.createdAt,
    artifacts: artifactPointer(taskSheetPath),
    plannedArtifacts,
    agentRole: meta.agentRole ?? defaultAgentRole(type),
    requiredSkills: Array.isArray(meta.requiredSkills) ? meta.requiredSkills : [],
    requiredTools: Array.isArray(meta.requiredTools) ? meta.requiredTools : [],
    scope: meta.scope ?? { files: [], modules: [], interfaces: [] },
    successCriteria: Array.isArray(meta.successCriteria) ? meta.successCriteria : [],
    outOfScope: Array.isArray(meta.outOfScope) ? meta.outOfScope : [],
    constraints: Array.isArray(meta.constraints) ? meta.constraints : [],
    policyRefs: Array.isArray(meta.policyRefs) ? meta.policyRefs : [],
    dependsOn: Array.isArray(meta.dependsOn) ? meta.dependsOn : [],
    priorTasks: Array.isArray(meta.priorTasks) ? meta.priorTasks : [],
  };
  delete record.artifactsInFrontmatter;
  return record;
}

/**
 * 读取已落 transport 的任务交接件并登记进索引（兼容 `{deliveredAt,payload}` 包装）。
 * 用于历史 transport 任务补登，不重写交接件正文。
 * @param {{handoverPath:string, status?:string, actor?:string}} opts
 * @returns {Promise<object>}
 */
export async function registerTaskFromHandover(opts = {}) {
  const abs = resolve(REPO_ROOT, opts.handoverPath ?? '');
  if (!opts.handoverPath || !existsSync(abs)) throw new Error(`交接件不存在：${opts.handoverPath ?? '(missing)'}`);
  const taskSheetPath = repoRelativePath(abs);
  let record;
  try {
    record = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`交接件 JSON 解析失败：${err.message}`);
  }
  const payload = record?.payload ?? record;
  const check = await validateTaskSheet(payload);
  if (check.skipped) throw new Error('框架 task-sheet schema 不可达，拒绝登记（ORCH_REQUIRE_FRAMEWORK=1 时应 fail-fast）');
  if (!check.ok) {
    throw new Error(`交接件 schema 校验失败：${check.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('；')}`);
  }
  const status = opts.status ?? payload.status ?? 'ready';
  if (!TASK_STATUSES.includes(status)) throw new Error(`任务状态非法：${String(status)}`);
  const task = buildTaskRecord(payload, { taskSheetPath, status });
  const index = createTask(task, { actor: opts.actor ?? 'orchestrator-cli' });
  return index.tasks.find((item) => item.taskId === task.taskId) ?? task;
}

/**
 * 读取任务单、做框架 schema 校验并登记进状态索引（事件日志为唯一写面）。
 * @param {{sheetPath:string, status?:string, actor?:string}} opts
 * @returns {Promise<object>} 登记后的任务记录
 */
export async function registerTaskFromSheet(opts = {}) {
  const abs = resolve(REPO_ROOT, opts.sheetPath ?? '');
  if (!opts.sheetPath || !existsSync(abs)) throw new Error(`任务单不存在：${opts.sheetPath ?? '(missing)'}`);
  const taskSheetPath = repoRelativePath(abs);
  const text = readFileSync(abs, 'utf8');
  const { meta } = parseTaskSheetFrontmatter(text);

  if (!TASK_TYPES.includes(meta.type)) throw new Error(`任务单 type 非法：${String(meta.type)}`);
  const status = opts.status ?? meta.status ?? 'ready';
  if (!TASK_STATUSES.includes(status)) throw new Error(`任务单 status 非法：${String(status)}`);

  const check = await validateTaskSheet(meta);
  if (check.skipped) throw new Error('框架 task-sheet schema 不可达，拒绝登记（ORCH_REQUIRE_FRAMEWORK=1 时应 fail-fast）');
  if (!check.ok) {
    throw new Error(`任务单 schema 校验失败：${check.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('；')}`);
  }

  const record = buildTaskRecord(meta, { taskSheetPath, status });
  const index = createTask(record, { actor: opts.actor ?? 'orchestrator-cli' });
  return index.tasks.find((task) => task.taskId === record.taskId) ?? record;
}
