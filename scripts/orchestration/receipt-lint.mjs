/**
 * AF-084 · 回执预检（run-once 之前的机读 lint）。
 *
 * 验收器在摄入回执时才做 V1–V7 核对，格式类问题（scope 外声明、状态面生成物、
 * 交付记录 CR、工件路径不存在）会让任务白跑一轮。本模块把这些可预检项前移：
 *   - 结构：复用框架七组字段校验；
 *   - scope：`changedFiles` 不得声明状态面生成物，越界声明直接拒绝；
 *   - 工件：`artifactRefs` 指向的文件必须存在且在仓内；
 *   - 换行：交付记录必须是 UTF-8 无 BOM + LF。
 *
 * 边界：只读文件，不写回执、不改状态；判定口径与 acceptance-runner / task-entry-gate 对齐，
 * 不新增或放宽校验，只把同一口径提前暴露。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { REPO_ROOT } from './state-store.mjs';
import { REVIEW_VERDICTS, validateReceiptHandover } from './handover-contract.mjs';
import { detectResidualFiles } from './scope-mutex.mjs';
import { isStatePlanePath } from './task-entry-gate.mjs';
import { inspectTextFile } from './text-normalize.mjs';

function isWithinRepo(absPath, repoRoot) {
  const rel = relative(repoRoot, absPath).replace(/\\/g, '/');
  return rel.length > 0 && !rel.startsWith('..') && !rel.startsWith('/');
}

function collectChangedFiles(changedFiles) {
  return ['added', 'modified', 'deleted'].flatMap((key) => (Array.isArray(changedFiles?.[key]) ? changedFiles[key] : []));
}

/**
 * 对一份回执载荷做预检。
 * @param {object} payload 回执正文（已剥掉 {deliveredAt,payload} 包装）
 * @param {object} task 状态索引任务条目
 * @param {{repoRoot?: string}} opts
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function lintReceiptPayload(payload, task, opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const errors = [];
  const warnings = [];

  const shape = validateReceiptHandover(payload);
  if (!shape.valid) {
    errors.push(...shape.errors.map((error) => `结构：${error}`));
  }
  if (typeof payload?.taskId === 'string' && task?.taskId && payload.taskId !== task.taskId) {
    errors.push(`taskId：回执 ${payload.taskId} 与任务 ${task.taskId} 不一致`);
  }

  const changed = collectChangedFiles(payload?.changedFiles);
  for (const file of changed) {
    if (isStatePlanePath(file)) {
      errors.push(`changedFiles：不得声明编排状态面生成物 ${file}（由 CLI / run-once 自动产出）`);
    }
  }
  if (task) {
    const { residual } = detectResidualFiles(changed, task);
    for (const file of residual) {
      if (isStatePlanePath(file)) continue;
      errors.push(`changedFiles：超出任务 scope ${file}`);
    }
  }

  if (payload?.finalStatus === 'completed' && !REVIEW_VERDICTS.includes(payload?.reviewVerdict)) {
    errors.push(`reviewVerdict：completed 回执必须是 ${REVIEW_VERDICTS.join(' / ')}，当前 ${String(payload?.reviewVerdict)}`);
  }

  const refs = payload?.artifactRefs ?? {};
  const refsToCheck = [refs.taskSheet, refs.deliveryRecord, refs.reply, ...(Array.isArray(refs.others) ? refs.others : [])];
  for (const ref of refsToCheck) {
    if (typeof ref !== 'string' || ref.length === 0) continue;
    const abs = resolve(repoRoot, ref);
    if (!isWithinRepo(abs, repoRoot)) {
      errors.push(`artifactRefs：越界路径 ${ref}`);
      continue;
    }
    if (!existsSync(abs)) {
      errors.push(`artifactRefs：文件不存在 ${ref}`);
      continue;
    }
    try {
      if (!statSync(abs).isFile()) errors.push(`artifactRefs：不是文件 ${ref}`);
    } catch (err) {
      errors.push(`artifactRefs：无法读取 ${ref}（${err.message}）`);
    }
  }

  if (typeof refs.deliveryRecord === 'string' && refs.deliveryRecord.length > 0) {
    const abs = resolve(repoRoot, refs.deliveryRecord);
    if (existsSync(abs)) {
      try {
        const inspect = inspectTextFile(abs);
        if (inspect.crCount > 0) {
          errors.push(`交付记录：含 ${inspect.crCount} 个 CR，请先执行 docs normalize --path ${refs.deliveryRecord} --apply`);
        }
        if (inspect.hasBom) {
          errors.push(`交付记录：含 UTF-8 BOM，请先执行 docs normalize --path ${refs.deliveryRecord} --apply`);
        }
      } catch (err) {
        errors.push(`交付记录：无法读取 ${refs.deliveryRecord}（${err.message}）`);
      }
    }
  }

  if (Array.isArray(payload?.gateResults) && payload.gateResults.some((gate) => typeof gate?.command === 'string' && /<[^>]+>|TODO|待补/.test(gate.command))) {
    warnings.push('gateResults：存在占位命令，交付前请替换为真实命令');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 从文件读取回执并预检（兼容 {deliveredAt,payload} 包装）。
 * @param {string} receiptFile 回执文件绝对路径
 * @param {object} task 状态索引任务条目
 * @param {{repoRoot?: string}} opts
 */
export function lintReceiptFile(receiptFile, task, opts = {}) {
  let record;
  try {
    record = JSON.parse(readFileSync(receiptFile, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`回执 JSON 解析失败：${err.message}`], warnings: [] };
  }
  return lintReceiptPayload(record?.payload ?? record, task, opts);
}
