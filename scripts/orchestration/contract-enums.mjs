/**
 * 契约枚举与标识模式共享投影（adapter 层；纯数据派生，零副作用）。
 *
 * 口径真相源在框架仓 `schemas/contract-enums.json`；本仓同目录 `contract-enums.json`
 * 为其 vendored 投影（框架 2.0.0，随本仓 git 评审并锁定），护栏单测对账取值集合与
 * 版本锚点。本模块是投影数据的唯一加载点：各编排消费方一律从本模块导入派生枚举与
 * 标识模式，不再各自读 JSON 或手写正则 / 枚举字面量镜像。
 *
 * 2.0.0 口径变化：
 *   - `finalStatuses` 更名为 `terminalStatuses`，取值扩为 4 个（新增 canceled）；
 *   - 新增 `roles`（5 值，移除 human）/ `nonRoutableRoles` / `toolCategories` /
 *     `artifactKinds` / `availabilities` / `transitions` / `statusMap` 等键；
 *   - 标识模式新增 `contractRefPattern`（契约引用 urn 形式）。
 *
 * 演进路径：框架仓发布版本化契约制品（契约包）后，本模块可替换为依赖包 import，
 * 消费方导入签名不变。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** vendored 枚举投影原始对象（框架仓 contract-enums.json 2.0.0 副本）。 */
export const CONTRACT_ENUMS = JSON.parse(readFileSync(join(__dirname, 'contract-enums.json'), 'utf8'));

/** 枚举投影版本（对齐框架 enums 轴）。 */
export const ENUMS_VERSION = CONTRACT_ENUMS.schemaVersion;

/** 任务类型枚举。 */
export const TASK_TYPES = [...CONTRACT_ENUMS.taskTypes];

/** 任务状态枚举（含冻结态 auth-required）。 */
export const TASK_STATUSES = [...CONTRACT_ENUMS.taskStatuses];

/** 终态枚举（completed / failed / canceled / rejected）。 */
export const TERMINAL_STATUSES = [...CONTRACT_ENUMS.terminalStatuses];

/** 冻结态枚举（auth-required：只入不出，缺授权一律转 input-required）。 */
export const FROZEN_STATUSES = [...CONTRACT_ENUMS.frozenStatuses];

/** 可派发角色枚举（不含 human）。 */
export const ROLES = [...CONTRACT_ENUMS.roles];

/** 非可派发角色（human：人工审批节点，不参与路由，不产出 Agent Card）。 */
export const NON_ROUTABLE_ROLES = [...CONTRACT_ENUMS.nonRoutableRoles];

/** 验收三级结论。 */
export const REVIEW_VERDICTS = [...CONTRACT_ENUMS.reviewVerdicts];

/** 工具副作用分级。 */
export const SIDE_EFFECTS = [...CONTRACT_ENUMS.sideEffects];

/** 工具类别（8 值）。 */
export const TOOL_CATEGORIES = [...CONTRACT_ENUMS.toolCategories];

/** 工件类型（8 值）。 */
export const ARTIFACT_KINDS = [...CONTRACT_ENUMS.artifactKinds];

/** 代理可用性（4 值）。 */
export const AVAILABILITIES = [...CONTRACT_ENUMS.availabilities];

/** 失败原因码（11 值）。 */
export const FAILURE_REASON_CODES = [...CONTRACT_ENUMS.failureReasonCodes];

/** 审批节点（6 值）。 */
export const APPROVAL_NODES = [...CONTRACT_ENUMS.approvalNodes];

/** 审批决策（3 值）。 */
export const APPROVAL_DECISIONS = [...CONTRACT_ENUMS.approvalDecisions];

/** 状态事件类型（14 值）。 */
export const EVENT_TYPES = [...CONTRACT_ENUMS.eventTypes];

/** 状态迁移表（唯一真相源）。 */
export const TRANSITIONS = { ...CONTRACT_ENUMS.transitions };

/** 标准协议态映射（backlog / ready → null）。 */
export const STATUS_MAP = { ...CONTRACT_ENUMS.statusMap };

/** taskId 标识模式。 */
export const TASK_ID_PATTERN = new RegExp(CONTRACT_ENUMS.taskIdPattern);

/** 契约引用（urn）模式。 */
export const CONTRACT_REF_PATTERN = new RegExp(CONTRACT_ENUMS.contractRefPattern);
