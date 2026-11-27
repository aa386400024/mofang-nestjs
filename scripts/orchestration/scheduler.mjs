/**
 * L2 调度器：一轮自治循环的状态机闭环。
 *
 * 流程（对齐框架 docs/autonomous-loop.md §2 循环模型与 docs/state-machine.md §4.1）：
 *   1. 超时释放：租约过期的 submitted / working 任务释放回 ready；
 *   2. 领单：依赖满足且类型在白名单的 ready 任务登记租约 → submitted；
 *   3. 回执验收：已落盘交付记录的任务跑验收护栏；
 *      - passed / conditional-pass → 归档 completed；
 *      - rejected → 未达限次生成返修提案（同 contextId，不自动分配新编号）；
 *        达限次 → 死信隔离；
 *   4. 生成队列快照供可视化网页读取。
 *
 * 边界：本模块不直接唤起桌面 GUI；执行代理派发 / 回执衔接由 agent cu 单元在
 * 调度间隙完成（设计备忘 §9）。返修新任务条目由编排者确认后落地，scheduler 只
 * 生成提案，避免擅自分配任务编号（任务标识模式见框架 task-sheet schema）。
 */
import {
  ensureRuntimeEntry,
  findTask,
  getRuntimeEntry,
  isLeaseExpired,
  listDeliveryPacks,
  loadAgentCards,
  loadConfig,
  loadIndex,
  loadRuntimeState,
  loadToolContracts,
  nowIso,
  PATHS,
  REPO_ROOT,
  saveRuntimeState,
} from './state-store.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { commitIndex } from './event-store.mjs';
import { TERMINAL_STATUSES } from './contract-enums.mjs';
import { runAcceptance } from './acceptance-runner.mjs';
import { loadImprovementLog, summarizeLog } from './improvement-log.mjs';
import { listAudits, loadAuditLog, summarizeAudits } from './audit-log.mjs';
import { buildProtocolView } from './protocol-mapper.mjs';
import { createTransport } from './transport.mjs';
import { recordRetiredTaskId } from './task-id-occupancy.mjs';
import { dispatchTask, receiptFingerprint, isReceiptProcessed, markReceiptProcessed, resolveChannelSelection } from './dispatch.mjs';
import { buildGuiBrief, writeGuiBrief, isDeliveryStalled, autoConfirmDelivery } from './gui-dispatch.mjs';
import { CIRCUIT_BREAKER_DEFAULTS, evaluateCircuitBreaker, resolveDispatchDecision } from './dispatch-channel.mjs';
import { findScopeConflicts } from './scope-mutex.mjs';
import { validateScopeDomain } from './card-router.mjs';
import { archiveTaskSheetFile, ingestReceipts } from './receipts.mjs';
import { ensureTaskRecordBundle, isTaskSheetBundled, resolveTaskSheet, resolveWorklogArtifact } from './worklog.mjs';
import { relative } from 'node:path';

const BY_ORCHESTRATOR = 'orchestrator-cli';

/** 快照/看板只读投影：把已迁移任务单的旧索引指针解析成记录包规范路径。 */
function withResolvedTaskSheet(task) {
  const sheet = resolveTaskSheet(task);
  const artifacts =
    task.artifacts && typeof task.artifacts === 'object' && !Array.isArray(task.artifacts)
      ? Object.fromEntries(Object.entries(task.artifacts).map(([key, value]) => [key, resolveWorklogArtifact(task, value)]))
      : task.artifacts;
  if (!sheet) {
    // 终态墓碑任务可能确实没有任务单；不把失效指针渲染成看板死链。
    if (typeof task.artifacts?.taskSheet !== 'string') return { ...task, artifacts };
    return { ...task, artifacts: { ...(artifacts ?? {}), taskSheet: null } };
  }
  return {
    ...task,
    artifacts: { ...(artifacts ?? {}), taskSheet: relative(REPO_ROOT, sheet.path).split('\\').join('/') },
  };
}

/** 有效迁移表（docs/state-machine.md §4.1）。 */
const TRANSITIONS = {
  backlog: ['ready', 'canceled'],
  ready: ['submitted', 'backlog', 'canceled'],
  submitted: ['working', 'ready', 'completed', 'rejected', 'canceled', 'failed', 'input-required'],
  working: ['submitted', 'input-required', 'failed', 'canceled'],
  'input-required': ['working', 'ready', 'failed', 'canceled'],
  completed: [],
  failed: [],
  canceled: [],
  rejected: [],
};

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** 自治模式是否开启；关闭时调度器只输出只读快照，不推进任何状态迁移。 */
export function shouldAdvance(config) {
  return config?.autoLoop?.enabled === true;
}

/**
 * 人工取消：把非终态任务沿合法迁移链闭合到 `canceled`。
 * 框架状态机允许 ready / submitted / working / input-required → canceled，但此前没有
 * 任何命令能执行它，误立项或域切错的任务只能靠改文件绕过状态机。这里补上唯一入口：
 * 迁移写 history、清租约、记 `cancelReason`，随后可用 archive 归档。
 * @param {{tasks:object[], archivedTasks:object[]}} index 状态索引（就地改写）
 * @param {object} runtimeState 运行态（就地改写）
 * @param {string} taskId 目标任务
 * @param {{reason?:string}} opts 取消原因
 * @returns {object} 取消后的任务条目
 */
export function cancelTask(index, runtimeState, taskId, opts = {}) {
  const task = index.tasks.find((item) => item.taskId === taskId);
  if (!task) throw new Error(`取消失败：任务不在活跃列表：${taskId}`);
  if (TERMINAL_STATUSES.includes(task.status)) throw new Error(`取消失败：任务已是终态：${taskId}（${task.status}）`);
  if (!canTransition(task.status, 'canceled')) throw new Error(`取消失败：${task.status} → canceled 不是合法迁移`);
  const reason = opts.reason ?? '人工取消';
  task.cancelReason = reason;
  pushHistory(task, 'canceled', BY_ORCHESTRATOR, reason);
  const entry = runtimeState.tasks?.[taskId];
  if (entry) {
    entry.leaseClaimedAt = null;
    entry.leaseDeadline = null;
    entry.releaseReason = 'cancelled';
    entry.cancelReason = reason;
    entry.heldForHuman = false;
    entry.escalation = null;
  }
  return task;
}

