/**
 * L2 编排工具链单元测试（纯函数 / 纯计算路径，不读写仓内索引与配置文件）。
 * 覆盖：配置校验、状态迁移合法性、自治守门、快照计数与人工复核回填、验收 rejected 结论。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { validateConfig, PATHS, REPO_ROOT, loadAgentCards, loadIndex } from '../state-store.mjs';
import {
  validateAgentCard,
  validateContractVersion,
  validateDeliveryPackage,
  validateReviewHandoverSchema,
  validateTaskIndex,
  validateTaskSheet,
  validateToolDir,
  validateProtocolView,
} from '../validator.mjs';
import { buildRegistry, call as registryCall } from '../tool-registry.mjs';
import { listAudits, recordAudit, summarizeAudits } from '../audit-log.mjs';
import { createStore } from '../store-port.mjs';
import { dedupeEvents } from '../file-watcher.mjs';
import { PROTOCOL_CONTRACT_REF, buildProtocolView, mapCapabilityDeclaration, mapStatus, mapTask } from '../protocol-mapper.mjs';
import { createFileTransport, createTransport } from '../transport.mjs';
import {
  validateTaskHandover,
  validateReceiptHandover,
  validateReviewHandover,
  buildTaskHandover,
  TASK_CONTRACT_REF,
  RECEIPT_CONTRACT_REF,
  TASK_TYPES,
  TASK_STATUSES,
  REVIEW_VERDICTS,
} from '../handover-contract.mjs';
import {
  TASK_ID_PATTERN as SHARED_TASK_ID_PATTERN,
  TERMINAL_STATUSES,
  ROLES,
  NON_ROUTABLE_ROLES,
  TOOL_CATEGORIES,
  ARTIFACT_KINDS,
} from '../contract-enums.mjs';
import {
  ARCHIVE_STATUSES,
  archiveTaskEntry,
  sweepTerminalTasks,
  canTransition,
  shouldAdvance,
  buildSnapshot,
  claimReadyTasks,
  cancelTask,
  promoteTask,
  processReceipts,
  releaseExpiredLeases,
  releaseFailedDeliveries,
  resolveChannelCircuit,
} from '../scheduler.mjs';
import { generateDeliveryPack } from '../delivery-pack.mjs';
import {
  buildCreatedEvent,
  createdAtForEvent,
  deriveEvents,
  eventTypeForTransition,
  hashEvent,
  journalIntegrity,
  loadArchivedNotes,
  loadJournal,
  projectJournal,
  rechainEvents,
  toUtcIso,
} from '../event-store.mjs';
import {
  dispatchTask,
  buildDispatchRecord,
  receiptFingerprint,
  isReceiptProcessed,
  markReceiptProcessed,
  resolveChannelSelection,
} from '../dispatch.mjs';
import {
  buildGuiBrief,
  confirmDelivery,
  fallbackDelivery,
  isDeliveryStalled,
  autoConfirmDelivery,
  readDeliveryAck,
  ackRelativePath,
} from '../gui-dispatch.mjs';
import { parseTaskSheetFrontmatter, buildTaskRecord } from '../task-intake.mjs';
import { ingestReceipts } from '../receipts.mjs';
import { normalizeScope, findScopeConflicts, detectResidualFiles, scopeCovers, expandScopePattern } from '../scope-mutex.mjs';
import { evaluateTaskEntry, isStatePlanePath, GATE_ALLOWED_STATUSES } from '../task-entry-gate.mjs';
import { evaluateAcceptanceSnapshot, evaluateCommitSnapshot, extractCommitTaskId } from '../ci-task-gate.mjs';
import { INTEGRATE_REQUIRED_CONTEXTS, buildIntegrateProtection, verifyIntegrateProtection } from '../branch-protection.mjs';
import { evaluateRequiredChecks, hasPassedDurableReceipt } from '../pr-release.mjs';
import {
  buildBranchName,
  validateBranchName,
  classifyBranches,
  planCleanup,
  verifyBaseline,
  branchAgeDays,
  collectChangedFiles,
  finalizeSquashMerge,
  buildSquashCommitMessage,
  LONG_LIVED_BRANCHES,
} from '../branch-workflow.mjs';
import { ciGateVerdict, resolveGithubToken, resolveGithubTokenDetail, fetchCheckRuns, evaluateRemoteCiGate } from '../ci-status.mjs';
import { parseTaskSheetScopeForGate } from '../ci-task-gate.mjs';
import { matchAgentCard, selectTargetRole, validateScopeDomain } from '../card-router.mjs';
import {
  SESSION_PATHS,
  LOCATE_LAYERS,
  MAX_START_RETRIES,
  MAX_SEND_RETRIES,
  MAX_TOTAL_ATTEMPTS,
  BACKOFF_MS,
  IRRECOVERABLE_CAUSES,
  FAILURE_CLASSIFICATIONS,
  isIrrecoverable,
  isNonFailureCause,
  DELIVERY_CAUSES,
  nextBackoff,
  CIRCUIT_BREAKER_RESERVED,
  DEAD_LETTER_RESERVED,
  nextSessionPath,
  nextLocateLayer,
  canDispatch,
  resolveDispatchDecision,
  evaluateCircuitBreaker,
  CIRCUIT_BREAKER_DEFAULTS,
  buildDispatchAudit,
  summarizeChannelOutcomes,
  buildEscalationMessage,
} from '../dispatch-channel.mjs';
import { runAcceptance, findMissingDeliveryMarkers, DELIVERY_RECORD_MARKERS } from '../acceptance-runner.mjs';
import { autoConfirmDeliveries } from '../scheduler.mjs';
import {
  addCandidate,
  canTransitionImprovement,
  extractFromReceiptDoc,
  extractFromSnapshot,
  listOpen,
  summarizeLog,
  transitionImprovement,
  validateImprovementEntry,
} from '../improvement-log.mjs';

describe('validateConfig 配置结构校验', () => {
  it('合法缺省值归一化通过', () => {
    const cfg = validateConfig({});
    expect(cfg.reworkLimit).toBe(2);
    expect(cfg.leaseDefaultMinutes).toBe(30);
    expect(cfg.autoLoop.enabled).toBe(false);
    expect(cfg.allowedTaskTypes).toEqual([]);
  });

  it('返修上限为负整数时抛错', () => {
    expect(() => validateConfig({ reworkLimit: -1 })).toThrow(/reworkLimit/);
  });

  it('租约时长非正数时抛错', () => {
    expect(() => validateConfig({ leaseDefaultMinutes: 0 })).toThrow(/leaseDefaultMinutes/);
  });

  it('任务类型白名单非数组时抛错', () => {
    expect(() => validateConfig({ allowedTaskTypes: 'implementation' })).toThrow(/allowedTaskTypes/);
  });

  it('存储后端缺省归一化为 json，非法后端抛错', () => {
    expect(validateConfig({}).store.backend).toBe('json');
    expect(() => validateConfig({ store: { backend: 'mysql' } })).toThrow(/backend/);
  });

  it('看板轮询缺省开启、间隔 3000；显式关闭保留 false', () => {
    const def = validateConfig({});
    expect(def.web.refresh.enabled).toBe(true);
    expect(def.web.refresh.intervalMs).toBe(3000);
    expect(validateConfig({ web: { refresh: { enabled: false, intervalMs: 5000 } } }).web.refresh).toEqual({
      enabled: false,
      intervalMs: 5000,
    });
  });

  it('轮询间隔非法（非整数 / 小于 1000）时抛错', () => {
    expect(() => validateConfig({ web: { refresh: { intervalMs: 0 } } })).toThrow(/intervalMs/);
    expect(() => validateConfig({ web: { refresh: { intervalMs: 800 } } })).toThrow(/intervalMs/);
    expect(() => validateConfig({ web: { refresh: { intervalMs: 'fast' } } })).toThrow(/intervalMs/);
  });
});

describe('canTransition 状态迁移合法性', () => {
  it('backlog → ready 合法', () => {
    expect(canTransition('backlog', 'ready')).toBe(true);
  });

  it('ready → submitted 合法', () => {
    expect(canTransition('ready', 'submitted')).toBe(true);
  });

  it('终态 completed 不可再迁移', () => {
    expect(canTransition('completed', 'working')).toBe(false);
  });

  it('rejected 不可回到 working', () => {
    expect(canTransition('rejected', 'working')).toBe(false);
  });
});

describe('shouldAdvance 自治守门', () => {
  it('显式开启才推进', () => {
    expect(shouldAdvance({ autoLoop: { enabled: true } })).toBe(true);
  });

  it('关闭 / 缺省 / null 均为只读', () => {
    expect(shouldAdvance({ autoLoop: { enabled: false } })).toBe(false);
    expect(shouldAdvance({})).toBe(false);
    expect(shouldAdvance(null)).toBe(false);
  });
});

describe('buildSnapshot 快照计数与人工复核回填', () => {
  const config = validateConfig({});

  const index = {
    version: '1.0.0',
    tasks: [
      { taskId: 'AF-005', contextId: 'framework-evolution', type: 'implementation', title: '只读单', status: 'backlog', artifacts: {} },
      { taskId: 'AF-006', contextId: 'framework-evolution', type: 'implementation', title: '验收单', status: 'submitted', artifacts: {} },
    ],
    archivedTasks: [],
  };
  const runtimeState = {
    tasks: {
      'AF-006': {
        manualReview: ['回执七组字段完整性需人工核对'],
        autoVerdict: { verdict: 'conditional-pass', rationale: '机读全绿，存在人工复核项', at: '2026-11-15T00:00:00+08:00' },
        dispatch: {
          taskId: 'AF-006',
          channel: 'file',
          targetRole: 'executor',
          status: 'submitted',
          handoverRef: 'transport/tasks/AF-006.json',
          dispatchedAt: '2026-11-15T00:00:00+08:00',
        },
      },
    },
  };

  it('按状态计数', () => {
    const snapshot = buildSnapshot(index, runtimeState, config);
    expect(snapshot.counts.backlog).toBe(1);
    expect(snapshot.counts.submitted).toBe(1);
    expect(snapshot.tasks).toHaveLength(2);
  });

  it('回填运行态派发记录只读投影；未派发任务为 null', () => {
    const snapshot = buildSnapshot(index, runtimeState, config);
    const dispatched = snapshot.tasks.find((t) => t.taskId === 'AF-006');
    expect(dispatched.dispatch).toMatchObject({ channel: 'file', targetRole: 'executor', handoverRef: 'transport/tasks/AF-006.json' });
    const plain = snapshot.tasks.find((t) => t.taskId === 'AF-005');
    expect(plain.dispatch).toBeNull();
  });

  it('回填运行态人工复核清单，无记录时为空数组', () => {
    const snapshot = buildSnapshot(index, runtimeState, config);
    const reviewed = snapshot.tasks.find((t) => t.taskId === 'AF-006');
    expect(reviewed.manualReview).toEqual(['回执七组字段完整性需人工核对']);
    const plain = snapshot.tasks.find((t) => t.taskId === 'AF-005');
    expect(plain.manualReview).toEqual([]);
  });

  it('快照携带交付包 / Agent Card / 工具契约只读段（数组结构，容错空）', () => {
    const snapshot = buildSnapshot(index, runtimeState, config);
    expect(Array.isArray(snapshot.deliveryPacks)).toBe(true);
    expect(Array.isArray(snapshot.agentCards)).toBe(true);
    expect(Array.isArray(snapshot.toolContracts)).toBe(true);
    if (snapshot.agentCards.length > 0) expect(snapshot.agentCards[0]).toHaveProperty('role');
    if (snapshot.toolContracts.length > 0) expect(snapshot.toolContracts[0]).toHaveProperty('toolId');
  });

  it('快照投影看板轮询配置 webRefresh', () => {
    const snapshot = buildSnapshot(index, runtimeState, config);
    expect(snapshot.webRefresh).toEqual({ enabled: true, intervalMs: 3000 });
    const off = validateConfig({ web: { refresh: { enabled: false, intervalMs: 5000 } } });
    expect(buildSnapshot(index, runtimeState, off).webRefresh).toEqual({ enabled: false, intervalMs: 5000 });
  });
});

describe('archiveTaskEntry 归档迁移', () => {
  function buildIndex() {
    return {
      version: '1.0.0',
      tasks: [
        {
          taskId: 'AF-005',
          contextId: 'framework-evolution',
          type: 'implementation',
          title: '单',
          status: 'completed',
          artifacts: { taskSheet: 'docs/team/af-005.md' },
        },
        { taskId: 'AF-006', contextId: 'framework-evolution', type: 'implementation', title: '验收单', status: 'completed', artifacts: {} },
      ],
      archivedTasks: [],
    };
  }

  it('把任务从活跃列表迁入归档段并合并工件指针', () => {
    const index = buildIndex();
    const entry = archiveTaskEntry(index, 'AF-005', {
      status: 'completed',
      artifacts: { deliveryRecord: 'docs/team/record.md' },
      note: '事后补登归档',
    });
    expect(index.tasks).toHaveLength(1);
    expect(index.tasks[0].taskId).toBe('AF-006');
    expect(index.archivedTasks).toHaveLength(1);
    expect(entry).toMatchObject({
      taskId: 'AF-005',
      status: 'completed',
      artifacts: { taskSheet: 'docs/team/af-005.md', deliveryRecord: 'docs/team/record.md' },
      note: '事后补登归档',
    });
  });

  it('默认终态为 completed', () => {
    const index = buildIndex();
    expect(archiveTaskEntry(index, 'AF-006').status).toBe('completed');
  });

  it('任务不在活跃列表时抛错', () => {
    const index = buildIndex();
    expect(() => archiveTaskEntry(index, 'AF-999')).toThrow(/不在活跃列表/);
  });

  it('已归档任务重复归档时抛错', () => {
    const index = buildIndex();
    archiveTaskEntry(index, 'AF-005');
    expect(() => archiveTaskEntry(index, 'AF-005')).toThrow(/已归档/);
  });

  it('非法归档终态抛错；合法终态对齐白名单', () => {
    const index = buildIndex();
    expect(() => archiveTaskEntry(index, 'AF-005', { status: 'working' })).toThrow(/不得改写终态/);
    // failed 必须在内：它不经过回执归档分支，漏掉就会永久占「活跃计数」。
    expect(ARCHIVE_STATUSES).toEqual(['completed', 'rejected', 'canceled', 'failed']);
    for (const status of ['rejected', 'canceled', 'failed']) {
      const ix = buildIndex();
      ix.tasks.find((task) => task.taskId === 'AF-005').status = status;
      expect(archiveTaskEntry(ix, 'AF-005').status).toBe(status);
    }
  });

  it('扫档把 failed / canceled 的终态任务搬进归档段', () => {
    const index = buildIndex();
    index.tasks.find((task) => task.taskId === 'AF-005').status = 'failed';
    index.tasks.find((task) => task.taskId === 'AF-006').status = 'canceled';
    const actions = [];
    const swept = sweepTerminalTasks(index, actions);
    expect(swept.map((item) => `${item.taskId}:${item.status}`).sort()).toEqual(['AF-005:failed', 'AF-006:canceled']);
    expect(actions.filter((a) => a.type === 'archive-terminal')).toHaveLength(2);
    // 非终态任务不被误扫
    expect(index.tasks.map((task) => task.taskId)).not.toContain('AF-005');
    expect(index.tasks.map((task) => task.taskId)).not.toContain('AF-006');
  });
});

describe('runAcceptance 验收结论', () => {
  const emptyIndex = { tasks: [], archivedTasks: [] };

  it('任务单指针缺失时判 rejected', () => {
    const task = {
      taskId: 'AF-005',
      contextId: 'framework-evolution',
      type: 'implementation',
      artifacts: {},
    };
    const result = runAcceptance(task, emptyIndex);
    expect(result.verdict).toBe('rejected');
    expect(result.checks.some((c) => c.status === 'fail')).toBe(true);
  });

  it('taskId 不符合标识模式时 V2 失败', () => {
    const task = {
      taskId: 'bad id',
      contextId: 'x',
      type: 'implementation',
      artifacts: { taskSheet: 'docs/worklog/pending/nonexistent.md' },
    };
    const result = runAcceptance(task, emptyIndex);
    expect(result.verdict).toBe('rejected');
    expect(result.checks.find((c) => c.code === 'V2')?.status).toBe('fail');
  });

  it('无遗留、无偏差、回执齐全时判 passed（五类全清）', () => {
    const task = {
      taskId: 'AF-020',
      contextId: 'framework-evolution',
      type: 'investigation',
      artifacts: {
        taskSheet: 'docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-task-2026-11-17.md',
        deliveryRecord: 'docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-implementation-2026-11-17.md',
      },
      receipt: { deviationTable: [], openQuestions: [], manualReviewList: [], backlogItems: [] },
    };
    const result = runAcceptance(task, { tasks: [task], archivedTasks: [] });
    expect(result.verdict).toBe('passed');
    expect(result.manualReview).toHaveLength(0);
  });

  it('偏差非空时降为 conditional-pass，人工项按证据列出', () => {
    const task = {
      taskId: 'AF-021',
      contextId: 'framework-evolution',
      type: 'investigation',
      artifacts: {
        taskSheet: 'docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-task-2026-11-17.md',
        deliveryRecord: 'docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-implementation-2026-11-17.md',
      },
      receipt: {
        deviationTable: [{ id: 'D1', deviation: 'GUI 未启用', impact: '人工粘贴', mitigation: '文件 transport' }],
        openQuestions: [],
        manualReviewList: [],
        backlogItems: [],
      },
    };
    const result = runAcceptance(task, { tasks: [task], archivedTasks: [] });
    expect(result.verdict).toBe('conditional-pass');
    expect(result.manualReview.join(' ')).toMatch('偏差表');
  });
});

const baseEntry = { title: '快照复核清单需机读化', source: 'implementation', type: 'gap', layer: 'adapter' };

describe('改进台账字段校验与去重', () => {
  it('合法条目归一化并分配递增编号', () => {
    const log = { improvements: [] };
    const first = addCandidate(log, baseEntry);
    const second = addCandidate(log, { ...baseEntry, title: '护栏覆盖不足' });
    expect(first.improvementId).toBe('IM-001');
    expect(second.improvementId).toBe('IM-002');
    expect(first.status).toBe('candidate');
    expect(first.history).toHaveLength(1);
    expect(first.evidence).toEqual([]);
  });

  it('source / type / layer 枚举非法时抛错', () => {
    expect(() => validateImprovementEntry({ ...baseEntry, source: 'unknown' })).toThrow(/source/);
    expect(() => validateImprovementEntry({ ...baseEntry, type: 'unknown' })).toThrow(/type/);
    expect(() => validateImprovementEntry({ ...baseEntry, layer: 'unknown' })).toThrow(/layer/);
  });

  it('标题重复时拒绝登记', () => {
    const log = { improvements: [] };
    addCandidate(log, baseEntry);
    expect(() => addCandidate(log, { ...baseEntry, title: '快照复核清单需机读化' })).toThrow(/标题已存在/);
  });
});

describe('改进台账状态流转', () => {
  it('candidate → queued → accepted → done 合法，终态留 resolution', () => {
    const log = { improvements: [] };
    const entry = addCandidate(log, { ...baseEntry, title: '流转跟踪项' });
    transitionImprovement(log, entry.improvementId, 'queued', { by: 'orchestrator' });
    expect(entry.status).toBe('queued');
    transitionImprovement(log, entry.improvementId, 'accepted');
    transitionImprovement(log, entry.improvementId, 'done', { note: '已落地为护栏', linkedTaskId: 'AF-006' });
    expect(entry.status).toBe('done');
    expect(entry.resolution.resolutionNote).toBe('已落地为护栏');
    expect(entry.resolution.linkedTaskId).toBe('AF-006');
    expect(entry.history.length).toBeGreaterThan(1);
  });

  it('queued 不可直达 done；终态不可再迁移', () => {
    const log = { improvements: [] };
    const entry = addCandidate(log, { ...baseEntry, title: '非法流转项' });
    transitionImprovement(log, entry.improvementId, 'queued');
    expect(canTransitionImprovement('queued', 'done')).toBe(false);
    expect(() => transitionImprovement(log, entry.improvementId, 'done')).toThrow(/非法/);
    transitionImprovement(log, entry.improvementId, 'wontfix', { note: '不采纳' });
    expect(() => transitionImprovement(log, entry.improvementId, 'queued')).toThrow(/非法/);
  });
});

describe('改进台账快照抽取与汇总', () => {
  const snapshot = {
    tasks: [
      {
        taskId: 'AF-005',
        title: '试点单',
        verdict: 'conditional-pass',
        verdictRationale: '附条件通过，遗留已登记',
        manualReview: ['复核项 A'],
      },
    ],
    reworkProposals: [
      { proposalId: 'RW-AF-005-1', originalTaskId: 'AF-005', title: '返修单', rationale: '根因：指针缺失', priorTasks: ['AF-005'] },
    ],
    deadLetters: [{ taskId: 'DL-1', title: '死信单', escalation: { waiting: '待裁决', evidence: ['E1'] } }],
  };

  it('四类来源各抽一条，existing 命中的跳过', () => {
    const drafts = extractFromSnapshot(snapshot, []);
    expect(drafts).toHaveLength(4);
    const existing = [{ title: '复核项 A', source: 'acceptance', relatedTaskId: 'AF-005', type: 'gap', layer: 'adapter' }];
    const after = extractFromSnapshot(snapshot, existing);
    expect(after).toHaveLength(3);
  });

  it('汇总计数区分活跃与终态', () => {
    const log = { improvements: [] };
    addCandidate(log, { ...baseEntry, title: '活跃项' });
    const done = addCandidate(log, { ...baseEntry, title: '完成项', type: 'tech-debt' });
    transitionImprovement(log, done.improvementId, 'queued');
    transitionImprovement(log, done.improvementId, 'accepted');
    transitionImprovement(log, done.improvementId, 'done');
    const summary = summarizeLog(log);
    expect(summary.total).toBe(2);
    expect(summary.activeCount).toBe(1);
    expect(summary.byStatus.done).toBe(1);
    expect(listOpen(log)).toHaveLength(1);
    const active = summary.items.find((i) => i.title === '活跃项');
    expect(active.status).toBe('candidate');
    expect(active.evidence).toEqual([]);
    expect(active.lastTransition.to).toBe('candidate');
    expect(active.historyCount).toBe(1);
  });
});

describe('改进台账回执正文抽取', () => {
  const fixture = [
    '---',
    'taskId: AF-017',
    '---',
    '',
    '## 遗留',
    '',
    '**backlogItems**',
    '',
    '- 通道重试规则未锚定框架 §4',
    '- 12 条差异需在两仓文档修订时消化',
    '',
    '**openQuestions**',
    '',
    '1. 通道失败的权威终态出口以哪侧为准？',
    '| 列 A | 列 B |',
    '| 表格行 | 不应抽取 |',
    '2. 熔断阈值在通道侧复用通用熔断，还是独立计数？',
    '',
    '**manualReviewList**',
    '',
    '- 抽查备忘 §3 五个子节行号锚点',
  ].join('\n');

  it('抽取 backlog 与 openQuestion 列表项，跳过 manualReview 与表格行', () => {
    const drafts = extractFromReceiptDoc(fixture, [], { docRef: 'relay-response-af017.md' });
    expect(drafts).toHaveLength(4);
    expect(drafts[0].title).toBe('通道重试规则未锚定框架 §4');
    expect(drafts[0].relatedTaskId).toBe('AF-017');
    expect(drafts[0].evidence).toEqual(['receipt:relay-response-af017.md', 'backlogItem']);
    expect(drafts[2].evidence).toEqual(['receipt:relay-response-af017.md', 'openQuestion']);
    expect(drafts.some((d) => d.title.includes('抽查备忘'))).toBe(false);
    expect(drafts.some((d) => d.title.includes('表格行'))).toBe(false);
    expect(drafts.every((d) => d.source === 'acceptance' && d.type === 'gap' && d.layer === 'adapter')).toBe(true);
  });

  it('existing 命中标题跳过，同通道重复标题去重', () => {
    const existing = [{ title: '通道重试规则未锚定框架 §4', source: 'acceptance', relatedTaskId: 'AF-017' }];
    const drafts = extractFromReceiptDoc(fixture, existing, { docRef: 'r.md' });
    expect(drafts).toHaveLength(3);
    expect(drafts.some((d) => d.title === '通道重试规则未锚定框架 §4')).toBe(false);
  });

  it('空文本 / 非字符串返回空数组', () => {
    expect(extractFromReceiptDoc('', [])).toEqual([]);
    expect(extractFromReceiptDoc(null, [])).toEqual([]);
    expect(extractFromReceiptDoc(undefined, [])).toEqual([]);
  });

  it('正文“任务标识”行解析 taskId；无标识返回 null', () => {
    const inline = '# DR-001 回执\n\n> 任务标识：`DR-001`\n\n**openQuestions**\n\n1. 待拍板问题？\n';
    const drafts = extractFromReceiptDoc(inline, []);
    expect(drafts[0].relatedTaskId).toBe('DR-001');
    const noId = '**openQuestions**\n\n1. 待拍板问题？\n';
    expect(extractFromReceiptDoc(noId, [])[0].relatedTaskId).toBeNull();
  });
});

const __testDir = dirname(fileURLToPath(import.meta.url));
function readFixture(name) {
  return JSON.parse(readFileSync(join(__testDir, 'fixtures', name), 'utf8'));
}
function readJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}
/** 框架仓 schema 不可达时校验结果为 skipped；此时不断言通过性。 */
function assertNotFailed(res) {
  if (!res.skipped) expect(res.ok).toBe(true);
}

