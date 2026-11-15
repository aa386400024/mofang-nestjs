/**
 * L2 编排工具链单元测试（纯函数 / 纯计算路径，不读写仓内索引与配置文件）。
 * 覆盖：配置校验、状态迁移合法性、自治守门、快照计数与人工复核回填、验收 rejected 结论。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { validateConfig, PATHS } from '../state-store.mjs';
import { validateAgentCard, validateTaskIndex, validateTaskSheet, validateToolManifest } from '../validator.mjs';
import { buildRegistry, call as registryCall } from '../tool-registry.mjs';
import { listAudits, recordAudit, summarizeAudits } from '../audit-log.mjs';
import { createStore } from '../store-port.mjs';
import { dedupeEvents } from '../file-watcher.mjs';
import { buildProtocolView, mapCapabilityDeclaration, mapStatus, mapTask } from '../protocol-mapper.mjs';
import { createFileTransport, createTransport } from '../transport.mjs';
import {
  validateTaskHandover,
  validateReceiptHandover,
  validateReviewHandover,
  buildTaskHandover,
  HANDOVER_SCHEMA_VERSION,
} from '../handover-contract.mjs';
import { ARCHIVE_STATUSES, archiveTaskEntry, canTransition, shouldAdvance, buildSnapshot } from '../scheduler.mjs';
import { runAcceptance } from '../acceptance-runner.mjs';
import {
  addCandidate,
  canTransitionImprovement,
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
      },
    },
  };

  it('按状态计数', () => {
    const snapshot = buildSnapshot(index, runtimeState, config);
    expect(snapshot.counts.backlog).toBe(1);
    expect(snapshot.counts.submitted).toBe(1);
    expect(snapshot.tasks).toHaveLength(2);
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
          status: 'backlog',
          artifacts: { taskSheet: 'docs/team/af-005.md' },
        },
        { taskId: 'AF-006', contextId: 'framework-evolution', type: 'implementation', title: '验收单', status: 'submitted', artifacts: {} },
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
    expect(() => archiveTaskEntry(index, 'AF-005', { status: 'working' })).toThrow(/终态非法/);
    expect(ARCHIVE_STATUSES).toEqual(['completed', 'rejected', 'canceled']);
    for (const status of ['rejected', 'canceled']) {
      const ix = buildIndex();
      expect(archiveTaskEntry(ix, 'AF-005', { status }).status).toBe(status);
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

  it('仓内现有工具契约清单通过 schema 校验', async () => {
    const manifest = readJsonFile(PATHS.toolsContractFile);
    const res = await validateToolManifest(manifest);
    assertNotFailed(res);
  });

  it('仓内现有 Agent Card 通过 schema 校验', async () => {
    const card = readJsonFile(join(PATHS.agentCardsDir, 'orchestrator.json'));
    const res = await validateAgentCard(card);
    assertNotFailed(res);
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
  it('状态映射：前置态 / 活跃态 / 终态归类正确', () => {
    expect(mapStatus('backlog')).toMatchObject({ protocol: 'DRAFT', stage: 'prelude' });
    expect(mapStatus('ready')).toMatchObject({ protocol: 'QUEUED', stage: 'prelude' });
    expect(mapStatus('working')).toMatchObject({ protocol: 'WORKING', stage: 'active' });
    expect(mapStatus('completed')).toMatchObject({ protocol: 'COMPLETED', stage: 'terminal' });
    expect(mapStatus('unknown-x')).toMatchObject({ protocol: 'UNKNOWN', stage: 'unknown' });
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
    expect(task.status.protocol).toBe('QUEUED');
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

  it('协议视图聚合任务 / 工件 / 归组 / 能力声明，归档任务带 archived 标记', () => {
    const view = buildProtocolView({
      tasks: [{ taskId: 'T-1', contextId: 'g', status: 'working', artifacts: { doc: 'docs/a.md' } }],
      archivedTasks: [{ taskId: 'T-0', status: 'completed', artifacts: {} }],
      agentCards: [{ agentId: 'orc', role: 'orchestrator', availability: 'available' }],
    });
    expect(view.tasks).toHaveLength(2);
    expect(view.artifacts).toEqual([{ taskId: 'T-1', kind: 'doc', ref: 'docs/a.md' }]);
    expect(view.groupIds).toEqual(['g']);
    expect(view.groupId).toBe('g');
    expect(view.capabilityDeclarations).toHaveLength(1);
    expect(view.tasks.find((t) => t.taskId === 'T-0').archived).toBe(true);
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
    createdAt: '2026-11-16',
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
      changedFiles: [{ path: 'scripts/orchestration/transport.mjs', kind: 'modified' }],
      artifactRefs: [{ path: 'docs/worklog/completed/af009.md', kind: 'document' }],
      gateResults: [{ command: 'pnpm exec vitest run', exitCode: 0, errors: 0, warnings: 0, tests: 56 }],
      reproNotes: '定向运行编排层 spec',
      scopeCheck: true,
      parallelArtifactsExcluded: true,
      noOutscopeRefactor: true,
      contractChecks: [{ field: 'taskId', aligned: true }],
      schemaVersion: HANDOVER_SCHEMA_VERSION,
      fieldAlignment: { taskId: 'matched' },
      backlogItems: [],
      openQuestions: [],
      manualReviewList: [],
      deviationTable: '无',
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

  it('合法任务交接件通过校验；构造器补契约版本与追溯字段', () => {
    expect(validateTaskHandover(validTask)).toMatchObject({ valid: true, errors: [] });
    const built = buildTaskHandover(validTask);
    expect(built.handoverKind).toBe('task');
    expect(built.schemaVersion).toBe(HANDOVER_SCHEMA_VERSION);
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