function pushHistory(task, to, by, reason) {
  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({ at: nowIso(), from: task.status, to, by, reason: reason ?? null });
  task.status = to;
}

/**
 * 把编排前置态任务从 backlog 提到 ready（框架 docs/state-machine.md §4.1 允许 backlog ↔ ready）。
 * ready 的前置条件按框架口径硬校验：契约齐全（任务单指针 + taskId/contextId/type）、
 * 基线明确（baselineRef）、依赖满足。缺一即拒，不允许「先塞进队列再说」。
 */
export function promoteTask(index, runtimeState, taskId, opts = {}) {
  const task = findTask(index, taskId);
  if (!task) throw new Error(`提级失败：任务不在活跃列表：${taskId}`);
  if (task.status === 'ready') throw new Error(`提级失败：任务已处于 ready：${taskId}`);
  if (task.status !== 'backlog') throw new Error(`提级失败：只有 backlog 可提到 ready：${taskId} 当前 ${task.status}`);
  if (!canTransition('backlog', 'ready')) throw new Error('提级失败：backlog → ready 不是合法迁移');
  if (!task.artifacts?.taskSheet) throw new Error(`提级失败：任务单指针缺失：${taskId}`);
  for (const key of ['taskId', 'contextId', 'type']) {
    if (!task[key]) throw new Error(`提级失败：任务单缺字段 ${key}：${taskId}`);
  }
  if (!task.baselineRef) throw new Error(`提级失败：基线不明确（缺 baselineRef）：${taskId}`);
  const deps = dependencyState(task, index);
  if (!deps.met) {
    const unmet = deps.unmet.map((item) => `${item.taskId}:${item.status}`).join('、');
    throw new Error(`提级失败：依赖未满足：${unmet}`);
  }
  const reason = opts.reason ?? '人工提级';
  task.promotedAt = nowIso();
  pushHistory(task, 'ready', BY_ORCHESTRATOR, reason);
  const entry = runtimeState.tasks?.[taskId];
  if (entry) entry.promotedAt = task.promotedAt;
  return task;
}

/**
 * 依赖是否全部满足：无 dependsOn 视为满足；上游须全部 completed。
 * 上游既可能在活跃列表，也可能已归档（终态 completed 后迁入 archivedTasks），
 * 两处都要查——否则依赖已归档任务的条目会永久卡在 ready（静默死等）。
 * 完全不存在的上游按未满足处理，并由调用方记 `dependency-unresolved` 显性暴露。
 */
function dependencyState(task, index) {
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  const unmet = [];
  for (const dep of deps) {
    const upstream = findTask(index, dep) ?? index.archivedTasks?.find((item) => item.taskId === dep) ?? null;
    if (upstream?.status !== 'completed') {
      unmet.push({ taskId: dep, status: upstream?.status ?? 'unknown' });
    }
  }
  return { met: unmet.length === 0, unmet };
}

/** IM-080：失败 / 取消 / 拒绝 / 死信上游不会自行完成，必须显性暴露而不是静默死等。 */
const INVALID_DEPENDENCY_STATUSES = ['failed', 'canceled', 'rejected', 'deadLetter'];

/**
 * 列出 ready 任务中依赖已进入失败类终态的条目，供 claim 与 status 共用。
 * @param {object} index 状态索引
 * @returns {Array<{taskId:string, unmet:Array<{taskId:string,status:string}>}>}
 */
export function dependencyHealth(index) {
  const issues = [];
  for (const task of index?.tasks ?? []) {
    if (task.status !== 'ready') continue;
    const state = dependencyState(task, index);
    const invalid = state.unmet.filter((item) => INVALID_DEPENDENCY_STATUSES.includes(item.status));
    if (invalid.length > 0) issues.push({ taskId: task.taskId, unmet: invalid });
  }
  return issues;
}

/** 超时释放：租约过期的活跃任务回到 ready，必须写 releaseReason 并转人工确认，不在同一轮自动重派。 */
export function releaseExpiredLeases(index, runtimeState, actions) {
  for (const task of index.tasks) {
    if (task.status !== 'submitted' && task.status !== 'working') continue;
    const entry = getRuntimeEntry(runtimeState, task.taskId);
    if (isLeaseExpired(entry)) {
      if (!canTransition(task.status, 'ready')) continue;
      const releasedAt = nowIso();
      pushHistory(task, 'ready', BY_ORCHESTRATOR, '租约超时释放（持单待人工确认，不自动重派）');
      entry.leaseClaimedAt = null;
      entry.leaseDeadline = null;
      entry.releaseReason = 'lease-expired';
      entry.releasedAt = releasedAt;
      entry.heldForHuman = true;
      entry.escalation = {
        waiting: '租约超时，任务已释放回 ready；按 reliability.md §3 不自动重派，需人工确认后恢复',
        evidence: entry.dispatch?.handoverRef ? [entry.dispatch.handoverRef] : [],
        attemptedPaths: entry.dispatch?.channel ? [entry.dispatch.channel] : [],
        suggestedDecision: '确认执行侧是否失联：恢复领取，或转 failed / 重开任务',
      };
      actions.push({ type: 'release', taskId: task.taskId, reason: 'lease-expired', heldForHuman: true });
    }
  }
}

/**
 * AF-074 · 执行代理送达 ack 自动确认。
 *
 * `channel send` 只负责把投递件送进桌面会话；它写的 `gui-sent/<taskId>.json` 是发送现场，
 * 不是送达证明。只有执行代理按 brief 写出 `acks/<taskId>.json` 后，才把 `delivery.state`
 * 从 pending 升到 delivered。缺失 ack 时保持 pending，交给 `releaseFailedDeliveries`
 * 按投递租约回滚，避免把「已粘贴」当成「已送达」。
 * @returns {number} 本轮确认条数
 */
