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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT, PATHS } from './state-store.mjs';

/** 框架仓 schema 文件相对路径（schemaKey → 文件名）。 */
export const SCHEMA_FILES = {
  taskSheet: 'task-sheet.schema.json',
  taskIndex: 'task-state-index.schema.json',
  stateEvent: 'state-event.schema.json',
  toolContract: 'tool-contract.schema.json',
  agentCard: 'agent-card.schema.json',
  reviewHandover: 'review-handover.schema.json',
  receipt: 'receipt.schema.json',
  deliveryPackage: 'delivery-package.schema.json',
  protocolView: 'protocol-view.schema.json',
};

/** 契约包固化目录（框架私仓在 CI 不可跨仓读取时的可复现来源）。 */
function latestVendorDir() {
  const root = resolve(REPO_ROOT, 'contracts', 'agent-collaboration-framework');
  if (!existsSync(root)) return resolve(root, '2.0.0');
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const left = a.split('.').map(Number);
      const right = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
      return 0;
    });
  return resolve(root, versions.at(-1) ?? '2.0.0');
}
const VENDOR_FRAMEWORK_DIR = latestVendorDir();
/** 本地兄弟仓（开发期优先，能第一时间发现框架 tag 漂移）。 */
const SIBLING_FRAMEWORK_DIR = resolve(REPO_ROOT, '..', '..', 'agent-collaboration-framework');

/** CI 硬模式：框架不可达时不允许把校验降级为 skipped。 */
export function requireFramework() {
  return process.env.ORCH_REQUIRE_FRAMEWORK === '1';
}

/**
 * 框架仓根目录：env 优先；本地兄弟仓次之；最后回落到仓内固化契约包。
 * CI 显式设 ORCH_FRAMEWORK_DIR 指向固化包，并置 ORCH_REQUIRE_FRAMEWORK=1。
 */
