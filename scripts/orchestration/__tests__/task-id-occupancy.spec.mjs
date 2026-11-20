/**
 * AF-213 · 任务编号三源占用检查护栏。
 *
 * 覆盖：分支名解析、下一个可用号、records 目录扫描、三源合并、冲突断言与离线降级。
 * 全部用临时目录 + fake runGit，不碰真实仓库、不触网。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertTaskIdAvailable, collectOccupiedTaskIds, nextTaskId, recordDirIds, remoteTaskBranchIds } from '../task-id-occupancy.mjs';

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orch-id-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seedLocalIndex(tasks) {
  const dir = join(root, 'docs', 'team', 'agent-orchestration');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task-state-index.json'), JSON.stringify({ tasks, archivedTasks: [] }), 'utf8');
}

function seedRecords(context, taskId) {
  mkdirSync(join(root, 'docs', 'worklog', 'records', context, taskId), { recursive: true });
}

describe('task-id-occupancy', () => {
  it('从 ls-remote 文本解析任务分支编号，忽略非任务分支', () => {
    const text = [
      'aaa\trefs/heads/task/AF-211-realism-r4',
      'bbb\trefs/heads/integrate',
      'ccc\trefs/heads/task/AF-300-orchestration-hardening',
    ].join('\n');
    expect(remoteTaskBranchIds(text)).toEqual(['AF-211', 'AF-300']);
  });

  it('下一个可用编号取同前缀最大号 +1', () => {
    expect(nextTaskId(['AF-209', 'AF-212', 'TD-9'])).toBe('AF-213');
    expect(nextTaskId([], 'AF')).toBe('AF-1');
  });

  it('records 目录扫描只认 <context>/<AF-NNN> 结构', () => {
    seedRecords('phase2.5-provider-fallback', 'AF-210');
    seedRecords('phase3-orchestration-hardening', 'AF-213');
    mkdirSync(join(root, 'docs', 'worklog', 'records', 'loose'), { recursive: true });
    expect(recordDirIds(root).sort()).toEqual(['AF-210', 'AF-213']);
  });

  it('三源合并：本地索引 + records + 远端分支 + 远端索引', () => {
    seedLocalIndex([{ taskId: 'AF-100' }]);
    seedRecords('ctx', 'AF-101');
    const runGit = (args, opts = {}) => {
      if (args[0] === 'ls-remote') return 'x\trefs/heads/task/AF-102-realism';
      if (args[0] === 'show') return JSON.stringify({ tasks: [{ taskId: 'AF-103' }], archivedTasks: [] });
      if (opts.allowFailure) return null;
      throw new Error(`unexpected ${args.join(' ')}`);
    };
    const occupancy = collectOccupiedTaskIds({ rootDir: root, runGit });
    expect([...occupancy.ids].sort()).toEqual(['AF-100', 'AF-101', 'AF-102', 'AF-103']);
    expect(occupancy.warnings).toEqual([]);
    expect(nextTaskId(occupancy.ids)).toBe('AF-104');
  });

  it('编号被远端分支占用时拒绝登记并给出下一个可用号', () => {
    seedLocalIndex([]);
    const runGit = (args, opts = {}) => {
      if (args[0] === 'ls-remote') return 'x\trefs/heads/task/AF-102-realism';
      if (args[0] === 'show') return JSON.stringify({ tasks: [], archivedTasks: [] });
      if (opts.allowFailure) return null;
      throw new Error('unexpected');
    };
    const occupancy = collectOccupiedTaskIds({ rootDir: root, runGit });
    expect(() => assertTaskIdAvailable('AF-102', { occupancy })).toThrow(/AF-103/);
    expect(() => assertTaskIdAvailable('AF-102', { occupancy })).toThrow(/remoteBranches/);
  });

  it('远端不可达时只告警不阻塞，仍按本地口径给出编号', () => {
    seedLocalIndex([{ taskId: 'AF-100' }]);
    const runGit = (_args, opts = {}) => {
      if (opts.allowFailure) return null;
      throw new Error('offline');
    };
    const occupancy = collectOccupiedTaskIds({ rootDir: root, runGit });
    expect(occupancy.warnings.length).toBe(2);
    expect(nextTaskId(occupancy.ids)).toBe('AF-101');
    expect(assertTaskIdAvailable('AF-101', { occupancy }).ok).toBe(true);
  });
});