export function autoConfirmDeliveries(index, runtimeState, actions, opts = {}) {
  let confirmed = 0;
  for (const task of index.tasks) {
    if (task.status !== 'submitted') continue;
    const entry = getRuntimeEntry(runtimeState, task.taskId);
    const record = entry?.dispatch ?? null;
    if (!record || record.channel !== 'gui-relay' || record.delivery?.state !== 'pending') continue;
    const result = autoConfirmDelivery({
      record,
      taskId: task.taskId,
      transportDir: opts.transportDir ?? PATHS.transportDir,
      repoRoot: opts.repoRoot ?? REPO_ROOT,
    });
    if (!result.confirmed) continue;
    entry.dispatch = result.record;
    actions.push({
      type: 'delivery-auto-confirmed',
      taskId: task.taskId,
      sourceRef: result.ack?.receivedAt ?? null,
      evidenceRef: result.record?.delivery?.evidenceRef ?? null,
    });
    confirmed += 1;
  }
  return confirmed;
}

/**
 * 投递失败 / 投递租约过期的回滚：把带 `delivery.state=failed` 或 pending 超投递租约的任务
 * 从 submitted 释放回 ready 并置 `heldForHuman`（不自动重派，避免 GUI 反复失败空转）。
 * 与任务租约（30 min）分离：桌面投递是分钟级动作，用 `config.dispatch.deliveryLeaseMinutes`（默认 5）。
 * @returns {number} 处理条数
 */
export function releaseFailedDeliveries(index, runtimeState, config, actions) {
  const leaseMinutes = config.dispatch?.deliveryLeaseMinutes;
  let handled = 0;
  for (const task of index.tasks) {
    if (task.status !== 'submitted') continue;
    const entry = getRuntimeEntry(runtimeState, task.taskId);
    const record = entry?.dispatch ?? null;
    if (!record?.delivery) continue;
    const stalled = isDeliveryStalled(record, { deliveryLeaseMinutes: leaseMinutes });
    if (!stalled) continue;
    // IM-028：回收环节不再一律 held-for-human，而是把 relay 上报的现场事实喂给运行时决策链
    // （dispatch-channel.mjs#resolveDispatchDecision），由它给出终态 / 升级人工 / 可重试三种动作，
    // 调度层只负责把动作映射成状态迁移。facts 缺省时按「待人工」处理，行为与既有口径一致。
    const delivery = record.delivery;
    const facts = delivery.lastAttempt ?? {};
    const decision = resolveDispatchDecision({
      // cause 缺省留空：没有现场事实时不得假定「不可恢复」，否则会把可恢复的偶发故障直接判死。
      cause: facts.cause,
      loginGate: facts.loginGate === true,
      processRunning: facts.processRunning,
      windowReady: facts.windowReady,
      startRetries: facts.startRetries ?? 0,
      sendRetries: facts.sendRetries ?? 0,
      sessionAttempted: facts.sessionAttempted ?? [],
      locateAttempted: facts.locateAttempted ?? [],
      attemptCount: facts.attemptCount ?? record.attempt ?? 1,
    });
    if (decision.action === 'continue-in-session') {
      // 非失败事实：通道被旁路，工作由会话内代执行完成。任务不动（仍在 submitted），
      // 只留痕；后续按回执正常验收，不再走「失败回收 → 判终态」那条路。
      entry.dispatchDecisionResult = { action: decision.action, reason: decision.reason, cause: decision.cause };
      entry.deliveryBypassed = true;
      actions.push({ type: 'delivery-bypassed', taskId: task.taskId, cause: decision.cause, reason: decision.reason });
      handled += 1;
      continue;
    }
    if (decision.action === 'fail-terminal' && canTransition(task.status, 'failed')) {
      pushHistory(task, 'failed', BY_ORCHESTRATOR, `GUI 投递不可恢复（${decision.cause}）：直接置失败，不重试`);
      entry.leaseClaimedAt = null;
      entry.leaseDeadline = null;
      entry.heldForHuman = false;
      entry.releaseReason = 'gui-delivery-terminal';
      entry.releasedAt = nowIso();
      entry.dispatchDecisionResult = { action: decision.action, reason: decision.reason, cause: decision.cause };
      actions.push({
        type: 'delivery-terminal',
        taskId: task.taskId,
        cause: decision.cause,
        reason: decision.reason,
      });
      handled += 1;
      continue;
    }
    if (!canTransition(task.status, 'ready')) continue;
    // 只有决策链明确给出「任务级尝试预算耗尽」才记预算原因；其余 failed 保持既有的 gui-delivery-failed 口径。
    const budgetExhausted = decision.action === 'human-escalate' && /预算耗尽/.test(String(decision.reason ?? ''));
    const reason =
      delivery.state === 'failed'
        ? budgetExhausted
          ? 'gui-delivery-budget-exhausted'
          : 'gui-delivery-failed'
        : 'gui-delivery-lease-expired';
    pushHistory(task, 'ready', BY_ORCHESTRATOR, 'GUI 投递未完成回收：回滚 ready 并持单待人工（不自动重派）');
    entry.leaseClaimedAt = null;
    entry.leaseDeadline = null;
    entry.releaseReason = reason;
    entry.releasedAt = nowIso();
    entry.heldForHuman = true;
    entry.dispatchDecisionResult = { action: decision.action, reason: decision.reason, retries: decision.retries ?? null };
    // IM-017：通道级熔断按「通道 + 连续失败次数」判定，独立于任务级预算；开闸即发可观察事件，
    // 让看板与排障能一眼看出「不是这单有毛病，是这条通道现在不能派」。
    // half-open：冷却期满只放一次试探（成功由 confirmDelivery 归零并封闭，失败刷新开闸时刻）。
    const breaker = evaluateCircuitBreaker(
      {
        channel: record.channel ?? record.delivery?.lastAttempt?.channel ?? null,
        delivery: record.delivery,
        openedAt: entry.channelCircuit?.openedAt ?? record.delivery?.circuitOpenedAt ?? null,
      },
      config,
    );
    if (breaker.state === 'open' || breaker.state === 'half-open') {
      entry.channelCircuit = {
        state: breaker.state,
        channel: breaker.channel,
        consecutiveFailures: breaker.consecutiveFailures,
        threshold: breaker.threshold,
        cooldownMinutes: breaker.cooldownMinutes,
        openedAt: breaker.openedAt,
        probeAllowed: breaker.probeAllowed === true,
        at: nowIso(),
      };
      // 开闸时刻落到投递记录上，跨轮可算冷却期（运行态清理也不会丢）。
      record.delivery = { ...record.delivery, circuitOpenedAt: breaker.openedAt };
      actions.push({
        type: breaker.state === 'open' ? 'channel-circuit-open' : 'channel-circuit-half-open',
        taskId: task.taskId,
        channel: breaker.channel,
        consecutiveFailures: breaker.consecutiveFailures,
        threshold: breaker.threshold,
        openedAt: breaker.openedAt,
      });
    } else if (entry.channelCircuit?.state === 'half-open' || entry.channelCircuit?.state === 'open') {
      // 计数已回落（投递成功过）：封闭熔断，留一条可观察事件。
      entry.channelCircuit = { state: 'closed', channel: breaker.channel, consecutiveFailures: 0, at: nowIso() };
      // 探针事实随开闸周期一起清掉：closed 后再开闸是新周期，旧探针不应冒充「已试探过」。
      if (entry.circuitProbe) entry.circuitProbe = null;
      actions.push({ type: 'channel-circuit-closed', taskId: task.taskId, channel: breaker.channel });
    }
    entry.escalation = {
      waiting: 'GUI 投递未确认送达，任务已回滚 ready 并持单',
      decision: { action: decision.action, reason: decision.reason },
      evidence: [record.delivery.briefRef, record.delivery.evidenceRef]
        .filter(Boolean)
        .concat(entry.dispatch?.handoverRef ? [entry.dispatch.handoverRef] : []),
      attemptedPaths: record.delivery.history?.map((item) => item.sessionPath ?? item.state).filter(Boolean) ?? [],
      suggestedDecision: '确认桌面投递通道（进程 / 会话 / 定位层）后 task resume，或改用文件通道重派',
    };
    actions.push({ type: 'delivery-released', taskId: task.taskId, reason, deliveryState: record.delivery.state });
    handled += 1;
  }
  return handled;
}

