/**
 * L2 编排工具链单元测试（纯函数 / 纯计算路径，不读写仓内索引与配置文件）。
 * 覆盖：配置校验、状态迁移合法性、自治守门、快照计数与人工复核回填、验收 rejected 结论。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { validateConfig, PATHS, REPO_ROOT, loadIndex } from '../state-store.mjs';
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
  REVIEW_CONTRACT_REF,
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
  canTransition,
  shouldAdvance,
  buildSnapshot,
  claimReadyTasks,
  processReceipts,
  releaseExpiredLeases,
} from '../scheduler.mjs';
import { generateDeliveryPack } from '../delivery-pack.mjs';
import {
  deriveEvents,
  eventTypeForTransition,
  hashEvent,
  journalIntegrity,
  loadArchivedNotes,
  loadJournal,
  projectJournal,
} from '../event-store.mjs';
import { dispatchTask, buildDispatchRecord, receiptFingerprint, isReceiptProcessed, markReceiptProcessed } from '../dispatch.mjs';
import { parseTaskSheetFrontmatter, buildTaskRecord } from '../task-intake.mjs';
import { ingestReceipts } from '../receipts.mjs';
import { normalizeScope, findScopeConflicts, detectResidualFiles, scopeCovers } from '../scope-mutex.mjs';
import {
  buildBranchName,
  validateBranchName,
  classifyBranches,
  planCleanup,
  verifyBaseline,
  branchAgeDays,
  collectChangedFiles,
  LONG_LIVED_BRANCHES,
} from '../branch-workflow.mjs';
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
  nextBackoff,
  CIRCUIT_BREAKER_RESERVED,
  DEAD_LETTER_RESERVED,
  nextSessionPath,
  nextLocateLayer,
  canDispatch,
  resolveDispatchDecision,
  buildDispatchAudit,
  summarizeChannelOutcomes,
  buildEscalationMessage,
} from '../dispatch-channel.mjs';
import { runAcceptance } from '../acceptance-runner.mjs';
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
    expect(ARCHIVE_STATUSES).toEqual(['completed', 'rejected', 'canceled']);
    for (const status of ['rejected', 'canceled']) {
      const ix = buildIndex();
      ix.tasks.find((task) => task.taskId === 'AF-005').status = status;
      expect(archiveTaskEntry(ix, 'AF-005').status).toBe(status);
    }
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
      expect(index.tasks[0].artifacts.receipt).toMatch(/AF-009-receipt-AF-009-R1\.json$/);
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
    expect(actions.some((a) => a.type === 'held-for-human')).toBe(true);
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
    expect(CIRCUIT_BREAKER_RESERVED.reserved).toBe(true);
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