describe('validator AF-006 框架 schema 机读校验', () => {
  it('合法任务单元数据通过 schema 校验', async () => {
    const res = await validateTaskSheet(readFixture('valid-task-sheet.json'));
    assertNotFailed(res);
  });

  it('非法任务单（标识模式 / 枚举 / 必填缺失）被拒绝', async () => {
    const res = await validateTaskSheet(readFixture('invalid-task-sheet.json'));
    if (!res.skipped) {
      expect(res.ok).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    }
  });

  it('合法状态索引通过 schema 校验', async () => {
    const res = await validateTaskIndex(readFixture('valid-task-index.json'));
    assertNotFailed(res);
  });

  it('仓内现有工具契约目录通过 schema 校验', async () => {
    const res = await validateToolDir(PATHS.toolsDir);
    assertNotFailed(res);
  });

  it('仓内现有 Agent Card 通过 schema 校验', async () => {
    const card = readJsonFile(join(PATHS.agentCardsDir, 'orchestrator.json'));
    const res = await validateAgentCard(card);
    assertNotFailed(res);
  });

  it('框架样例 review 交接件通过 schema 校验', async () => {
    const fwDir = process.env.ORCH_FRAMEWORK_DIR
      ? process.env.ORCH_FRAMEWORK_DIR
      : join(REPO_ROOT, '..', '..', 'agent-collaboration-framework');
    const fwFile = join(fwDir, 'examples', 'example-review-handover.json');
    if (!existsSync(fwFile)) return;
    const res = await validateReviewHandoverSchema(readJsonFile(fwFile));
    assertNotFailed(res);
  });

  it('缺必填字段的 review 交接件被拒绝', async () => {
    const fwDir = process.env.ORCH_FRAMEWORK_DIR
      ? process.env.ORCH_FRAMEWORK_DIR
      : join(REPO_ROOT, '..', '..', 'agent-collaboration-framework');
    const fwFile = join(fwDir, 'examples', 'example-review-handover.json');
    const review = existsSync(fwFile)
      ? readJsonFile(fwFile)
      : { reviewId: 'REVIEW-001', taskId: 'TASK-001', contextId: 'CTX-1', recommendation: 'r', createdBy: 'x', createdAt: '2026-11-16' };
    delete review.proposal;
    const res = await validateReviewHandoverSchema(review);
    if (!res.skipped) {
      expect(res.ok).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    }
  });
});

const sampleTool = {
  toolId: 'TOOL-TEST-READ',
  category: 'workspace-read',
  sideEffect: 'read-only',
  allowedRoles: ['orchestrator', 'reviewer'],
  resources: ['docs/'],
  description: '测试只读工具',
};

describe('tool-registry AF-007 注册表收口与权限校验', () => {
  it('合法工具契约构建注册表并暴露只读清单', () => {
    const registry = buildRegistry([sampleTool]);
    const tools = Object.values(registry.tools);
    expect(tools).toHaveLength(1);
    expect(tools[0].toolId).toBe('TOOL-TEST-READ');
  });

  it('重复工具标识抛错', () => {
    expect(() => buildRegistry([sampleTool, sampleTool])).toThrow(/重复/);
  });

  it('非法副作用级别抛错', () => {
    expect(() => buildRegistry([{ ...sampleTool, sideEffect: 'explosive' }])).toThrow(/sideEffect/);
  });

  it('非法角色抛错', () => {
    expect(() => buildRegistry([{ ...sampleTool, allowedRoles: ['wizard'] }])).toThrow(/角色/);
  });

  it('白名单内角色调用放行并记 allowed 审计', () => {
    const registry = buildRegistry([sampleTool]);
    const auditLog = { audits: [] };
    const res = registryCall(registry, 'TOOL-TEST-READ', { actor: 'reviewer', correlationId: 'T-1' }, auditLog);
    expect(res.ok).toBe(true);
    expect(res.denied).toBe(false);
    expect(auditLog.audits[0].result).toBe('allowed');
  });

  it('白名单外角色调用拒绝并记 denied 审计', () => {
    const registry = buildRegistry([sampleTool]);
    const auditLog = { audits: [] };
    const res = registryCall(registry, 'TOOL-TEST-READ', { actor: 'executor', correlationId: 'T-2' }, auditLog);
    expect(res.ok).toBe(false);
    expect(res.denied).toBe(true);
    expect(res.reason).toMatch(/未被授权/);
    expect(auditLog.audits[0].result).toBe('denied');
  });

  it('未注册工具拒绝', () => {
    const registry = buildRegistry([sampleTool]);
    const res = registryCall(registry, 'TOOL-MISSING', { actor: 'orchestrator' });
    expect(res.denied).toBe(true);
    expect(res.reason).toMatch(/未注册/);
  });
});

describe('audit-log AF-007 审计记录与汇总', () => {
  it('追加审计条目，同签名幂等去重', () => {
    const log = { audits: [] };
    const first = recordAudit(log, { actorRef: 'orchestrator', toolId: 'TOOL-TEST-READ', result: 'allowed', correlationId: 'T-1' });
    const second = recordAudit(log, { actorRef: 'orchestrator', toolId: 'TOOL-TEST-READ', result: 'allowed', correlationId: 'T-1' });
    expect(log.audits).toHaveLength(1);
    expect(second.auditId).toBe(first.auditId);
  });

  it('listAudits 倒序并按工具过滤；summarizeAudits 计数', () => {
    const log = { audits: [] };
    recordAudit(log, { actorRef: 'orchestrator', toolId: 'TOOL-A', result: 'allowed' });
    recordAudit(log, { actorRef: 'reviewer', toolId: 'TOOL-A', result: 'denied' });
    recordAudit(log, { actorRef: 'orchestrator', toolId: 'TOOL-B', result: 'allowed' });
    const toolA = listAudits(log, { toolId: 'TOOL-A' });
    expect(toolA).toHaveLength(2);
    const summary = summarizeAudits(log);
    expect(summary.total).toBe(3);
    expect(summary.byResult.allowed).toBe(2);
    expect(summary.byResult.denied).toBe(1);
  });
});

describe('快照审计段', () => {
  it('快照携带 toolAudits 数组与 auditSummary 汇总段（容错空）', () => {
    const config = validateConfig({});
    const snapshot = buildSnapshot({ version: '1.0.0', tasks: [], archivedTasks: [] }, { tasks: {} }, config);
    expect(Array.isArray(snapshot.toolAudits)).toBe(true);
    expect(snapshot.auditSummary).toMatchObject({ total: expect.any(Number), byResult: expect.any(Object) });
  });
});

function seedIndex() {
  return {
    version: '1.0.0',
    tasks: [{ taskId: 'T-1', contextId: 'c', type: 'implementation', title: '样例', status: 'backlog', artifacts: {} }],
    archivedTasks: [],
  };
}

describe('AF-005 Store 端口与双后端往返', () => {
  it('JSON 后端经工厂创建并完成领取 / 历史 / 释放往返（内存读写隔离）', () => {
    let index = seedIndex();
    const store = createStore(
      { store: { backend: 'json' } },
      {
        loadIndex: () => index,
        saveIndex: (next) => {
          index = next;
        },
      },
    );
    expect(store.backend).toBe('json');
    expect(store.getTask('T-1').status).toBe('backlog');
    expect(store.listByStatus('backlog')).toHaveLength(1);
    expect(store.claim('T-1', 'executor')).toBe(true);
    expect(store.getTask('T-1').agent).toBe('executor');
    store.appendHistory('T-1', { event: 'claim', at: '2026-11-15T00:00:00+08:00' });
    expect(store.getTask('T-1').history).toHaveLength(1);
    expect(store.release('T-1')).toBe(true);
    expect(store.getTask('T-1').agent).toBeNull();
    expect(store.getTask('MISSING')).toBeNull();
  });

  it('SQLite 后端在临时库完成状态持久化往返', () => {
    const dbPath = join(tmpdir(), `orch-store-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`);
    let store;
    let reopen;
    try {
      store = createStore({ store: { backend: 'sqlite' } }, { dbPath });
      expect(store.backend).toBe('sqlite');
      store.saveIndex(seedIndex());
      expect(store.getTask('T-1').status).toBe('backlog');
      expect(store.listByStatus('backlog')).toHaveLength(1);
      store.claim('T-1', 'reviewer');
      store.appendHistory('T-1', { event: 'claim', at: '2026-11-15T00:00:00+08:00' });
      expect(store.getTask('T-1').agent).toBe('reviewer');
      expect(store.getTask('T-1').history).toHaveLength(1);
      // 重新打开同一库，验证持久化
      reopen = createStore({ store: { backend: 'sqlite' } }, { dbPath });
      expect(reopen.getTask('T-1').agent).toBe('reviewer');
      expect(reopen.getTask('T-1').history).toHaveLength(1);
    } finally {
      reopen?.close();
      store?.close();
      rmSync(dbPath, { force: true });
    }
  });
});

describe('AF-005 file-watcher 事件聚合', () => {
  it('同一路径在窗口内去重并累计次数', () => {
    const events = dedupeEvents([
      { path: 'a.md', kind: 'change' },
      { path: 'a.md', kind: 'rename' },
      { path: 'b.md', kind: 'change' },
    ]);
    expect(events.map((e) => e.path).sort()).toEqual(['a.md', 'b.md']);
    expect(events.find((e) => e.path === 'a.md').count).toBe(2);
  });
});

describe('AF-008 协议映射层', () => {
  it('状态映射：前置态 / 活跃态 / 中断态 / 终态归类正确', () => {
    expect(mapStatus('backlog')).toMatchObject({ protocol: null, stage: 'orchestration' });
    expect(mapStatus('ready')).toMatchObject({ protocol: null, stage: 'orchestration' });
    expect(mapStatus('working')).toMatchObject({ protocol: 'WORKING', stage: 'active' });
    expect(mapStatus('input-required')).toMatchObject({ protocol: 'INPUT_REQUIRED', stage: 'interrupted' });
    expect(mapStatus('completed')).toMatchObject({ protocol: 'COMPLETED', stage: 'terminal' });
    expect(mapStatus('unknown-x')).toMatchObject({ protocol: null, stage: 'orchestration' });
  });

  it('任务与工件引用映射（对象 / 数组两种工件口径）', () => {
    const task = mapTask({
      taskId: 'T-1',
      contextId: 'g',
      type: 'implementation',
      title: '样例',
      status: 'ready',
      requiredSkills: ['audit'],
      dependsOn: ['T-0'],
      artifacts: { deliveryRecord: 'docs/x.md' },
    });
    expect(task.groupId).toBe('g');
    expect(task.status.protocol).toBeNull();
    expect(task.status.stage).toBe('orchestration');
    expect(task.artifactReferences).toEqual([{ kind: 'deliveryRecord', ref: 'docs/x.md' }]);
    const arr = mapTask({ taskId: 'T-2', status: 'working', artifacts: ['docs/a.md'] });
    expect(arr.artifactReferences).toEqual([{ kind: null, ref: 'docs/a.md' }]);
  });

  it('Agent Card → 能力声明字段映射', () => {
    const decl = mapCapabilityDeclaration({
      agentId: 'orc',
      role: 'orchestrator',
      skills: ['route'],
      tools: ['state-store'],
      resources: ['docs/'],
      availability: 'available',
    });
    expect(decl.agentId).toBe('orc');
    expect(decl.skills).toEqual(['route']);
    expect(decl.availability).toBe('available');
  });

  it('协议视图聚合任务 / 工件 / 归组 / 能力声明，归档任务单列轻量指针', () => {
    const view = buildProtocolView({
      tasks: [{ taskId: 'T-1', contextId: 'g', type: 'documentation', title: '样例', status: 'working', artifacts: { doc: 'docs/a.md' } }],
      archivedTasks: [{ taskId: 'T-0', status: 'completed', artifacts: {} }],
      agentCards: [{ agentId: 'orc', role: 'orchestrator', availability: 'available' }],
    });
    expect(view.contractRef).toBe(PROTOCOL_CONTRACT_REF);
    expect(view.tasks).toHaveLength(1);
    expect(view.archivedTasks).toHaveLength(1);
    expect(view.archivedTasks[0]).toMatchObject({ taskId: 'T-0' });
    expect(view.artifacts).toEqual([{ taskId: 'T-1', kind: 'doc', ref: 'docs/a.md' }]);
    expect(view.groupIds).toEqual(['g']);
    expect(view.groupId).toBe('g');
    expect(view.capabilityDeclarations).toHaveLength(1);
  });

  it('协议视图符合框架 protocol-view schema（运行态任务 + 归档指针）', async () => {
    const view = buildProtocolView({
      tasks: [
        {
          taskId: 'T-1',
          contextId: 'g',
          type: 'documentation',
          title: '样例',
          status: 'working',
          history: [{ by: 'executor' }],
          artifacts: { deliveryRecord: 'docs/x.md' },
        },
      ],
      archivedTasks: [{ taskId: 'T-0', status: 'completed', artifacts: { deliveryRecord: 'docs/y.md' } }],
    });
    const res = await validateProtocolView(view);
    // CI 无框架仓 sibling 时 validator 按设计返回 skipped；此时只验证“不误报失败”。
    if (!res.skipped) {
      expect(res.ok).toBe(true);
    } else {
      expect(res.skipped).toBe(true);
    }
  });

  it('tolerant 策略：未知状态值原样透传并列入 unknownStatuses，不猜造标准态', () => {
    const view = buildProtocolView({
      tasks: [{ taskId: 'T-2', status: 'quarantined', artifacts: {} }],
      archivedTasks: [],
    });
    expect(view.tasks[0].status.protocol).toBeNull();
    expect(view.tasks[0].status.stage).toBe('orchestration');
    expect(view.unknownStatuses).toEqual(['quarantined']);
  });
});