/**
 * 通道级熔断的**当前有效状态**（AF-044-O1 实证后落地）。
 *
 * 为什么按运行态扫描而不是读单个任务：熔断语义是通道级的（同一条通道上任何任务累计的连续失败），
 * 但状态只落在触发它的那个任务条目上。只看当前任务会漏掉「A 单把通道熔断了，B 单照派」的场景。
 * 扫描后取最新开闸事实，按当前时刻重算冷却：冷期内 `open`，期满 `half-open`。
 *
 * @param {{tasks?:object}} runtimeState 运行态
 * @param {object} config 编排配置（`circuitBreaker`）
 * @param {{now?:string}} [opts]
 * @returns {{state:'closed'|'open'|'half-open', channel:string|null, consecutiveFailures:number,
 *   threshold:number, openedAt:string|null, cooldownMinutes:number, probeAllowed:boolean, reason:string|null}}
 */
export function resolveChannelCircuit(runtimeState, config = {}, opts = {}) {
  const entries = Object.values(runtimeState?.tasks ?? {});
  let latest = null;
  for (const entry of entries) {
    const circuit = entry?.channelCircuit;
    if (!circuit || (circuit.state !== 'open' && circuit.state !== 'half-open')) continue;
    if (latest && String(circuit.openedAt ?? '') <= String(latest.openedAt ?? '')) continue;
    latest = circuit;
  }
  if (!latest) {
    const settings = { ...CIRCUIT_BREAKER_DEFAULTS, ...(config?.circuitBreaker ?? {}) };
    return {
      state: 'closed',
      channel: null,
      consecutiveFailures: 0,
      threshold: Math.max(1, Number(settings.consecutiveFailureThreshold ?? 3)),
      openedAt: null,
      cooldownMinutes: Math.max(1, Number(settings.cooldownMinutes ?? 10)),
      probeAllowed: false,
      probeIssued: false,
      probeAt: null,
      reason: null,
    };
  }
  const evaluated = evaluateCircuitBreaker(
    {
      channel: latest.channel ?? null,
      delivery: { consecutiveFailures: latest.consecutiveFailures ?? 0 },
      openedAt: latest.openedAt ?? null,
    },
    config,
    opts,
  );
  // 「只放一次试探」必须跨轮成立：探针事实落在任务条目上（circuitProbe），
  // 同一开闸周期（openedAt 相同）内只要放过一次，后续 run-once 不再放第二次。
  const openedAt = String(latest.openedAt ?? '');
  const probe =
    entries
      .map((entry) => entry?.circuitProbe)
      .filter((item) => item && openedAt !== '' && String(item.openedAt ?? '') === openedAt)
      .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))[0] ?? null;
  return { ...evaluated, probeIssued: Boolean(probe), probeAt: probe?.at ?? null };
}

