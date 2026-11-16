/**
 * AF-008 · 协议映射层（纯函数，零副作用，厂商中立）。
 *
 * 把框架内部任务 / 状态 / 工件 / 归组标识 / Agent Card 映射为标准协议模型只读投影；
 * 不回写索引、不绑定特定代理协议 / 厂商。状态映射对齐框架 docs/state-machine.md §2：
 * 编排前置态 backlog / ready 在标准侧标 DRAFT / QUEUED 概念位，不另造标准状态值。
 */

/** 框架状态 → 标准大写状态值（state-machine.md §2）。 */
const STATUS_MAP = {
  backlog: 'DRAFT',
  ready: 'QUEUED',
  submitted: 'SUBMITTED',
  working: 'WORKING',
  'input-required': 'INPUT_REQUIRED',
  'auth-required': 'AUTH_REQUIRED',
  completed: 'COMPLETED',
  failed: 'FAILED',
  canceled: 'CANCELED',
  rejected: 'REJECTED',
};

/** 状态阶段归类：编排前置 / 活跃 / 终态。 */
const STAGE_MAP = {
  backlog: 'prelude',
  ready: 'prelude',
  submitted: 'active',
  working: 'active',
  'input-required': 'active',
  'auth-required': 'active',
  completed: 'terminal',
  failed: 'terminal',
  canceled: 'terminal',
  rejected: 'terminal',
};

/** 状态映射：返回框架态、标准协议态与阶段归类。 */
export function mapStatus(status) {
  return {
    framework: status,
    protocol: STATUS_MAP[status] ?? 'UNKNOWN',
    stage: STAGE_MAP[status] ?? 'unknown',
  };
}

/**
 * 工件指针 → 工件引用数组；兼容对象（kind → ref）与数组（裸 ref）两种现状。
 */
export function mapArtifactReferences(artifacts) {
  if (!artifacts) return [];
  if (Array.isArray(artifacts)) {
    return artifacts.map((ref) => ({ kind: null, ref }));
  }
  return Object.entries(artifacts).map(([kind, ref]) => ({ kind, ref: ref ?? null }));
}

/** 任务单 → 标准任务模型。 */
export function mapTask(task) {
  return {
    taskId: task.taskId,
    title: task.title ?? null,
    type: task.type ?? null,
    status: mapStatus(task.status),
    groupId: task.contextId ?? null,
    requiredSkills: task.requiredSkills ?? [],
    dependsOn: task.dependsOn ?? [],
    agentRole: task.agentRole ?? null,
    artifactReferences: mapArtifactReferences(task.artifacts),
  };
}

/** Agent Card → 能力声明模型。 */
export function mapCapabilityDeclaration(card) {
  return {
    agentId: card.agentId,
    role: card.role,
    skills: card.skills ?? [],
    tools: card.tools ?? [],
    resources: card.resources ?? [],
    limits: card.limits ?? null,
    availability: card.availability,
  };
}

/** 归组标识映射：contextId 原样透传为中性 groupId。 */
export function mapGroupId(contextId) {
  return contextId ?? null;
}

/**
 * 构建协议视图（只读投影，不回写索引）。
 * `unknownStatuses` 落实适配层声明的 `unknownEnumPolicy: tolerant`：未知状态值原样透传并单列，
 * 供人工复核，不静默丢弃、不猜造标准态。
 * @param {{tasks?: object[], archivedTasks?: object[], agentCards?: object[]}} input
 * @returns {{tasks: object[], statusMap: object, artifacts: object[], groupId: string|null, groupIds: string[], capabilityDeclarations: object[], unknownStatuses: string[]}}
 */
export function buildProtocolView({ tasks = [], archivedTasks = [], agentCards = [] } = {}) {
  const active = tasks.map(mapTask);
  const archived = archivedTasks.map((task) => ({ ...mapTask(task), archived: true }));
  const allTasks = [...active, ...archived];
  const artifacts = allTasks.flatMap((task) => task.artifactReferences.map((ref) => ({ taskId: task.taskId, ...ref })));
  const groupIds = [...new Set(allTasks.map((task) => task.groupId).filter(Boolean))];
  const unknownStatuses = [...new Set(allTasks.map((task) => task.status.framework).filter((s) => !(s in STATUS_MAP)))];
  return {
    tasks: allTasks,
    statusMap: { ...STATUS_MAP },
    artifacts,
    groupId: groupIds[0] ?? null,
    groupIds,
    capabilityDeclarations: agentCards.map(mapCapabilityDeclaration),
    unknownStatuses,
  };
}