describe('AF-008 Transport 端口与文件实现', () => {
  it('文件 Transport 投递任务 / 回执 / 工件三类交接文件', () => {
    const outDir = join(tmpdir(), `orch-transport-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`).replace(/\.sqlite$/, '');
    try {
      const transport = createFileTransport({ outDir });
      const p1 = transport.submitTask({ taskId: 'T-1', title: '样例' });
      const p2 = transport.submitReceipt({ receiptId: 'R-1', taskId: 'T-1' });
      const p3 = transport.publishArtifact({ refId: 'A-1', kind: 'doc' });
      expect(existsSync(p1)).toBe(true);
      expect(existsSync(p2)).toBe(true);
      expect(existsSync(p3)).toBe(true);
      const record = JSON.parse(readFileSync(p1, 'utf8'));
      expect(record.payload.taskId).toBe('T-1');
      expect(record.deliveredAt).toBeTruthy();
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('工厂默认文件 Transport；MCP / HTTP 预留位抛未实现错误', () => {
    const file = createTransport({});
    expect(file.kind).toBe('file');
    expect(() => createTransport({ transport: { type: 'mcp' } })).toThrow(/尚未实现/);
  });
});

describe('AF-009 交接契约校验与构造器', () => {
  const validTask = {
    taskId: 'AF-009',
    contextId: 'phase2.5-orchestration-closed-loop',
    type: 'implementation',
    title: '交接契约 schema 与 transport 接线',
    status: 'backlog',
    createdAt: '2026-11-16T08:00:00+08:00',
    scope: { files: ['scripts/orchestration/transport.mjs'], modules: [], interfaces: [] },
    dependsOn: [],
    policyRefs: ['framework/task-contract.md'],
  };

  function validReceipt(overrides = {}) {
    return {
      taskId: 'AF-009',
      contextId: 'phase2.5-orchestration-closed-loop',
      type: 'implementation',
      baselineRef: '09df090',
      dependsOn: [],
      policyRefs: [],
      changedFiles: { added: [], modified: ['scripts/orchestration/transport.mjs'], deleted: [] },
      artifactRefs: {
        taskSheet: 'docs/worklog/pending/af009-task.md',
        deliveryRecord: 'docs/worklog/completed/af009.md',
        reply: null,
        others: [],
      },
      gateResults: [{ command: 'pnpm exec vitest run', exitCode: 0, errors: 0, warnings: 0, specFiles: 56 }],
      reproNotes: '定向运行编排层 spec',
      scopeCheck: 'in-scope',
      parallelArtifactsExcluded: true,
      noOutscopeRefactor: true,
      contractChecks: [{ item: 'taskId', result: 'pass', note: '与任务单一致' }],
      contractRef: RECEIPT_CONTRACT_REF,
      fieldAlignment: { result: 'aligned', note: '共享字段一致' },
      backlogItems: [],
      openQuestions: [],
      manualReviewList: [],
      deviationTable: [],
      deviationAbsent: true,
      finalStatus: 'completed',
      reviewVerdict: 'passed',
      verdictRationale: '五类核对全清',
      ...overrides,
    };
  }

  function validReview(overrides = {}) {
    return {
      reviewId: 'RV-AF-009-1',
      taskId: 'AF-009',
      contextId: 'phase2.5-orchestration-closed-loop',
      proposal: '契约结构前置固化，transport 保持薄 IO',
      risks: ['双代理并发写同一交接件'],
      alternatives: ['复用框架 ajv schema 校验'],
      disputes: ['校验强制点应在派发前还是 transport 层'],
      recommendation: '派发前由编排层调用纯函数校验',
      createdBy: 'executor',
      createdAt: '2026-11-16T02:00:00.000Z',
      ...overrides,
    };
  }

  it('合法任务交接件通过校验；构造器补契约引用与追溯字段', () => {
    expect(validateTaskHandover(validTask)).toMatchObject({ valid: true, errors: [] });
    const built = buildTaskHandover(validTask);
    expect(built.handoverKind).toBe('task');
    expect(built.contractRef).toBe(TASK_CONTRACT_REF);
    expect(built.producedBy).toBe('orchestrator');
    expect(built.producedAt).toBeTruthy();
    expect(built.dependsOn).toEqual([]);
    expect(built.scope.files).toEqual(['scripts/orchestration/transport.mjs']);
  });

  it('任务交接件：缺必填 / taskId 模式非法 / 类型越界 / 路径越界均被拦截', () => {
    const missingContext = { ...validTask, contextId: undefined };
    expect(validateTaskHandover(missingContext)).toMatchObject({ valid: false });
    expect(validateTaskHandover(missingContext).errors.join(' ')).toMatch('contextId');

    const badId = { ...validTask, taskId: 'af-9' };
    expect(validateTaskHandover(badId).errors.join(' ')).toMatch('taskId');

    const badType = { ...validTask, type: 'unknown' };
    expect(validateTaskHandover(badType).errors.join(' ')).toMatch('type');

    const badPath = { ...validTask, scope: { files: ['../../etc/passwd'] } };
    expect(validateTaskHandover(badPath).errors.join(' ')).toMatch('scope.files');
  });

  it('合法回执交接件通过；缺七组字段与结论越界被拦截', () => {
    expect(validateReceiptHandover(validReceipt())).toMatchObject({ valid: true, errors: [] });

    const missing = validReceipt();
    delete missing.gateResults;
    delete missing.verdictRationale;
    const result = validateReceiptHandover(missing);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch('gateResults');
    expect(result.errors.join(' ')).toMatch('verdictRationale');

    const badVerdict = validReceipt({ reviewVerdict: 'maybe' });
    expect(validateReceiptHandover(badVerdict).errors.join(' ')).toMatch('reviewVerdict');

    // 框架 receipt.schema 明确允许未验收的 failed 任务 reviewVerdict=null。
    expect(validateReceiptHandover(validReceipt({ finalStatus: 'failed', reviewVerdict: null }))).toMatchObject({
      valid: true,
      errors: [],
    });

    // artifactRefs 必须是对象；数组是历史误用，必须拦截。
    expect(validateReceiptHandover(validReceipt({ artifactRefs: [{ path: 'docs/x.md', kind: 'document' }] })).errors.join(' ')).toMatch(
      'artifactRefs',
    );

    const badFinal = validReceipt({ finalStatus: 'running' });
    expect(validateReceiptHandover(badFinal).errors.join(' ')).toMatch('finalStatus');
  });

  it('AF-043-I1：回执 changedFiles.commits 合法通过；非法 SHA 被拦截', () => {
    const withCommits = validReceipt();
    withCommits.changedFiles = { added: [], modified: [], deleted: [], commits: ['c8632c6', '2a354ca01f150e18852ba11c3b2b1eba04f01b1b'] };
    expect(validateReceiptHandover(withCommits)).toMatchObject({ valid: true, errors: [] });

    const bad = validReceipt();
    bad.changedFiles = { added: [], modified: [], deleted: [], commits: ['HEAD~1'] };
    expect(validateReceiptHandover(bad).errors.join(' ')).toMatch('changedFiles.commits');
  });

  it('合法协商轮意见通过；缺意见字段与裁决缺 decision 被拦截', () => {
    expect(validateReviewHandover(validReview())).toMatchObject({ valid: true, errors: [] });

    const missing = validReview();
    delete missing.proposal;
    delete missing.risks;
    const result = validateReviewHandover(missing);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch('proposal');
    expect(result.errors.join(' ')).toMatch('risks');

    const badResolution = validReview({ resolution: { by: 'orchestrator', at: '2026-11-16' } });
    expect(validateReviewHandover(badResolution).errors.join(' ')).toMatch('resolution.decision');
  });

  it('文件 Transport 落盘 reviews 目录并可回读交接件', () => {
    const outDir = join(tmpdir(), `orch-review-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`).replace(/\.sqlite$/, '');
    try {
      const transport = createFileTransport({ outDir });
      const path = transport.submitReview(validReview());
      expect(existsSync(path)).toBe(true);
      expect(path).toMatch(/reviews/);
      const record = JSON.parse(readFileSync(path, 'utf8'));
      expect(record.payload.reviewId).toBe('RV-AF-009-1');
      expect(record.deliveredAt).toBeTruthy();
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('快照协议视图段', () => {
  it('快照携带 protocolView 只读投影段（容错空）', () => {
    const config = validateConfig({});
    const snapshot = buildSnapshot({ version: '1.0.0', tasks: [], archivedTasks: [] }, { tasks: {} }, config);
    expect(snapshot.protocolView).toMatchObject({
      tasks: expect.any(Array),
      statusMap: expect.any(Object),
      artifacts: expect.any(Array),
      capabilityDeclarations: expect.any(Array),
    });
  });
});

describe('AF-023 任务单立项与回执摄取', () => {
  it('frontmatter 解析为索引记录：产出清单与索引指针分离', () => {
    const text = `---
taskId: AF-023
contextId: phase2.5-orchestration-closed-loop
title: 编排运行态闭环自检
type: verification
status: ready
baselineRef: 1ffcf0f
dependsOn: []
policyRefs: []
createdAt: 2026-11-17T08:00:00+08:00
scope:
  files:
    - scripts/orchestration/
artifacts:
  - name: 自检报告
    path: docs/team/agent-orchestration/af023-runtime-closure-report-2026-11-17.md
    kind: report
---

# 正文
`;
    const { meta, body } = parseTaskSheetFrontmatter(text);
    expect(meta.taskId).toBe('AF-023');
    expect(body).toContain('正文');
    const record = buildTaskRecord(meta, {
      taskSheetPath: 'docs/worklog/pending/af023-runtime-loop-task-2026-11-17.md',
    });
    expect(record.status).toBe('ready');
    expect(record.agentRole).toBe('reviewer');
    expect(Array.isArray(record.artifacts)).toBe(false);
    expect(record.artifacts.taskSheet).toBe('docs/worklog/pending/af023-runtime-loop-task-2026-11-17.md');
    expect(record.plannedArtifacts).toEqual([
      {
        name: '自检报告',
        path: 'docs/team/agent-orchestration/af023-runtime-closure-report-2026-11-17.md',
        kind: 'report',
      },
    ]);
  });

  it('transport 回执摄入：投影 artifactRefs 到任务、按指纹幂等、非法回执不落状态', () => {
    const dir = join(tmpdir(), `orch-receipts-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(dir, { recursive: true });
    const makeReceipt = (overrides = {}) => ({
      receiptId: 'AF-009-R1',
      taskId: 'AF-009',
      contextId: 'phase2.5-orchestration-closed-loop',
      type: 'implementation',
      baselineRef: '1ffcf0f',
      dependsOn: [],
      policyRefs: [],
      changedFiles: { added: [], modified: [], deleted: [] },
      artifactRefs: {
        taskSheet: 'docs/worklog/pending/af009-task.md',
        deliveryRecord: 'docs/worklog/completed/phase2.5/af009.md',
        reply: null,
        others: [],
      },
      gateResults: [{ command: 'pnpm test', exitCode: 0, errors: 0, warnings: 0, specFiles: null }],
      reproNotes: '定向测试',
      scopeCheck: 'in-scope',
      parallelArtifactsExcluded: true,
      noOutscopeRefactor: true,
      contractChecks: [{ item: 'taskId', result: 'pass', note: '与交接件一致' }],
      contractRef: RECEIPT_CONTRACT_REF,
      fieldAlignment: { result: 'aligned', note: '字段一致' },
      backlogItems: [{ id: 'AF-009-B1', impact: '无', schedule: null }],
      openQuestions: [],
      manualReviewList: [],
      deviationTable: [],
      deviationAbsent: true,
      finalStatus: 'completed',
      reviewVerdict: null,
      verdictRationale: '待 orchestrator 验收',
      ...overrides,
    });
    try {
      writeFileSync(
        join(dir, 'AF-009.json'),
        `${JSON.stringify({ deliveredAt: '2026-11-17T08:00:00.000Z', payload: makeReceipt() }, null, 2)}\n`,
        'utf8',
      );
      const index = {
        tasks: [
          {
            taskId: 'AF-009',
            status: 'submitted',
            artifacts: { taskSheet: 'docs/worklog/pending/af009-task.md', deliveryRecord: null },
          },
        ],
      };
      const runtimeState = { tasks: { 'AF-009': { leaseDeadline: '2099-01-01T00:00:00.000Z' } } };
      const actions = [];
      const first = ingestReceipts(index, runtimeState, { dir, archiveDir: join(dir, 'archive'), actions });
      expect(first.ingested).toBe(1);
      expect(index.tasks[0].artifacts.deliveryRecord).toBe('docs/worklog/completed/phase2.5/af009.md');
      // 回执副本指针只能在 task.receipt / 运行态；索引 artifacts 不允许带 receipt 键。
      expect(index.tasks[0].artifacts).not.toHaveProperty('receipt');
      expect(index.tasks[0].receipt.archiveRef).toMatch(/AF-009-receipt-AF-009-R1\.json$/);
      expect(runtimeState.tasks['AF-009'].receiptArchiveRef).toMatch(/AF-009-receipt-AF-009-R1\.json$/);
      expect(index.tasks[0].receipt.finalStatus).toBe('completed');
      expect(runtimeState.tasks['AF-009'].receiptStatus).toBe('completed');

      const second = ingestReceipts(index, runtimeState, { dir, archiveDir: join(dir, 'archive'), actions });
      expect(second.ingested).toBe(0);

      // 租约超时持单后回执才到达：ready + heldForHuman 仍应摄入，作为完成证据供恢复验收。
      const heldIndex = {
        tasks: [
          {
            taskId: 'AF-009',
            status: 'ready',
            artifacts: { taskSheet: 'docs/worklog/pending/af009-task.md', deliveryRecord: null },
          },
        ],
      };
      const heldState = { tasks: { 'AF-009': { heldForHuman: true } } };
      const held = ingestReceipts(heldIndex, heldState, { dir, archiveDir: join(dir, 'archive'), actions: [] });
      expect(held.ingested).toBe(1);
      expect(heldIndex.tasks[0].receipt.finalStatus).toBe('completed');

      writeFileSync(
        join(dir, 'AF-009-bad.json'),
        `${JSON.stringify(
          {
            deliveredAt: '2026-11-17T08:05:00.000Z',
            payload: makeReceipt({ artifactRefs: [{ path: 'docs/x.md', kind: 'document' }] }),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      const third = ingestReceipts(index, runtimeState, { dir, actions });
      expect(third.invalid).toBeGreaterThan(0);
      expect(index.tasks[0].artifacts.deliveryRecord).toBe('docs/worklog/completed/phase2.5/af009.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AF-010 派发接线与回执幂等', () => {
  const validDispatchTask = {
    taskId: 'AF-010',
    contextId: 'phase2.5-orchestration-closed-loop',
    type: 'implementation',
    title: '派发接线与回执监听',
    status: 'ready',
    createdAt: '2026-11-16T08:00:00+08:00',
    scope: { files: ['scripts/orchestration/scheduler.mjs'], modules: [], interfaces: [] },
    dependsOn: [],
    policyRefs: [],
    agentRole: 'executor',
  };

  function fakeTransport() {
    const calls = [];
    return {
      calls,
      submitTask(handover) {
        calls.push(handover);
        return `transport/tasks/${handover.taskId}.json`;
      },
    };
  }

  it('首次派发：交接件投递 transport，派发记录字段齐全并落运行态条目', () => {
    const transport = fakeTransport();
    const entry = { leaseClaimedAt: '2026-11-16T01:00:00.000Z', leaseDeadline: '2026-11-16T01:30:00.000Z' };
    const result = dispatchTask(validDispatchTask, entry, { transport, channel: 'file', targetRole: 'executor' });

    expect(result.dispatched).toBe(true);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].taskId).toBe('AF-010');
    expect(transport.calls[0].handoverKind).toBe('task');
    expect(result.handoverRef).toBe('transport/tasks/AF-010.json');
    expect(entry.dispatch).toMatchObject({
      taskId: 'AF-010',
      contextId: 'phase2.5-orchestration-closed-loop',
      channel: 'file',
      targetRole: 'executor',
      status: 'submitted',
      attempt: 1,
      handoverRef: 'transport/tasks/AF-010.json',
    });
    expect(entry.dispatch.dispatchedAt).toBeTruthy();
    expect(entry.dispatch.sessionRef).toBeNull();
  });

  it('重复派发同一任务不重复投递（幂等），保留首次派发记录', () => {
    const transport = fakeTransport();
    const entry = { leaseDeadline: '2026-11-16T01:30:00.000Z' };
    const first = dispatchTask(validDispatchTask, entry, { transport });
    const second = dispatchTask(validDispatchTask, entry, { transport });

    expect(first.dispatched).toBe(true);
    expect(second.dispatched).toBe(false);
    expect(second.reason).toBe('already-dispatched');
    expect(transport.calls).toHaveLength(1);
    expect(second.record).toBe(first.record);
  });

  it('交接件契约非法时不投递 transport，返回错误清单', () => {
    const transport = fakeTransport();
    const invalid = { ...validDispatchTask, contextId: undefined };
    const entry = {};
    const result = dispatchTask(invalid, entry, { transport });

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('contract-invalid');
    expect(result.errors.join(' ')).toMatch('contextId');
    expect(transport.calls).toHaveLength(0);
    expect(entry.dispatch).toBeUndefined();
  });

  it('派发动作不触碰租约字段，租约超时释放不被派发绕过', () => {
    const transport = fakeTransport();
    const leaseDeadline = '2026-11-16T01:30:00.000Z';
    const entry = { leaseDeadline };
    dispatchTask(validDispatchTask, entry, { transport });
    expect(entry.leaseDeadline).toBe(leaseDeadline);
  });

  it('IM-007 指纹优先用工件版本：同路径返修重写不再被误判为已验收', () => {
    const base = { taskId: 'AF-010', artifacts: { deliveryRecord: 'docs/worklog/completed/af010.md' } };
    const revision1 = receiptFingerprint({ ...base, artifacts: { ...base.artifacts, deliveryRevision: 1 } });
    const revision2 = receiptFingerprint({ ...base, artifacts: { ...base.artifacts, deliveryRevision: 2 } });
    expect(revision1).toBe('AF-010@1');
    expect(revision2).toBe('AF-010@2');
    expect(revision1).not.toBe(revision2);
    // 未登记版本时退回路径指纹（兼容存量任务）
    expect(receiptFingerprint(base, 'other-ref.md')).toBe('AF-010|other-ref.md');
  });

  it('回执验收指纹按 taskId + 交付记录生成；重复指纹只标记一次', () => {
    const task = { taskId: 'AF-010', artifacts: { deliveryRecord: 'docs/worklog/completed/af010.md' } };
    const fp = receiptFingerprint(task);
    expect(fp).toBe('AF-010|docs/worklog/completed/af010.md');
    expect(receiptFingerprint(task, 'other-ref.md')).toBe('AF-010|other-ref.md');

    const entry = {};
    expect(isReceiptProcessed(entry, fp)).toBe(false);
    markReceiptProcessed(entry, fp);
    expect(isReceiptProcessed(entry, fp)).toBe(true);
    expect(isReceiptProcessed(entry, 'AF-010|other-ref.md')).toBe(false);
  });

  it('回执目录事件在防抖窗口内按路径去重合并', () => {
    const events = [
      { path: 'AF-010.json', kind: 'change' },
      { path: 'AF-010.json', kind: 'change' },
      { path: 'AF-011.json', kind: 'rename' },
    ];
    const deduped = dedupeEvents(events);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((e) => e.path === 'AF-010.json').count).toBe(2);
  });
});

describe('AF-023 运行态调度闭环（领单 / 回滚 / 回执终态）', () => {
  const config = {
    autoLoop: { enabled: true },
    allowedTaskTypes: ['investigation'],
    maxConcurrentTasks: 1,
    leaseDefaultMinutes: 30,
    reworkLimit: 2,
    transport: { type: 'file' },
  };

  function task(id) {
    return {
      taskId: id,
      contextId: 'phase2.5-orchestration-closed-loop',
      type: 'investigation',
      title: `只读巡检 ${id}`,
      status: 'ready',
      createdAt: '2026-11-17T00:00:00+08:00',
      scope: { files: ['docs/team/agent-orchestration/README.md'], modules: [], interfaces: [] },
      dependsOn: [],
      policyRefs: [],
      agentRole: 'reviewer',
      artifacts: { taskSheet: `docs/team/agent-orchestration/transport/tasks/${id}.json` },
      history: [],
    };
  }

  function fakeTransport(handler = () => {}) {
    const calls = [];
    return {
      calls,
      submitTask(handover) {
        calls.push(handover);
        handler(handover);
        return `transport/tasks/${handover.taskId}.json`;
      },
    };
  }

  function freshIndex(...tasks) {
    return { tasks, archivedTasks: [] };
  }

  it('单任务队列：有在办任务时不再领取下一个 ready', () => {
    const index = freshIndex(task('AF-101'), task('AF-102'));
    const runtimeState = { tasks: {} };
    const actions = [];
    claimReadyTasks(index, runtimeState, config, actions, { transport: fakeTransport(), cards: [] });

    expect(index.tasks.filter((t) => t.status === 'submitted')).toHaveLength(1);
    expect(index.tasks.filter((t) => t.status === 'ready')).toHaveLength(1);
    expect(actions.filter((a) => a.type === 'claim')).toHaveLength(1);
    expect(actions.filter((a) => a.type === 'dispatch')).toHaveLength(1);
  });

  it('依赖已归档（completed）的上游时仍可领单', () => {
    const downstream = task('AF-107');
    downstream.dependsOn = ['AF-013'];
    const index = {
      tasks: [downstream],
      archivedTasks: [{ taskId: 'AF-013', status: 'completed', history: [] }],
    };
    const runtimeState = { tasks: {} };
    const actions = [];
    claimReadyTasks(index, runtimeState, config, actions, { transport: fakeTransport(), cards: [] });

    expect(downstream.status).toBe('submitted');
    expect(actions.some((a) => a.type === 'claim' && a.taskId === 'AF-107')).toBe(true);
  });

  it('依赖不存在的上游时不领单，并显性报 dependency-unresolved', () => {
    const orphan = task('AF-108');
    orphan.dependsOn = ['AF-999'];
    const index = freshIndex(orphan);
    const runtimeState = { tasks: {} };
    const actions = [];
    claimReadyTasks(index, runtimeState, config, actions, { transport: fakeTransport(), cards: [] });

    expect(orphan.status).toBe('ready');
    const report = actions.find((a) => a.type === 'dependency-unresolved');
    expect(report?.unmet).toEqual([{ taskId: 'AF-999', status: 'unknown' }]);
  });

  it('派发通道按目标角色选：编排者任务走 file，执行代理任务走配置的 gui-relay 并置 pending', () => {
    const guiConfig = { ...config, dispatch: { channel: 'gui-relay', fallbackToFile: true } };
    const own = task('AF-120');
    own.agentRole = 'orchestrator';
    const ownIndex = freshIndex(own);
    const ownState = { tasks: {} };
    claimReadyTasks(ownIndex, ownState, guiConfig, [], { transport: fakeTransport(), cards: [] });
    expect(ownState.tasks['AF-120'].dispatch.channel).toBe('file');
    expect(ownState.tasks['AF-120'].dispatch.delivery).toBeUndefined();

    const exec = task('AF-121');
    exec.agentRole = 'executor';
    const execIndex = freshIndex(exec);
    const execState = { tasks: {} };
    claimReadyTasks(execIndex, execState, guiConfig, [], { transport: fakeTransport(), cards: [] });
    expect(execState.tasks['AF-121'].dispatch.channel).toBe('gui-relay');
    expect(execState.tasks['AF-121'].dispatch.delivery.state).toBe('pending');
    expect(execState.tasks['AF-121'].dispatch.handoverRef).toBeTruthy();
  });

  it('派发失败回滚到 ready，清空租约与派发记录且历史不变', () => {
    const only = task('AF-103');
    const originalHistory = [...only.history];
    const index = freshIndex(only);
    const runtimeState = { tasks: {} };
    const actions = [];
    const transport = fakeTransport(() => {
      throw new Error('transport down');
    });

    claimReadyTasks(index, runtimeState, config, actions, { transport, cards: [] });

    expect(only.status).toBe('ready');
    expect(only.history).toEqual(originalHistory);
    expect(runtimeState.tasks['AF-103'].leaseClaimedAt).toBeNull();
    expect(runtimeState.tasks['AF-103'].leaseDeadline).toBeNull();
    expect(runtimeState.tasks['AF-103'].dispatch).toBeNull();
    expect(actions.some((a) => a.type === 'dispatch-rejected')).toBe(true);
  });

  it('租约超时释放：写 releaseReason 并持单待人工，不在同一轮自动重派', () => {
    const only = task('AF-106');
    only.status = 'submitted';
    const index = freshIndex(only);
    const runtimeState = {
      tasks: {
        'AF-106': {
          leaseClaimedAt: '2026-11-16T00:00:00.000Z',
          leaseDeadline: '2026-11-16T00:30:00.000Z',
          dispatch: { channel: 'file', handoverRef: 'transport/tasks/AF-106.json' },
        },
      },
    };
    const actions = [];
    releaseExpiredLeases(index, runtimeState, actions);

    expect(only.status).toBe('ready');
    expect(runtimeState.tasks['AF-106'].releaseReason).toBe('lease-expired');
    expect(runtimeState.tasks['AF-106'].heldForHuman).toBe(true);
    expect(actions.some((a) => a.type === 'release' && a.reason === 'lease-expired')).toBe(true);

    claimReadyTasks(index, runtimeState, config, actions, { transport: fakeTransport(), cards: [] });
    expect(only.status).toBe('ready');
    expect(actions.some((a) => a.type === 'held-for-human' && a.reason === 'lease-expired')).toBe(true);
  });

  it('持单原因随运行态：GUI 投递降级持单不再被写成租约超时（AF-035-B1）', () => {
    const only = task('AF-108');
    only.status = 'ready';
    const index = freshIndex(only);
    const runtimeState = { tasks: { 'AF-108': { heldForHuman: true, releaseReason: 'gui-delivery-failed' } } };
    const actions = [];

    claimReadyTasks(index, runtimeState, config, actions, { transport: fakeTransport(), cards: [] });
    expect(only.status).toBe('ready');
    const held = actions.find((a) => a.type === 'held-for-human');
    expect(held?.reason).toBe('gui-delivery-failed');
  });

  it('租约超时持单后回执到达：恢复领取并归档，不重新派发', () => {
    const only = task('AF-107');
    only.status = 'ready';
    only.artifacts = { taskSheet: only.artifacts.taskSheet };
    only.receipt = { finalStatus: 'failed', sourceRef: 'transport/receipts/AF-107.json' };
    const index = freshIndex(only);
    const runtimeState = { tasks: { 'AF-107': { heldForHuman: true, releaseReason: 'lease-expired' } } };
    const actions = [];
    const receiptsDir = mkdtempSync(join(tmpdir(), 'orch-receipts-'));

    try {
      processReceipts(index, runtimeState, config, actions, { receiptsDir });
      expect(index.tasks).toHaveLength(0);
      expect(index.archivedTasks[0].status).toBe('failed');
      expect(actions.some((a) => a.type === 'late-receipt-recovered')).toBe(true);
      expect(runtimeState.tasks['AF-107'].heldForHuman).toBe(false);
      expect(runtimeState.tasks['AF-107'].releaseReason).toBe('receipt-after-timeout');
    } finally {
      rmSync(receiptsDir, { recursive: true, force: true });
    }
  });

  it('回执终态非 completed：按合法迁移链闭合并归档，不进入机读验收', () => {
    const only = task('AF-104');
    only.status = 'submitted';
    only.artifacts = { taskSheet: only.artifacts.taskSheet };
    only.receipt = { finalStatus: 'failed', sourceRef: 'transport/receipts/AF-104.json' };
    const index = freshIndex(only);
    const runtimeState = { tasks: {} };
    const actions = [];
    const receiptsDir = mkdtempSync(join(tmpdir(), 'orch-receipts-'));

    try {
      processReceipts(index, runtimeState, config, actions, { receiptsDir });
      expect(index.tasks).toHaveLength(0);
      expect(index.archivedTasks).toHaveLength(1);
      expect(index.archivedTasks[0].taskId).toBe('AF-104');
      expect(index.archivedTasks[0].status).toBe('failed');
      expect(actions.some((a) => a.type === 'receipt-terminal' && a.status === 'failed')).toBe(true);
      expect(runtimeState.tasks['AF-104'].terminalReceipt).toMatchObject({ status: 'failed' });
    } finally {
      rmSync(receiptsDir, { recursive: true, force: true });
    }
  });

  it('回执 completed 但缺交付记录：保留任务并报 receipt-delivery-missing', () => {
    const only = task('AF-105');
    only.status = 'submitted';
    only.receipt = { finalStatus: 'completed', sourceRef: 'transport/receipts/AF-105.json' };
    const index = freshIndex(only);
    const runtimeState = { tasks: {} };
    const actions = [];
    const receiptsDir = mkdtempSync(join(tmpdir(), 'orch-receipts-'));

    try {
      processReceipts(index, runtimeState, config, actions, { receiptsDir });
      expect(index.tasks).toHaveLength(1);
      expect(index.tasks[0].status).toBe('submitted');
      expect(actions.some((a) => a.type === 'receipt-delivery-missing')).toBe(true);
    } finally {
      rmSync(receiptsDir, { recursive: true, force: true });
    }
  });

  it('人工取消：非终态沿状态机闭合到 canceled 并清租约；终态拒绝取消', () => {
    const open = task('AF-110');
    open.status = 'ready';
    const index = freshIndex(open);
    const runtimeState = { tasks: { 'AF-110': { leaseClaimedAt: '2026-11-17T00:00:00.000Z', leaseDeadline: '2999-01-01T00:00:00.000Z' } } };
    const cancelled = cancelTask(index, runtimeState, 'AF-110', { reason: 'scope 跨域' });
    expect(cancelled.status).toBe('canceled');
    expect(cancelled.cancelReason).toBe('scope 跨域');
    expect(runtimeState.tasks['AF-110'].leaseDeadline).toBeNull();
    expect(runtimeState.tasks['AF-110'].releaseReason).toBe('cancelled');
    expect(cancelled.history.at(-1)).toMatchObject({ from: 'ready', to: 'canceled' });

    const done = task('AF-111');
    done.status = 'completed';
    expect(() => cancelTask(freshIndex(done), { tasks: {} }, 'AF-111', {})).toThrow(/终态/);
    expect(() => cancelTask(freshIndex(task('AF-112')), { tasks: {} }, 'AF-404', {})).toThrow(/不在活跃列表/);
  });

  it('人工提级：backlog → ready 校验任务单 / 基线 / 依赖；上游已归档算满足', () => {
    const queued = {
      ...task('AF-113'),
      status: 'backlog',
      baselineRef: '7dd3539',
      dependsOn: ['AF-100'],
    };
    const archiveOk = { taskId: 'AF-100', status: 'completed', artifacts: {} };
    const index = freshIndex(queued);
    index.archivedTasks = [archiveOk];
    const runtimeState = { tasks: { 'AF-113': {} } };
    const promoted = promoteTask(index, runtimeState, 'AF-113', { reason: '依赖已闭环' });
    expect(promoted.status).toBe('ready');
    expect(promoted.history.at(-1)).toMatchObject({ from: 'backlog', to: 'ready', reason: '依赖已闭环' });
    expect(runtimeState.tasks['AF-113'].promotedAt).toBe(promoted.promotedAt);

    const unmet = { ...task('AF-114'), status: 'backlog', baselineRef: '7dd3539', dependsOn: ['AF-200'] };
    expect(() => promoteTask(freshIndex(unmet), { tasks: {} }, 'AF-114', {})).toThrow(/依赖未满足：AF-200/);

    const noBaseline = { ...task('AF-115'), status: 'backlog', baselineRef: null };
    expect(() => promoteTask(freshIndex(noBaseline), { tasks: {} }, 'AF-115', {})).toThrow(/基线不明确/);

    const noSheet = { ...task('AF-116'), status: 'backlog', baselineRef: '7dd3539', artifacts: {} };
    expect(() => promoteTask(freshIndex(noSheet), { tasks: {} }, 'AF-116', {})).toThrow(/任务单指针缺失/);

    expect(() => promoteTask(freshIndex(task('AF-117')), { tasks: {} }, 'AF-117', {})).toThrow(/已处于 ready/);
    const done = { ...task('AF-118'), status: 'submitted' };
    expect(() => promoteTask(freshIndex(done), { tasks: {} }, 'AF-118', {})).toThrow(/只有 backlog/);
    expect(() => promoteTask(freshIndex(task('AF-119')), { tasks: {} }, 'AF-404', {})).toThrow(/不在活跃列表/);
  });

  it('整链：回执落盘 → 摄入 → 验收 → 归档，一轮内闭合 completed', () => {
    const taskId = 'AF-109';
    const only = task(taskId);
    only.status = 'submitted';
    only.artifacts = {
      taskSheet: 'docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-task-2026-11-17.md',
      deliveryRecord: 'docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-implementation-2026-11-17.md',
    };
    const index = freshIndex(only);
    const runtimeState = {
      tasks: {
        [taskId]: { leaseClaimedAt: '2026-11-17T00:00:00.000Z', leaseDeadline: '2999-01-01T00:00:00.000Z' },
      },
    };
    const receiptsDir = mkdtempSync(join(tmpdir(), 'orch-chain-'));
    const archiveDir = mkdtempSync(join(tmpdir(), 'orch-archive-'));

    const receipt = {
      receiptId: `RC-${taskId}-1`,
      taskId,
      contextId: 'phase2.5-orchestration-closed-loop',
      type: 'investigation',
      baselineRef: '7311d01',
      dependsOn: [],
      policyRefs: [],
      contractRef: RECEIPT_CONTRACT_REF,
      artifactRefs: {
        taskSheet: 'docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-task-2026-11-17.md',
        deliveryRecord: 'docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-implementation-2026-11-17.md',
        reply: null,
        others: [],
      },
      changedFiles: { added: [], modified: [], deleted: [] },
      gateResults: [{ command: 'pnpm test', exitCode: 0, errors: 0, warnings: 0, specFiles: 202 }],
      reproNotes: '定向复核整链',
      scopeCheck: 'in-scope',
      parallelArtifactsExcluded: true,
      noOutscopeRefactor: true,
      contractChecks: [{ item: 'taskId', result: 'pass', note: '与任务单一致' }],
      fieldAlignment: { result: 'aligned', note: '字段一致' },
      backlogItems: [],
      openQuestions: [],
      manualReviewList: [],
      deviationTable: [],
      deviationAbsent: true,
      finalStatus: 'completed',
      reviewVerdict: 'passed',
      verdictRationale: '机读全绿',
    };
    writeFileSync(join(receiptsDir, `${taskId}.json`), JSON.stringify({ deliveredAt: '2026-11-17T02:00:00.000Z', payload: receipt }));

    const actions = [];
    try {
      processReceipts(index, runtimeState, config, actions, { receiptsDir, receiptArchiveDir: archiveDir, changedFiles: [] });
      expect(actions.some((a) => a.type === 'receipt-ingested')).toBe(true);
      expect(actions.some((a) => a.type === 'archive-completed')).toBe(true);
      expect(index.tasks).toHaveLength(0);
      expect(index.archivedTasks[0]).toMatchObject({ taskId, status: 'completed' });
      expect(runtimeState.tasks[taskId].autoVerdict.verdict).toBe('passed');
    } finally {
      rmSync(receiptsDir, { recursive: true, force: true });
      rmSync(archiveDir, { recursive: true, force: true });
    }
  });
});

describe('AF-011 文件域 scope 互斥校验', () => {
  function task(id, files, opts = {}) {
    return {
      taskId: id,
      contextId: 'phase2.5-orchestration-closed-loop',
      type: 'implementation',
      status: 'submitted',
      scope: { files },
      ...opts,
    };
  }

  it('IM-011 通配展开：按真实目录枚举，不存在的段不产幽灵路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'orch-glob-'));
    try {
      mkdirSync(join(root, 'src', 'a'), { recursive: true });
      mkdirSync(join(root, 'src', 'b'), { recursive: true });
      mkdirSync(join(root, 'docs'), { recursive: true });
      const matches = expandScopePattern('src/*', { rootDir: root });
      expect(matches.sort()).toEqual(['src/a', 'src/b']);
      expect(expandScopePattern('src/*/deep', { rootDir: root })).toEqual([]);
      expect(expandScopePattern('docs/', { rootDir: root })).toEqual(['docs']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('IM-011 通配展开消除前缀误报：src/*.ts 不再覆盖 src/shared/ 目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'orch-scope-'));
    try {
      mkdirSync(join(root, 'src', 'shared'), { recursive: true });
      writeFileSync(join(root, 'src', 'main.ts'), 'export const x = 1;\n');
      // 前缀语义（无 rootDir）会把 src/*.ts 降级成 src/，进而与 src/shared/ 误判冲突。
      const prefixOnly = findScopeConflicts(task('T1', ['src/*.ts']), [{ ...task('T2', ['src/shared/']), status: 'submitted' }]);
      expect(prefixOnly.map((item) => item.taskId)).toEqual(['T2']);
      // 采集层给出 rootDir 后按真实文件展开：只命中 src/main.ts，与目录 src/shared/ 不冲突。
      const expanded = findScopeConflicts(task('T1', ['src/*.ts']), [{ ...task('T2', ['src/shared/']), status: 'submitted' }], {
        rootDir: root,
      });
      expect(expanded).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('路径归一化：相对路径 / 目录前缀 / 反斜杠与 ./ 前缀；拒绝绝对路径与 .. 段', () => {
    const norm = normalizeScope(task('T1', ['./src/app.ts', 'src\\shared\\', '/abs/x.ts', 'src/../secret.ts']));
    expect(norm.errors).toHaveLength(2);
    expect(norm.entries[0]).toMatchObject({ path: 'src/app.ts', isDir: false });
    expect(norm.entries[1]).toMatchObject({ path: 'src/shared', isDir: true });
  });

  it('通配段降级为目录前缀，不展开 glob', () => {
    const norm = normalizeScope(task('T1', ['src/**/*.ts']));
    expect(norm.entries).toHaveLength(1);
    expect(norm.entries[0].path).toBe('src');
    expect(norm.entries[0].isDir).toBe(true);
  });

  it('同文件精确命中 → 报告冲突；不同文件域 → 无冲突', () => {
    const other = task('AF-011B', ['src/a.ts'], { status: 'submitted' });
    expect(findScopeConflicts(task('AF-011A', ['src/a.ts']), [other])).toHaveLength(1);
    const disjoint = task('AF-011B', ['src/b.ts'], { status: 'submitted' });
    expect(findScopeConflicts(task('AF-011A', ['src/a.ts']), [disjoint])).toHaveLength(0);
  });

  it('目录前缀覆盖：目录与目录下文件、父子目录互相包含均判冲突', () => {
    const dirOther = task('AF-011B', ['src/'], { status: 'working' });
    const hit = findScopeConflicts(task('AF-011A', ['src/app/a.ts']), [dirOther]);
    expect(hit).toHaveLength(1);
    expect(hit[0].conflicts.join(' ')).toMatch('src/');

    const parent = task('AF-011B', ['src/'], { status: 'working' });
    const child = task('AF-011A', ['src/orchestration/'], { status: 'submitted' });
    expect(findScopeConflicts(child, [parent])).toHaveLength(1);
  });

  it('只读调研任务豁免写域互斥：自身只读不产生冲突，对方只读不构成冲突', () => {
    const researcher = task('AF-011R', ['src/a.ts'], { type: 'investigation', status: 'submitted' });
    expect(findScopeConflicts(task('AF-011A', ['src/a.ts']), [researcher])).toHaveLength(0);
    expect(findScopeConflicts(researcher, [task('AF-011B', ['src/a.ts'])])).toHaveLength(0);
    const readonlyFlag = task('AF-011Q', ['src/a.ts'], { scope: { files: ['src/a.ts'], readOnly: true }, status: 'submitted' });
    expect(normalizeScope(readonlyFlag).readOnly).toBe(true);
  });

  it('非在办状态（ready / completed）不参与文件域冲突', () => {
    const ready = task('AF-011B', ['src/a.ts'], { status: 'ready' });
    const done = task('AF-011C', ['src/a.ts'], { status: 'completed' });
    expect(findScopeConflicts(task('AF-011A', ['src/a.ts']), [ready, done])).toHaveLength(0);
  });

  it('残留识别：scope 内文件计 covered，scope 外文件计 residual', () => {
    const t = task('AF-011A', ['scripts/orchestration/']);
    const { covered, residual } = detectResidualFiles(['scripts/orchestration/scheduler.mjs', 'src/engine-core/secret.ts'], t);
    expect(covered).toEqual(['scripts/orchestration/scheduler.mjs']);
    expect(residual).toEqual(['src/engine-core/secret.ts']);
    expect(scopeCovers(t, 'scripts/orchestration/cli.mjs')).toBe(true);
    expect(scopeCovers(t, 'README.md')).toBe(false);
  });

  it('验收 V7：编排状态面生成物不计残留，只比对交付文件', () => {
    const t = task('AF-011A', ['scripts/orchestration/']);
    t.artifacts = { deliveryRecord: 'docs/worklog/completed/af011.md' };
    const withStatePlane = runAcceptance(
      t,
      { tasks: [t], archivedTasks: [] },
      {
        changedFiles: [
          'scripts/orchestration/scheduler.mjs',
          'docs/team/agent-orchestration/task-state-index.json',
          'docs/team/agent-orchestration/state/journal.jsonl',
          'docs/team/agent-orchestration/orchestration-snapshot.json',
          'web/orchestration/data.js',
          'docs/team/agent-orchestration/transport/tasks/AF-011A.json',
        ],
      },
    );
    expect(withStatePlane.checks.find((c) => c.code === 'V7').status).toBe('pass');
    expect(withStatePlane.checks.find((c) => c.code === 'V7').detail).toMatch('均在 scope 文件域内');

    const onlyStatePlane = runAcceptance(
      t,
      { tasks: [t], archivedTasks: [] },
      {
        changedFiles: ['docs/team/agent-orchestration/task-state-index.json', 'web/orchestration/data.js'],
      },
    );
    expect(onlyStatePlane.checks.find((c) => c.code === 'V7').status).toBe('pass');
    expect(onlyStatePlane.checks.find((c) => c.code === 'V7').detail).toMatch('仅含编排状态面生成物');
  });

  it('验收 V7：变更清单含 scope 外文件 → fail；全在域内 → pass；未传清单 → skip', () => {
    const t = task('AF-011A', ['docs/']);
    t.artifacts = { deliveryRecord: 'docs/worklog/completed/af011.md' };
    const rejected = runAcceptance(t, { tasks: [t], archivedTasks: [] }, { changedFiles: ['docs/a.md', 'src/b.ts'] });
    expect(rejected.checks.find((c) => c.code === 'V7').status).toBe('fail');
    expect(rejected.verdict).toBe('rejected');

    const passed = runAcceptance(t, { tasks: [t], archivedTasks: [] }, { changedFiles: ['docs/a.md'] });
    expect(passed.checks.find((c) => c.code === 'V7').status).toBe('pass');

    const skipped = runAcceptance(t, { tasks: [t], archivedTasks: [] });
    expect(skipped.checks.find((c) => c.code === 'V7').status).toBe('skip');
  });

  it('验收 V7：本任务任务单的状态行改动不计残留，同目录其它任务单仍算交付面', () => {
    const t = task('AF-024A', ['scripts/orchestration/', 'docs/team/agent-orchestration/']);
    t.artifacts = {
      taskSheet: 'docs/worklog/pending/af024a-task-2026-11-17.md',
      deliveryRecord: 'docs/worklog/completed/phase2.5/af024a-record.md',
    };
    const sheetOnly = runAcceptance(
      t,
      { tasks: [t], archivedTasks: [] },
      { changedFiles: ['docs/worklog/pending/af024a-task-2026-11-17.md', 'scripts/orchestration/cli.mjs'] },
    );
    const v7 = sheetOnly.checks.find((c) => c.code === 'V7');
    expect(v7.status).toBe('pass');
    expect(v7.detail).not.toMatch('af024a-task-2026-11-17.md');

    const otherSheet = runAcceptance(
      t,
      { tasks: [t], archivedTasks: [] },
      { changedFiles: ['docs/worklog/pending/af024b-task-2026-11-17.md'] },
    );
    expect(otherSheet.checks.find((c) => c.code === 'V7').status).toBe('fail');
  });

  it('AF-050：回执声明集优先于整棵工作树；未声明脏文件按并行产物留痕', () => {
    const t = task('AF-050A', ['scripts/orchestration/', 'docs/worklog/']);
    t.artifacts = {
      taskSheet: 'docs/worklog/pending/af050a-task-2026-11-17.md',
      deliveryRecord: 'docs/worklog/completed/phase2.5/af050a-record.md',
    };
    t.receipt = {
      changedFiles: {
        added: ['docs/worklog/completed/phase2.5/af050a-record.md'],
        modified: ['scripts/orchestration/acceptance-runner.mjs'],
        deleted: [],
        commits: [],
      },
      parallelArtifactsExcluded: true,
    };
    const dirty = [
      'docs/worklog/completed/phase2.5/af050a-record.md',
      'scripts/orchestration/acceptance-runner.mjs',
      'docs/worklog/pending/af050a-task-2026-11-17.md',
      'data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json',
      'admin-dashboard/pnpm-lock.yaml',
    ];
    const ok = runAcceptance(t, { tasks: [t], archivedTasks: [] }, { changedFiles: dirty });
    const v7 = ok.checks.find((c) => c.code === 'V7');
    expect(v7.status).toBe('pass');
    expect(v7.detail).toMatch('回执声明 2 个交付文件均在 scope 文件域内');
    expect(v7.detail).toMatch('工作树另有 2 个未声明脏文件按并行产物排除');

    const unmarked = { ...t, receipt: { ...t.receipt, parallelArtifactsExcluded: false } };
    const rejected = runAcceptance(unmarked, { tasks: [unmarked], archivedTasks: [] }, { changedFiles: dirty });
    expect(rejected.checks.find((c) => c.code === 'V7').status).toBe('fail');
    expect(rejected.checks.find((c) => c.code === 'V7').detail).toMatch('未声明脏文件');

    const outOfScope = {
      ...t,
      receipt: { ...t.receipt, changedFiles: { added: ['src/engine-core/bad.ts'], modified: [], deleted: [], commits: [] } },
    };
    const bad = runAcceptance(outOfScope, { tasks: [outOfScope], archivedTasks: [] }, { changedFiles: ['src/engine-core/bad.ts'] });
    expect(bad.checks.find((c) => c.code === 'V7').status).toBe('fail');
    expect(bad.checks.find((c) => c.code === 'V7').detail).toMatch('回执声明集含 scope 外文件');
  });

  it('AF-043-I1：回执声明 commit 集合后按 commit 事实比对，工作树残留不误判', () => {
    const t = task('AF-050A', ['scripts/orchestration/']);
    t.artifacts = { deliveryRecord: 'docs/worklog/completed/phase2.5/af050a.md' };
    t.receipt = {
      changedFiles: { added: [], modified: [], deleted: [], commits: ['c8632c6'] },
    };
    const commits = { c8632c6: ['scripts/orchestration/scheduler.mjs'] };
    const resolveCommitFiles = (sha) => commits[sha] ?? null;
    // 工作树里还有别的任务的在办改动：按 commit 事实比对时不计本单残留。
    const ok = runAcceptance(
      t,
      { tasks: [t], archivedTasks: [] },
      { changedFiles: ['test/admin-debug/wp38-debug-session-resume.spec.ts'], resolveCommitFiles },
    );
    const v7 = ok.checks.find((c) => c.code === 'V7');
    expect(v7.status).toBe('pass');
    expect(v7.detail).toMatch('按声明 commit 集合比对');
    expect(v7.detail).toMatch('不参与比对');

    // 提交里确有 scope 外文件 → fail。
    const bad = runAcceptance(
      t,
      { tasks: [t], archivedTasks: [] },
      { changedFiles: [], resolveCommitFiles: () => ['src/engine-core/bad.ts'] },
    );
    expect(bad.checks.find((c) => c.code === 'V7').status).toBe('fail');

    // 声明了 commit 却解析不到 → fail（声明即证据，给不出就是没证据）。
    const unresolved = runAcceptance(t, { tasks: [t], archivedTasks: [] }, { changedFiles: [], resolveCommitFiles: () => null });
    expect(unresolved.checks.find((c) => c.code === 'V7').status).toBe('fail');
    expect(unresolved.checks.find((c) => c.code === 'V7').detail).toMatch('无法解析');

    // 没有注入解析器 → skip，不冒充通过。
    const noResolver = runAcceptance(t, { tasks: [t], archivedTasks: [] }, { changedFiles: [] });
    expect(noResolver.checks.find((c) => c.code === 'V7').status).toBe('skip');
  });
});

describe('AF-012 任务分支流程与治理', () => {
  it('分支名构造：合规 taskId + slug 规范化；非法 taskId / 空 slug 报错', () => {
    const ok = buildBranchName('AF-012', 'Task Branch_Workflow');
    expect(ok).toMatchObject({ valid: true, branchName: 'task/AF-012-task-branch-workflow' });
    const badId = buildBranchName('af 12', 'x');
    expect(badId.valid).toBe(false);
    expect(badId.errors.join(' ')).toMatch('taskId');
    const emptySlug = buildBranchName('AF-012', '___');
    expect(emptySlug.valid).toBe(false);
    expect(emptySlug.branchName).toBeNull();
  });

  it('分支名校验：前缀、taskId 包含、空任务段判定', () => {
    expect(validateBranchName('task/AF-012-x', 'AF-012').valid).toBe(true);
    expect(validateBranchName('feature/x', 'AF-012').valid).toBe(false);
    expect(validateBranchName('task/OTHER-x', 'AF-012').valid).toBe(false);
    expect(validateBranchName('task/', 'AF-012').valid).toBe(false);
  });

  it('巡检分类：已合并 / 未合并 / 超期三分；长期分支不进入清理集合', () => {
    const branches = [
      { name: 'master', remote: null, merged: true, ageDays: 300 },
      { name: 'integrate', remote: null, merged: true, ageDays: 300 },
      { name: 'task/AF-012-a', remote: 'origin', merged: true, ageDays: 5 },
      { name: 'task/AF-013-b', remote: null, merged: false, ageDays: 3 },
      { name: 'task/AF-014-c', remote: null, merged: false, ageDays: 20 },
    ];
    const { merged, unmerged, stale } = classifyBranches(branches, { staleDays: 14 });
    expect(merged.map((b) => b.name)).toEqual(['task/AF-012-a']);
    expect(unmerged.map((b) => b.name)).toEqual(['task/AF-013-b']);
    expect(stale.map((b) => b.name)).toEqual(['task/AF-014-c']);
    expect(LONG_LIVED_BRANCHES).toEqual(['master', 'integrate']);
  });

  it('清理计划：只对已合并生成本地 + 远端删除项；未合并与超期只列名保留', () => {
    const branches = [
      { name: 'task/AF-012-a', remote: 'origin', merged: true, ageDays: 5 },
      { name: 'task/AF-013-b', remote: null, merged: false, ageDays: 3 },
      { name: 'task/AF-014-c', remote: null, merged: false, ageDays: 20 },
    ];
    const plan = planCleanup(branches, { staleDays: 14 });
    expect(plan.toDelete).toEqual([
      { name: 'task/AF-012-a', ref: 'local' },
      { name: 'task/AF-012-a', ref: 'remote:origin' },
    ]);
    expect(plan.keptUnmerged).toEqual(['task/AF-013-b']);
    expect(plan.stale).toEqual(['task/AF-014-c']);
  });

  it('基线核对：一致通过；漂移返回原因；缺 baselineRef 记 null 而非报错', () => {
    const task = { taskId: 'AF-012', baselineRef: 'abc1234' };
    expect(verifyBaseline(task, 'abc1234')).toMatchObject({ matches: true, reason: null });
    const drift = verifyBaseline(task, 'def5678');
    expect(drift.matches).toBe(false);
    expect(drift.reason).toMatch('基线漂移');
    expect(verifyBaseline({ taskId: 'X' }, 'abc1234').matches).toBeNull();
  });

  it('分支年龄天数：按日期差折算；非法日期返回 null', () => {
    expect(branchAgeDays('2026-11-10T00:00:00.000Z', '2026-11-16T00:00:00.000Z')).toBe(6);
    expect(branchAgeDays('not-a-date', '2026-11-16T00:00:00.000Z')).toBeNull();
  });
});

describe('AF-013 GUI 派发通道规则', () => {
  it('会话降级链与定位层按固定顺序返回下一条；链尾返回 null', () => {
    expect(SESSION_PATHS).toEqual(['existing-session', 'mini-chat', 'new-task']);
    expect(LOCATE_LAYERS).toEqual(['health', 'element-tree', 'shortcut', 'paste-verify']);
    expect(nextSessionPath([])).toBe('existing-session');
    expect(nextSessionPath(['existing-session'])).toBe('mini-chat');
    expect(nextSessionPath(SESSION_PATHS)).toBeNull();
    expect(nextLocateLayer(['health'])).toBe('element-tree');
    expect(nextLocateLayer(LOCATE_LAYERS)).toBeNull();
  });

  it('单任务队列：无在办允许；其他在办阻断；自身在办不阻断', () => {
    expect(canDispatch({ tasks: [{ taskId: 'AF-013', status: 'backlog' }] }, 'AF-013')).toMatchObject({ allowed: true, blockers: [] });
    const busy = canDispatch(
      {
        tasks: [
          { taskId: 'AF-013', status: 'backlog' },
          { taskId: 'AF-010B', status: 'working' },
        ],
      },
      'AF-013',
    );
    expect(busy.allowed).toBe(false);
    expect(busy.blockers).toEqual(['AF-010B']);
    const self = canDispatch({ tasks: [{ taskId: 'AF-013', status: 'working' }] }, 'AF-013');
    expect(self.allowed).toBe(true);
  });

  it('决策：登录门优先转人工接管；进程 / 窗口未起按重试上限拉起，超限升级', () => {
    expect(resolveDispatchDecision({ loginGate: true, processRunning: false, windowReady: false, startRetries: 0 }).action).toBe(
      'human-login',
    );
    expect(resolveDispatchDecision({ processRunning: false, windowReady: false, startRetries: 0 }).action).toBe('start-process');
    expect(resolveDispatchDecision({ processRunning: false, windowReady: false, startRetries: MAX_START_RETRIES }).action).toBe(
      'human-escalate',
    );
    expect(resolveDispatchDecision({ processRunning: true, windowReady: false, startRetries: 0 }).action).toBe('relaunch-window');
    expect(resolveDispatchDecision({ processRunning: true, windowReady: false, startRetries: MAX_START_RETRIES }).action).toBe(
      'human-escalate',
    );
  });

  it('决策：就绪后逐层定位；定位走完沿会话链发送；发送超限升级人工', () => {
    const locating = resolveDispatchDecision({ processRunning: true, windowReady: true, locateAttempted: [] });
    expect(locating).toMatchObject({ action: 'locate', layer: 'health' });
    const sending = resolveDispatchDecision({
      processRunning: true,
      windowReady: true,
      locateAttempted: LOCATE_LAYERS,
      sessionAttempted: [],
      sendRetries: 0,
    });
    expect(sending).toMatchObject({ action: 'send', sessionPath: 'existing-session' });
    const exhausted = resolveDispatchDecision({
      processRunning: true,
      windowReady: true,
      locateAttempted: LOCATE_LAYERS,
      sessionAttempted: SESSION_PATHS,
      sendRetries: MAX_SEND_RETRIES,
    });
    expect(exhausted.action).toBe('human-escalate');
  });

  it('派发审计：合法构造且不含消息正文；缺字段 / 非法枚举被拒', () => {
    const ok = buildDispatchAudit({
      taskId: 'AF-013',
      attempt: 0,
      result: 'dispatched',
      sessionPath: 'mini-chat',
      locateLayer: 'shortcut',
    });
    expect(ok.valid).toBe(true);
    expect(ok.audit).not.toHaveProperty('messageText');
    expect(ok.audit).toMatchObject({ taskId: 'AF-013', attempt: 0, result: 'dispatched' });

    expect(buildDispatchAudit({ taskId: '', attempt: 0, result: 'dispatched' }).valid).toBe(false);
    expect(buildDispatchAudit({ taskId: 'X', attempt: -1, result: 'dispatched' }).valid).toBe(false);
    expect(buildDispatchAudit({ taskId: 'X', attempt: 0, result: 'bogus' }).valid).toBe(false);
    expect(buildDispatchAudit({ taskId: 'X', attempt: 0, result: 'dispatched', sessionPath: 'nope' }).valid).toBe(false);
  });

  it('路径成功率聚合：按会话路径统计成功 / 失败；无样本记 null', () => {
    const summary = summarizeChannelOutcomes([
      { sessionPath: 'existing-session', result: 'dispatched' },
      { sessionPath: 'existing-session', result: 'failed' },
      { sessionPath: 'mini-chat', result: 'dispatched' },
    ]);
    const first = summary.find((s) => s.sessionPath === 'existing-session');
    expect(first).toMatchObject({ attempted: 2, dispatched: 1, failed: 1, successRate: 0.5 });
    expect(summary.find((s) => s.sessionPath === 'new-task').successRate).toBeNull();
  });

  it('升级消息：标准字段齐全通过；缺证据 / 少于两条选项 / 缺决定点被拒', () => {
    const base = {
      taskId: 'AF-013',
      currentStatus: 'ready',
      attemptedPaths: [{ path: 'existing-session', conclusion: '失败' }],
      failureEvidence: [{ command: 'launch', exitCode: 1, note: '窗口未就绪' }],
      options: [
        { action: '人工接管登录', cost: '一次人工操作', risk: '无', benefit: '恢复通道' },
        { action: '保持 ready 并稍后重试', cost: '延后一轮派发', risk: '任务继续等待', benefit: '不阻塞其他只读任务' },
      ],
      recommendedDecision: '是否由人工接管完成登录',
    };
    expect(buildEscalationMessage(base).valid).toBe(true);
    expect(buildEscalationMessage({ ...base, failureEvidence: [] }).valid).toBe(false);
    expect(buildEscalationMessage({ ...base, options: [] }).valid).toBe(false);
    expect(buildEscalationMessage({ ...base, recommendedDecision: '' }).valid).toBe(false);
  });

  it('不可恢复类别：四类判定为不可恢复；决策直接终态 failed，不进入重试', () => {
    for (const cause of IRRECOVERABLE_CAUSES) expect(isIrrecoverable(cause)).toBe(true);
    expect(isIrrecoverable('transient-flake')).toBe(false);
    const terminal = resolveDispatchDecision({ processRunning: false, cause: 'deterministic-defect', attemptCount: 0 });
    expect(terminal).toMatchObject({ action: 'fail-terminal', result: 'failed', cause: 'deterministic-defect' });
    // 登录门优先于不可恢复短路（认证问题不在不可恢复四类内时仍走人工）
    const login = resolveDispatchDecision({ loginGate: true, cause: 'permission-denied' });
    expect(login.action).toBe('human-login');
  });

  it('任务级重试预算：耗尽保持 held-ready 升级人工；降级路径切换计入尝试', () => {
    const exhausted = resolveDispatchDecision({
      processRunning: true,
      windowReady: true,
      locateAttempted: LOCATE_LAYERS,
      sessionAttempted: SESSION_PATHS,
      sendRetries: MAX_SEND_RETRIES,
      attemptCount: MAX_TOTAL_ATTEMPTS,
    });
    expect(exhausted).toMatchObject({ action: 'human-escalate', result: 'held-ready' });
    const withinBudget = resolveDispatchDecision({
      processRunning: true,
      windowReady: true,
      locateAttempted: [],
      attemptCount: 1,
    });
    expect(withinBudget.action).toBe('locate');
  });

  it('指数退避序列：首试无退避，序列用尽复用末位', () => {
    expect(nextBackoff(0)).toBe(BACKOFF_MS[0]);
    expect(nextBackoff(1)).toBe(BACKOFF_MS[1]);
    expect(nextBackoff(2)).toBe(BACKOFF_MS[2]);
    expect(nextBackoff(5)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1]);
    expect(nextBackoff(-1)).toBe(BACKOFF_MS[0]);
  });

  it('审计：定性三分法与基线分栏落库；非法定性 / 基线形态 / 逐次条目被拒', () => {
    const ok = buildDispatchAudit({
      taskId: 'AF-015',
      attempt: 2,
      result: 'held-ready',
      classification: 'flaky',
      baseline: { legacyDebt: 'AF-013 演练基线', changeIntroduced: null },
      attempts: [
        { sessionPath: 'existing-session', locateLayer: 'shortcut', reason: '定位未聚焦', backoffMs: 0, result: 'held-ready' },
        { sessionPath: 'mini-chat', locateLayer: 'paste-verify', reason: '降级路径', backoffMs: 500, result: 'dispatched' },
      ],
    });
    expect(ok.valid).toBe(true);
    expect(ok.audit.classification).toBe('flaky');
    expect(ok.audit.baseline).toMatchObject({ legacyDebt: 'AF-013 演练基线', changeIntroduced: null });
    expect(ok.audit.attempts).toHaveLength(2);
    expect(ok.audit.attempts[0]).toMatchObject({ sessionPath: 'existing-session', locateLayer: 'shortcut', backoffMs: 0 });
    expect(ok.audit).not.toHaveProperty('messageText');

    expect(buildDispatchAudit({ taskId: 'X', attempt: 0, result: 'dispatched', classification: 'bogus' }).valid).toBe(false);
    expect(buildDispatchAudit({ taskId: 'X', attempt: 0, result: 'dispatched', baseline: ['legacy'] }).valid).toBe(false);
    expect(buildDispatchAudit({ taskId: 'X', attempt: 0, result: 'dispatched', attempts: [{ result: 'bogus' }] }).valid).toBe(false);
  });

  it('路径聚合：held-ready 计入未成功；预留位常量标注本版本不实现', () => {
    const summary = summarizeChannelOutcomes([
      { sessionPath: 'existing-session', result: 'dispatched' },
      { sessionPath: 'existing-session', result: 'held-ready' },
    ]);
    const first = summary.find((s) => s.sessionPath === 'existing-session');
    expect(first).toMatchObject({ attempted: 2, dispatched: 1, failed: 1, successRate: 0.5 });
    // IM-017 落地后熔断不再只是预留位；断言改为「语义 + 参数化默认值」。
    expect(CIRCUIT_BREAKER_RESERVED.reserved).toBe(false);
    expect(CIRCUIT_BREAKER_RESERVED.semantics).toMatch(/阈值/);
    expect(DEAD_LETTER_RESERVED.reserved).toBe(true);
    expect(FAILURE_CLASSIFICATIONS).toEqual(['deterministic', 'flaky', 'legacy-debt']);
  });
});

const routerCards = [
  {
    agentId: 'AGENT-EXEC-001',
    role: 'executor',
    skills: ['implementation', 'self-test'],
    tools: ['workspace-write'],
    resources: ['src/', 'docs/worklog/pending/'],
    availability: 'available',
  },
  {
    agentId: 'AGENT-ORCH-001',
    role: 'orchestrator',
    skills: ['queue-management'],
    tools: ['TOOL-ORCH-CLI'],
    resources: ['docs/team/agent-orchestration/'],
    availability: 'available',
  },
  { agentId: 'AGENT-REVIEW-002', role: 'reviewer', skills: ['review'], tools: [], resources: ['docs/'], availability: 'busy' },
];

describe('AF-016 IM-008 Agent Card 能力声明路由', () => {
  it('按 requiredSkills 命中评分选择最契合角色', () => {
    const m = matchAgentCard({ requiredSkills: ['implementation'] }, routerCards);
    expect(m.eligible).toBe(true);
    expect(m.role).toBe('executor');
    expect(m.matchedSkills).toContain('implementation');
  });

  it('busy 角色不进入候选', () => {
    const m = matchAgentCard({ role: 'reviewer' }, routerCards);
    expect(m.eligible).toBe(false);
    expect(m.reason).toMatch('reviewer');
  });

  it('显式角色不可用时保留显式角色，不擅自改派', () => {
    const r = selectTargetRole({ agentRole: 'reviewer' }, routerCards, {});
    expect(r.targetRole).toBe('reviewer');
    expect(r.routedBy).toBe('explicit-role-fallback');
    expect(r.match.eligible).toBe(false);
  });

  it('无显式角色时按能力匹配到 executor', () => {
    const r = selectTargetRole({ requiredSkills: ['implementation'] }, routerCards, {});
    expect(r.targetRole).toBe('executor');
    expect(r.routedBy).toBe('capability-match');
  });

  it('空候选卡返回不可用原因', () => {
    const m = matchAgentCard({}, []);
    expect(m.eligible).toBe(false);
    expect(m.reason).toBeTruthy();
  });
});

describe('AF-016 IM-010 角色资源域越域校验', () => {
  const baseTask = { taskId: 'AF-016', agentRole: 'executor', type: 'implementation', scope: { files: [] } };

  it('scope 落在角色 resources 内 → valid', () => {
    const task = { ...baseTask, scope: { files: ['src/engine/a.ts'] } };
    const r = validateScopeDomain(task, routerCards);
    expect(r.valid).toBe(true);
    expect(r.inside).toContain('src/engine/a.ts');
    expect(r.outside).toHaveLength(0);
  });

  it('scope 越出角色资源域 → 标注 outside', () => {
    const task = { ...baseTask, scope: { files: ['engine-core/x.ts'] } };
    const r = validateScopeDomain(task, routerCards);
    expect(r.valid).toBe(false);
    expect(r.outside[0].file).toBe('engine-core/x.ts');
  });

  it('只读 / 评审类任务豁免资源域校验', () => {
    const task = { ...baseTask, type: 'review', scope: { files: ['engine-core/x.ts'] } };
    const r = validateScopeDomain(task, routerCards);
    expect(r.valid).toBe(true);
    expect(r.outside).toHaveLength(0);
  });

  it('目标角色无卡 → errors 标注', () => {
    const task = { ...baseTask, agentRole: 'researcher' };
    const r = validateScopeDomain(task, routerCards);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch('researcher');
  });

  it('卡未声明 resources → errors 标注', () => {
    const noRes = [{ role: 'executor', availability: 'available', skills: [], tools: [], resources: [] }];
    const r = validateScopeDomain(baseTask, noRes);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch('resources');
  });

  it('真实 executor 卡资源域覆盖交付记录目录（切片收窄靠 scope，不靠目录白名单）', () => {
    const task = {
      ...baseTask,
      scope: { files: ['docs/worklog/completed/phase2.5/x.md', 'docs/worklog/pending/y.md'] },
    };
    const r = validateScopeDomain(task, loadAgentCards());
    expect(r.valid).toBe(true);
    expect(r.outside).toHaveLength(0);
  });
});

describe('AF-016 IM-013 分支 rebase 状态巡检', () => {
  const branches = [
    { name: 'task/AF-016-a', merged: false, ageDays: 3, aheadBy: 1, behindBy: 2 },
    { name: 'task/AF-016-b', merged: false, ageDays: 3, aheadBy: 0, behindBy: 0 },
    { name: 'task/AF-016-c', merged: false, ageDays: 30, aheadBy: 0, behindBy: 0 },
    { name: 'task/AF-016-d', merged: true, ageDays: 1 },
  ];

  it('落后基线的未合并分支归入 needsRebase', () => {
    const c = classifyBranches(branches, { staleDays: 14 });
    expect(c.needsRebase.map((b) => b.name)).toEqual(['task/AF-016-a']);
    expect(c.unmerged.map((b) => b.name)).toEqual(['task/AF-016-b']);
    expect(c.stale.map((b) => b.name)).toEqual(['task/AF-016-c']);
    expect(c.merged.map((b) => b.name)).toEqual(['task/AF-016-d']);
  });

  it('planCleanup 透出 needsRebase 名清单', () => {
    const p = planCleanup(branches, { staleDays: 14 });
    expect(p.needsRebase).toEqual(['task/AF-016-a']);
    expect(p.keptUnmerged).toEqual(['task/AF-016-b']);
  });

  it('旧分支对象缺 behindBy 不进入 needsRebase', () => {
    const c = classifyBranches([{ name: 'task/AF-016-e', merged: false, ageDays: 2 }], { staleDays: 14 });
    expect(c.needsRebase).toHaveLength(0);
    expect(c.unmerged).toHaveLength(1);
  });
});

describe('AF-016 IM-009 变更文件清单采集器', () => {
  it('端口清单过滤空串与非字符串', () => {
    const port = { changedFiles: () => ['src/a.ts', '', 'docs/b.md', 42, null] };
    expect(collectChangedFiles(port)).toEqual(['src/a.ts', 'docs/b.md']);
  });

  it('端口缺方法返回空清单', () => {
    expect(collectChangedFiles({})).toEqual([]);
    expect(collectChangedFiles(null)).toEqual([]);
  });

  it('端口返回非数组返回空清单', () => {
    expect(collectChangedFiles({ changedFiles: () => 'src/a.ts' })).toEqual([]);
  });
});

describe('AF-016 dispatchTask 能力路由接线', () => {
  function baseTask() {
    return {
      taskId: 'AF-016',
      contextId: 'phase2.5-orchestration-closed-loop',
      type: 'implementation',
      title: '能力路由与资源域护栏',
      status: 'ready',
      createdAt: '2026-11-16T08:00:00+08:00',
      scope: { files: ['src/a.ts'] },
      dependsOn: [],
      policyRefs: [],
      agentRole: 'executor',
    };
  }
  function fakeTransport() {
    const calls = [];
    return {
      calls,
      submitTask(h) {
        calls.push(h);
        return `transport/${h.taskId}.json`;
      },
    };
  }

  it('传入 cards 时目标角色来自能力匹配并返回 route 明细', () => {
    const transport = fakeTransport();
    const r = dispatchTask(baseTask(), {}, { transport, cards: routerCards });
    expect(r.dispatched).toBe(true);
    expect(r.record.targetRole).toBe('executor');
    expect(r.route.match.eligible).toBe(true);
  });

  it('不传 cards 时保持原显式 / agentRole 口径，route 为 null', () => {
    const transport = fakeTransport();
    const r = dispatchTask(baseTask(), {}, { transport });
    expect(r.dispatched).toBe(true);
    expect(r.record.targetRole).toBe('executor');
    expect(r.route).toBeNull();
  });
});

describe('契约枚举 vendored 投影对账（IM-005）', () => {
  const enumsFile = join(__testDir, '..', 'contract-enums.json');
  const enums = readJsonFile(enumsFile);

  it('导出枚举与 vendored 投影取值与顺序一致', () => {
    expect(TASK_TYPES).toEqual(enums.taskTypes);
    expect(TASK_STATUSES).toEqual(enums.taskStatuses);
    expect(TERMINAL_STATUSES).toEqual(enums.terminalStatuses);
    expect(REVIEW_VERDICTS).toEqual(enums.reviewVerdicts);
    expect(ROLES).toEqual(enums.roles);
    expect(NON_ROUTABLE_ROLES).toEqual(enums.nonRoutableRoles);
    expect(TOOL_CATEGORIES).toEqual(enums.toolCategories);
    expect(ARTIFACT_KINDS).toEqual(enums.artifactKinds);
  });

  it('taskId 模式与投影一致，且正反例匹配正确', () => {
    expect(new RegExp(enums.taskIdPattern).source).toBe(enums.taskIdPattern);
    const good = ['TASK-001', 'AF-009', 'REVIEW-001'];
    const bad = ['task-001', 'TASK-001-X', 'TASK', 'TASK-abc', ''];
    for (const id of good) expect(new RegExp(enums.taskIdPattern).test(id)).toBe(true);
    for (const id of bad) expect(new RegExp(enums.taskIdPattern).test(id)).toBe(false);
  });

  it('共享模块导出的 taskId 模式与投影一致', () => {
    expect(SHARED_TASK_ID_PATTERN.source).toBe(enums.taskIdPattern);
    for (const id of ['TASK-001', 'AF-009', 'REVIEW-001']) {
      expect(SHARED_TASK_ID_PATTERN.test(id)).toBe(true);
    }
    for (const id of ['task-001', 'TASK-001-X', 'TASK', 'TASK-abc', '']) {
      expect(SHARED_TASK_ID_PATTERN.test(id)).toBe(false);
    }
  });

  it('vendored 投影与框架仓权威枚举一致（框架仓不可达则跳过跨仓对账）', () => {
    const fwDir = process.env.ORCH_FRAMEWORK_DIR
      ? process.env.ORCH_FRAMEWORK_DIR
      : join(REPO_ROOT, '..', '..', 'agent-collaboration-framework');
    const fwFile = join(fwDir, 'schemas', 'contract-enums.json');
    if (!existsSync(fwFile)) return;
    const fw = readJsonFile(fwFile);
    expect(fw.taskTypes).toEqual(enums.taskTypes);
    expect(fw.taskStatuses).toEqual(enums.taskStatuses);
    expect(fw.terminalStatuses).toEqual(enums.terminalStatuses);
    expect(fw.reviewVerdicts).toEqual(enums.reviewVerdicts);
    expect(fw.roles).toEqual(enums.roles);
    expect(fw.toolCategories).toEqual(enums.toolCategories);
    expect(fw.taskIdPattern).toBe(enums.taskIdPattern);
  });
});

describe('适配层实例 2.0.0 合规（仓内真实工件，只读）', () => {
  const packFile = join(PATHS.deliveryPackDir, 'pack-20261115-225603.json');

  it('仓内状态索引通过 task-state-index 1.1.0 校验，且归档说明已外移', async () => {
    const index = readJsonFile(PATHS.index);
    const res = await validateTaskIndex(index);
    assertNotFailed(res);
    expect(index.version).toBe('1.1.0');
    for (const entry of index.archivedTasks) expect(entry.note).toBeUndefined();
    expect(Object.keys(index.archivedNotes ?? {}).length).toBeGreaterThan(0);
  });

  it('仓内 Agent Card 均通过 agent-card 1.1.0 校验，且无 human 卡', async () => {
    const files = readdirSync(PATHS.agentCardsDir).filter((f) => f.endsWith('.json'));
    expect(files).not.toContain('human.json');
    for (const file of files) {
      const card = readJsonFile(join(PATHS.agentCardsDir, file));
      const res = await validateAgentCard(card);
      assertNotFailed(res);
      expect(ROLES).toContain(card.role);
      expect(card.contractRef).toContain(':agent-card:1.1.0');
    }
  });

  it('仓内交付包通过 delivery-package 1.0.0 校验', async () => {
    if (!existsSync(packFile)) return;
    const res = await validateDeliveryPackage(readJsonFile(packFile));
    assertNotFailed(res);
    const pack = readJsonFile(packFile);
    expect(pack.leftovers).toBeTruthy();
    expect(pack.legacy).toBeTruthy();
  });

  it('交付包生成器（write:false）产物通过 delivery-package 1.0.0 校验', async () => {
    const { pack } = generateDeliveryPack({ write: false });
    const res = await validateDeliveryPackage(pack);
    assertNotFailed(res);
    expect(pack.packageId).toMatch(/^PACK-\d{8}-\d{6}$/);
    expect(['human-on-the-loop', 'human-in-the-loop']).toContain(pack.cycle.mode);
    expect(['queue-empty', 'limit-reached', 'circuit-open', 'human-stop']).toContain(pack.cycle.stopReason);
    expect(pack.counts.deadLettered).toBe(pack.deadLetters.length);
  });

  it('契约版本对账：声明版本与框架 versions.json 一致 / 漂移被拦', () => {
    const index = readJsonFile(PATHS.index);
    const base = validateContractVersion(index, 'task-state-index');
    // 契约包已固化进仓，本地 / CI 都必须真实对账；skipped 属于硬失败。
    expect(base.skipped).toBeFalsy();
    expect(base.ok).toBe(true);
    const drifted = { ...index, schemaRef: 'urn:agent-collaboration-framework:schema:task-state-index:1.0.0' };
    const res = validateContractVersion(drifted, 'task-state-index');
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.message).join(' ')).toMatch('版本');
  });

  it('工具目录缺 category 枚举外取值时被 validateToolDir 拦截', async () => {
    const tmp = join(tmpdir(), `orch-tools-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    try {
      writeFileSync(
        join(tmp, 'TOOL-BAD.json'),
        JSON.stringify(
          {
            toolId: 'TOOL-BAD',
            category: 'legacy-persistence',
            sideEffect: 'restricted-write',
            allowedRoles: ['orchestrator'],
          },
          null,
          2,
        ),
        'utf8',
      );
      const res = await validateToolDir(tmp);
      if (!res.skipped) {
        expect(res.ok).toBe(false);
        expect(res.errors.map((e) => e.message).join(' ')).toMatch('category');
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/** 用固定内容封一条事件（仅测试用，不打真实日志）。 */
function sealEvent(seq, prevHash, overrides = {}) {
  const event = {
    taskId: 'AF-020',
    type: 'created',
    from: 'backlog',
    to: 'ready',
    by: 'test',
    at: '2026-11-16T00:00:00.000Z',
    idempotencyKey: `AF-020:test:${seq}`,
    reason: null,
    payload: {},
    eventSeq: seq,
    eventId: `EV-${String(seq).padStart(4, '0')}`,
    prevHash,
    ...overrides,
  };
  delete event.hash;
  event.hash = hashEvent(event, prevHash);
  return event;
}

describe('事件溯源：日志投影 / 哈希链 / 派生', () => {
  it('时间戳归一：带偏移的 createdAt 落事件前转 UTC，畸形值原样留给 schema 报错', () => {
    expect(toUtcIso('2026-11-17T10:44:00+08:00')).toBe('2026-11-17T02:44:00.000Z');
    expect(toUtcIso('2026-11-17T02:44:00.000Z')).toBe('2026-11-17T02:44:00.000Z');
    expect(toUtcIso('瞎写的时间')).toBe('瞎写的时间');
    const task = { taskId: 'AF-999', contextId: 'ctx', type: 'implementation', status: 'backlog', createdAt: '2026-11-17T10:44:00+08:00' };
    expect(buildCreatedEvent(task).at).toBe('2026-11-17T02:44:00.000Z');
  });

  it('createdAt 未来时间夹到写入时刻，避免 created 事件晚于其后迁移', () => {
    const now = '2026-11-17T02:54:20.000Z';
    expect(createdAtForEvent('2026-11-17T02:58:00.000Z', now)).toBe(now);
    expect(createdAtForEvent('2026-11-17T02:44:00.000Z', now)).toBe('2026-11-17T02:44:00.000Z');
    const future = {
      taskId: 'AF-998',
      contextId: 'ctx',
      type: 'implementation',
      status: 'backlog',
      createdAt: '2026-11-17T10:58:00+08:00',
    };
    expect(buildCreatedEvent(future, { at: now }).at).toBe(now);
  });

  it('链纠偏：切点前逐字保留，切点起重编号重算，链仍可通过完整性校验', () => {
    const e1 = sealEvent(1, 'GENESIS');
    const e2 = sealEvent(2, e1.hash, { type: 'promoted', from: 'ready', to: 'submitted' });
    const e3 = sealEvent(3, e2.hash, { type: 'verified', from: 'submitted', to: 'completed' });
    const broken = { ...e3, at: '2026-11-17T02:00:00.000Z' };
    const res = rechainEvents([e1, e2, broken], { fromEventId: e3.eventId });
    expect(res.events[0]).toEqual(e1);
    expect(res.events[1]).toEqual(e2);
    expect(journalIntegrity(res.events).ok).toBe(true);
    expect(() => rechainEvents([e1, e2], { fromEventId: 'EV-9999' })).toThrow('切点事件不存在');
  });

  it('当前归档可由日志完整重建，且与索引逐字段一致', () => {
    const current = loadIndex();
    const journal = loadJournal();
    expect(current.archivedTasks.length).toBeGreaterThan(0);
    expect(Object.keys(current.archivedNotes || {}).length).toBeGreaterThan(0);
    const rebuilt = projectJournal(journal, { archivedNotes: loadArchivedNotes() });
    expect(rebuilt).toEqual(current);
    expect(rebuilt.projection.rebuiltAt).toBeNull();
    expect(rebuilt.projection.lastEventSeq).toBe(journal[journal.length - 1].eventSeq);
  });

  it('哈希链连续时通过，改写任一字段即被检出', () => {
    const e1 = sealEvent(1, 'GENESIS');
    const e2 = sealEvent(2, e1.hash, { type: 'promoted', from: 'ready', to: 'submitted' });
    expect(journalIntegrity([e1, e2]).ok).toBe(true);
    const tampered = { ...e2, to: 'working' };
    const res = journalIntegrity([e1, tampered]);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/hash 不匹配/);
  });

  it('非法状态迁移与序号断裂被检出', () => {
    const e1 = sealEvent(1, 'GENESIS');
    const illegal = sealEvent(2, e1.hash, { type: 'promoted', from: 'working', to: 'completed' });
    const badTransition = journalIntegrity([e1, illegal]);
    expect(badTransition.ok).toBe(false);
    expect(badTransition.errors.join(' ')).toMatch(/非法状态迁移 working → completed/);

    const gap = sealEvent(3, e1.hash, { type: 'promoted', from: 'ready', to: 'submitted' });
    const badSeq = journalIntegrity([e1, gap]);
    expect(badSeq.ok).toBe(false);
    expect(badSeq.errors.join(' ')).toMatch(/eventSeq 不连续/);
  });

  it('重复 idempotencyKey 在投影中只生效一次', () => {
    const e1 = sealEvent(1, 'GENESIS');
    const duplicate = { ...e1, eventSeq: 2, eventId: 'EV-0002', prevHash: e1.hash };
    duplicate.hash = hashEvent(duplicate, duplicate.prevHash);
    const index = projectJournal([e1, duplicate]);
    expect(index.tasks).toHaveLength(1);
    expect(index.tasks[0].taskId).toBe('AF-020');
  });

  it('迁移类型映射覆盖 promoted / claimed / interrupted / resumed / verified', () => {
    expect(eventTypeForTransition('backlog', 'ready')).toBe('promoted');
    expect(eventTypeForTransition('ready', 'submitted')).toBe('claimed');
    expect(eventTypeForTransition('submitted', 'working')).toBe('started');
    expect(eventTypeForTransition('working', 'input-required')).toBe('interrupted');
    expect(eventTypeForTransition('input-required', 'working')).toBe('resumed');
    expect(eventTypeForTransition('working', 'completed')).toBe('verified');
  });

  it('派生事件：新建任务生成 created + history，归档生成 archived 终态', () => {
    const created = deriveEvents(
      { tasks: [], archivedTasks: [] },
      {
        tasks: [
          {
            taskId: 'AF-020',
            status: 'submitted',
            history: [{ at: '2026-11-16T00:00:01.000Z', from: 'ready', to: 'submitted', by: 'test' }],
          },
        ],
        archivedTasks: [],
      },
      { at: '2026-11-16T00:00:01.000Z', actor: 'test' },
    );
    expect(created.map((e) => e.type)).toEqual(['created', 'claimed']);
    expect(created[0].to).toBe('ready');

    const archived = deriveEvents(
      { tasks: [{ taskId: 'AF-020', status: 'rejected', history: [] }], archivedTasks: [] },
      { tasks: [], archivedTasks: [{ taskId: 'AF-020', status: 'rejected', artifacts: { taskSheet: 'x.md' } }] },
      { at: '2026-11-16T00:00:02.000Z', actor: 'test' },
    );
    expect(archived).toHaveLength(1);
    expect(archived[0].type).toBe('archived');
    expect(archived[0].from).toBe('rejected');
    expect(archived[0].to).toBe('rejected');

    const closing = deriveEvents(
      { tasks: [{ taskId: 'AF-021', status: 'working', history: [] }], archivedTasks: [] },
      { tasks: [], archivedTasks: [{ taskId: 'AF-021', status: 'completed', artifacts: {} }] },
      { at: '2026-11-16T00:00:03.000Z', actor: 'test' },
    );
    expect(closing.map((e) => e.type)).toEqual(['submitted', 'verified', 'archived']);
    expect(closing[0].from).toBe('working');
    expect(closing[0].to).toBe('submitted');
    expect(closing[1].from).toBe('submitted');
    expect(closing[1].to).toBe('completed');
    expect(closing[2].from).toBe('completed');
    expect(closing[2].to).toBe('completed');
  });
});

describe('AF-024 GUI 投递协议', () => {
  const task = {
    taskId: 'AF-901',
    contextId: 'phase2.5-orchestration-closed-loop',
    title: 'GUI 通道验收',
    type: 'implementation',
    baselineRef: '7dd3539',
    dependsOn: ['AF-013'],
    agentRole: 'orchestrator',
    scope: { files: ['scripts/orchestration/'], modules: [], interfaces: [] },
    artifacts: {
      taskSheet: 'docs/worklog/pending/af901-task.md',
      deliveryRecord: 'docs/worklog/completed/phase2.5/af901.md',
    },
  };

  it('投递件：含任务契约 / 范围 / 闸门 / 验收 / 投递确认 / 回执约定，不含编排内部状态', () => {
    const brief = buildGuiBrief(
      task,
      { gates: [{ command: 'pnpm exec vitest run x', check: '单测全绿', threshold: 'failed=0' }], successCriteria: ['闭环可复现'] },
      { receiptPath: 'docs/team/agent-orchestration/transport/receipts/AF-901.json' },
    );
    expect(brief.taskId).toBe('AF-901');
    expect(brief.sections).toEqual(['任务契约', '改动范围', '闸门', '验收标准', '投递确认', '回执约定']);
    expect(brief.text).toContain('pnpm exec vitest run x');
    expect(brief.text).toContain('docs/team/agent-orchestration/transport/receipts/AF-901.json');
    expect(brief.text).toContain('docs/team/agent-orchestration/transport/acks/AF-901.json');
    expect(brief.text).toContain('禁止执行 task / run-once / archive');
    expect(brief.text).toContain('scripts/orchestration/');
    expect(brief.text).not.toContain('orchestration-state.json');
    expect(() => buildGuiBrief({}, {})).toThrow(/缺 taskId/);
  });

  it('投递确认：缺会话路径 / 定位层 / 证据一律拒绝，齐备才 delivered', () => {
    const repoRoot = join(tmpdir(), `orch-gui-confirm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    const evidenceDir = join(repoRoot, 'docs', 'team', 'agent-orchestration', 'transport', 'briefs');
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, 'AF-901.sent.png'), 'png', 'utf8');
    const handoverDir = join(repoRoot, 'docs', 'team', 'agent-orchestration', 'transport', 'tasks');
    mkdirSync(handoverDir, { recursive: true });
    writeFileSync(join(handoverDir, 'AF-901.json'), '{"payload":{}}', 'utf8');
    try {
      const record = {
        taskId: 'AF-901',
        channel: 'gui-relay',
        handoverRef: 'docs/team/agent-orchestration/transport/tasks/AF-901.json',
        delivery: { state: 'pending' },
      };
      expect(confirmDelivery(record, { repoRoot }).valid).toBe(false);
      expect(confirmDelivery(record, { sessionPath: 'existing-session', repoRoot }).errors.join()).toMatch(/定位层/);
      expect(confirmDelivery(record, { sessionPath: 'existing-session', locateLayer: 'shortcut', repoRoot }).errors.join()).toMatch(
        /证据指针/,
      );
      // 枚举守卫：瞎写的会话路径 / 定位层不再放行
      expect(
        confirmDelivery(record, {
          sessionPath: '瞎写',
          locateLayer: '瞎写',
          evidenceRef: 'docs/team/agent-orchestration/transport/briefs/AF-901.sent.png',
          repoRoot,
        }).errors.join(),
      ).toMatch(/会话路径非法/);
      // 通道与状态守卫：file 通道 / 非 pending 状态都不得确认送达
      expect(
        confirmDelivery(
          { taskId: 'AF-901', channel: 'file', handoverRef: record.handoverRef },
          {
            sessionPath: 'mini-chat',
            locateLayer: 'paste-verify',
            evidenceRef: 'docs/team/agent-orchestration/transport/briefs/AF-901.sent.png',
            repoRoot,
          },
        ).errors.join(),
      ).toMatch(/不是 gui-relay/);
      expect(
        confirmDelivery(
          { ...record, delivery: { state: 'failed' } },
          {
            sessionPath: 'mini-chat',
            locateLayer: 'paste-verify',
            evidenceRef: 'docs/team/agent-orchestration/transport/briefs/AF-901.sent.png',
            repoRoot,
          },
        ).errors.join(),
      ).toMatch(/须为 pending/);
      const ok = confirmDelivery(record, {
        sessionPath: 'mini-chat',
        locateLayer: 'paste-verify',
        evidenceRef: 'docs/team/agent-orchestration/transport/briefs/AF-901.sent.png',
        at: '2026-11-17T10:20:00.000Z',
        repoRoot,
      });
      expect(ok.valid).toBe(true);
      expect(ok.record.delivery.state).toBe('delivered');
      expect(ok.record.delivery.sessionPath).toBe('mini-chat');
      expect(ok.record.delivery.deliveredAt).toBe('2026-11-17T10:20:00.000Z');
      expect(ok.record.channel).toBe('gui-relay');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('ack 自动确认：缺 ack 不伪造送达；ack 齐备才 delivered 并保留证据指针', () => {
    const repoRoot = join(tmpdir(), `orch-gui-ack-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    const transport = join(repoRoot, 'docs', 'team', 'agent-orchestration', 'transport');
    mkdirSync(join(transport, 'acks'), { recursive: true });
    mkdirSync(join(transport, 'tasks'), { recursive: true });
    writeFileSync(join(transport, 'tasks', 'AF-901.json'), '{"payload":{}}', 'utf8');
    const record = {
      taskId: 'AF-901',
      channel: 'gui-relay',
      handoverRef: 'docs/team/agent-orchestration/transport/tasks/AF-901.json',
      delivery: { state: 'pending', preparedAt: '2026-11-17T10:00:00.000Z' },
    };
    try {
      const missing = autoConfirmDelivery({ record, taskId: 'AF-901', transportDir: transport, repoRoot });
      expect(missing.confirmed).toBe(false);
      expect(missing.reason).toBe('ack-missing');

      writeFileSync(
        join(transport, 'acks', 'AF-901.json'),
        JSON.stringify({ schemaVersion: '1.0.0', taskId: 'AF-901', receivedAt: '2026-11-17T10:03:00.000Z', executor: 'MiniMax Code' }),
        'utf8',
      );
      expect(readDeliveryAck({ transportDir: transport, taskId: 'AF-901', repoRoot }).relative).toBe(
        ackRelativePath('AF-901'),
      );
      const ok = autoConfirmDelivery({ record, taskId: 'AF-901', transportDir: transport, repoRoot });
      expect(ok.confirmed).toBe(true);
      expect(ok.record.delivery.state).toBe('delivered');
      expect(ok.record.delivery.sessionPath).toBe('existing-session');
      expect(ok.record.delivery.locateLayer).toBe('paste-verify');
      expect(ok.record.delivery.evidenceRef).toBe(ackRelativePath('AF-901'));

      // ack taskId 不一致：不得确认，避免别的任务 ack 误认领
      writeFileSync(
        join(transport, 'acks', 'AF-901.json'),
        JSON.stringify({ schemaVersion: '1.0.0', taskId: 'AF-999', receivedAt: '2026-11-17T10:03:00.000Z' }),
        'utf8',
      );
      const mismatch = autoConfirmDelivery({ record, taskId: 'AF-901', transportDir: transport, repoRoot });
      expect(mismatch.confirmed).toBe(false);
      expect(mismatch.reason).toMatch(/taskId/);

      // 上一轮旧 ack 早于本次 preparedAt：不得拿来确认新投递
      writeFileSync(
        join(transport, 'acks', 'AF-901.json'),
        JSON.stringify({ schemaVersion: '1.0.0', taskId: 'AF-901', receivedAt: '2026-11-17T09:00:00.000Z' }),
        'utf8',
      );
      const stale = autoConfirmDelivery({ record, taskId: 'AF-901', transportDir: transport, repoRoot });
      expect(stale.confirmed).toBe(false);
      expect(stale.reason).toMatch(/早于本次投递/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('调度轮自动确认：只对 submitted + gui-relay + pending 的任务读 ack，缺 ack 不动状态', () => {
    const repoRoot = join(tmpdir(), `orch-sched-ack-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    const transport = join(repoRoot, 'docs', 'team', 'agent-orchestration', 'transport');
    mkdirSync(join(transport, 'acks'), { recursive: true });
    const index = { tasks: [{ taskId: 'AF-901', status: 'submitted' }, { taskId: 'AF-902', status: 'working' }] };
    const runtimeState = {
      tasks: {
        'AF-901': {
          dispatch: {
            taskId: 'AF-901',
            channel: 'gui-relay',
            delivery: { state: 'pending', preparedAt: '2026-11-17T10:00:00.000Z' },
          },
        },
      },
    };
    try {
      const actions = [];
      expect(autoConfirmDeliveries(index, runtimeState, actions, { transportDir: transport, repoRoot })).toBe(0);
      expect(runtimeState.tasks['AF-901'].dispatch.delivery.state).toBe('pending');
      writeFileSync(
        join(transport, 'acks', 'AF-901.json'),
        JSON.stringify({ schemaVersion: '1.0.0', taskId: 'AF-901', receivedAt: '2026-11-17T10:03:00.000Z' }),
        'utf8',
      );
      const confirmed = autoConfirmDeliveries(index, runtimeState, actions, { transportDir: transport, repoRoot });
      expect(confirmed).toBe(1);
      expect(runtimeState.tasks['AF-901'].dispatch.delivery.state).toBe('delivered');
      expect(actions.find((a) => a.type === 'delivery-auto-confirmed')?.taskId).toBe('AF-901');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('交付记录六组标记：英文键 / 中文块标题都认，缺一即报缺', () => {
    expect(findMissingDeliveryMarkers('')).toEqual(DELIVERY_RECORD_MARKERS.map((marker) => marker.key));
    const mixed = [
      '## 1. gateResults',
      '## 2. 范围核对',
      '## 3. 契约核对',
      '## 4. 遗留登记',
      '## 5. 偏差说明',
      '## 6. 验收结论',
    ].join('\n');
    expect(findMissingDeliveryMarkers(mixed)).toEqual([]);
    expect(findMissingDeliveryMarkers('## gateResults\n## scopeCheck')).toEqual([
      'contractChecks',
      'backlogItems',
      'deviationTable',
      'reviewVerdict',
    ]);
  });


  it('降级：缺原因 / 缺文件交接件 / 定性非法 / 非 GUI 通道都拒绝；成功清定位痕迹并保留 history', () => {
    const repoRoot = join(tmpdir(), `orch-gui-fallback-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    const handoverDir = join(repoRoot, 'docs', 'team', 'agent-orchestration', 'transport', 'tasks');
    mkdirSync(handoverDir, { recursive: true });
    writeFileSync(join(handoverDir, 'AF-901.json'), '{"payload":{}}', 'utf8');
    try {
      const record = {
        taskId: 'AF-901',
        channel: 'gui-relay',
        handoverRef: 'docs/team/agent-orchestration/transport/tasks/AF-901.json',
        delivery: { state: 'pending', sessionPath: 'mini-chat', locateLayer: 'shortcut' },
      };
      expect(fallbackDelivery(record, { repoRoot }).valid).toBe(false);
      expect(fallbackDelivery({ taskId: 'AF-901', channel: 'gui-relay' }, { reason: '桌面不可用', repoRoot }).errors.join()).toMatch(
        /文件交接件/,
      );
      expect(fallbackDelivery(record, { reason: '桌面不可用', classification: 'weird', repoRoot }).errors.join()).toMatch(/定性非法/);
      expect(fallbackDelivery({ ...record, channel: 'file' }, { reason: '没走 GUI', repoRoot }).errors.join()).toMatch(/不是 gui-relay/);
      const ok = fallbackDelivery(record, { reason: '桌面自动化不可用（CDP disconnected）', classification: 'flaky', repoRoot });
      expect(ok.valid).toBe(true);
      expect(ok.record.channel).toBe('gui-file-fallback');
      expect(ok.record.handoverRef).toBe('docs/team/agent-orchestration/transport/tasks/AF-901.json');
      expect(ok.record.delivery.state).toBe('failed');
      expect(ok.record.delivery.failureReason).toMatch(/CDP disconnected/);
      // 降级清空上一次定位痕迹，旧记录进 history 保留审计
      expect(ok.record.delivery.sessionPath).toBeNull();
      expect(ok.record.delivery.locateLayer).toBeNull();
      expect(ok.record.delivery.history.at(-1).state).toBe('pending');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('投递停滞判定：pending 超投递租约或 failed 才算停滞，delivered 不算', () => {
    const base = {
      taskId: 'AF-901',
      dispatchedAt: '2026-11-17T10:00:00.000Z',
      delivery: { state: 'pending', preparedAt: '2026-11-17T10:00:00.000Z' },
    };
    expect(isDeliveryStalled(base, { now: '2026-11-17T10:06:00.000Z', deliveryLeaseMinutes: 5 })).toBe(true);
    expect(isDeliveryStalled(base, { now: '2026-11-17T10:04:00.000Z', deliveryLeaseMinutes: 5 })).toBe(false);
    expect(
      isDeliveryStalled({ ...base, delivery: { state: 'delivered' } }, { now: '2026-11-17T11:00:00.000Z', deliveryLeaseMinutes: 5 }),
    ).toBe(false);
    expect(isDeliveryStalled({ ...base, delivery: { state: 'failed' } }, { now: '2026-11-17T11:00:00.000Z' })).toBe(true);
  });

  it('派发记录：gui-relay 带 pending delivery，file 通道不带投递段', () => {
    const gui = buildDispatchRecord(task, { channel: 'gui-relay', leaseDeadline: '2026-11-17T11:00:00.000Z' });
    expect(gui.channel).toBe('gui-relay');
    expect(gui.delivery.state).toBe('pending');
    const file = buildDispatchRecord(task, { channel: 'file' });
    expect(file.channel).toBe('file');
    expect(file.delivery).toBeUndefined();
  });

  it('重派留痕：attempt 递增且上一轮 delivery 进 history，不覆盖失败原因', () => {
    const entry = {
      dispatch: {
        taskId: 'AF-901',
        channel: 'gui-file-fallback',
        attempt: 1,
        delivery: { state: 'failed', failureReason: 'CDP disconnected', classification: 'flaky' },
      },
    };
    const record = buildDispatchRecord(task, {
      channel: 'gui-relay',
      attempt: Number(entry.dispatch.attempt ?? 0) + 1,
      previousDelivery: entry.dispatch.delivery,
    });
    expect(record.attempt).toBe(2);
    expect(record.delivery.state).toBe('pending');
    expect(record.delivery.history).toHaveLength(1);
    expect(record.delivery.history[0].failureReason).toMatch(/CDP disconnected/);
    expect(record.delivery.history[0].classification).toBe('flaky');
  });

  it('投递回滚：failed 或 pending 超投递租约 → 回滚 ready 并 heldForHuman，不自动重派', () => {
    const submitted = (taskId) => ({ taskId, status: 'submitted', history: [], dependsOn: [], type: 'implementation' });
    const failedTask = submitted('AF-130');
    const failedTask2 = submitted('AF-131');
    const index = { tasks: [failedTask, failedTask2], archivedTasks: [] };
    const runtimeState = {
      tasks: {
        'AF-130': { dispatch: { channel: 'gui-file-fallback', delivery: { state: 'failed', failureReason: 'CDP disconnected' } } },
        'AF-131': {
          dispatch: { channel: 'gui-relay', delivery: { state: 'pending', preparedAt: '2026-11-17T00:00:00.000Z' } },
        },
      },
    };
    const actions = [];
    const guiConfig = { dispatch: { channel: 'gui-relay', deliveryLeaseMinutes: 5 } };
    const handled = releaseFailedDeliveries(index, runtimeState, guiConfig, actions);
    expect(handled).toBe(2);
    expect(failedTask.status).toBe('ready');
    expect(failedTask2.status).toBe('ready');
    expect(runtimeState.tasks['AF-130'].heldForHuman).toBe(true);
    expect(runtimeState.tasks['AF-130'].releaseReason).toBe('gui-delivery-failed');
    expect(runtimeState.tasks['AF-131'].releaseReason).toBe('gui-delivery-lease-expired');
    expect(actions.filter((a) => a.type === 'delivery-released')).toHaveLength(2);
    // 已 delivered 的投递不参与回滚
    const okTask = submitted('AF-132');
    const okIndex = { tasks: [okTask], archivedTasks: [] };
    const okState = { tasks: { 'AF-132': { dispatch: { channel: 'gui-relay', delivery: { state: 'delivered' } } } } };
    expect(releaseFailedDeliveries(okIndex, okState, guiConfig, [])).toBe(0);
  });

  it('IM-028 选路决策：角色 → 上轮投递事实 → 配置通道 → 枚举收敛', () => {
    const guiConfig = { dispatch: { channel: 'gui-relay', fallbackToFile: true } };
    // 编排者：写文件交接件，不走桌面 relay
    const own = resolveChannelSelection({ task: { taskId: 'AF-140', agentRole: 'orchestrator' }, config: guiConfig });
    expect(own.channel).toBe('file');
    expect(own.reason).toBe('orchestrator-self-dispatch');
    // 执行代理 + 配置 gui-relay
    const exec = resolveChannelSelection({ task: { taskId: 'AF-141', agentRole: 'executor' }, config: guiConfig });
    expect(exec.channel).toBe('gui-relay');
    expect(exec.reason).toBe('configured-channel');
    // 上轮 failed → 直接降级文件通道，不再撞同一堵墙
    const afterFail = resolveChannelSelection({
      task: { taskId: 'AF-142', agentRole: 'executor' },
      config: guiConfig,
      previousDispatch: { channel: 'gui-file-fallback', attempt: 1, delivery: { state: 'failed' } },
    });
    expect(afterFail.channel).toBe('gui-file-fallback');
    expect(afterFail.reason).toBe('delivery-fallback-after-failure');
    expect(afterFail.attempt).toBe(2);
    // 已降级但显式关闭文件兜底 → 只能重试 relay
    const noFallback = resolveChannelSelection({
      task: { taskId: 'AF-143', agentRole: 'executor' },
      config: { dispatch: { channel: 'gui-relay', fallbackToFile: false } },
      previousDispatch: { channel: 'gui-relay', attempt: 1, delivery: { state: 'failed' } },
    });
    expect(noFallback.channel).toBe('gui-relay');
    expect(noFallback.reason).toBe('fallback-disabled-retry');
    // 配置通道不在枚举内 → 收敛 file 并留原因
    const coerced = resolveChannelSelection({
      task: { taskId: 'AF-144', agentRole: 'executor' },
      config: { dispatch: { channel: 'carrier-pigeon' } },
    });
    expect(coerced.channel).toBe('file');
    expect(coerced.reason).toBe('channel-unavailable-coerced');
  });

  it('IM-028 配置归一保留 dispatch 段：GUI 通道配了必须读得到，非法值显式报错', () => {
    const normalized = validateConfig({ dispatch: { channel: 'gui-relay', fallbackToFile: false, deliveryLeaseMinutes: 3 } });
    expect(normalized.dispatch).toEqual({ channel: 'gui-relay', fallbackToFile: false, deliveryLeaseMinutes: 3 });
    const defaults = validateConfig({});
    expect(defaults.dispatch).toEqual({ channel: 'file', fallbackToFile: true, deliveryLeaseMinutes: 5 });
    expect(() => validateConfig({ dispatch: { channel: 'carrier-pigeon' } })).toThrow(/dispatch\.channel 非法/);
    expect(() => validateConfig({ dispatch: { deliveryLeaseMinutes: 0 } })).toThrow(/deliveryLeaseMinutes/);
  });

  it('IM-028 回收：现场事实驱动决策链，不可恢复类别直接 failed，预算耗尽才升级人工', () => {
    const submitted = (taskId, extra = {}) => ({
      taskId,
      status: 'submitted',
      history: [],
      dependsOn: [],
      type: 'implementation',
      ...extra,
    });
    const terminalTask = submitted('AF-150');
    const budgetTask = submitted('AF-151');
    const index = { tasks: [terminalTask, budgetTask], archivedTasks: [] };
    const runtimeState = {
      tasks: {
        'AF-150': {
          dispatch: {
            channel: 'gui-file-fallback',
            attempt: 1,
            delivery: { state: 'failed', failureReason: '会话输入框不存在', lastAttempt: { cause: 'deterministic-defect' } },
          },
        },
        'AF-151': {
          dispatch: {
            channel: 'gui-file-fallback',
            attempt: 3,
            delivery: { state: 'failed', failureReason: '反复重试', lastAttempt: { cause: 'flaky', attemptCount: 3 } },
          },
        },
      },
    };
    const actions = [];
    const handled = releaseFailedDeliveries(index, runtimeState, { dispatch: { deliveryLeaseMinutes: 5 } }, actions);
    expect(handled).toBe(2);
    expect(terminalTask.status).toBe('failed');
    expect(runtimeState.tasks['AF-150'].heldForHuman).toBe(false);
    expect(runtimeState.tasks['AF-150'].releaseReason).toBe('gui-delivery-terminal');
    expect(actions.find((a) => a.type === 'delivery-terminal')?.cause).toBe('deterministic-defect');
    expect(budgetTask.status).toBe('ready');
    expect(runtimeState.tasks['AF-151'].heldForHuman).toBe(true);
    expect(runtimeState.tasks['AF-151'].releaseReason).toBe('gui-delivery-budget-exhausted');
    expect(runtimeState.tasks['AF-151'].dispatchDecisionResult.action).toBe('human-escalate');
  });
});

describe('IM-017 通道熔断参数化与可观察事件', () => {
  it('阈值来自配置；未达阈值不通开闸，达到阈值开闸并解释原因', () => {
    const closed = evaluateCircuitBreaker({ channel: 'gui-relay', delivery: { consecutiveFailures: 1 } });
    expect(closed.state).toBe('closed');
    expect(closed.threshold).toBe(CIRCUIT_BREAKER_DEFAULTS.consecutiveFailureThreshold);
    const open = evaluateCircuitBreaker(
      { channel: 'gui-relay', delivery: { consecutiveFailures: 3 } },
      { circuitBreaker: { consecutiveFailureThreshold: 3 } },
    );
    expect(open.state).toBe('open');
    expect(open.reason).toMatch(/连续失败 3 次/);
  });

  it('回收环节开闸时发 channel-circuit-open 事件并写 channelCircuit', () => {
    const task = { taskId: 'AF-160', contextId: 'c', type: 'verification', status: 'submitted', agentRole: 'executor' };
    const index = { tasks: [task], archivedTasks: [] };
    const runtimeState = {
      tasks: {
        'AF-160': {
          leaseClaimedAt: '2026-11-16T00:00:00.000Z',
          leaseDeadline: '2026-11-16T00:05:00.000Z',
          dispatch: {
            channel: 'gui-file-fallback',
            attempt: 2,
            delivery: {
              state: 'failed',
              history: [],
              consecutiveFailures: 3,
              lastAttempt: { cause: 'flaky', attemptCount: 2 },
            },
          },
        },
      },
    };
    const actions = [];
    releaseFailedDeliveries(
      index,
      runtimeState,
      { dispatch: { deliveryLeaseMinutes: 5 }, circuitBreaker: { consecutiveFailureThreshold: 3 } },
      actions,
    );
    expect(task.status).toBe('ready');
    expect(runtimeState.tasks['AF-160'].channelCircuit).toMatchObject({
      state: 'open',
      channel: 'gui-file-fallback',
      consecutiveFailures: 3,
    });
    expect(actions.some((a) => a.type === 'channel-circuit-open' && a.threshold === 3)).toBe(true);
  });

  it('冷却期满转 half-open 只放一次试探；冷期内保持 open', () => {
    const cfg = { circuitBreaker: { consecutiveFailureThreshold: 3, cooldownMinutes: 10 } };
    const openedAt = '2026-11-17T00:00:00.000Z';
    const inCooldown = evaluateCircuitBreaker({ channel: 'gui-relay', delivery: { consecutiveFailures: 3 }, openedAt }, cfg, {
      now: '2026-11-17T00:05:00.000Z',
    });
    expect(inCooldown.state).toBe('open');
    expect(inCooldown.probeAllowed).toBe(false);
    expect(inCooldown.openedAt).toBe(openedAt);
    const halfOpen = evaluateCircuitBreaker({ channel: 'gui-relay', delivery: { consecutiveFailures: 3 }, openedAt }, cfg, {
      now: '2026-11-17T00:11:00.000Z',
    });
    expect(halfOpen.state).toBe('half-open');
    expect(halfOpen.probeAllowed).toBe(true);
    expect(halfOpen.reason).toMatch(/冷却期满/);
  });

  it('半开态回收写 channelCircuit=half-open 并放开闸事件；成功投递归零封闭', () => {
    const task = { taskId: 'AF-161', contextId: 'c', type: 'verification', status: 'submitted', agentRole: 'executor' };
    const index = { tasks: [task], archivedTasks: [] };
    const runtimeState = {
      tasks: {
        'AF-161': {
          leaseClaimedAt: '2026-11-16T00:00:00.000Z',
          leaseDeadline: '2026-11-16T00:05:00.000Z',
          channelCircuit: { state: 'open', openedAt: '2026-11-16T23:50:00.000Z', consecutiveFailures: 3 },
          dispatch: {
            channel: 'gui-file-fallback',
            attempt: 3,
            delivery: { state: 'failed', history: [], consecutiveFailures: 3, lastAttempt: { cause: 'transient' } },
          },
        },
      },
    };
    const actions = [];
    releaseFailedDeliveries(
      index,
      runtimeState,
      { dispatch: { deliveryLeaseMinutes: 5 }, circuitBreaker: { consecutiveFailureThreshold: 3, cooldownMinutes: 10 } },
      actions,
    );
    expect(runtimeState.tasks['AF-161'].channelCircuit).toMatchObject({ state: 'half-open', probeAllowed: true });
    expect(actions.some((a) => a.type === 'channel-circuit-half-open')).toBe(true);

    // 试探成功：confirmDelivery 把通道级连续失败计数归零并清开闸时刻。
    const evidenceRoot = join(tmpdir(), `orch-confirm-${process.pid}`);
    const evidenceRef = 'docs/evidence/shot.png';
    mkdirSync(dirname(join(evidenceRoot, evidenceRef)), { recursive: true });
    writeFileSync(join(evidenceRoot, evidenceRef), 'png', 'utf8');
    const record = {
      taskId: 'AF-161',
      channel: 'gui-relay',
      handoverRef: 'transport/briefs/AF-161.md',
      delivery: { state: 'pending', consecutiveFailures: 3, circuitOpenedAt: '2026-11-16T23:50:00.000Z' },
    };
    const confirmed = confirmDelivery(record, {
      sessionPath: 'existing-session',
      locateLayer: 'element-tree',
      evidenceRef,
      repoRoot: evidenceRoot,
      at: '2026-11-17T00:12:00.000Z',
    });
    expect(confirmed.valid).toBe(true);
    expect(confirmed.record.delivery.consecutiveFailures).toBe(0);
    expect(confirmed.record.delivery.circuitOpenedAt).toBeNull();
  });
});

describe('AF-043-I2 非失败事实（通道旁路）', () => {
  it('executed-in-session 不是不可恢复类别，决策链给 continue-in-session', () => {
    expect(isNonFailureCause('executed-in-session')).toBe(true);
    expect(isIrrecoverable('executed-in-session')).toBe(false);
    const decision = resolveDispatchDecision({ processRunning: false, cause: 'executed-in-session', attemptCount: 2 });
    expect(decision).toMatchObject({ action: 'continue-in-session', result: 'working' });
  });

  it('降级为旁路：状态 bypassed、通道失败计数不递增', () => {
    const repoRoot = join(tmpdir(), `orch-bypass-${process.pid}`);
    const handoverRef = 'transport/briefs/AF-170.md';
    const abs = join(repoRoot, handoverRef);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '# brief\n', 'utf8');
    const record = { taskId: 'AF-170', channel: 'gui-relay', handoverRef, delivery: { state: 'pending', consecutiveFailures: 2 } };
    const result = fallbackDelivery(record, {
      reason: '会话内直做，未走桌面 relay',
      repoRoot,
      facts: { cause: 'executed-in-session', attemptCount: 1 },
    });
    expect(result.valid).toBe(true);
    expect(result.record.delivery.state).toBe('bypassed');
    expect(result.record.delivery.consecutiveFailures).toBe(2);
    expect(result.record.delivery.bypassCause).toBe('executed-in-session');
  });

  it('回收环节对旁路任务不动状态，只留痕', () => {
    const task = { taskId: 'AF-171', contextId: 'c', type: 'verification', status: 'submitted', agentRole: 'executor' };
    const index = { tasks: [task], archivedTasks: [] };
    const runtimeState = {
      tasks: {
        'AF-171': {
          leaseClaimedAt: '2026-11-16T00:00:00.000Z',
          leaseDeadline: '2026-11-16T00:05:00.000Z',
          dispatch: {
            channel: 'gui-file-fallback',
            attempt: 1,
            delivery: { state: 'failed', history: [], lastAttempt: { cause: 'executed-in-session' } },
          },
        },
      },
    };
    const actions = [];
    releaseFailedDeliveries(index, runtimeState, { dispatch: { deliveryLeaseMinutes: 5 } }, actions);
    expect(task.status).toBe('submitted');
    expect(runtimeState.tasks['AF-171'].deliveryBypassed).toBe(true);
    expect(actions.some((a) => a.type === 'delivery-bypassed')).toBe(true);
  });

  it('cause 全集含不可恢复四类、transient 与旁路事实', () => {
    expect(DELIVERY_CAUSES).toEqual(
      expect.arrayContaining([
        'contract-invalid',
        'input-invalid',
        'permission-denied',
        'deterministic-defect',
        'transient',
        'executed-in-session',
      ]),
    );
    expect(DELIVERY_CAUSES).not.toContain('executed_in_session');
  });
});

describe('AF-044-O1 熔断派发侧硬拦截', () => {
  const config = {
    autoLoop: { enabled: true },
    allowedTaskTypes: ['investigation'],
    maxConcurrentTasks: 1,
    leaseDefaultMinutes: 30,
    reworkLimit: 2,
    transport: { type: 'file' },
    circuitBreaker: { consecutiveFailureThreshold: 3, cooldownMinutes: 10 },
  };

  function task(id) {
    return {
      taskId: id,
      contextId: 'phase2.5-orchestration-closed-loop',
      type: 'investigation',
      title: `只读巡检 ${id}`,
      status: 'ready',
      createdAt: '2026-11-17T00:00:00+08:00',
      scope: { files: ['docs/team/agent-orchestration/README.md'], modules: [], interfaces: [] },
      dependsOn: [],
      policyRefs: [],
      agentRole: 'reviewer',
      artifacts: { taskSheet: `docs/team/agent-orchestration/transport/tasks/${id}.json` },
      history: [],
    };
  }

  function openState(openedAt) {
    return {
      tasks: {
        'AF-900': {
          channelCircuit: {
            state: 'open',
            channel: 'gui-relay',
            consecutiveFailures: 3,
            threshold: 3,
            cooldownMinutes: 10,
            openedAt,
            at: openedAt,
          },
        },
      },
    };
  }

  it('open 冷期内整轮不派发：任务留 ready 并发 channel-circuit-blocked', () => {
    const index = { tasks: [task('AF-901')], archivedTasks: [] };
    const runtimeState = openState('2026-11-17T04:00:00.000Z');
    const actions = [];
    claimReadyTasks(index, runtimeState, config, actions, {
      transport: { submitTask: () => 'transport/tasks/x.json' },
      cards: [],
      now: '2026-11-17T04:05:00.000Z',
    });
    expect(index.tasks[0].status).toBe('ready');
    expect(runtimeState.tasks['AF-901']).toBeUndefined();
    const blocked = actions.find((a) => a.type === 'channel-circuit-blocked');
    expect(blocked).toMatchObject({ state: 'open', channel: 'gui-relay', consecutiveFailures: 3 });
    expect(actions.some((a) => a.type === 'claim')).toBe(false);
  });

  it('half-open 只放一次试探：首个领单并发 probe 事件', () => {
    const index = { tasks: [task('AF-902'), task('AF-903')], archivedTasks: [] };
    const runtimeState = openState('2026-11-17T03:50:00.000Z');
    const actions = [];
    claimReadyTasks(index, runtimeState, config, actions, {
      transport: { submitTask: (h) => `transport/tasks/${h.taskId}.json` },
      cards: [],
      now: '2026-11-17T04:05:00.000Z',
    });
    expect(index.tasks[0].status).toBe('submitted');
    expect(actions.filter((a) => a.type === 'channel-circuit-probe')).toHaveLength(1);
    expect(runtimeState.tasks['AF-902'].circuitProbe).toMatchObject({ channel: 'gui-relay' });
  });

  it('无熔断事实时 resolveChannelCircuit 返回 closed，不误拦', () => {
    const circuit = resolveChannelCircuit({ tasks: {} }, config, { now: '2026-11-17T04:05:00.000Z' });
    expect(circuit.state).toBe('closed');
    expect(circuit.probeAllowed).toBe(false);
    expect(circuit.probeIssued).toBe(false);
  });

  // 「只放一次试探」必须跨轮成立：上一轮已经把探针发出去，这一轮不能再发第二个。
  it('同一开闸周期已发过探针：half-open 跨轮不再放行', () => {
    const index = { tasks: [task('AF-904')], archivedTasks: [] };
    const runtimeState = openState('2026-11-17T03:50:00.000Z');
    runtimeState.tasks['AF-905'] = {
      circuitProbe: { channel: 'gui-relay', at: '2026-11-17T04:02:00.000Z', openedAt: '2026-11-17T03:50:00.000Z' },
    };
    const actions = [];
    claimReadyTasks(index, runtimeState, config, actions, {
      transport: { submitTask: () => 'transport/tasks/x.json' },
      cards: [],
      now: '2026-11-17T04:05:00.000Z',
    });
    const circuit = resolveChannelCircuit(runtimeState, config, { now: '2026-11-17T04:05:00.000Z' });
    expect(circuit.state).toBe('half-open');
    expect(circuit.probeIssued).toBe(true);
    expect(index.tasks[0].status).toBe('ready');
    expect(actions.some((a) => a.type === 'channel-circuit-probe')).toBe(false);
    expect(actions.find((a) => a.type === 'channel-circuit-blocked')?.state).toBe('half-open');
  });

  it('不同开闸周期的探针不冒充已试探：新周期可再放一次', () => {
    const runtimeState = openState('2026-11-17T04:00:00.000Z');
    runtimeState.tasks['AF-906'] = {
      circuitProbe: { channel: 'gui-relay', at: '2026-11-17T03:00:00.000Z', openedAt: '2026-11-17T02:30:00.000Z' },
    };
    const circuit = resolveChannelCircuit(runtimeState, config, { now: '2026-11-17T04:05:00.000Z' });
    expect(circuit.probeIssued).toBe(false);
  });
});

describe('IM-012 squash 合并收口', () => {
  function fakeGit(overrides = {}) {
    const calls = [];
    const port = {
      squashMerge: (name) => calls.push(['squashMerge', name]),
      commitSquash: (message) => calls.push(['commitSquash', message]),
      deleteLocal: (name) => calls.push(['deleteLocal', name]),
      deleteRemote: (name, remote) => calls.push(['deleteRemote', name, remote]),
      ...overrides,
    };
    return { port, calls };
  }

  it('一次调用完成 暂存 → 提交 → 删本地/远端，提交标题带 taskId', () => {
    const { port, calls } = fakeGit();
    const result = finalizeSquashMerge({ source: 'task/AF-160-x', taskId: 'AF-160', title: '合并标题', remote: 'origin', gitPort: port });
    expect(result.stages).toEqual(['squash-merge', 'commit', 'delete-local', 'delete-remote']);
    expect(result.errors).toEqual([]);
    expect(calls[1][1]).toContain('AF-160');
    expect(calls[3]).toEqual(['deleteRemote', 'task/AF-160-x', 'origin']);
  });

  // AF-046 实弹暴露：裸 `<taskId> <title>` 被仓内 commit-msg 钩子拒绝，squash 提交直接失败。
  it('提交标题满足 conventional commit（钩子正则），并按任务类型选前缀', () => {
    const HOOK = /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\([^)]+\))?: .+/;
    const cases = [
      ['implementation', 'feat'],
      ['fix', 'fix'],
      ['documentation', 'docs'],
      ['verification', 'chore'],
      [undefined, 'chore'],
    ];
    for (const [taskType, expectedType] of cases) {
      const message = buildSquashCommitMessage({ taskId: 'AF-046', taskType, title: '合并标题' });
      expect(HOOK.test(message)).toBe(true);
      expect(message.startsWith(`${expectedType}(orchestration): `)).toBe(true);
      expect(message).toContain('AF-046');
    }
  });

  it('squash 标题剥离外部任务号，只保留主任务号', () => {
    const message = buildSquashCommitMessage({
      taskId: 'AF-061',
      taskType: 'verification',
      title: 'Phase2.5 出口条件取证重定（AF-060 验收断链返修）',
    });
    expect(extractCommitTaskId(message)).toBe('AF-061');
    expect(message).not.toContain('AF-060');

    const ascii = buildSquashCommitMessage({
      taskId: 'AF-061',
      taskType: 'verification',
      title: '出口取证 (AF-060 rework)',
    });
    expect(extractCommitTaskId(ascii)).toBe('AF-061');
    expect(ascii).not.toContain('AF-060');

    const bare = buildSquashCommitMessage({
      taskId: 'AF-062',
      taskType: 'fix',
      title: '修复 AF-060 的 gate',
    });
    expect(extractCommitTaskId(bare)).toBe('AF-062');
    expect(bare).not.toContain('AF-060');
  });

  it('提交阶段失败即停：不删分支、错误如实返回', () => {
    const { port, calls } = fakeGit({
      commitSquash: () => {
        throw new Error('nothing to commit');
      },
    });
    const result = finalizeSquashMerge({ source: 'task/AF-160-x', taskId: 'AF-160', gitPort: port });
    expect(result.stages).toEqual(['squash-merge']);
    expect(result.errors.join()).toMatch(/提交失败/);
    expect(calls.some(([name]) => name === 'deleteLocal')).toBe(false);
  });
});

describe('IM-018 远端 CI 合并门禁', () => {
  it('判定：全 success/skipped 放行；失败态阻断；未完成判 pending；无 check 判 unknown', () => {
    expect(
      ciGateVerdict([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'skipped' },
      ]).verdict,
    ).toBe('pass');
    expect(ciGateVerdict([{ status: 'completed', conclusion: 'failure', name: 'Unit' }]).verdict).toBe('fail');
    expect(ciGateVerdict([{ status: 'in_progress', conclusion: null, name: 'E2E' }]).verdict).toBe('pending');
    expect(ciGateVerdict([]).verdict).toBe('unknown');
  });

  it('token 优先环境变量；取数失败不冒充通过', async () => {
    expect(resolveGithubToken({ env: { GITHUB_TOKEN: ' t0ken ' } })).toBe('t0ken');
    expect(resolveGithubToken({ env: {}, fillCredential: () => 'protocol=https\npassword=abc\n' })).toBe('abc');
    const failed = await evaluateRemoteCiGate({
      repo: 'o/r',
      sha: 'deadbeef',
      token: 't',
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }),
    });
    expect(failed.verdict).toBe('unknown');
    expect(failed.error).toMatch(/403/);
    const passed = await evaluateRemoteCiGate({
      repo: 'o/r',
      sha: 'deadbeef',
      token: 't',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [{ status: 'completed', conclusion: 'success' }] }),
      }),
    });
    expect(passed.verdict).toBe('pass');
    expect(passed.total).toBe(1);
  });

  it('AF-043-I4：Actions 内无 token 不白跑 credential，直接给注入提示', async () => {
    const inActions = resolveGithubTokenDetail({ env: { GITHUB_ACTIONS: 'true' } });
    expect(inActions.token).toBeNull();
    expect(inActions.hint).toMatch(/GITHUB_TOKEN/);

    // Actions 里注入 secrets.GITHUB_TOKEN 即被识别，来源可追溯。
    expect(resolveGithubTokenDetail({ env: { GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'ghs_1' } })).toMatchObject({
      token: 'ghs_1',
      source: 'GITHUB_TOKEN',
    });
    // 私有仓专用变量在本地/CI 都可用。
    expect(resolveGithubTokenDetail({ env: { ORCH_GITHUB_TOKEN: 'x' } })).toMatchObject({ token: 'x', source: 'ORCH_GITHUB_TOKEN' });

    const fetched = await fetchCheckRuns({
      repo: 'o/r',
      sha: 'deadbeef',
      env: { GITHUB_TOKEN: 't', GITHUB_API_URL: 'https://ghe.example.com/api/v3' },
      fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => ({ check_runs: [], url }) }),
    });
    expect(fetched.ok).toBe(true);
  });

  it('GHES 基址取自 GITHUB_API_URL，缺省回落 api.github.com', async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ check_runs: [] }) };
    };
    await fetchCheckRuns({ repo: 'o/r', sha: 'abc', token: 't', env: {}, fetchImpl });
    await fetchCheckRuns({ repo: 'o/r', sha: 'abc', token: 't', env: { GITHUB_API_URL: 'https://ghe.example.com/api/v3/' }, fetchImpl });
    expect(urls[0]).toMatch(/^https:\/\/api\.github\.com\/repos\/o\/r\//);
    expect(urls[1]).toMatch(/^https:\/\/ghe\.example\.com\/api\/v3\/repos\/o\/r\//);
  });
});

describe('task-entry-gate 开发任务强制编排门', () => {
  const gateTask = (taskId, files, status = 'submitted') => ({
    taskId,
    status,
    type: 'implementation',
    agentRole: 'orchestrator',
    scope: { files },
    artifacts: {
      taskSheet: `docs/worklog/pending/${taskId.toLowerCase()}-task-2026-11-17.md`,
    },
  });

  it('没有在办任务时阻断暂存提交', () => {
    const result = evaluateTaskEntry({ changedFiles: ['src/a.ts'], tasks: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-active-task');
  });

  it('在 scope 内的暂存文件放行', () => {
    const task = gateTask('AF-G1', ['src/']);
    const result = evaluateTaskEntry({ changedFiles: ['src/a.ts'], tasks: [task] });
    expect(result).toMatchObject({ ok: true, taskId: 'AF-G1', covered: ['src/a.ts'] });
  });

  it('越出 scope 的暂存文件阻断并列出 residual', () => {
    const task = gateTask('AF-G2', ['src/']);
    const result = evaluateTaskEntry({ changedFiles: ['src/a.ts', 'docs/out-of-scope.md'], tasks: [task] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('scope-residual');
    expect(result.residual).toEqual(['docs/out-of-scope.md']);
  });

  it('编排状态面生成物豁免 scope 比对', () => {
    const task = gateTask('AF-G3', ['src/']);
    const result = evaluateTaskEntry({
      changedFiles: [
        'src/a.ts',
        'docs/team/agent-orchestration/task-state-index.json',
        'docs/team/agent-orchestration/state/journal.jsonl',
      ],
      tasks: [task],
    });
    expect(result.ok).toBe(true);
    expect(isStatePlanePath('docs/team/agent-orchestration/state/journal.jsonl')).toBe(true);
    expect(isStatePlanePath('src/a.ts')).toBe(false);
  });

  it('ready 任务未领单时不允许提交实现文件', () => {
    const task = gateTask('AF-G4', ['src/'], 'ready');
    const result = evaluateTaskEntry({ changedFiles: ['src/a.ts'], tasks: [task] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('run-once-required');
  });

  it('ready 任务只提交自身任务单时放行', () => {
    const task = gateTask('AF-G5', ['docs/worklog/pending/'], 'ready');
    const result = evaluateTaskEntry({
      changedFiles: [task.artifacts.taskSheet],
      tasks: [task],
    });
    expect(result.ok).toBe(true);
    expect(result.taskId).toBe('AF-G5');
  });

  it('completed 任务不允许再提交实现文件', () => {
    const task = gateTask('AF-G6', ['src/'], 'completed');
    const result = evaluateTaskEntry({ changedFiles: ['src/a.ts'], tasks: [task] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('completed-write-blocked');
  });

  it('多个任务覆盖时用显式 taskId 消歧', () => {
    const a = gateTask('AF-G7A', ['src/a/']);
    const b = gateTask('AF-G7B', ['src/b/']);
    const result = evaluateTaskEntry({
      changedFiles: ['src/b/x.ts'],
      tasks: [a, b],
      explicitTaskId: 'AF-G7B',
    });
    expect(result).toMatchObject({ ok: true, taskId: 'AF-G7B' });
  });

  it('可提交状态集合覆盖 ready/submitted/working/input-required/completed', () => {
    expect(GATE_ALLOWED_STATUSES).toEqual(['ready', 'submitted', 'working', 'input-required', 'completed']);
  });

  it('无在办任务时纯编排状态面提交放行', () => {
    const result = evaluateTaskEntry({
      changedFiles: [
        'docs/team/agent-orchestration/task-state-index.json',
        'docs/team/agent-orchestration/state/journal.jsonl',
        'docs/team/agent-orchestration/orchestration-snapshot.json',
        'web/orchestration/data.js',
      ],
      tasks: [],
    });
    expect(result).toMatchObject({ ok: true, reason: 'state-plane-only', taskId: null });
    expect(result.covered).toHaveLength(4);
  });

  it('纯状态面混入一个业务文件仍要求有在办任务', () => {
    const result = evaluateTaskEntry({
      changedFiles: ['docs/team/agent-orchestration/task-state-index.json', 'src/a.ts'],
      tasks: [],
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'no-active-task',
      residual: ['docs/team/agent-orchestration/task-state-index.json', 'src/a.ts'],
    });
  });

  it('completed 归档迁移提交可借用 HEAD 中同任务做 scope 校验', () => {
    const headTask = gateTask('AF-G8', ['src/'], 'submitted');
    const archivedTask = { ...headTask, status: 'completed' };
    const result = evaluateTaskEntry({
      changedFiles: ['docs/team/agent-orchestration/task-state-index.json', 'src/a.ts'],
      tasks: [],
      archivedTasks: [archivedTask],
      headTasks: [headTask],
    });
    expect(result).toMatchObject({ ok: true, reason: 'archived-transition', taskId: 'AF-G8', covered: ['src/a.ts'] });
  });

  it('canceled 归档不能借用 HEAD 任务恢复写权限', () => {
    const headTask = gateTask('AF-G9', ['src/'], 'submitted');
    const result = evaluateTaskEntry({
      changedFiles: ['docs/team/agent-orchestration/task-state-index.json', 'src/a.ts'],
      tasks: [],
      archivedTasks: [{ ...headTask, status: 'canceled' }],
      headTasks: [headTask],
    });
    expect(result).toMatchObject({ ok: false, reason: 'no-active-task' });
  });

  it('未同次提交状态索引时不能借用 HEAD 任务', () => {
    const headTask = gateTask('AF-G10', ['src/'], 'submitted');
    const result = evaluateTaskEntry({
      changedFiles: ['src/a.ts'],
      tasks: [],
      archivedTasks: [{ ...headTask, status: 'completed' }],
      headTasks: [headTask],
    });
    expect(result).toMatchObject({ ok: false, reason: 'no-active-task' });
  });

  it('归档迁移快照不放宽 scope 越界检查', () => {
    const headTask = gateTask('AF-G11', ['src/'], 'submitted');
    const result = evaluateTaskEntry({
      changedFiles: ['docs/team/agent-orchestration/task-state-index.json', 'docs/out-of-scope.md'],
      tasks: [],
      archivedTasks: [{ ...headTask, status: 'completed' }],
      headTasks: [headTask],
    });
    expect(result).toMatchObject({ ok: false, reason: 'scope-residual', residual: ['docs/out-of-scope.md'] });
  });
});

describe('AF-056 CI 逐提交编排门', () => {
  const ciTask = (taskId, files = ['src/'], status = 'submitted') => ({
    taskId,
    status,
    type: 'implementation',
    agentRole: 'orchestrator',
    scope: { files },
    artifacts: { taskSheet: `docs/worklog/pending/${taskId.toLowerCase()}-task-2026-11-17.md` },
  });

  it('提交标题解析唯一任务编号，日期不误判，同编号重复不歧义', () => {
    expect(extractCommitTaskId('docs: release 2026-11-17')).toBeNull();
    expect(extractCommitTaskId('fix: AF-056 / AF-056 gate')).toBe('AF-056');
    expect(extractCommitTaskId('feat: WP-123 quality gate')).toBe('WP-123');
  });

  it('提交标题含多个不同任务编号直接拒绝', () => {
    expect(() => extractCommitTaskId('fix: AF-056 mixed with AF-055')).toThrow('多个任务编号');
    const result = evaluateCommitSnapshot({ subject: 'AF-056 AF-055', changedFiles: ['src/a.ts'] });
    expect(result).toMatchObject({ pass: false, reason: 'ambiguous-task-id' });
  });

  it('登记提交使用当前提交的在办任务并校验任务单存在', () => {
    const task = ciTask('AF-900', ['docs/worklog/']);
    const result = evaluateCommitSnapshot({
      subject: 'docs: register AF-900',
      changedFiles: ['docs/worklog/pending/af-900-task-2026-11-17.md'],
      currentIndex: { tasks: [task], archivedTasks: [] },
      parentIndex: { tasks: [], archivedTasks: [] },
      taskSheetExists: true,
    });
    expect(result).toMatchObject({ pass: true, reason: 'pass', taskId: 'AF-900', commitTaskId: 'AF-900' });
  });

  it('无任务编号的非状态面提交在服务端阻断', () => {
    const result = evaluateCommitSnapshot({
      subject: 'fix: bypass hooks',
      changedFiles: ['src/a.ts'],
      currentIndex: { tasks: [], archivedTasks: [] },
      parentIndex: { tasks: [], archivedTasks: [] },
    });
    expect(result).toMatchObject({ pass: false, reason: 'no-active-task' });
  });

  it('任务索引有记录但提交缺任务单时阻断', () => {
    const task = ciTask('AF-901', ['src/']);
    const result = evaluateCommitSnapshot({
      subject: 'feat: AF-901 implementation',
      changedFiles: ['src/a.ts'],
      currentIndex: { tasks: [task], archivedTasks: [] },
      parentIndex: { tasks: [task], archivedTasks: [] },
      taskSheetExists: false,
    });
    expect(result).toMatchObject({ pass: false, reason: 'task-sheet-missing' });
  });

  it('纯状态面提交沿用 state-plane-only 豁免', () => {
    const result = evaluateCommitSnapshot({
      subject: 'chore: sync archived state',
      changedFiles: ['docs/team/agent-orchestration/task-state-index.json'],
      currentIndex: { tasks: [], archivedTasks: [] },
      parentIndex: { tasks: [], archivedTasks: [] },
    });
    expect(result).toMatchObject({ pass: true, reason: 'state-plane-only' });
  });

  it('归档 squash 提交复用 archived-transition', () => {
    const task = ciTask('AF-902', ['src/']);
    const result = evaluateCommitSnapshot({
      subject: 'fix(orchestration): AF-902 squash merge into integrate',
      changedFiles: ['docs/team/agent-orchestration/task-state-index.json', 'src/a.ts'],
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      parentIndex: { tasks: [task], archivedTasks: [] },
      taskSheetExists: true,
    });
    expect(result).toMatchObject({ pass: true, reason: 'archived-transition', taskId: 'AF-902' });
  });

  it('canceled 归档不能借父提交恢复写权限', () => {
    const task = ciTask('AF-903', ['src/']);
    const result = evaluateCommitSnapshot({
      subject: 'fix: AF-903 canceled bypass',
      changedFiles: ['docs/team/agent-orchestration/task-state-index.json', 'src/a.ts'],
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'canceled' }] },
      parentIndex: { tasks: [task], archivedTasks: [] },
      taskSheetExists: true,
    });
    expect(result).toMatchObject({ pass: false, reason: 'no-active-task' });
  });

  it('服务端归档迁移仍阻断 scope 外文件', () => {
    const task = ciTask('AF-904', ['src/']);
    const result = evaluateCommitSnapshot({
      subject: 'fix: AF-904 archive',
      changedFiles: ['docs/team/agent-orchestration/task-state-index.json', 'docs/out-of-scope.md'],
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      parentIndex: { tasks: [task], archivedTasks: [] },
      taskSheetExists: true,
    });
    expect(result).toMatchObject({ pass: false, reason: 'scope-residual' });
  });

  it('PR 最终 HEAD 未 completed/archived 时禁止直接合并', () => {
    const task = ciTask('AF-905');
    const result = evaluateAcceptanceSnapshot({
      taskId: 'AF-905',
      currentIndex: { tasks: [task], archivedTasks: [] },
      receipts: [{ verdict: 'passed', scopeCheck: 'in-scope', finalStatus: 'completed' }],
    });
    expect(result).toMatchObject({ pass: false, reason: 'task-not-archived-completed' });
  });

  it('PR 的 conditional-pass 有已登记 backlog 且无人工复核项时可合并', () => {
    const task = ciTask('AF-906');
    const result = evaluateAcceptanceSnapshot({
      taskId: 'AF-906',
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      receipts: [
        {
          verdict: 'conditional-pass',
          scopeCheck: 'in-scope',
          finalStatus: 'completed',
          manualReviewList: [],
          backlogItems: [{ id: 'IM-053', impact: 'long-run validation' }],
        },
      ],
    });
    expect(result).toMatchObject({ pass: true, reason: 'accepted', taskId: 'AF-906' });
  });

  it('PR 的 conditional-pass 存在人工复核项时仍禁止合并', () => {
    const task = ciTask('AF-9061');
    const result = evaluateAcceptanceSnapshot({
      taskId: 'AF-9061',
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      receipts: [
        {
          verdict: 'conditional-pass',
          scopeCheck: 'in-scope',
          finalStatus: 'completed',
          manualReviewList: ['回执字段缺失'],
          backlogItems: [{ id: 'IM-053' }],
        },
      ],
    });
    expect(result).toMatchObject({ pass: false, reason: 'passed-durable-receipt-missing' });
  });

  it('PR archived/completed 与 passed durable 回执同时满足才 accepted', () => {
    const task = ciTask('AF-907');
    const result = evaluateAcceptanceSnapshot({
      taskId: 'AF-907',
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      receipts: [
        { path: 'docs/worklog/pending/archive/AF-907-receipt.json', verdict: 'passed', scopeCheck: 'in-scope', finalStatus: 'completed' },
      ],
    });
    expect(result).toMatchObject({ pass: true, reason: 'accepted', taskId: 'AF-907' });
  });
});

describe('AF-058 squash 全生命周期归档门', () => {
  const lifecycleFiles = [
    'docs/team/agent-orchestration/task-state-index.json',
    'docs/worklog/pending/af058-squash-lifecycle-gate-task-2026-11-17.md',
    'docs/worklog/pending/archive/AF-908-receipt.json',
    'src/quality.ts',
  ];
  const passedReceipt = { verdict: 'passed', scopeCheck: 'in-scope', finalStatus: 'completed' };
  const lifecycleTask = (taskId) => ({
    taskId,
    status: 'submitted',
    type: 'implementation',
    agentRole: 'orchestrator',
    scope: { files: ['src/', 'docs/'] },
    artifacts: { taskSheet: `docs/worklog/pending/${taskId.toLowerCase()}-task-2026-11-17.md` },
  });

  it('父提交无任务且当前归档有 passed 回执时允许 squash 全生命周期', () => {
    const task = lifecycleTask('AF-908');
    const result = evaluateCommitSnapshot({
      subject: 'fix(orchestration): AF-908 squash lifecycle',
      changedFiles: lifecycleFiles,
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      parentIndex: { tasks: [], archivedTasks: [] },
      taskSheetExists: true,
      receipts: [passedReceipt],
    });
    expect(result).toMatchObject({ pass: true, reason: 'archived-transition', taskId: 'AF-908' });
  });

  it('父提交无任务且 conditional-pass 无人工复核项时允许 squash 全生命周期', () => {
    const task = lifecycleTask('AF-9081');
    const result = evaluateCommitSnapshot({
      subject: 'fix(orchestration): AF-9081 squash lifecycle conditional',
      changedFiles: lifecycleFiles,
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      parentIndex: { tasks: [], archivedTasks: [] },
      taskSheetExists: true,
      receipts: [
        {
          verdict: 'conditional-pass',
          scopeCheck: 'in-scope',
          finalStatus: 'completed',
          manualReviewList: [],
          backlogItems: [{ id: 'IM-053' }],
        },
      ],
    });
    expect(result).toMatchObject({ pass: true, reason: 'archived-transition', taskId: 'AF-9081' });
  });

  it('父提交无任务且 conditional-pass 有未登记遗留时拒绝 squash', () => {
    const task = lifecycleTask('AF-9082');
    const result = evaluateCommitSnapshot({
      subject: 'fix(orchestration): AF-9082 squash lifecycle bad backlog',
      changedFiles: lifecycleFiles,
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      parentIndex: { tasks: [], archivedTasks: [] },
      taskSheetExists: true,
      receipts: [
        {
          verdict: 'conditional-pass',
          scopeCheck: 'in-scope',
          finalStatus: 'completed',
          manualReviewList: [],
          backlogItems: [{ impact: 'missing id' }],
        },
      ],
    });
    expect(result).toMatchObject({ pass: false, reason: 'no-active-task' });
  });

  it('父提交无任务但缺 passed 回执时仍拒绝 squash', () => {
    const task = lifecycleTask('AF-909');
    const result = evaluateCommitSnapshot({
      subject: 'fix(orchestration): AF-909 squash lifecycle',
      changedFiles: lifecycleFiles,
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      parentIndex: { tasks: [], archivedTasks: [] },
      taskSheetExists: true,
      receipts: [],
    });
    expect(result).toMatchObject({ pass: false, reason: 'no-active-task' });
  });

  it('父任务已经归档时，passed 回执不能为后续追加写借道', () => {
    const task = lifecycleTask('AF-910');
    const result = evaluateCommitSnapshot({
      subject: 'fix(orchestration): AF-910 post archive write',
      changedFiles: lifecycleFiles,
      currentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      parentIndex: { tasks: [], archivedTasks: [{ ...task, status: 'completed' }] },
      taskSheetExists: true,
      receipts: [passedReceipt],
    });
    expect(result).toMatchObject({ pass: false, reason: 'no-active-task' });
  });
});

describe('AF-056 integrate 保护与 PR 合并门', () => {
  const successfulChecks = () => INTEGRATE_REQUIRED_CONTEXTS.map((name) => ({ name, status: 'completed', conclusion: 'success' }));

  it('保护声明保留 12 项检查并新增 Orchestration Gate，管理员同样受限', () => {
    const payload = buildIntegrateProtection();
    expect(payload.required_status_checks.contexts).toHaveLength(13);
    expect(payload.required_status_checks.contexts[0]).toBe('Orchestration Gate');
    expect(payload.required_status_checks.strict).toBe(true);
    expect(payload.enforce_admins).toBe(true);
    expect(payload.required_linear_history).toBe(true);
    expect(payload.required_pull_request_reviews.required_approving_review_count).toBe(0);
    expect(payload.allow_force_pushes).toBe(false);
    expect(payload.allow_deletions).toBe(false);
  });

  it('保护读回校验识别缺项与管理员绕过风险', () => {
    const actual = {
      required_status_checks: { strict: true, contexts: INTEGRATE_REQUIRED_CONTEXTS },
      enforce_admins: { enabled: true },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_conversation_resolution: { enabled: true },
      required_pull_request_reviews: { required_approving_review_count: 0 },
    };
    expect(verifyIntegrateProtection(actual).pass).toBe(true);
    actual.enforce_admins.enabled = false;
    expect(verifyIntegrateProtection(actual).pass).toBe(false);
    actual.enforce_admins.enabled = true;
    actual.required_status_checks.contexts = actual.required_status_checks.contexts.slice(1);
    expect(verifyIntegrateProtection(actual)).toMatchObject({ pass: false, missing: ['Orchestration Gate'] });
  });

  it('PR 必需检查全部存在且成功才 pass', () => {
    expect(evaluateRequiredChecks(successfulChecks())).toMatchObject({ verdict: 'pass', total: 13, missing: [], failing: [], pending: [] });
  });

  it('缺检查、待完成与 unknown 不放行，失败优先返回 fail', () => {
    expect(evaluateRequiredChecks([]).verdict).toBe('unknown');
    expect(evaluateRequiredChecks(successfulChecks().slice(1))).toMatchObject({ verdict: 'pending', missing: ['Orchestration Gate'] });
    const pending = successfulChecks();
    pending[0].status = 'in_progress';
    pending[0].conclusion = null;
    expect(evaluateRequiredChecks(pending)).toMatchObject({ verdict: 'pending', pending: ['Orchestration Gate'] });
    const failed = successfulChecks();
    failed[2].conclusion = 'failure';
    expect(evaluateRequiredChecks(failed)).toMatchObject({ verdict: 'fail', failing: ['Lint + Typecheck（failure）'] });
  });
});

describe('AF-077 pr-release 本地合并门口径', () => {
  const receiptDir = (root) => join(root, 'docs/worklog/pending/archive');
  const withReceipt = (taskId, payload) => {
    const root = mkdtempSync(join(tmpdir(), 'af077-'));
    mkdirSync(receiptDir(root), { recursive: true });
    writeFileSync(join(receiptDir(root), `${taskId}-receipt-RC-${taskId}-1.json`), JSON.stringify({ payload }));
    return root;
  };

  it('conditional-pass 有已登记 backlog 且无人工复核项时本地合并门放行', () => {
    const root = withReceipt('AF-977', {
      reviewVerdict: 'conditional-pass',
      scopeCheck: 'in-scope',
      finalStatus: 'completed',
      manualReviewList: [],
      backlogItems: [{ id: 'IM-053' }],
    });
    try {
      expect(hasPassedDurableReceipt('AF-977', root)).toMatchObject({ pass: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('conditional-pass 有 manualReviewList 时本地合并门拒绝', () => {
    const root = withReceipt('AF-978', {
      reviewVerdict: 'conditional-pass',
      scopeCheck: 'in-scope',
      finalStatus: 'completed',
      manualReviewList: ['回执字段缺失'],
      backlogItems: [{ id: 'IM-053' }],
    });
    try {
      expect(hasPassedDurableReceipt('AF-978', root)).toMatchObject({ pass: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('AF-059 零依赖任务单 scope 解析', () => {
  it('支持块数组、行内数组与引号标量', () => {
    const block = parseTaskSheetScopeForGate(
      `---\ntaskId: AF-059\ntype: fix\nagentRole: orchestrator\nscope:\n  files:\n    - "scripts/orchestration/ci-task-gate.mjs"\n    - 'docs/worklog/'\n  modules: []\n---\n`,
      'AF-059',
    );
    expect(block.scope.files).toEqual(['scripts/orchestration/ci-task-gate.mjs', 'docs/worklog/']);
    const inline = parseTaskSheetScopeForGate(`---\ntaskId: AF-059\nscope:\n  files: [scripts/a.mjs, "docs/worklog/"]\n---\n`, 'AF-059');
    expect(inline.scope.files).toEqual(['scripts/a.mjs', 'docs/worklog/']);
  });

  it('taskId 不符、scope 缺失或空 files 均 fail closed', () => {
    expect(() => parseTaskSheetScopeForGate(`---\ntaskId: AF-058\nscope:\n  files: [scripts/a.mjs]\n---\n`, 'AF-059')).toThrow(
      'taskId 不匹配',
    );
    expect(() => parseTaskSheetScopeForGate(`---\ntaskId: AF-059\ntype: fix\n---\n`, 'AF-059')).toThrow('scope 缺失');
    expect(() => parseTaskSheetScopeForGate(`---\ntaskId: AF-059\nscope:\n  files: []\n---\n`, 'AF-059')).toThrow('scope.files 为空');
  });
});
