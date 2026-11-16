/**
 * 契约枚举与标识模式共享投影（adapter 层；纯数据派生，零副作用）。
 *
 * 口径真相源在框架仓 `schemas/contract-enums.json`；本仓同目录 `contract-enums.json`
 * 为其 vendored 投影（随本仓 git 评审与锁定，护栏单测对账取值集合与版本锚点）。
 * 本模块是投影数据的唯一加载点：各编排消费方（交接契约、分支流程、验收护栏、
 * 台账回执抽取）一律从本模块导入派生枚举与 taskId 模式，不再各自读 JSON 或
 * 手写正则 / 枚举字面量镜像。
 *
 * 演进路径：框架仓发布版本化契约制品（契约包）后，本模块可替换为依赖包 import，
 * 消费方导入签名不变。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** vendored 枚举投影原始对象（框架仓 contract-enums.json 副本）。 */
export const CONTRACT_ENUMS = JSON.parse(readFileSync(join(__dirname, 'contract-enums.json'), 'utf8'));

/** 任务类型枚举（派生自 vendored 契约枚举投影）。 */
export const TASK_TYPES = [...CONTRACT_ENUMS.taskTypes];

/** 任务状态枚举（派生自 vendored 契约枚举投影）。 */
export const TASK_STATUSES = [...CONTRACT_ENUMS.taskStatuses];

/** 回执终态枚举（派生自 vendored 契约枚举投影）。 */
export const FINAL_STATUSES = [...CONTRACT_ENUMS.finalStatuses];

/** 验收三级结论（派生自 vendored 契约枚举投影）。 */
export const REVIEW_VERDICTS = [...CONTRACT_ENUMS.reviewVerdicts];

/** taskId 标识模式（派生自 vendored 契约枚举投影 taskIdPattern）。 */
export const TASK_ID_PATTERN = new RegExp(CONTRACT_ENUMS.taskIdPattern);
