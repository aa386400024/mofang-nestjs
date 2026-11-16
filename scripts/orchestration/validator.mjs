/**
 * AF-006 · 机读 Schema 校验固化。
 *
 * 用 ajv（Draft 2020-12）加载框架仓四份契约 schema，对任务单元数据、状态索引、
 * 工具契约清单、Agent Card 做机读校验。本模块只做结构 / 枚举 / 模式校验，不判定
 * 契约语义、口径 SSOT 与偏差合理性（仍归人工复核，见 acceptance-runner）。
 *
 * 分层边界：schema 权威源在框架仓（纯规范层），本模块只读引用，不复制口径。
 * 框架仓目录经环境变量 `ORCH_FRAMEWORK_DIR` 覆盖；缺失时对应校验记 skipped=true
 * （容错不阻断），与既有"未登记工具声明记 skip"口径一致。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './state-store.mjs';

/** 框架仓 schema 文件相对路径（schemaKey → 文件名）。 */
export const SCHEMA_FILES = {
  taskSheet: 'task-sheet.schema.json',
  taskIndex: 'task-state-index.schema.json',
  toolContract: 'tool-contract.schema.json',
  agentCard: 'agent-card.schema.json',
  reviewHandover: 'review-handover.schema.json',
};

/** 框架仓根目录：env 优先；默认本仓上两级平级目录。 */
export function frameworkDir() {
  return process.env.ORCH_FRAMEWORK_DIR
    ? resolve(process.env.ORCH_FRAMEWORK_DIR)
    : resolve(REPO_ROOT, '..', '..', 'agent-collaboration-framework');
}

function schemaPath(schemaKey) {
  return resolve(frameworkDir(), 'schemas', SCHEMA_FILES[schemaKey]);
}

/** 统一校验结果结构。 */
function result({ ok = true, skipped = false, errors = [], schemaId = null } = {}) {
  return { ok, skipped, errors, schemaId };
}

/** 读取 schema JSON；文件缺失或解析失败返回 null。 */
function loadSchema(schemaKey) {
  const file = schemaPath(schemaKey);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

let ajvInstance = null;
/** 懒加载 ajv（Draft 2020-12）实例并注册 formats；依赖缺失时返回 null（调用方容错 skip）。 */
async function getAjv() {
  if (ajvInstance) return ajvInstance;
  try {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const addFormats = (await import('ajv-formats')).default;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajvInstance = ajv;
    return ajvInstance;
  } catch {
    return null;
  }
}

const compiledCache = new Map();

/** 编译指定 schemaKey 的校验函数；不可用返回 null。 */
async function getValidator(schemaKey) {
  if (compiledCache.has(schemaKey)) return compiledCache.get(schemaKey);
  const ajv = await getAjv();
  const schema = loadSchema(schemaKey);
  if (!ajv || !schema) {
    compiledCache.set(schemaKey, null);
    return null;
  }
  if (schema.$id) ajv.removeSchema(schema.$id);
  const validate = ajv.compile(schema);
  compiledCache.set(schemaKey, validate);
  return validate;
}

/** ajv 错误归一化为可读清单。 */
function normalizeErrors(validate) {
  return (validate.errors ?? []).map((err) => ({
    instancePath: err.instancePath ?? '',
    message: err.message ?? '校验不通过',
    params: err.params ?? {},
  }));
}

/**
 * 通用对象校验。
 * @param {'taskSheet'|'taskIndex'|'toolContract'|'agentCard'|'reviewHandover'} schemaKey
 * @param {object} value 待校验对象
 * @returns {Promise<{ok:boolean,skipped:boolean,errors:object[],schemaId:string|null}>}
 */
export async function validateObject(schemaKey, value) {
  const validate = await getValidator(schemaKey);
  const schema = loadSchema(schemaKey);
  if (!validate || !schema) {
    return result({ skipped: true, schemaId: null });
  }
  const ok = validate(value);
  return result({
    ok,
    errors: ok ? [] : normalizeErrors(validate),
    schemaId: schema.$id ?? null,
  });
}

/** 任务单元数据对象（Markdown frontmatter 抽取结果）校验。 */
export function validateTaskSheet(meta) {
  return validateObject('taskSheet', meta);
}

/** 状态索引对象校验。 */
export function validateTaskIndex(index) {
  return validateObject('taskIndex', index);
}

/** 单条工具契约对象校验。 */
export function validateTool(tool) {
  return validateObject('toolContract', tool);
}

/** Agent Card 对象校验。 */
export function validateAgentCard(card) {
  return validateObject('agentCard', card);
}

/** 协商轮 review 交接件对象校验（框架 review-handover.schema.json）。 */
export function validateReviewHandoverSchema(review) {
  return validateObject('reviewHandover', review);
}

/**
 * 工具契约清单校验：容器结构（schemaRef、tools 数组）+ 逐条工具 schema。
 * 容器结构问题作为 errors 返回；工具条目错误携带 toolId 定位。
 */
export async function validateToolManifest(manifest) {
  const problems = [];
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    problems.push('清单须为对象');
    return result({ ok: false, errors: [{ instancePath: '', message: '清单须为对象', params: {} }] });
  }
  if (!manifest.schemaRef) problems.push('清单缺 schemaRef');
  if (!Array.isArray(manifest.tools)) {
    problems.push('tools 须为数组');
  }
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  if (tools.length === 0) problems.push('工具清单为空');

  const toolResults = await Promise.all(tools.map((tool) => validateTool(tool)));
  const toolErrors = [];
  toolResults.forEach((res, i) => {
    if (res.skipped) return;
    if (!res.ok) {
      const label = tools[i]?.toolId ?? `条目 #${i + 1}`;
      for (const err of res.errors) {
        toolErrors.push({ instancePath: `/tools/${i}${err.instancePath}`, message: `[${label}] ${err.message}`, params: err.params });
      }
    }
  });

  const containerErrors = problems.map((message) => ({ instancePath: '', message, params: {} }));
  const errors = [...containerErrors, ...toolErrors];
  return result({ ok: errors.length === 0, errors, schemaId: 'urn:agent-collaboration-framework:schema:tool-contract:1.0.0' });
}

/** 复位编译缓存（测试隔离用）。 */
export function _resetCache() {
  compiledCache.clear();
  ajvInstance = null;
}
