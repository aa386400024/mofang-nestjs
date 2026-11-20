/**
 * AF-213 · 归档前置（实现必须已提交）护栏。
 *
 * 只测纯函数约定：未注入探测 → 不阻断（向后兼容）；注入结果做去重与空值清洗；
 * 状态面生成物必须被剔除，否则 run-once 本轮自写的索引/事件会永远阻断自己的归档。
 * 真实 git 语义由 createGitPort().uncommittedWithin 承担，CLI 侧已接入。
 */
import { describe, expect, it } from 'vitest';
import { archiveUncommittedFiles } from '../scheduler.mjs';
import { excludeStatePlane } from '../task-entry-gate.mjs';

describe('archive-guard', () => {
  it('未注入探测函数时返回空清单（既有调用方行为不变）', () => {
    expect(archiveUncommittedFiles({ taskId: 'AF-999' })).toEqual([]);
    expect(archiveUncommittedFiles({ taskId: 'AF-999' }, null)).toEqual([]);
  });

  it('注入结果去重并清洗空值与空白', () => {
    const files = archiveUncommittedFiles({ taskId: 'AF-999' }, () => ['src/a.ts', 'src/a.ts', '', '  ', 'test/b.spec.ts']);
    expect(files).toEqual(['src/a.ts', 'test/b.spec.ts']);
  });

  it('探测函数返回非数组时按空清单处理，不因脏数据阻断归档', () => {
    expect(archiveUncommittedFiles({}, () => undefined)).toEqual([]);
    expect(archiveUncommittedFiles({}, () => 'src/a.ts')).toEqual([]);
  });

  it('探测函数返回真实未提交清单时保留全部条目（调用方据此阻断归档）', () => {
    expect(archiveUncommittedFiles({}, () => ['scripts/orchestration/cli.mjs'])).toEqual(['scripts/orchestration/cli.mjs']);
  });

  it('剔除状态面生成物：索引 / 事件 / 快照 / records 不计为实现未提交', () => {
    const files = [
      'scripts/orchestration/cli.mjs',
      'docs/team/agent-orchestration/task-state-index.json',
      'docs/team/agent-orchestration/orchestration-snapshot.json',
      'docs/team/agent-orchestration/state/journal.jsonl',
      'docs/worklog/records/phase3-orchestration-hardening/AF-213/receipt-RC-AF-213-1.json',
      'web/orchestration/data.js',
    ];
    expect(excludeStatePlane(files)).toEqual(['scripts/orchestration/cli.mjs']);
    expect(excludeStatePlane(undefined)).toEqual([]);
  });
});
