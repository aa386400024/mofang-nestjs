/**
 * AF-007 · 标准工具注册表（adapter 层收口）。
 *
 * 职责：把工具契约声明（tools/orchestration-tools.json）构建为运行时注册表；
 * 调用收口于本模块——角色白名单校验、副作用级别核对、调用审计留痕。代理侧不
 * 直接持有底层凭据或内部句柄；未列入白名单的角色一律拒绝。
 *
 * 边界：注册表不执行工具本体逻辑，只做授权判定与审计；工具实现仍在各编排模块。
 * 角色 / 副作用枚举与框架 tool-contract schema 一致。
 */
import { existsSync, readFileSync } from 'node:fs';
import { PATHS } from './state-store.mjs';
import { recordAudit } from './audit-log.mjs';

/** 角色枚举（对齐框架 schema role）。 */
export const ROLES = ['orchestrator', 'executor', 'reviewer', 'researcher', 'critic'];
/** 副作用分级（对齐框架 schema sideEffect）。 */
export const SIDE_EFFECTS = ['read-only', 'restricted-write', 'sensitive'];

function readManifest() {
  if (!existsSync(PATHS.toolsContractFile)) return { tools: [] };
  const raw = JSON.parse(readFileSync(PATHS.toolsContractFile, 'utf8'));
  return Array.isArray(raw.tools) ? raw : { tools: [] };
}

/** 校验单条工具契约字段；返回错误清单（空数组即合法）。 */
function validateToolDef(tool) {
  const errors = [];
  if (!tool.toolId) errors.push('缺 toolId');
  if (!tool.category) errors.push(`${tool.toolId ?? '未命名工具'}：缺 category`);
  if (!SIDE_EFFECTS.includes(tool.sideEffect)) errors.push(`${tool.toolId ?? '未命名工具'}：sideEffect 非法（${String(tool.sideEffect)}）`);
  if (!Array.isArray(tool.allowedRoles)) {
    errors.push(`${tool.toolId ?? '未命名工具'}：allowedRoles 须为数组`);
  } else {
    for (const role of tool.allowedRoles) {
      if (!ROLES.includes(role)) errors.push(`${tool.toolId ?? '未命名工具'}：角色非法（${role}）`);
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

/** 从仓内工具契约清单加载注册表；文件缺失或损坏时返回空注册表（容错不阻断）。 */
export function loadRegistry() {
  try {
    const manifest = readManifest();
    return buildRegistry(manifest.tools);
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
