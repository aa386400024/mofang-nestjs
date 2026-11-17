/**
 * AF-010 · 派发链路（adapter 层纯逻辑，注入式 transport）。
 *
 * 职责：领单成功后构造任务交接件（AF-009 契约）、经注入的 Transport 投递、
 * 生成派发记录（通道 / 目标角色 / 会话指针 / 派发时间 / 租约 / 状态）落到运行态条目；
 * 回执验收指纹幂等：同一 taskId + 工件指针只触发一次验收。
 *
 * 边界：本模块不直接读写仓内文件（transport 由调用方注入）；派发记录只留指针、
 * 通道与计数，不含对话原文；状态迁移仍由 scheduler 状态机负责，本模块不新增状态枚举。
 */
import { buildTaskHandover, validateTaskHandover } from './handover-contract.mjs';
import { selectTargetRole } from './card-router.mjs';
import { CHANNEL_GUI_FALLBACK } from './gui-dispatch.mjs';
import { nowIso } from './state-store.mjs';

/** 派发通道枚举（file / gui-relay 为本批实现；gui-file-fallback 为降级态；mcp / http 预留位）。 */
export const DISPATCH_CHANNELS = ['file', 'gui-relay', 'gui-file-fallback', 'mcp', 'http'];

function normalizeChannel(channel) {
  return DISPATCH_CHANNELS.includes(channel) ? channel : 'file';
}

/**
 * 派发决策原因枚举（IM-028：选路不得是散落的 if 表达式，必须是可审计的决策结果）。
 * - `orchestrator-self-dispatch`：编排者给自己派活，写文件交接件即可，不走桌面 relay；
 * - `configured-channel`：执行代理角色，按 `config.dispatch.channel` 选路；
 * - `delivery-fallback-after-failure`：上一轮 GUI 投递已 failed 或已降级，本轮直接用文件降级通道；
 * - `fallback-disabled-retry`：同上但 `fallbackToFile=false`，只能重试 gui-relay；
 * - `channel-unavailable-coerced`：配置里的通道不在枚举内，收敛为 file 并留原因。
 */
export const DISPATCH_DECISION_REASONS = [
  'orchestrator-self-dispatch',
  'configured-channel',
  'delivery-fallback-after-failure',
  'fallback-disabled-retry',
  'channel-unavailable-coerced',
];

/**
 * 解析本轮派发通道选路（纯函数，无副作用；运行时决策链的降级判定见 dispatch-channel.mjs#resolveDispatchDecision）。
 *
 * 决策顺序对齐框架 `reliability.md` 的降级链：角色 → 上轮投递事实 → 配置通道 → 枚举收敛。
 * 「上轮投递事实」必须读 `delivery.state` 与上轮 `channel`：调度层若对 delivery 零读取，
 * 就等于把「已降级」当成「在正常执行」，任务会反复撞同一堵墙（AF-024 评审阻塞项）。
 *
 * @param {object} params {task, config, previousDispatch}
 * @returns {{channel: string, targetRole: string, reason: string, attempt: number, configuredChannel: string, previousDeliveryState: string|null}}
 */
export function resolveChannelSelection({ task, config, previousDispatch = null } = {}) {
  const targetRole = task?.agentRole ?? 'executor';
  const configuredRaw = config?.dispatch?.channel ?? 'file';
  const configuredChannel = normalizeChannel(configuredRaw);
  const attempt = Number(previousDispatch?.attempt ?? 0) + 1;
  const previousDeliveryState = previousDispatch?.delivery?.state ?? null;
  const previousChannel = previousDispatch?.channel ?? null;

  if (targetRole === 'orchestrator') {
    return {
      channel: 'file',
      targetRole,
      reason: 'orchestrator-self-dispatch',
      attempt,
      configuredChannel,
      previousDeliveryState,
    };
  }

  const needsFallback = previousDeliveryState === 'failed' || previousChannel === CHANNEL_GUI_FALLBACK;
  if (needsFallback) {
    const fallbackAllowed = config?.dispatch?.fallbackToFile !== false;
    return {
      channel: fallbackAllowed ? CHANNEL_GUI_FALLBACK : 'gui-relay',
      targetRole,
      reason: fallbackAllowed ? 'delivery-fallback-after-failure' : 'fallback-disabled-retry',
      attempt,
      configuredChannel,
      previousDeliveryState,
    };
  }

  if (!DISPATCH_CHANNELS.includes(configuredRaw)) {
    return {
      channel: 'file',
      targetRole,
      reason: 'channel-unavailable-coerced',
      attempt,
      configuredChannel,
      previousDeliveryState,
    };
  }

  return {
    channel: configuredChannel,
    targetRole,
    reason: 'configured-channel',
    attempt,
    configuredChannel,
    previousDeliveryState,
  };
}

/**
 * 构造派发记录（只留指针、通道与计数，不含对话原文）。
 * gui-relay 通道额外带 `delivery` 段：投递状态机由 gui-dispatch.mjs 的 confirm / fallback 推进，
 * 记录初始态 pending 表示「投递件已生成、尚未确认送达」。
 * 重派（`opts.attempt > 1`）时把上一轮 delivery 压入 `history`，失败原因与定性不被覆盖。
 * @param {object} task 索引任务条目
 * @param {object} opts {channel, targetRole, sessionRef, leaseDeadline, attempt, handoverRef, briefRef, previousDelivery}
 * @returns {object} 派发记录
 */
