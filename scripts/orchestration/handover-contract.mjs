/**
 * AF-009 · 交接契约结构、校验纯函数与构造器（适配层投影，零副作用）。
 *
 * 三组交接件：
 *   task     —— 任务交接件：由状态索引任务记录投影，承载标识 / 目标 / 切片 / 能力 / 门禁；
 *   receipt  —— 回执交接件：头部任务标识 + 回执七组字段（框架 receipt-contract.md §1）；
 *   review   —— 方案协商轮意见：executor 提第二意见，orchestrator 裁决回写结论。
 *
 * 口径真相源在框架仓：`schemas/task-sheet.schema.json`、`docs/task-contract.md`、
 * `docs/receipt-contract.md`。本模块只做适配层投影与结构 / 枚举 / 模式校验，
 * 不复制阈值口径，不回写索引，不做文件存在性检查（存在性归验收层）。
 * 契约字段只增不删；既有交接件行为保持不变。
 */

/** 交接件契约版本（随数据下发，消费端按版本分派解析）。 */
export const HANDOVER_SCHEMA_VERSION = '1.0.0';

/** 任务类型枚举（镜像框架 task-sheet.schema.json §type）。 */
export const TASK_TYPES = ['implementation', 'review', 'investigation', 'documentation', 'fix', 'verification'];

/** 任务状态枚举（镜像框架 state-machine.md §1，含编排前置态）。 */
export const TASK_STATUSES = [
  'backlog',
  'ready',
  'submitted',
  'working',
  'input-required',
  'auth-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
];

/** 回执终态枚举（框架 receipt-contract.md §2）。 */
export const FINAL_STATUSES = ['completed', 'failed', 'rejected'];

/** 验收三级结论（框架 acceptance.md §4 / receipt-contract.md §1）。 */
export const REVIEW_VERDICTS = ['passed', 'conditional-pass', 'rejected'];

/** taskId 模式（镜像框架 task-sheet.schema.json）。 */
const TASK_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;

/** 回执七组字段（框架 receipt-contract.md §1，逐字同名）。 */
export const RECEIPT_GROUPS = {
  landing: ['changedFiles', 'artifactRefs'],
  evidence: ['gateResults', 'reproNotes'],
  scope: ['scopeCheck', 'parallelArtifactsExcluded', 'noOutscopeRefactor'],
  contract: ['contractChecks', 'schemaVersion', 'fieldAlignment'],
  legacy: ['backlogItems', 'openQuestions', 'manualReviewList'],
  deviation: ['deviationTable'],
  verdict: ['finalStatus', 'reviewVerdict', 'verdictRationale'],
};

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
  if (typeof createdAt !== 'string' || createdAt.length === 0) {
    pushError(errors, 'createdAt', '缺失或为空（ISO 日期）');
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
  if (!FINAL_STATUSES.includes(input.finalStatus)) {
    pushError(errors, 'finalStatus', `必须为枚举之一：${FINAL_STATUSES.join(' / ')}`);
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
    pushError(errors, 'createdAt', '缺失或为空（ISO 日期）');
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
  return {
    handoverKind: 'task',
    schemaVersion: HANDOVER_SCHEMA_VERSION,
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
    agentRole: agentRole ?? null,
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
}

/** 构造回执交接件：头部标识 + 七组字段原样携带，补契约版本与来源追溯字段。 */
export function buildReceiptHandover(receipt, { producedBy = 'executor' } = {}) {
  return {
    handoverKind: 'receipt',
    schemaVersion: HANDOVER_SCHEMA_VERSION,
    ...receipt,
    producedBy,
    producedAt: new Date().toISOString(),
  };
}

/** 构造协商轮意见交接件；裁决结论经 resolution 字段回写。 */
export function buildReviewHandover(review, { producedBy = 'executor' } = {}) {
  return {
    handoverKind: 'review',
    schemaVersion: HANDOVER_SCHEMA_VERSION,
    ...review,
    producedBy,
    producedAt: new Date().toISOString(),
  };
}
