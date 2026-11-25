/**
 * AF-498 · 编排根因修复回归。
 *
 * 覆盖四类曾导致「代码已完成却反复换号 / 重建分支」的缺陷：
 *   1. 状态锚点：分支切换后旧索引不能覆盖新状态；
 *   2. check 去重：同名 check 只认最新 run，旧 failure 不累计；
 *   3. 提交号识别：`RC-2` 等回执编号不当成任务号；
 *   4. 缺回执任务：submitted 不得被自动打成 rejected。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureStateAnchor, stateAnchorDir, ANCHORED_FILES } from '../state-anchor.mjs';
import { evaluateRequiredChecks } from '../pr-release.mjs';
import { extractCommitTaskId, resolveCommitTaskId } from '../ci-task-gate.mjs';
import { processReceipts } from '../scheduler.mjs';

const tempDirs = [];

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('AF-498 状态锚点', () => {
  it('分支把索引回退到旧基线时，启动恢复锚点而不是接受旧索引', () => {
    const repo = tempDir('af498-repo-');
    const anchorHome = tempDir('af498-anchor-');
    const previousHome = process.env.ORCH_STATE_HOME;
    process.env.ORCH_STATE_HOME = anchorHome;
    process.env.ORCH_STATE_ANCHOR = 'on';
    try {
      const rel = ANCHORED_FILES[0];
      mkdirSync(join(anchorHome), { recursive: true });
      // 首次启动：把当前仓库状态播种到锚点。
      const repoIndex = join(repo, rel);
      mkdirSync(join(repo, 'docs', 'team', 'agent-orchestration'), { recursive: true });
      writeFileSync(repoIndex, JSON.stringify({ tasks: ['new-state'] }), 'utf8');
      const seeded = ensureStateAnchor({ repoRoot: repo });
      expect(seeded.seeded).toBe(true);
      // 模拟 git switch 到旧分支：仓库索引退回旧基线。
      writeFileSync(repoIndex, JSON.stringify({ tasks: ['old-state'] }), 'utf8');
      const restored = ensureStateAnchor({ repoRoot: repo });
      expect(restored.restored).toBe(true);
      expect(JSON.parse(readFileSync(repoIndex, 'utf8')).tasks).toEqual(['new-state']);
      expect(stateAnchorDir(repo)).toBe(anchorHome);
    } finally {
      if (previousHome === undefined) delete process.env.ORCH_STATE_HOME;
      else process.env.ORCH_STATE_HOME = previousHome;
    }
  });
});

describe('AF-498 远端检查去重', () => {
  it('同名 check 只认最新一条，旧 failure / cancelled 不累计', () => {
    const required = ['unit'];
    const runs = [
      { name: 'unit', status: 'completed', conclusion: 'failure', started_at: '2026-11-24T10:00:00Z' },
      { name: 'unit', status: 'completed', conclusion: 'success', started_at: '2026-11-24T10:05:00Z' },
      { name: 'unit', status: 'completed', conclusion: 'cancelled', started_at: '2026-11-24T10:01:00Z' },
    ];
    expect(evaluateRequiredChecks(runs, required).verdict).toBe('pass');
  });
});

describe('AF-498 提交任务号识别', () => {
  it('回执编号 RC-2 不参与任务号识别', () => {
    expect(extractCommitTaskId('fix(AF-497): 缓存接线并补 RC-2 回执')).toBe('AF-497');
    expect(resolveCommitTaskId({ message: 'chore: 同步 RC-2 回执\n\nTask: none', subject: 'chore: 同步 RC-2 回执' })).toEqual({
      taskId: null,
      source: 'trailer',
      none: true,
    });
  });
});

describe('AF-498 缺回执不拒绝', () => {
  it('submitted + 交付记录但无机读回执时保持 submitted，等待回执', () => {
    const receipts = tempDir('af498-receipts-');
    const index = {
      tasks: [
        {
          taskId: 'AF-498',
          status: 'submitted',
          type: 'fix',
          contextId: 'phase2.5-orchestration-closed-loop',
          scope: { files: ['scripts/orchestration/'] },
          artifacts: { taskSheet: 'x.md', deliveryRecord: 'y.md' },
          history: [],
        },
      ],
      archivedTasks: [],
    };
    const runtime = { tasks: {} };
    const actions = [];
    processReceipts(index, runtime, { reworkLimit: 2, maxConcurrentTasks: 1 }, actions, { receiptsDir: receipts });
    expect(index.tasks[0].status).toBe('submitted');
    expect(actions.some((action) => action.type === 'receipt-missing')).toBe(true);
  });
});
