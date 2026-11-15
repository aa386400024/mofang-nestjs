/**
 * AF-016 · Agent Card 能力路由与角色资源域校验（adapter 层纯函数，零 IO）。
 *
 * 职责：
 *   1. IM-008 派发目标角色匹配：按 skills / tools / availability 声明从候选卡中选择目标代理；
 *   2. IM-010 任务 scope 与角色 resources 资源域越域校验。
 *
 * 边界：纯函数不读文件系统、不调 git；cards 投影由调用方注入（state-store.loadAgentCards）。
 * 资源域真相源保持 Agent Card resources 与框架 roles.md，本模块不另抄目录白名单；
 * 任务间文件域互斥仍归 scope-mutex.mjs，本模块只做角色-任务资源域核对。
 */
import { normalizeScope } from './scope-mutex.mjs';

/** availability 枚举（对齐 Agent Card schema）。 */
export const AVAILABILITY = ['available', 'busy', 'offline'];

function asArray(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
}

/** 单卡能力匹配度：命中 skill / tool 交集、未命中需求与评分。 */
function scoreCard(card, requiredSkills, requiredTools) {
  const skills = asArray(card?.skills);
  const tools = asArray(card?.tools);
  const matchedSkills = requiredSkills.filter((s) => skills.includes(s));
  const matchedTools = requiredTools.filter((t) => tools.includes(t));
  return {
    matchedSkills,
    matchedTools,
    missingSkills: requiredSkills.filter((s) => !skills.includes(s)),
    missingTools: requiredTools.filter((t) => !tools.includes(t)),
    score: matchedSkills.length * 2 + matchedTools.length,
  };
}

/**
 * 在候选卡中匹配最契合的角色卡。
 * @param {{role?:string|null, requiredSkills?:string[], requiredTools?:string[]}} params
 * @param {object[]} cards Agent Card 只读投影
 * @returns {{eligible:boolean, role:string|null, card:object|null, matchedSkills:string[], matchedTools:string[], missingSkills:string[], missingTools:string[], reason:string|null}}
 */
export function matchAgentCard({ role, requiredSkills = [], requiredTools = [] } = {}, cards = []) {
  const roster = Array.isArray(cards) ? cards : [];
  const picked = [];
  for (const card of roster) {
    if (card?.availability && card.availability !== 'available') continue;
    if (role && card.role !== role) continue;
    picked.push({ card, ...scoreCard(card, requiredSkills, requiredTools) });
  }
  if (picked.length === 0) {
    const reason = role ? `无 availability=available 且角色为 ${role} 的 Agent Card` : '无 availability=available 的 Agent Card';
    return {
      eligible: false,
      role: role ?? null,
      card: null,
      matchedSkills: [],
      matchedTools: [],
      missingSkills: [...requiredSkills],
      missingTools: [...requiredTools],
      reason,
    };
  }
  // 评分降序；同分保持候选顺序（稳定排序）。
  picked.sort((a, b) => b.score - a.score);
  const best = picked[0];
  return {
    eligible: true,
    role: best.card.role ?? null,
    card: best.card,
    matchedSkills: best.matchedSkills,
    matchedTools: best.matchedTools,
    missingSkills: best.missingSkills,
    missingTools: best.missingTools,
    reason: null,
  };
}

/**
 * 选择派发目标角色。显式指定角色优先；显式角色不可用时保留显式角色（不擅自改派），
 * 能力匹配明细与原因透出；无显式角色时按能力声明匹配。
 * @param {object} task 索引任务条目（读 agentRole / requiredSkills / requiredTools）
 * @param {object[]} cards Agent Card 只读投影
 * @param {{targetRole?:string|null, requiredSkills?:string[], requiredTools?:string[]}} opts
 * @returns {{targetRole:string|null, card:object|null, match:object, reason:string|null, routedBy:string}}
 */
export function selectTargetRole(task, cards = [], opts = {}) {
  const requiredSkills = [...new Set([...asArray(task?.requiredSkills), ...asArray(opts.requiredSkills)])];
  const requiredTools = [...new Set([...asArray(task?.requiredTools), ...asArray(opts.requiredTools)])];
  const explicitRole = opts.targetRole ?? task?.agentRole ?? null;

  if (explicitRole) {
    const match = matchAgentCard({ role: explicitRole, requiredSkills, requiredTools }, cards);
    return {
      targetRole: explicitRole,
      card: match.card,
      match,
      reason: match.reason,
      routedBy: match.eligible ? 'explicit-role' : 'explicit-role-fallback',
    };
  }
  const match = matchAgentCard({ role: null, requiredSkills, requiredTools }, cards);
  return {
    targetRole: match.role,
    card: match.card,
    match,
    reason: match.reason,
    routedBy: match.eligible ? 'capability-match' : 'none',
  };
}

/** 任务 scope 路径是否落在某条角色资源域前缀内（相等或子路径）。 */
function scopeEntryInResource(entry, resourcePrefix) {
  const res = String(resourcePrefix ?? '')
    .replace(/\/+$/, '')
    .trim();
  if (!res) return false;
  return entry.path === res || entry.path.startsWith(`${res}/`);
}

/**
 * 校验任务 scope 是否落在目标角色 Agent Card resources 资源域内。
 * 只读 / 调研 / 评审 / 验证类任务豁免（不占资源域）。
 * @param {object} task 索引任务条目（读 agentRole / scope）
 * @param {object[]} cards Agent Card 只读投影
 * @param {{role?:string|null}} opts
 * @returns {{valid:boolean, cardRole:string|null, inside:string[], outside:Array<{file:string,reason:string}>, errors:string[]}}
 */
export function validateScopeDomain(task, cards = [], opts = {}) {
  const result = { valid: true, cardRole: null, inside: [], outside: [], errors: [] };
  const normalized = normalizeScope(task);
  if (normalized.readOnly) return result;

  const role = opts.role ?? task?.agentRole ?? null;
  const roster = Array.isArray(cards) ? cards : [];
  const card = roster.find((c) => c?.role === role && c?.availability !== 'offline') ?? null;
  result.cardRole = card?.role ?? null;

  if (!card) {
    result.valid = false;
    result.errors.push(role ? `未找到角色 ${role} 的 Agent Card，无法校验资源域` : '未指定目标角色，无法校验资源域');
    return result;
  }
  const resources = asArray(card.resources);
  if (resources.length === 0) {
    result.valid = false;
    result.errors.push(`角色 ${card.role} 的 Agent Card 未声明 resources 资源域`);
    return result;
  }

  for (const entry of normalized.entries) {
    if (resources.some((res) => scopeEntryInResource(entry, res))) {
      result.inside.push(entry.path);
    } else {
      result.outside.push({ file: entry.path, reason: `不在角色 ${card.role} 资源域：${resources.join('、')}` });
    }
  }
  if (result.outside.length > 0) result.valid = false;
  return result;
}
