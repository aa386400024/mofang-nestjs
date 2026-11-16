/**
 * AF-007 · 标准工具注册表（adapter 层收口）。
 *
 * 职责：把工具契约声明（`tools/*.json`，一工具一文件，框架 2.0.0 单对象口径）
 * 构建为运行时注册表；调用收口于本模块——角色白名单校验、副作用级别核对、调用
 * 审计留痕。代理侧不直接持有底层凭据或内部句柄；未列入白名单的角色一律拒绝。
 *
 * 边界：注册表不执行工具本体逻辑，只做授权判定与审计；工具实现仍在各编排模块。
 * 角色 / 类别 / 副作用枚举一律来自共享投影 `contract-enums.mjs`，不在本模块手写镜像。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './state-store.mjs';
import { recordAudit } from './audit-log.mjs';
import { ROLES, SIDE_EFFECTS, TOOL_CATEGORIES } from './contract-enums.mjs';

/** 角色 / 副作用 / 类别枚举（对齐框架 contract-enums 2.0.0，对外签名保持）。 */
export { ROLES, SIDE_EFFECTS, TOOL_CATEGORIES };

/** 读取工具目录下全部单工具声明；目录缺失返回空数组。 */
function readToolDefs() {
  if (!existsSync(PATHS.toolsDir)) return [];
  const tools = [];
  for (const fileName of readdirSync(PATHS.toolsDir).sort()) {
    if (!fileName.endsWith('.json')) continue;
    tools.push(JSON.parse(readFileSync(join(PATHS.toolsDir, fileName), 'utf8')));
  }
  return tools;
}

/** 校验单条工具契约字段；返回错误清单（空数组即合法）。 */
function validateToolDef(tool) {
  const errors = [];
  const label = tool?.toolId ?? '未命名工具';
  if (!tool.toolId) errors.push('缺 toolId');
  else if (!/^[A-Z0-9][A-Z0-9-]*$/.test(tool.toolId)) errors.push(`${label}：toolId 须形如 TOOL-XXX`);
  if (!tool.category) errors.push(`${label}：缺 category`);
  else if (!TOOL_CATEGORIES.includes(tool.category)) errors.push(`${label}：category 不在 8 值枚举内（${tool.category}）`);
  if (!SIDE_EFFECTS.includes(tool.sideEffect)) errors.push(`${label}：sideEffect 非法（${String(tool.sideEffect)}）`);
  if (!Array.isArray(tool.allowedRoles)) {
    errors.push(`${label}：allowedRoles 须为数组`);
  } else {
    for (const role of tool.allowedRoles) {
      if (!ROLES.includes(role)) errors.push(`${label}：角色非法（${role}）`);
    }
  }
  return errors;
}

/**
 * 由工具契约数组构建注册表。
 * @param {object[]} tools 工具契约定义
 * @returns {{tools: Record<string, object>}}
 */
export function buildRegistry(tools) {
  const registry = { tools: {} };
  for (const tool of tools ?? []) {
    const errors = validateToolDef(tool);
    if (errors.length > 0) throw new Error(`工具契约非法：${errors.join('；')}`);
    if (registry.tools[tool.toolId]) throw new Error(`工具标识重复：${tool.toolId}`);
    registry.tools[tool.toolId] = {
      toolId: tool.toolId,
      category: tool.category,
      sideEffect: tool.sideEffect,
      allowedRoles: [...tool.allowedRoles],
      resources: Array.isArray(tool.resources) ? [...tool.resources] : [],
      description: tool.description ?? null,
    };
  }
  return registry;
}

/** 从仓内工具契约目录加载注册表；目录缺失或损坏时返回空注册表（容错不阻断）。 */
export function loadRegistry() {
  try {
    return buildRegistry(readToolDefs());
  } catch {
    return { tools: {} };
  }
}

/** 注册表工具只读清单。 */
export function listTools(registry) {
  return Object.values(registry.tools).map((tool) => ({ ...tool, allowedRoles: [...tool.allowedRoles] }));
}

/**
 * 经注册表调用工具：角色白名单校验 + 审计留痕。
 *
 * @param {{tools: Record<string, object>}} registry 注册表
 * @param {string} toolId 工具标识
 * @param {{actor: string, correlationId?: string, taskId?: string, resources?: string[]}} ctx 调用上下文
 * @param {object} [auditLog] 审计日志对象（loadAuditLog 返回）；缺省不落审计
 * @returns {{ok: boolean, denied: boolean, toolId: string, sideEffect: string|null, reason: string|null, audit: object|null}}
 */
export function call(registry, toolId, ctx = {}, auditLog = null) {
  const def = registry.tools[toolId];
  const actor = ctx.actor ?? null;
  const base = { toolId, sideEffect: def?.sideEffect ?? null, category: def?.category ?? null, resources: def?.resources ?? [] };

  let denied = false;
  let reason = null;
  if (!def) {
    denied = true;
    reason = `工具未注册：${toolId}`;
  } else if (!actor) {
    denied = true;
    reason = '调用方角色缺失';
  } else if (!def.allowedRoles.includes(actor)) {
    denied = true;
    reason = `角色 ${actor} 未被授权调用 ${toolId}`;
  }

  let audit = null;
  if (auditLog) {
    audit = recordAudit(auditLog, {
      actorRef: actor ?? 'unknown',
      correlationId: ctx.correlationId,
      toolId,
      category: base.category,
      sideEffect: base.sideEffect,
      resources: ctx.resources ?? base.resources,
      taskId: ctx.taskId,
      result: denied ? 'denied' : 'allowed',
      reason: ctx.reason ?? reason,
    });
  }

  return { ok: !denied, denied, toolId, sideEffect: base.sideEffect, reason, audit };
}