/** 领单：ready 且依赖满足、类型在白名单 → submitted，登记租约并经 Transport 派发交接件。 */
export function claimReadyTasks(index, runtimeState, config, actions, opts = {}) {
  const transport = opts.transport ?? createTransport(config);
  // 单任务队列：在办数达到 maxConcurrentTasks 时不再领取下一个，避免通道并发。
  const active = index.tasks.filter((t) => t.status === 'submitted' || t.status === 'working');
  if (active.length >= (config.maxConcurrentTasks ?? 1)) {
    actions.push({ type: 'queue-busy', blockers: active.map((t) => t.taskId) });
    return;
  }
  const maxConcurrent = config.maxConcurrentTasks ?? 1;
  // AF-044-O1：熔断开启即**快速失败**，不把新单再送进已知坏通道。
  // 冷期内（open）整轮不派发；冷却期满（half-open）本轮只放一次试探。
  const circuit = resolveChannelCircuit(runtimeState, config, { now: opts.now ?? nowIso() });
  // 探针是否已发由运行态决定（不是本轮局部变量），否则每轮 run-once 都会再放一次。
  let probeIssued = circuit.probeIssued === true;
  let claimed = 0;
  for (const task of index.tasks) {
    if (task.status !== 'ready') continue;
    if (claimed >= maxConcurrent) break;
    const dependency = dependencyState(task, index);
    if (!dependency.met) {
      // 依赖未满足：留 ready 等上游闭合；失败类终态显性报 dependency-invalid，
      // 完全不存在的上游报 dependency-unresolved，避免静默死等。
      const invalid = dependency.unmet.filter((item) => INVALID_DEPENDENCY_STATUSES.includes(item.status));
      if (invalid.length > 0) {
        actions.push({ type: 'dependency-invalid', taskId: task.taskId, unmet: invalid });
      } else if (dependency.unmet.some((item) => item.status === 'unknown')) {
        actions.push({ type: 'dependency-unresolved', taskId: task.taskId, unmet: dependency.unmet });
      }
      continue;
    }
    if (!config.allowedTaskTypes.includes(task.type)) continue;
    if (!task.artifacts?.taskSheet) {
      actions.push({ type: 'task-sheet-missing', taskId: task.taskId });
      continue;
    }
    // 租约超时释放后持单待人工：按 reliability.md §3「超时不自动重派」，不得在本轮或后续空跑里自动领回。
    if (getRuntimeEntry(runtimeState, task.taskId)?.heldForHuman === true) {
      // 持单原因取运行态真实释放原因（lease-expired / gui-delivery-failed / gui-delivery-budget-exhausted），
      // 不再一律写成 lease-expired——否则事件流看不出任务为何持单（AF-035-B1）。
      const heldEntry = getRuntimeEntry(runtimeState, task.taskId);
      actions.push({ type: 'held-for-human', taskId: task.taskId, reason: heldEntry?.releaseReason ?? 'held-for-human' });
      continue;
    }
    // AF-044-O1：熔断硬拦截。open 整轮不派发；half-open 只放一次试探，其余 ready 任务本轮留 ready。
    if (circuit.state === 'open' || (circuit.state === 'half-open' && probeIssued)) {
      actions.push({
        type: 'channel-circuit-blocked',
        taskId: task.taskId,
        channel: circuit.channel,
        state: circuit.state,
        consecutiveFailures: circuit.consecutiveFailures,
        threshold: circuit.threshold,
        openedAt: circuit.openedAt,
        cooldownMinutes: circuit.cooldownMinutes,
      });
      continue;
    }
    // IM-011：给出仓根时，scope 通配条目按真实目录展开后再求交集，避免「父目录前缀」粗判漏冲突。
    const scopeConflicts = findScopeConflicts(task, index.tasks, { rootDir: REPO_ROOT });
    if (scopeConflicts.length > 0) {
      // 文件域与在办任务相交：拦截派发，任务留 ready，不登记租约、不投递交接件。
      actions.push({ type: 'scope-conflict', taskId: task.taskId, conflicts: scopeConflicts });
      continue;
    }
    // IM-010：任务 scope 与目标角色 Agent Card resources 资源域越域拦截。
    const domain = validateScopeDomain(task, opts.cards ?? [], {});
    if (!domain.valid) {
      actions.push({ type: 'scope-domain-conflict', taskId: task.taskId, outside: domain.outside, errors: domain.errors });
      continue;
    }
    const entry = ensureRuntimeEntry(runtimeState, task.taskId);
    if (circuit.state === 'half-open') {
      probeIssued = true;
      entry.circuitProbe = { channel: circuit.channel, at: nowIso(), openedAt: circuit.openedAt };
      actions.push({ type: 'channel-circuit-probe', taskId: task.taskId, channel: circuit.channel, openedAt: circuit.openedAt });
    }
    const previousStatus = task.status;
    const previousHistory = Array.isArray(task.history) ? [...task.history] : [];
    const deadline = new Date(Date.now() + config.leaseDefaultMinutes * 60_000).toISOString();
    pushHistory(task, 'submitted', BY_ORCHESTRATOR, '编排者领单（派发通道由 agent cu 衔接）');
    entry.leaseClaimedAt = nowIso();
    entry.leaseDeadline = deadline;
    entry.lastRunner = BY_ORCHESTRATOR;
    actions.push({ type: 'claim', taskId: task.taskId });
    let dispatch;
    try {
      // IM-028：选路交给 resolveChannelSelection（可审计决策结果），不在调度层散落 if。
      // 决策读取上一轮 dispatch 事实：GUI 投递已 failed / 已降级时，本轮直接走文件降级通道，
      // 否则任务会反复把同一份投递件送进同一条死路（AF-024 评审阻塞项）。
      const decision = resolveChannelSelection({ task, config, previousDispatch: entry.dispatch ?? null });
      entry.dispatchDecision = { ...decision, decidedAt: nowIso() };
      actions.push({
        type: 'dispatch-decision',
        taskId: task.taskId,
        channel: decision.channel,
        reason: decision.reason,
        attempt: decision.attempt,
        previousDeliveryState: decision.previousDeliveryState,
      });
      const channel = decision.channel;
      // GUI 通道在领单时就生成投递件：`delivery.state=pending` 的定义是「投递件已生成」，
      // 不能留给人工补跑 channel dispatch，否则任务空等租约。transportDir 由调用方注入，缺省不生成。
      let briefRef = null;
      if (channel === 'gui-relay' && opts.transportDir) {
        briefRef = writeGuiBrief({
          transportDir: opts.transportDir,
          taskId: task.taskId,
          text: buildGuiBrief(task, {}).text,
        });
      }
      dispatch = dispatchTask(task, entry, {
        transport,
        channel,
        targetRole: decision.targetRole,
        cards: opts.cards,
        force: true,
        briefRef,
      });
    } catch (err) {
      dispatch = { dispatched: false, record: null, handoverRef: null, errors: [err.message] };
    }
    if (!dispatch.dispatched) {
      // 派发失败不得留下 submitted + 租约的空转任务；回到 ready，等待下一轮修复后重试。
      task.status = previousStatus;
      task.history = previousHistory;
      entry.leaseClaimedAt = null;
      entry.leaseDeadline = null;
      entry.dispatch = null;
      actions.push({
        type: 'dispatch-rejected',
        taskId: task.taskId,
        channel: dispatch.record?.channel ?? 'file',
        handoverRef: dispatch.handoverRef,
        errors: dispatch.errors,
      });
      continue;
    }
    actions.push({
      type: 'dispatch',
      taskId: task.taskId,
      channel: dispatch.record?.channel ?? 'file',
      handoverRef: dispatch.handoverRef,
      errors: dispatch.errors,
    });
    claimed += 1;
    if (active.length + claimed >= maxConcurrent) break;
  }
}

