/**
 * AF-009 · 交接契约结构、校验纯函数与构造器（适配层投影，零副作用）。
 *
 * 三组交接件：
 *   task     —— 任务交接件：由状态索引任务记录投影，承载标识 / 目标 / 切片 / 能力 / 门禁；
 *   receipt  —— 回执交接件：头部任务标识 + 回执七组字段（框架 receipt-contract.md §1）；
 *   review   —— 方案协商轮意见：executor 提第二意见，orchestrator 裁决回写结论。
 *
 * 口径真相源在框架仓：`schemas/task-sheet.schema.json`、`docs/task-contract.md`、
 * `docs/receipt-contract.md`；枚举与标识模式真相源为框架仓 `schemas/contract-enums.json`，
 * 本仓同目录 `contract-enums.json` 为其 vendored 投影，经共享模块 `contract-enums.mjs`
 * 唯一加载。本模块只做适配层投影与结构 / 枚举 / 模式校验，不复制阈值口径，不回写
 * 索引，不做文件存在性检查（存在性归验收层）。契约字段只增不删；既有交接件行为保持不变。
 */

import {
  CONTRACT_REF_PATTERN,
  ROLES,
  TASK_ID_PATTERN,
  TASK_TYPES,
  TASK_STATUSES,
  TERMINAL_STATUSES,
  REVIEW_VERDICTS,
} from './contract-enums.mjs';

/**
 * 交接件契约引用（框架 2.0.0 用 `contractRef` urn 取代 `schemaVersion` 数字串，
 * 消费端按 urn 分派解析；版本真相源为框架仓 `schemas/versions.json`）。
 */
export const TASK_CONTRACT_REF = 'urn:agent-collaboration-framework:schema:task-sheet:1.1.0';
export const RECEIPT_CONTRACT_REF = 'urn:agent-collaboration-framework:schema:receipt:1.0.0';
export const REVIEW_CONTRACT_REF = 'urn:agent-collaboration-framework:schema:review-handover:1.1.0';

/** 任务类型 / 状态 / 终态 / 验收结论枚举（共享投影派生）。 */
export { TASK_TYPES, TASK_STATUSES, TERMINAL_STATUSES, REVIEW_VERDICTS };

/** 回执七组字段（框架 receipt-contract.md §1，逐字同名；契约版本以 contractRef 表达）。 */
export const RECEIPT_GROUPS = {
  landing: ['changedFiles', 'artifactRefs'],
  evidence: ['gateResults', 'reproNotes'],
  scope: ['scopeCheck', 'parallelArtifactsExcluded', 'noOutscopeRefactor'],
  contract: ['contractChecks', 'contractRef', 'fieldAlignment'],
  legacy: ['backlogItems', 'openQuestions', 'manualReviewList'],
  deviation: ['deviationTable'],
  verdict: ['finalStatus', 'reviewVerdict', 'verdictRationale'],
};

/** date-time（必须带时区偏移或 Z；框架 2.0.0 时间字段口径）。 */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isDateTime(value) {
  return typeof value === 'string' && DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

/** 回执头部标识字段（框架 receipt-contract.md §2）。 */
const RECEIPT_HEADERS = ['taskId', 'contextId', 'type', 'baselineRef', 'dependsOn', 'policyRefs'];

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

/** 路径安全：相对仓根、不含 `..` 段、非绝对路径（存在性检查不在本模块）。 */
function isSafeRelPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\')) return false;
  return !path.split(/[\\/]+/).includes('..');
}

function pushError(errors, field, message) {
  errors.push(`${field}: ${message}`);
}

