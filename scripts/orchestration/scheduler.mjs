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
  PATHS,
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
  saveRuntimeState,
  writeJsonAtomic,
} from './state-store.mjs';
import { commitIndex } from './event-store.mjs';
import { TERMINAL_STATUSES } from './contract-enums.mjs';
import { runAcceptance } from './acceptance-runner.mjs';
import { loadImprovementLog, summarizeLog } from './improvement-log.mjs';
import { listAudits, loadAuditLog, summarizeAudits } from './audit-log.mjs';
import { buildProtocolView } from './protocol-mapper.mjs';
import { createTransport } from './transport.mjs';
import { dispatchTask, receiptFingerprint, isReceiptProcessed, markReceiptProcessed } from './dispatch.mjs';
import { findScopeConflicts } from './scope-mutex.mjs';
import { validateScopeDomain } from './card-router.mjs';
import { ingestReceipts } from './receipts.mjs';

const BY_ORCHESTRATOR = 'orchestrator-cli';

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

function pushHistory(task, to, by, reason) {
  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({ at: nowIso(), from: task.status, to, by, reason: reason ?? null });
  task.status = to;
}

/** 依赖是否全部满足：无 dependsOn 视为满足；上游须全部 completed。 */
function dependenciesMet(task, index) {
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  return deps.every((dep) => {
    const upstream = findTask(index, dep);
    return upstream?.status === 'completed';
  });
}

/** 超时释放：租约过期的活跃任务回到 ready。 */
function releaseExpiredLeases(index, runtimeState, actions) {
  for (const task of index.tasks) {
    if (task.status !== 'submitted' && task.status !== 'working') continue;
    const entry = getRuntimeEntry(runtimeState, task.taskId);
    if (isLeaseExpired(entry)) {
      if (!canTransition(task.status, 'ready')) continue;
      pushHistory(task, 'ready', BY_ORCHESTRATOR, '租约超时释放');
      entry.leaseClaimedAt = null;
      entry.leaseDeadline = null;
      actions.push({ type: 'release', taskId: task.taskId, reason: 'lease-expired' });
    }
  }
}

/** 领单：ready 且依赖满足、类型在白名单 → submitted，登记租约并经 Transport 派发交接件。 */
function claimReadyTasks(index, runtimeState, config, actions, opts = {}) {
  const transport = opts.transport ?? createTransport(config);
  // 单任务队列：在办数达到 maxConcurrentTasks 时不再领取下一个，避免通道并发。
  const active = index.tasks.filter((t) => t.status === 'submitted' || t.status === 'working');
  if (active.length >= (config.maxConcurrentTasks ?? 1)) {
    actions.push({ type: 'queue-busy', blockers: active.map((t) => t.taskId) });
    return;
  }
  const maxConcurrent = config.maxConcurrentTasks ?? 1;
  let claimed = 0;
  for (const task of index.tasks) {
    if (task.status !== 'ready') continue;
    if (!dependenciesMet(task, index)) continue;
    if (!config.allowedTaskTypes.includes(task.type)) continue;
    if (!task.artifacts?.taskSheet) {
      actions.push({ type: 'task-sheet-missing', taskId: task.taskId });
      continue;
    }
    const scopeConflicts = findScopeConflicts(task, index.tasks);
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
      dispatch = dispatchTask(task, entry, {
        transport,
        channel: config.transport?.type ?? 'file',
        targetRole: task.agentRole ?? 'executor',
        cards: opts.cards,
        force: true,
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

/** 归档终态白名单（终态任务从活跃列表迁入归档段）。 */
export const ARCHIVE_STATUSES = ['completed', 'rejected', 'canceled'];

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
}

/** 回执验收驱动：已落盘交付记录的任务跑护栏并归档 / 提案返修 / 死信。 */
function processReceipts(index, runtimeState, config, actions, opts = {}) {
  // 先把 transport/receipts 的机读回执投影进任务与运行态，再进入验收。
  ingestReceipts(index, runtimeState, { actions, dir: opts.receiptsDir });

  const remaining = [];
  for (const task of index.tasks) {
    if (task.status !== 'submitted' && task.status !== 'working') {
      remaining.push(task);
      continue;
    }
    const entry = ensureRuntimeEntry(runtimeState, task.taskId);
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
      archiveTask(index, task, receiptStatus);
      actions.push({ type: 'receipt-terminal', taskId: task.taskId, status: receiptStatus });
      continue;
    }
    const deliveryRef = task.artifacts?.deliveryRecord;
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
    const result = runAcceptance(task, index, { changedFiles: opts.changedFiles });
    markReceiptProcessed(entry, fingerprint);
    entry.autoVerdict = { verdict: result.verdict, rationale: result.rationale, at: nowIso() };
    entry.manualReview = result.manualReview;

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

  for (const task of index.tasks) {
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
    protocolView: buildProtocolView({ tasks: index.tasks, archivedTasks: index.archivedTasks, agentCards }),
    webRefresh: { enabled: config.web.refresh.enabled, intervalMs: config.web.refresh.intervalMs },
    archivedCount: index.archivedTasks.length,
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
    const cards = opts.cards ?? loadAgentCards();
    claimReadyTasks(index, runtimeState, config, actions, { transport: opts.transport, cards });
    processReceipts(index, runtimeState, config, actions, { changedFiles: opts.changedFiles, receiptsDir: opts.receiptsDir });
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
    // 快照为只读产物，关闭自治时同样落盘，供静态网页读取。
    writeJsonAtomic(PATHS.snapshot, snapshot);
  }
  return { snapshot, actions };
}