/**
 * 归档终态白名单（终态任务从活跃列表迁入归档段）。
 *
 * `failed` 必须在内：它是回执验收链之外的终态（投递定性失败、返修上限耗尽），
 * 不经过 `processReceipts` 的归档分支，漏掉就会永久留在 `tasks[]`，
 * 让 `status` 的「活跃计数」把已死任务算成在办（AF-039 / AF-041 实测）。
 */
export const ARCHIVE_STATUSES = ['completed', 'rejected', 'canceled', 'failed'];

/**
 * 扫档：把已闭合但尚未归档的终态任务迁入 `archivedTasks`（就地改写 index）。
 *
 * 与 `processReceipts` 里的归档互补——那条路径只处理「有回执且验收闭合」的任务，
 * 取消 / 失败的任务没有任何回执可等，只能靠本函数收尾。
 * @param {{tasks:object[], archivedTasks:object[]}} index 状态索引（就地改写）
 * @param {object[]} actions 动作列表（就地追加）
 * @returns {object[]} 本次归档的条目
 */
export function sweepTerminalTasks(index, actions = []) {
  const swept = [];
  for (const task of [...index.tasks]) {
    if (!ARCHIVE_STATUSES.includes(task.status)) continue;
    if (index.archivedTasks.some((item) => item.taskId === task.taskId)) continue;
    const entry = archiveTaskEntry(index, task.taskId, {
      note: `终态扫档：${task.status}`,
    });
    actions.push({ type: 'archive-terminal', taskId: task.taskId, status: task.status });
    swept.push(entry);
  }
  return swept;
}

/**
 * 把任务从活跃 tasks 迁移到 archivedTasks（纯函数，就地修改 index，不落盘）。
 * 校验：任务存在于活跃列表、未归档过、**当前已是终态**且不得改写终态；
 * 返回归档条目。非终态任务须先经调度器闭合（见 archiveTask）。
 */
export function archiveTaskEntry(index, taskId, opts = {}) {
  if (index.archivedTasks.some((t) => t.taskId === taskId)) {
    throw new Error(`任务已归档：${taskId}`);
  }
  const task = index.tasks.find((t) => t.taskId === taskId);
  if (!task) throw new Error(`归档失败：任务不在活跃列表：${taskId}`);
  if (!TERMINAL_STATUSES.includes(task.status)) {
    throw new Error(`归档前置条件不满足：${taskId} 当前状态 ${task.status} 不是终态`);
  }
  if (opts.status !== undefined && opts.status !== task.status) {
    throw new Error(`归档不得改写终态：${taskId} 当前 ${task.status}，请求 ${opts.status}`);
  }
  const artifacts = { ...(task.artifacts ?? {}), ...(opts.artifacts ?? {}) };
  const entry = { taskId, status: task.status, artifacts };
  if (opts.note) entry.note = opts.note;
  index.tasks = index.tasks.filter((t) => t.taskId !== taskId);
  index.archivedTasks.push(entry);
  // AF-498：进入归档即退役该编号，记录包/分支/状态被清掉也不放号。
  try {
    if (task.taskSheet || task.sheetPath || task.artifacts?.taskSheet) recordRetiredTaskId(taskId);
  } catch {
    /* 台账失败不得阻断归档 */
  }
  return entry;
}

/** 非终态 → 目标终态的最短合法迁移路径（BFS）。 */
function terminalPath(from, to) {
  if (from === to) return [];
  const queue = [[from, []]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const [state, path] = queue.shift();
    for (const next of TRANSITIONS[state] ?? []) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath;
      seen.add(next);
      queue.push([next, nextPath]);
    }
  }
  throw new Error(`不存在从 ${from} 到 ${to} 的合法迁移路径`);
}

/** 归档终态任务（scheduler 内部调用）：先把非终态任务沿合法迁移链闭合，再归档。 */
function archiveTask(index, task, status) {
  if (!TERMINAL_STATUSES.includes(status)) throw new Error(`归档终态非法：${status}`);
  for (const step of terminalPath(task.status, status)) {
    pushHistory(task, step, BY_ORCHESTRATOR, '回执验收后闭合终态');
  }
  archiveTaskEntry(index, task.taskId, { status });
  // AF-373：记录包在登记/冻结时已提交，归档只迁移状态面；已入包任务不得再回写 manifest。
  if (resolveTaskSheet(task) && !isTaskSheetBundled(task)) {
    try {
      ensureTaskRecordBundle(task, { status });
    } catch {
      // 历史/错误指针不应阻断归档；记录包完整性由 worklog verify 事后判。
    }
  }
}

/**
 * AF-217：归档前置取数（纯函数，便于单测）。
 * 未注入探测函数返回空清单（向后兼容）；注入结果做去重与空值清洗，避免把空串当成「有未提交改动」。
 * @param {object} task
 * @param {(task:object)=>string[]} [checkUncommitted]
 * @returns {string[]}
 */
export function archiveUncommittedFiles(task, checkUncommitted) {
  if (typeof checkUncommitted !== 'function') return [];
  const list = checkUncommitted(task);
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((file) => String(file ?? '').trim()).filter(Boolean))];
}

/**
 * 索引投影不携带回执正文（回执不是状态迁移事件），运行态已摄入的回执在下一轮
 * 需要回填到任务条目，否则验收会误判「缺机读回执」。
 */
function hydrateTaskReceipt(task, entry) {
  if (task?.receipt) return;
  const ref = entry?.receiptRef;
  if (typeof ref !== 'string' || !existsSync(ref)) return;
  try {
    const record = JSON.parse(readFileSync(ref, 'utf8'));
    const payload = record?.payload ?? record;
    task.receipt = {
      receiptId: payload?.receiptId ?? null,
      finalStatus: payload?.finalStatus ?? null,
      reviewVerdict: payload?.reviewVerdict ?? null,
      changedFiles: payload?.changedFiles ?? null,
      parallelArtifactsExcluded: payload?.parallelArtifactsExcluded === true,
      sourceRef: ref,
      archiveRef: entry?.receiptArchiveRef ?? null,
      ingestedAt: entry?.receiptIngestedAt ?? null,
    };
  } catch {
    // 回执副本损坏由 receipt-lint / worklog verify 事后判，不阻断调度。
  }
}

