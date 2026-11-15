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
  saveIndex,
  saveRuntimeState,
  writeJsonAtomic,
} from './state-store.mjs';
import { runAcceptance } from './acceptance-runner.mjs';
import { loadImprovementLog, summarizeLog } from './improvement-log.mjs';
import { listAudits, loadAuditLog, summarizeAudits } from './audit-log.mjs';
import { buildProtocolView } from './protocol-mapper.mjs';

const BY_ORCHESTRATOR = 'orchestrator-cli';

/** 有效迁移表（docs/state-machine.md §4.1）。 */
const TRANSITIONS = {
  backlog: ['ready', 'canceled'],
  ready: ['submitted', 'backlog', 'canceled'],
  submitted: ['working', 'ready', 'canceled', 'failed', 'input-required'],
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

/** 领单：ready 且依赖满足、类型在白名单 → submitted，登记租约。 */
function claimReadyTasks(index, runtimeState, config, actions) {
  for (const task of index.tasks) {
    if (task.status !== 'ready') continue;
    if (!dependenciesMet(task, index)) continue;
    if (!config.allowedTaskTypes.includes(task.type)) continue;
    const entry = ensureRuntimeEntry(runtimeState, task.taskId);
    const deadline = new Date(Date.now() + config.leaseDefaultMinutes * 60_000).toISOString();
    pushHistory(task, 'submitted', BY_ORCHESTRATOR, '编排者领单（派发通道由 agent cu 衔接）');
    entry.leaseClaimedAt = nowIso();
    entry.leaseDeadline = deadline;
    entry.lastRunner = BY_ORCHESTRATOR;
    actions.push({ type: 'claim', taskId: task.taskId });
  }
}

/** 归档终态任务：从 tasks 移入 archivedTasks，只保留标识、终态与工件指针。 */
function archiveTask(index, task, status) {
  index.tasks = index.tasks.filter((t) => t.taskId !== task.taskId);
  index.archivedTasks.push({
    taskId: task.taskId,
    status,
    artifacts: { ...(task.artifacts ?? {}) },
  });
}

/** 回执验收驱动：已落盘交付记录的任务跑护栏并归档 / 提案返修 / 死信。 */
function processReceipts(index, runtimeState, config, actions) {
  const remaining = [];
  for (const task of index.tasks) {
    if (task.status !== 'submitted' && task.status !== 'working') {
      remaining.push(task);
      continue;
    }
    const deliveryRef = task.artifacts?.deliveryRecord;
    if (!deliveryRef) {
      remaining.push(task);
      continue;
    }
    const result = runAcceptance(task, index);
    const entry = ensureRuntimeEntry(runtimeState, task.taskId);
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
 * @param {{commit?: boolean}} opts commit=false 时只计算快照与动作，不落盘。
 * @returns {{snapshot: object, actions: object[]}}
 */
export function advanceOnce(opts = {}) {
  const config = loadConfig();
  const index = loadIndex();
  const runtimeState = loadRuntimeState();
  const actions = [];

  if (shouldAdvance(config)) {
    releaseExpiredLeases(index, runtimeState, actions);
    claimReadyTasks(index, runtimeState, config, actions);
    processReceipts(index, runtimeState, config, actions);
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
      saveIndex(index);
      saveRuntimeState(runtimeState);
    }
    // 快照为只读产物，关闭自治时同样落盘，供静态网页读取。
    writeJsonAtomic(PATHS.snapshot, snapshot);
  }
  return { snapshot, actions };
}
