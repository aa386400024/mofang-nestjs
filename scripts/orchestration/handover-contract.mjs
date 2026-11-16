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
  if (!REVIEW_VERDICTS.includes(input.reviewVerdict)) {
    pushError(errors, 'reviewVerdict', `必须为枚举之一：${REVIEW_VERDICTS.join(' / ')}`);
  }
  if (typeof input.verdictRationale !== 'string' || input.verdictRationale.length === 0) {
    pushError(errors, 'verdictRationale', '缺失或为空');
  }
  for (const groupFields of Object.values(RECEIPT_GROUPS)) {
    for (const field of groupFields) {
      if (field === 'finalStatus' || field === 'reviewVerdict' || field === 'verdictRationale') continue;
      if (input[field] === undefined) pushError(errors, field, `回执七组字段缺失（${field}）`);
    }
  }
  const unsafe = (input.artifactRefs ?? []).find((ref) =>
    isObject(ref) ? !isSafeRelPath(ref.path ?? ref.ref ?? '') : !isSafeRelPath(ref),
  );
  if (unsafe) pushError(errors, 'artifactRefs', '存在越界或非相对路径工件指针');
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
    artifacts,
    gates,
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
    artifacts: artifacts ?? [],
    gates: gates ?? [],
    priority: priority ?? null,
    deadline: deadline ?? null,
    retention: retention ?? null,
    references: references ?? [],
    constraints: constraints ?? [],
    producedBy,
    producedAt: new Date().toISOString(),
  };
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