/** 回执验收驱动：已落盘交付记录的任务跑护栏并归档 / 提案返修 / 死信。 */
export function processReceipts(index, runtimeState, config, actions, opts = {}) {
  // 先把 transport/receipts 的机读回执投影进任务与运行态，再进入验收。
  ingestReceipts(index, runtimeState, {
    actions,
    dir: opts.receiptsDir,
    archiveDir: opts.receiptArchiveDir,
    requireBundled: opts.requireBundled === true,
  });

  const remaining = [];
  for (const task of index.tasks) {
    // 租约超时转人工后回执才到达：回执即完成证据，恢复领取并走验收，不再重新派发。
    const lateReceipt = task.status === 'ready' && runtimeState.tasks?.[task.taskId]?.heldForHuman === true && task.receipt;
    if (!lateReceipt && task.status !== 'submitted' && task.status !== 'working') {
      remaining.push(task);
      continue;
    }
    const entry = ensureRuntimeEntry(runtimeState, task.taskId);
    hydrateTaskReceipt(task, entry);
    if (lateReceipt) {
      pushHistory(task, 'submitted', BY_ORCHESTRATOR, '租约超时后回执到达：恢复领取并验收，不重新派发');
      entry.heldForHuman = false;
      entry.releaseReason = 'receipt-after-timeout';
      entry.recoveredAt = nowIso();
      entry.escalation = null;
      actions.push({ type: 'late-receipt-recovered', taskId: task.taskId, sourceRef: task.receipt?.sourceRef ?? null });
    }
    const receiptStatus = task.receipt?.finalStatus;
    if (receiptStatus && receiptStatus !== 'completed') {
      // 执行侧回执直接给出失败 / 取消 / 拒绝：不进入机读验收，按合法迁移链闭合后归档。
      entry.terminalReceipt = { status: receiptStatus, at: nowIso(), sourceRef: task.receipt.sourceRef ?? null };
      entry.frozen = receiptStatus === 'failed' || receiptStatus === 'rejected';
      entry.escalation = {
        waiting: `执行侧回执终态=${receiptStatus}，需人工裁决或按 contextId 重开`,
        evidence: [task.receipt.sourceRef].filter(Boolean),
        attemptedPaths: [],
        suggestedDecision: '人工复核回执后决定关闭 / 返修 / 重开任务',
      };
      archiveTaskSheetFile(task);
      archiveTask(index, task, receiptStatus);
      actions.push({ type: 'receipt-terminal', taskId: task.taskId, status: receiptStatus });
      continue;
    }
    const deliveryRef = task.artifacts?.deliveryRecord;
    if (!task.receipt) {
      // AF-498：交付记录存在但机读回执尚未落盘时只能等，不能拿「缺回执」当成验收不通过
      // 把任务打成 rejected——那会把一个已完成任务永久锁在不可合并状态。
      actions.push({ type: 'receipt-missing', taskId: task.taskId, deliveryRef: deliveryRef ?? null });
      remaining.push(task);
      continue;
    }
    if (!deliveryRef) {
      if (receiptStatus === 'completed') {
        actions.push({ type: 'receipt-delivery-missing', taskId: task.taskId, sourceRef: task.receipt?.sourceRef ?? null });
      }
      remaining.push(task);
      continue;
    }
    const fingerprint = receiptFingerprint(task, deliveryRef);
    if (isReceiptProcessed(entry, fingerprint)) {
      // 同一交付记录重复投递：只触发一次验收，不重复跑护栏。
      remaining.push(task);
      continue;
    }
    const result = runAcceptance(task, index, { changedFiles: opts.changedFiles, resolveCommitFiles: opts.resolveCommitFiles });
    // conditional-pass 需人工补齐复核项后重跑验收；提前标记会让回执永远停在旧结论。
    if (result.verdict !== 'conditional-pass') markReceiptProcessed(entry, fingerprint);
    entry.autoVerdict = { verdict: result.verdict, rationale: result.rationale, at: nowIso() };
    entry.manualReview = result.manualReview;

    archiveTaskSheetFile(task);
    if (result.verdict === 'rejected') {
      entry.attemptCount = Number(entry.attemptCount ?? 0);
      if (entry.attemptCount < config.reworkLimit) {
        // 返修提案：同 contextId 新开任务；编号由编排者确认后分配。
        entry.attemptCount += 1;
        entry.reworkOf = task.taskId;
        const proposal = {
          proposalId: `RW-${task.taskId}-${entry.attemptCount}`,
          originalTaskId: task.taskId,
          contextId: task.contextId,
          reworkOf: task.taskId,
          priorTasks: [task.taskId],
          attemptCount: entry.attemptCount,
          type: task.type,
          title: `${task.title}（返修第 ${entry.attemptCount} 次）`,
          status: 'ready',
          rationale: result.rationale,
          manualReview: result.manualReview,
          createdAt: nowIso(),
        };
        entry.reworkProposal = proposal;
        archiveTask(index, task, 'rejected');
        actions.push({ type: 'rework-proposal', taskId: task.taskId, proposalId: proposal.proposalId });
      } else {
        // 死信隔离：保留错误上下文，转人工，不再自动重试。
        entry.deadLetter = true;
        entry.frozen = true;
        entry.escalation = {
          waiting: '返修达上限，需人工裁决或重新定义任务',
          evidence: result.checks.filter((c) => c.status === 'fail').map((c) => c.detail),
          attemptedPaths: result.manualReview,
          suggestedDecision: '人工复核后重开任务或关闭该 contextId',
        };
        archiveTask(index, task, 'rejected');
        actions.push({ type: 'dead-letter', taskId: task.taskId });
      }
      continue;
    }

    // AF-217 · 归档前置：实现必须已进版本库。
    // 「先归档后提交」会被 preflight 以 no-active-task 拒绝，只能补开任务单返工；
    // 这里在归档瞬间阻断，不让「实现还在工作区」的任务被判定为验收通过并归档。
    const uncommitted = archiveUncommittedFiles(task, opts.checkUncommitted);
    if (uncommitted.length > 0) {
      entry.escalation = {
        waiting: '任务 scope 内仍有未提交改动，归档已阻断：先提交实现，再跑 pnpm orchestration:run',
        evidence: uncommitted.slice(0, 10),
        attemptedPaths: [],
        suggestedDecision: '提交实现文件后重跑 run-once；回执与交付记录无需重出',
      };
      actions.push({ type: 'archive-blocked-uncommitted', taskId: task.taskId, files: uncommitted });
      remaining.push(task);
      continue;
    }

    // passed / conditional-pass → 归档 completed；遗留项由交付记录与快照携带。
    archiveTask(index, task, 'completed');
    actions.push({ type: 'archive-completed', taskId: task.taskId, verdict: result.verdict });
  }
  index.tasks = remaining;
}

