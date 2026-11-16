/**
 * AF-008 · 协议映射层（纯函数，零副作用，厂商中立）。
 *
 * 把框架内部任务 / 状态 / 工件 / 归组标识 / Agent Card 映射为标准协议模型只读投影；
 * 不回写索引、不绑定特定代理协议 / 厂商。状态映射直接复用框架 `contract-enums.json`
 * 的 `statusMap`（唯一真相源）：编排前置态 backlog / ready 的标准协议态为 **null**，
 * 禁止虚构 DRAFT / QUEUED；阶段归类按 `protocol-view.schema.json` 四值词汇
 * （orchestration / active / interrupted / terminal）。
 */

import { STATUS_MAP } from './contract-enums.mjs';

/** 协议视图契约标识（框架 protocol-view 1.0.0）。 */
export const PROTOCOL_CONTRACT_REF = 'urn:agent-collaboration-framework:schema:protocol-view:1.0.0';

/** 状态阶段归类：编排前置 / 活跃 / 中断 / 终态（对齐 protocol-view schema 枚举）。 */
const STAGE_MAP = {
  backlog: 'orchestration',
  ready: 'orchestration',
  submitted: 'active',
  working: 'active',
  'input-required': 'interrupted',
  'auth-required': 'interrupted',
  completed: 'terminal',
  failed: 'terminal',
  canceled: 'terminal',
  rejected: 'terminal',
};

/** 状态映射：返回框架态、标准协议态（前置态为 null）与阶段归类。 */
export function mapStatus(status) {
  return {
    framework: status,
    protocol: STATUS_MAP[status] ?? null,
    stage: STAGE_MAP[status] ?? 'orchestration',
  };
}

/**
 * 工件指针 → 工件引用数组；兼容对象（kind → ref）与数组（裸 ref）两种现状。
 * 协议视图要求 `ref` 为非空字符串，空指针直接剔除，不产出不可消费的引用。
 */
export function mapArtifactReferences(artifacts) {
  if (!artifacts) return [];
  const refs = Array.isArray(artifacts)
    ? artifacts.map((ref) => ({ kind: null, ref }))
    : Object.entries(artifacts).map(([kind, ref]) => ({ kind, ref: ref ?? null }));
  return refs.filter((item) => typeof item.ref === 'string' && item.ref.length > 0);
}

/** 运行态任务 → 标准任务模型；缺失展示字段用 taskId 兜底，承接角色取历史末次执行方。 */
export function mapTask(task) {
  const lastBy = Array.isArray(task.history) && task.history.length > 0 ? task.history[task.history.length - 1]?.by : null;
  return {
    taskId: task.taskId,
    title: task.title ?? task.taskId,
    type: task.type ?? null,
    status: mapStatus(task.status),
    groupId: task.contextId ?? null,
    requiredSkills: task.requiredSkills ?? [],
    dependsOn: task.dependsOn ?? [],
    agentRole: task.agentRole ?? task.agent ?? lastBy ?? null,
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
 * `tasks` 只投影运行态任务（符合框架 protocol-view schema 的必填面）；归档条目按框架
 * §6.1 是轻量指针，单列在扩展段 `archivedTasks`，不塞进 `tasks` 伪造缺失字段。
 * `unknownStatuses` 落实适配层声明的 `unknownEnumPolicy: tolerant`：未知状态值原样透传并单列，
 * 供人工复核，不静默丢弃、不猜造标准态。
 * @param {{tasks?: object[], archivedTasks?: object[], agentCards?: object[]}} input
 * @returns {{contractRef: string, tasks: object[], archivedTasks: object[], statusMap: object, artifacts: object[], groupId: string|null, groupIds: string[], capabilityDeclarations: object[], unknownStatuses: string[]}}
 */
export function buildProtocolView({ tasks = [], archivedTasks = [], agentCards = [] } = {}) {
  const active = tasks.map(mapTask);
  const archived = archivedTasks.map((task) => ({
    taskId: task.taskId,
    status: mapStatus(task.status),
    artifactReferences: mapArtifactReferences(task.artifacts),
  }));
  const artifacts = active.flatMap((task) => task.artifactReferences.map((ref) => ({ taskId: task.taskId, ...ref })));
  const groupIds = [...new Set(active.map((task) => task.groupId).filter(Boolean))];
  const unknownStatuses = [...new Set([...active, ...archived].map((task) => task.status.framework).filter((s) => !(s in STATUS_MAP)))];
  return {
    contractRef: PROTOCOL_CONTRACT_REF,
    tasks: active,
    archivedTasks: archived,
    statusMap: { ...STATUS_MAP },
    artifacts,
    groupId: groupIds[0] ?? null,
    groupIds,
    capabilityDeclarations: agentCards.map(mapCapabilityDeclaration),
    unknownStatuses,
  };
}