export function frameworkDir() {
  if (process.env.ORCH_FRAMEWORK_DIR) return resolve(process.env.ORCH_FRAMEWORK_DIR);
  if (existsSync(resolve(SIBLING_FRAMEWORK_DIR, 'schemas', 'versions.json'))) return SIBLING_FRAMEWORK_DIR;
  return VENDOR_FRAMEWORK_DIR;
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
 * @param {'taskSheet'|'taskIndex'|'toolContract'|'agentCard'|'reviewHandover'|'deliveryPackage'|'protocolView'} schemaKey
 * @param {object} value 待校验对象
 * @returns {Promise<{ok:boolean,skipped:boolean,errors:object[],schemaId:string|null}>}
 */
export async function validateObject(schemaKey, value) {
  const validate = await getValidator(schemaKey);
  const schema = loadSchema(schemaKey);
  if (!validate || !schema) {
    if (requireFramework()) {
      return result({
        ok: false,
        errors: [{ instancePath: '', message: `框架契约不可达：${schemaPath(schemaKey)}（CI 硬模式禁止跳过）`, params: {} }],
      });
    }
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

/** 单条状态事件校验（框架 state-event 1.0.0）。 */
export function validateStateEvent(event) {
  return validateObject('stateEvent', event);
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
 * 已归档回执的 deletionChecks 兼容视图。
 *
 * 早期回执把 deletionChecks 写成字符串数组；这些回执已冻结进记录包，改正文会破坏
 * sha256 与证据链。这里只在归档任务的校验视图里补成 {path, check} 对象，不回写磁盘。
 * 活动任务不走进此分支，仍按 receipt 2.1.0 严格校验。
 */
export function normalizeReceiptForValidation(receipt, { archived = false } = {}) {
  if (!archived || !receipt || typeof receipt !== 'object') return receipt;
  const changedFiles = receipt.changedFiles;
  const checks = changedFiles?.deletionChecks;
  if (!Array.isArray(checks) || checks.length === 0) return receipt;
  if (checks.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return receipt;
  if (!checks.every((item) => typeof item === 'string')) return receipt;

  const deleted = Array.isArray(changedFiles.deleted) ? changedFiles.deleted : [];
  const taskId = typeof receipt.taskId === 'string' && receipt.taskId ? receipt.taskId : 'unknown-task';
  return {
    ...receipt,
    changedFiles: {
      ...changedFiles,
      deletionChecks: checks.map((check, index) => ({
        path:
          typeof deleted[index] === 'string' && deleted[index].trim()
            ? deleted[index]
            : `legacy://${taskId}/deleted-${index + 1}`,
        check,
      })),
    },
  };
}

/** 机读回执对象校验（框架 receipt.schema.json）。archived 仅放行已归档旧结构。 */
export function validateReceiptSchema(receipt, options = {}) {
  return validateObject('receipt', normalizeReceiptForValidation(receipt, options));
}

/** 夜间交付包对象校验（框架 delivery-package.schema.json）。 */
export function validateDeliveryPackage(pack) {
  return validateObject('deliveryPackage', pack);
}

/** 协议视图对象校验（框架 protocol-view.schema.json）。 */
export function validateProtocolView(view) {
  return validateObject('protocolView', view);
}

/**
 * 工具契约目录校验：`tools/*.json` 一工具一文件（框架 2.0.0 单对象口径），
 * 逐文件做 schema 校验并携带文件名定位；目录缺失记 skipped。
 */
export async function validateToolDir(dir = PATHS.toolsDir) {
  if (!existsSync(dir)) return result({ skipped: true });
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    return result({ ok: false, errors: [{ instancePath: '', message: '工具目录为空', params: {} }] });
  }
  const problems = [];
  for (const fileName of files) {
    const file = join(dir, fileName);
    let tool;
    try {
      tool = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push({ instancePath: fileName, message: `JSON 解析失败：${err.message}`, params: {} });
      continue;
    }
    if (Array.isArray(tool) || typeof tool !== 'object' || tool === null) {
      problems.push({ instancePath: fileName, message: '工具声明须为对象（一工具一文件）', params: {} });
      continue;
    }
    const res = await validateTool(tool);
    if (res.skipped) return res;
    for (const err of res.errors) {
      problems.push({
        instancePath: `${fileName}${err.instancePath}`,
        message: `[${tool.toolId ?? fileName}] ${err.instancePath || '(根)'}: ${err.message}`,
        params: err.params,
      });
    }
    if ((tool.contractRef ?? '').includes('tool-contract') === false && tool.contractRef) {
      problems.push({ instancePath: fileName, message: 'contractRef 必须指向 tool-contract', params: {} });
    }
  }
  const validate = await getValidator('toolContract');
  const schema = loadSchema('toolContract');
  return result({ ok: problems.length === 0, errors: problems, schemaId: validate ? (schema?.$id ?? null) : null });
}

/** 框架版本表（`schemas/versions.json`），不可达返回 null。 */
export function loadVersions() {
  const file = resolve(frameworkDir(), 'schemas', 'versions.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 契约版本对账：实例声明的 contractRef / schemaRef 指向的 urn 版本必须与框架
 * versions.json 中同名契约一致；缺失声明也记为错误（防止升级后静默漂移）。
 *
 * @param {object} instance 含 contractRef 或 schemaRef 的实例
 * @param {string} contractName 契约名（task-sheet / task-state-index / tool-contract / agent-card / review-handover / delivery-package）
 */
export function validateContractVersion(instance, contractName) {
  const versions = loadVersions();
  if (!versions) {
    if (requireFramework()) {
      return result({
        ok: false,
        errors: [{ instancePath: '', message: '框架 versions.json 不可达（CI 硬模式禁止跳过）', params: {} }],
      });
    }
    return result({ skipped: true });
  }
  const expected = versions.contracts?.[contractName]?.version;
  const declared = instance?.contractRef ?? instance?.schemaRef ?? null;
  const errors = [];
  if (!expected) {
    errors.push({ instancePath: '', message: `框架 versions.json 未登记契约 ${contractName}`, params: {} });
  }
  if (!declared) {
    errors.push({ instancePath: '', message: `缺少 contractRef / schemaRef（期望 ${contractName}:${expected}）`, params: {} });
  } else if (expected) {
    const okRef = new RegExp(`:${contractName.replace(/[-]/g, '[-]')}:${expected.replace(/[.]/g, '\\.')}$`).test(String(declared));
    if (!okRef) {
      errors.push({
        instancePath: '',
        message: `契约版本与框架不一致：声明 ${declared}，期望版本 ${expected}（框架 ${versions.framework?.version}）`,
        params: {},
      });
    }
  }
  return result({ ok: errors.length === 0, errors, schemaId: null });
}

/**
 * IM-084：把校验分区汇总成退出码。
 * `--only-sheet` 时只看「任务单元」分区，全仓既有失败只作为背景信息，不污染单 sheet 结论。
 * @param {Array<[string, object]>} sections
 * @param {{onlySheet?: boolean}} opts
 * @returns {{onlySheet:boolean, sheetFound:boolean, sheetOk:boolean, globalFailed:boolean, exitCode:number}}
 */
export function resolveValidationOutcome(sections = [], opts = {}) {
  const onlySheet = opts.onlySheet === true;
  let sheetFound = false;
  let sheetOk = false;
  let globalFailed = false;
  for (const [name, res] of sections) {
    const ok = res?.ok === true && res?.skipped !== true;
    if (name === '任务单元') {
      sheetFound = true;
      sheetOk = ok;
    } else if (!ok) {
      globalFailed = true;
    }
  }
  const exitCode = onlySheet ? (sheetFound && sheetOk ? 0 : 1) : (globalFailed || (sheetFound && !sheetOk) ? 1 : 0);
  return { onlySheet, sheetFound, sheetOk, globalFailed, exitCode };
}

/** 复位编译缓存（测试隔离用）。 */
export function _resetCache() {
  compiledCache.clear();
  ajvInstance = null;
}