/**
 * 汇总快照（可视化网页读取的唯一数据源）。
 * @param {object} improvementSummary 台账汇总（summarizeLog 结果）；缺省为 null，快照不携带台账段。
 */
export function buildSnapshot(index, runtimeState, config, improvementSummary) {
  const counts = {
    ready: 0,
    submitted: 0,
    working: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
    rejected: 0,
    'input-required': 0,
    deadLetter: 0,
  };
  const tasks = [];
  const deadLetters = [];
  const reworkProposals = [];
  const pendingApprovals = [];
  const activeTasks = index.tasks.map(withResolvedTaskSheet);
  const archivedTasks = index.archivedTasks.map(withResolvedTaskSheet);

  for (const task of activeTasks) {
    const entry = getRuntimeEntry(runtimeState, task.taskId);
    counts[task.status] = (counts[task.status] ?? 0) + 1;
    if (entry.deadLetter) counts.deadLetter += 1;
    const row = {
      taskId: task.taskId,
      contextId: task.contextId,
      type: task.type,
      title: task.title,
      status: task.status,
      verdict: entry.autoVerdict?.verdict ?? null,
      verdictRationale: entry.autoVerdict?.rationale ?? null,
      attemptCount: Number(entry.attemptCount ?? 0),
      frozen: entry.frozen === true,
      reworkOf: entry.reworkOf ?? null,
      artifacts: task.artifacts ?? {},
      manualReview: entry.manualReview ?? [],
      dispatch: entry.dispatch ?? null,
    };
    tasks.push(row);
    if (entry.deadLetter) deadLetters.push({ ...row, escalation: entry.escalation ?? null });
    if (entry.reworkProposal) reworkProposals.push(entry.reworkProposal);
    if (entry.frozen) pendingApprovals.push({ taskId: task.taskId, reason: entry.escalation?.waiting ?? '冻结待批' });
  }

  const auditLog = loadAuditLog();
  const agentCards = loadAgentCards();

  return {
    generatedAt: nowIso(),
    mode: { autoLoopEnabled: config.autoLoop.enabled, reworkLimit: config.reworkLimit },
    counts,
    tasks,
    deadLetters,
    reworkProposals,
    pendingApprovals,
    improvements: improvementSummary ?? null,
    deliveryPacks: listDeliveryPacks(),
    agentCards,
    toolContracts: loadToolContracts(),
    toolAudits: listAudits(auditLog, { limit: 15 }),
    auditSummary: summarizeAudits(auditLog),
    protocolView: buildProtocolView({ tasks: activeTasks, archivedTasks }),
    webRefresh: { enabled: config.web.refresh.enabled, intervalMs: config.web.refresh.intervalMs },
    archivedCount: archivedTasks.length,
  };
}

/**
 * 执行一轮推进。
 * @param {{commit?: boolean, transport?: object, cards?: object[], changedFiles?: string[]}} opts
 *   commit=false 时只计算快照与动作，不落盘；cards 为 Agent Card 投影；changedFiles 供 V7 残留比对。
 * @returns {{snapshot: object, actions: object[]}}
 */
export function advanceOnce(opts = {}) {
  const config = loadConfig();
  const index = loadIndex();
  const runtimeState = loadRuntimeState();
  const actions = [];

  if (shouldAdvance(config)) {
    releaseExpiredLeases(index, runtimeState, actions);
    // 先认执行代理的送达 ack：ack 是唯一能证明「已送达」的弱事实；缺 ack 才进入租约回滚。
    autoConfirmDeliveries(index, runtimeState, actions);
    // GUI 投递失败 / 投递租约过期也要回滚：否则任务带着 failed 投递继续占租约，
    // 调度层对 delivery.state 零读取，等于把「已降级」当成「在正常执行」。
    releaseFailedDeliveries(index, runtimeState, config, actions);
    // 先验收 / 归档回收在办任务，再领下一个：同一轮即可完成「回收 → 派发下一单」，
    // 否则单任务队列会在回执已到的那一轮误报 queue-busy，并空转一轮。
    const cards = opts.cards ?? loadAgentCards();
    processReceipts(index, runtimeState, config, actions, {
      changedFiles: opts.changedFiles,
      receiptsDir: opts.receiptsDir,
      resolveCommitFiles: opts.resolveCommitFiles,
      // AF-217：注入「scope 内未提交改动」探测，未注入时行为与既有单测一致。
      checkUncommitted: opts.checkUncommitted,
      // AF-373：真实 CLI 运行显式开启；测试/历史回放默认关闭以保持既有夹具语义。
      requireBundled: opts.requireBundledReceipt === true,
    });
    // 取消 / 失败任务没有回执可等，靠扫档收尾；否则会永久占「活跃计数」并让队列概览虚高。
    sweepTerminalTasks(index, actions);
    // 投递件目录只在真实运行态（未注入 transport）时写入仓内 transport/briefs；
    // 单测注入 fake transport 时不写盘，避免测试污染工作区。
    const transportDir = opts.transportDir ?? (opts.transport ? null : PATHS.transportDir);
    claimReadyTasks(index, runtimeState, config, actions, {
      transport: opts.transport,
      cards,
      transportDir,
    });
  } else {
    actions.push({
      type: 'readonly-snapshot',
      taskId: null,
      reason: '自治模式关闭，仅生成只读快照，不执行领单 / 验收归档 / 返修等状态迁移',
    });
  }

  const snapshot = buildSnapshot(index, runtimeState, config, summarizeLog(loadImprovementLog()));

  if (opts.commit !== false) {
    if (shouldAdvance(config)) {
      commitIndex(index, { actor: BY_ORCHESTRATOR });
      saveRuntimeState(runtimeState);
    }
    // 快照由 CLI 统一双写（JSON + data.js），此处只返回内存对象，避免重复落盘与时间戳抖动。
  }
  return { snapshot, actions };
}
