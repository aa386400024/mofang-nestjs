/**
 * L2 编排工具链单元测试（纯函数 / 纯计算路径，不读写仓内索引与配置文件）。
 * 覆盖：配置校验、状态迁移合法性、自治守门、快照计数与人工复核回填、验收 rejected 结论。
 */
import { describe, expect, it } from 'vitest';

import { validateConfig } from '../state-store.mjs';
import { canTransition, shouldAdvance, buildSnapshot } from '../scheduler.mjs';
import { runAcceptance } from '../acceptance-runner.mjs';

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