export function buildDispatchRecord(task, opts = {}) {
  const channel = normalizeChannel(opts.channel);
  const record = {
    taskId: task.taskId,
    contextId: task.contextId ?? null,
    channel,
    targetRole: opts.targetRole ?? task.agentRole ?? null,
    sessionRef: opts.sessionRef ?? null,
    dispatchedAt: nowIso(),
    leaseDeadline: opts.leaseDeadline ?? null,
    attempt: Number(opts.attempt ?? 1),
    status: 'submitted',
    handoverRef: opts.handoverRef ?? null,
  };
  if (channel === 'gui-relay') {
    const previous = opts.previousDelivery && opts.previousDelivery.state ? [{ ...opts.previousDelivery }] : [];
    const history = previous.length > 0 ? previous : Array.isArray(opts.previousDelivery?.history) ? opts.previousDelivery.history : [];
    record.delivery = {
      state: 'pending',
      preparedAt: record.dispatchedAt,
      briefRef: opts.briefRef ?? null,
      sessionPath: null,
      locateLayer: null,
      evidenceRef: null,
      // IM-017：同一通道重新拿到一次干净派发，连续失败计数归零（熔断只计「连续」）。
      consecutiveFailures: 0,
      history,
    };
  }
  return record;
}

/**
 * 派发一个已领单任务：构造并校验交接件 → transport.submitTask → 记录派发条目。
 *
 * 幂等：运行态条目已存在 dispatch 记录且未显式 force 时不重复投递；
 * 交接件契约校验失败不投递，返回 errors，由调度层记录动作并保留租约（状态回退归状态机）。
 *
 * @param {object} task 索引任务条目（须已领单）
 * @param {object} entry 任务运行态条目（就地写入 dispatch）
 * @param {object} opts {transport, channel, targetRole, sessionRef, producedBy, force, attempt, cards}
 * @returns {{dispatched: boolean, record: object|null, handoverRef: string|null, handover: object|null, errors: string[], reason: string|null, route: object|null}}
 */
export function dispatchTask(task, entry, opts = {}) {
  if (!entry) throw new Error('派发缺运行态条目');
  if (entry.dispatch && !opts.force) {
    return {
      dispatched: false,
      record: entry.dispatch,
      handoverRef: entry.dispatch.handoverRef ?? null,
      handover: null,
      errors: [],
      reason: 'already-dispatched',
      route: null,
    };
  }

  // IM-008：注入 Agent Card 投影时按能力声明选择目标角色；未传 cards 保持原显式 / agentRole 口径。
  const route = opts.cards ? selectTargetRole(task, opts.cards, { targetRole: opts.targetRole }) : null;
  const targetRole = route ? route.targetRole : (opts.targetRole ?? task.agentRole ?? null);

  const handover = buildTaskHandover(task, { producedBy: opts.producedBy ?? 'orchestrator' });
  const validation = validateTaskHandover(handover);
  if (!validation.valid) {
    return { dispatched: false, record: null, handoverRef: null, handover, errors: validation.errors, reason: 'contract-invalid', route };
  }

  const transport = opts.transport ?? null;
  const handoverRef = transport?.submitTask ? transport.submitTask(handover) : null;
  // 逐次留痕（AF-015 D-3）：重派 attempt 递增，上一轮 delivery 进 history，不覆盖失败原因与定性。
  const previousDispatch = entry.dispatch ?? null;
  const attempt = Number(opts.attempt ?? (previousDispatch?.attempt ?? 0) + 1);
  const record = buildDispatchRecord(task, {
    channel: opts.channel,
    targetRole,
    sessionRef: opts.sessionRef,
    leaseDeadline: entry.leaseDeadline ?? null,
    attempt,
    handoverRef,
    briefRef: opts.briefRef ?? null,
    previousDelivery: previousDispatch?.delivery ?? null,
  });
  entry.dispatch = record;
  return { dispatched: true, record, handoverRef, handover, errors: [], reason: null, route };
}

/**
 * 回执验收指纹。
 *
 * IM-007：次级键优先用**工件版本号**（`task.artifacts.deliveryRevision` 或交接件 `revision`），
 * 而不是交付记录路径。原因是同一路径可以被返修后重写：路径不变、内容变了，
 * 以路径为键会把「第二次交付」误判成「已验收过的同一份」，重复回执静默丢弃。
 * 工件版本号缺失时才退回路径指纹，兼容尚未补版本的存量任务。
 *
 * @param {object} task 索引任务条目
 * @param {string} [deliveryRef] 交付记录指针；缺省取 task.artifacts.deliveryRecord
 * @returns {string} 指纹串
 */
export function receiptFingerprint(task, deliveryRef) {
  const revision = task?.artifacts?.deliveryRevision ?? task?.artifacts?.revision ?? null;
  const normalized = typeof revision === 'number' ? String(revision) : (revision ?? '').trim();
  if (normalized !== '') return `${task?.taskId ?? ''}@${normalized}`;
  const ref = deliveryRef ?? task?.artifacts?.deliveryRecord ?? '';
  return `${task?.taskId ?? ''}|${ref}`;
}

/** 运行态条目是否已处理过该指纹回执。 */
export function isReceiptProcessed(entry, fingerprint) {
  return entry?.receiptFingerprint === fingerprint;
}

/** 标记该指纹回执已完成验收。 */
export function markReceiptProcessed(entry, fingerprint) {
  entry.receiptFingerprint = fingerprint;
}
