/**
 * L2 编排工具链单元测试（纯函数 / 纯计算路径，不读写仓内索引与配置文件）。
 * 覆盖：配置校验、状态迁移合法性、自治守门、快照计数与人工复核回填、验收 rejected 结论。
 */
import { describe, expect, it } from 'vitest';

import { validateConfig } from '../state-store.mjs';
import { canTransition, shouldAdvance, buildSnapshot } from '../scheduler.mjs';
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
  });
});