/**
 * 校验任务交接件结构。
 * @param {object} input 任务交接件
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTaskHandover(input) {
  const errors = [];
  if (!isObject(input)) {
    return { valid: false, errors: ['交接件不是对象'] };
  }
  const { taskId, contextId, type, title, status, createdAt } = input;

  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    pushError(errors, 'taskId', '缺失或不符合 ^[A-Z0-9]+-[0-9]+$ 模式');
  }
  if (typeof contextId !== 'string' || contextId.length === 0) {
    pushError(errors, 'contextId', '缺失或为空');
  }
  if (!TASK_TYPES.includes(type)) {
    pushError(errors, 'type', `必须为枚举之一：${TASK_TYPES.join(' / ')}`);
  }
  if (typeof title !== 'string' || title.length === 0) {
    pushError(errors, 'title', '缺失或为空');
  }
  if (!TASK_STATUSES.includes(status)) {
    pushError(errors, 'status', `必须为枚举之一：${TASK_STATUSES.join(' / ')}`);
  }
  if (!isDateTime(createdAt)) {
    pushError(errors, 'createdAt', '缺失或非 date-time（须带时区偏移，如 2026-11-16T10:00:00+08:00 或 ...Z）');
  }
  if (input.contractRef !== undefined && !(typeof input.contractRef === 'string' && CONTRACT_REF_PATTERN.test(input.contractRef))) {
    pushError(errors, 'contractRef', '必须为契约引用 urn（urn:<domain>:schema:<contract>:<version>）');
  }
  if (input.agentRole !== undefined && input.agentRole !== null && !ROLES.includes(input.agentRole)) {
    pushError(errors, 'agentRole', `必须为可派发角色枚举之一：${ROLES.join(' / ')}（human 不可派发）`);
  }
  if (input.dependsOn !== undefined && !isStringArray(input.dependsOn)) {
    pushError(errors, 'dependsOn', '必须为非空字符串数组');
  } else if (Array.isArray(input.dependsOn)) {
    const bad = input.dependsOn.find((id) => !TASK_ID_PATTERN.test(id));
    if (bad) pushError(errors, 'dependsOn', `元素 ${bad} 不符合 taskId 模式`);
  }
  if (input.priorTasks !== undefined && !isStringArray(input.priorTasks)) {
    pushError(errors, 'priorTasks', '必须为非空字符串数组');
  } else if (Array.isArray(input.priorTasks)) {
    const bad = input.priorTasks.find((id) => !TASK_ID_PATTERN.test(id));
    if (bad) pushError(errors, 'priorTasks', `元素 ${bad} 不符合 taskId 模式`);
  }
  if (input.policyRefs !== undefined && !isStringArray(input.policyRefs)) {
    pushError(errors, 'policyRefs', '必须为非空字符串数组');
  }
  if (input.scope !== undefined) {
    if (!isObject(input.scope)) {
      pushError(errors, 'scope', '必须为对象');
    } else {
      for (const key of ['files', 'modules', 'interfaces']) {
        const value = input.scope[key];
        if (value !== undefined && !isStringArray(value)) {
          pushError(errors, `scope.${key}`, '必须为非空字符串数组');
        }
      }
      const unsafe = (input.scope.files ?? []).find((path) => !isSafeRelPath(path));
      if (unsafe) pushError(errors, 'scope.files', `路径 ${unsafe} 越界或非相对路径`);
    }
  }
  // 任务单契约 artifacts 是产出清单数组；索引侧指针对象不得直接塞进交接件。
  if (input.artifacts !== undefined && !Array.isArray(input.artifacts)) {
    pushError(errors, 'artifacts', '必须为产出清单数组（索引指针请放 artifactPointers）');
  } else if (Array.isArray(input.artifacts)) {
    for (const [i, artifact] of input.artifacts.entries()) {
      if (!isObject(artifact)) {
        pushError(errors, `artifacts[${i}]`, '必须为对象');
        continue;
      }
      if (typeof artifact.name !== 'string' || artifact.name.length === 0) pushError(errors, `artifacts[${i}].name`, '缺失或为空');
      if (typeof artifact.path !== 'string' || !isSafeRelPath(artifact.path))
        pushError(errors, `artifacts[${i}].path`, '缺失、越界或非相对路径');
      if (typeof artifact.kind !== 'string' || artifact.kind.length === 0) pushError(errors, `artifacts[${i}].kind`, '缺失或为空');
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 校验回执交接件结构（头部标识 + 七组字段存在性）。
 * @param {object} input 回执交接件
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateReceiptHandover(input) {
  const errors = [];
  if (!isObject(input)) {
    return { valid: false, errors: ['交接件不是对象'] };
  }
  if (typeof input.taskId !== 'string' || !TASK_ID_PATTERN.test(input.taskId)) {
    pushError(errors, 'taskId', '缺失或不符合 taskId 模式');
  }
  for (const header of RECEIPT_HEADERS) {
    if (header === 'taskId') continue;
    if (input[header] === undefined) pushError(errors, header, '回执头部标识缺失');
  }
  if (!TERMINAL_STATUSES.includes(input.finalStatus)) {
    pushError(errors, 'finalStatus', `必须为枚举之一：${TERMINAL_STATUSES.join(' / ')}`);
  }
  // 未经验收的 failed 任务允许 reviewVerdict=null（框架 receipt.schema enum 含 null）。
  if (input.reviewVerdict !== null && !REVIEW_VERDICTS.includes(input.reviewVerdict)) {
    pushError(errors, 'reviewVerdict', `必须为 null 或枚举之一：${REVIEW_VERDICTS.join(' / ')}`);
  }
  if (typeof input.verdictRationale !== 'string' || input.verdictRationale.length === 0) {
    pushError(errors, 'verdictRationale', '缺失或为空');
  }
  // 以下形状对齐框架 receipt.schema.json：运行态摄入不得接受 CLI 会拒绝的宽松结构。
  if (!['in-scope', 'deviated'].includes(input.scopeCheck)) {
    pushError(errors, 'scopeCheck', '必须为 in-scope / deviated');
  }
  if (typeof input.reproNotes !== 'string' || input.reproNotes.length === 0) {
    pushError(errors, 'reproNotes', '缺失或为空');
  }
  for (const flag of ['parallelArtifactsExcluded', 'noOutscopeRefactor']) {
    if (typeof input[flag] !== 'boolean') pushError(errors, flag, '必须为 boolean');
  }
  if (!isObject(input.changedFiles) || !['added', 'modified', 'deleted'].every((key) => Array.isArray(input.changedFiles[key]))) {
    pushError(errors, 'changedFiles', '必须为对象 {added[], modified[], deleted[]}');
  }
  if (!Array.isArray(input.gateResults) || input.gateResults.length === 0) {
    pushError(errors, 'gateResults', '必须为非空数组');
  } else {
    for (const [i, gate] of input.gateResults.entries()) {
      if (!isObject(gate)) {
        pushError(errors, `gateResults[${i}]`, '必须为对象');
        continue;
      }
      if (typeof gate.command !== 'string' || gate.command.length === 0) pushError(errors, `gateResults[${i}].command`, '缺失或为空');
      for (const key of ['exitCode', 'errors', 'warnings']) {
        if (!Number.isInteger(gate[key])) pushError(errors, `gateResults[${i}].${key}`, '必须为整数');
      }
    }
  }
  if (!Array.isArray(input.contractChecks) || input.contractChecks.length === 0) {
    pushError(errors, 'contractChecks', '必须为非空数组');
  } else {
    for (const [i, check] of input.contractChecks.entries()) {
      if (!isObject(check)) {
        pushError(errors, `contractChecks[${i}]`, '必须为对象');
        continue;
      }
      if (typeof check.item !== 'string' || check.item.length === 0) pushError(errors, `contractChecks[${i}].item`, '缺失或为空');
      if (!['pass', 'fail', 'not-applicable'].includes(check.result)) {
        pushError(errors, `contractChecks[${i}].result`, '必须为 pass / fail / not-applicable');
      }
    }
  }
  if (!isObject(input.fieldAlignment) || !['aligned', 'misaligned'].includes(input.fieldAlignment.result)) {
    pushError(errors, 'fieldAlignment', '必须为对象且 result 为 aligned / misaligned');
  }
  if (!Array.isArray(input.backlogItems)) {
    pushError(errors, 'backlogItems', '必须为数组');
  } else {
    for (const [i, item] of input.backlogItems.entries()) {
      if (
        !isObject(item) ||
        typeof item.id !== 'string' ||
        item.id.length === 0 ||
        typeof item.impact !== 'string' ||
        item.impact.length === 0
      ) {
        pushError(errors, `backlogItems[${i}]`, '必须为对象且 id / impact 非空');
      }
    }
  }
  for (const key of ['openQuestions', 'manualReviewList']) {
    if (!Array.isArray(input[key]) || input[key].some((item) => typeof item !== 'string' || item.length === 0)) {
      pushError(errors, key, '必须为字符串数组');
    }
  }
  if (!Array.isArray(input.deviationTable)) {
    pushError(errors, 'deviationTable', '必须为数组');
  } else if (input.deviationTable.length === 0) {
    if (input.deviationAbsent !== true) pushError(errors, 'deviationAbsent', '无偏差时须显式置 true');
  } else {
    for (const [i, row] of input.deviationTable.entries()) {
      if (!isObject(row)) {
        pushError(errors, `deviationTable[${i}]`, '必须为对象');
        continue;
      }
      for (const key of ['taskSays', 'reality', 'action', 'why']) {
        if (typeof row[key] !== 'string' || row[key].length === 0) pushError(errors, `deviationTable[${i}].${key}`, '缺失或为空');
      }
    }
  }
  for (const groupFields of Object.values(RECEIPT_GROUPS)) {
    for (const field of groupFields) {
      if (field === 'finalStatus' || field === 'reviewVerdict' || field === 'verdictRationale') continue;
      if (input[field] === undefined) pushError(errors, field, `回执七组字段缺失（${field}）`);
    }
  }
  // artifactRefs 是对象（taskSheet / deliveryRecord / reply / others），不是数组。
  if (!isObject(input.artifactRefs)) {
    pushError(errors, 'artifactRefs', '必须为对象 {taskSheet, deliveryRecord, reply?, others?}');
  } else {
    for (const key of ['taskSheet', 'deliveryRecord']) {
      const value = input.artifactRefs[key];
      if (!isSafeRelPath(value)) pushError(errors, `artifactRefs.${key}`, '缺失、越界或非相对路径');
    }
    if (input.artifactRefs.reply !== undefined && input.artifactRefs.reply !== null && !isSafeRelPath(input.artifactRefs.reply)) {
      pushError(errors, 'artifactRefs.reply', '越界或非相对路径');
    }
    const unsafe = (input.artifactRefs.others ?? []).find((ref) => !isSafeRelPath(ref));
    if (unsafe) pushError(errors, 'artifactRefs.others', `存在越界或非相对路径工件指针：${String(unsafe)}`);
  }
  if (input.contractRef !== undefined && !(typeof input.contractRef === 'string' && CONTRACT_REF_PATTERN.test(input.contractRef))) {
    pushError(errors, 'contractRef', '必须为契约引用 urn');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 校验协商轮意见交接件结构。
 * @param {object} input review 交接件
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateReviewHandover(input) {
  const errors = [];
  if (!isObject(input)) {
    return { valid: false, errors: ['交接件不是对象'] };
  }
  if (typeof input.reviewId !== 'string' || input.reviewId.length === 0) {
    pushError(errors, 'reviewId', '缺失或为空');
  }
  if (typeof input.taskId !== 'string' || !TASK_ID_PATTERN.test(input.taskId)) {
    pushError(errors, 'taskId', '缺失或不符合 taskId 模式');
  }
  if (typeof input.contextId !== 'string' || input.contextId.length === 0) {
    pushError(errors, 'contextId', '缺失或为空');
  }
  for (const field of ['proposal', 'risks', 'alternatives', 'disputes', 'recommendation']) {
    if (input[field] === undefined) pushError(errors, field, '协商轮意见字段缺失');
  }
  if (typeof input.createdBy !== 'string' || input.createdBy.length === 0) {
    pushError(errors, 'createdBy', '缺失或为空');
  }
  if (typeof input.createdAt !== 'string' || input.createdAt.length === 0) {
    pushError(errors, 'createdAt', '缺失或为空');
  } else if (!isDateTime(input.createdAt)) {
    pushError(errors, 'createdAt', '非 date-time（须带时区偏移）');
  }
  if (input.resolution !== undefined) {
    if (!isObject(input.resolution)) {
      pushError(errors, 'resolution', '必须为对象');
    } else if (input.resolution.decision === undefined) {
      pushError(errors, 'resolution.decision', '裁决结论缺失');
    }
  }
  return { valid: errors.length === 0, errors };
}

/** 构造任务交接件：从索引任务记录投影，补契约版本与来源追溯字段。 */
export function buildTaskHandover(record, { producedBy = 'orchestrator' } = {}) {
  const {
    taskId,
    parentTaskId,
    contextId,
    type,
    title,
    status,
    baselineRef,
    dependsOn,
    priorTasks,
    policyRefs,
    createdAt,
    objective,
    successCriteria,
    outOfScope,
    scope,
    exclusions,
    requiredSkills,
    requiredTools,
    agentRole,
    plannedArtifacts,
    artifacts,
    artifactSchema,
    deliveryPath,
    gates,
    evidenceFormat,
    escalationTriggers,
    priority,
    deadline,
    retention,
    references,
    constraints,
  } = record ?? {};
  const handover = {
    handoverKind: 'task',
    contractRef: TASK_CONTRACT_REF,
    taskId,
    contextId,
    type,
    title,
    status,
    baselineRef: baselineRef ?? null,
    dependsOn: dependsOn ?? [],
    priorTasks: priorTasks ?? [],
    policyRefs: policyRefs ?? [],
    createdAt,
    objective: objective ?? null,
    successCriteria: successCriteria ?? [],
    outOfScope: outOfScope ?? [],
    scope: scope ?? { files: [], modules: [], interfaces: [] },
    exclusions: exclusions ?? [],
    requiredSkills: requiredSkills ?? [],
    requiredTools: requiredTools ?? [],
    // 契约字段 artifacts 是产出清单数组；索引侧的 {taskSheet, deliveryRecord, reply}
    // 是运行态指针，放在扩展字段 artifactPointers，不能冒充产出清单。
    artifacts: Array.isArray(plannedArtifacts) ? plannedArtifacts : [],
    artifactPointers: artifacts ?? {},
    gates: gates ?? [],
    priority: priority ?? null,
    deadline: deadline ?? null,
    retention: retention ?? null,
    references: references ?? [],
    constraints: constraints ?? [],
    producedBy,
    producedAt: new Date().toISOString(),
  };
  for (const key of ['parentTaskId', 'artifactSchema', 'deliveryPath', 'evidenceFormat', 'escalationTriggers']) {
    if (record?.[key] !== undefined) handover[key] = record[key];
  }
  // agentRole 为可选字段：未指派时省略（不写 null，避免与角色枚举冲突）。
  if (agentRole) handover.agentRole = agentRole;
  return handover;
}

/** 构造回执交接件：头部标识 + 七组字段原样携带，补契约引用与来源追溯字段。 */
export function buildReceiptHandover(receipt, { producedBy = 'executor' } = {}) {
  return {
    handoverKind: 'receipt',
    contractRef: RECEIPT_CONTRACT_REF,
    ...receipt,
    producedBy,
    producedAt: new Date().toISOString(),
  };
}

/** 构造协商轮意见交接件；裁决结论经 resolution 字段回写。 */
export function buildReviewHandover(review, { producedBy = 'executor' } = {}) {
  return {
    handoverKind: 'review',
    contractRef: REVIEW_CONTRACT_REF,
    ...review,
    producedBy,
    producedAt: new Date().toISOString(),
  };
}
