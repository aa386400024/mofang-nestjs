/**
 * AF-221 批次子项 04 · CI 逐提交门的两阶段提交入场。
 *
 * 只测纯函数约定：实现提交（提交内新增 records 任务单、索引尚无该任务）能否入场、
 * 入场后 scope 是否仍被严格校验、受限条件缺项时是否退回原有判定。
 * 真实 git 取证由 CLI `--base 01c3ce8 --head 82e19c7` 承担（见交付记录）。
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalTaskId,
  deriveImplementationTaskFromCommitSheet,
  evaluateCommitSnapshot,
  extractCommitTaskId,
  parseTaskSheetArtifactPathsForGate,
} from '../ci-task-gate.mjs';

const SHEET = `---
taskId: AF-900
contextId: demo-context
title: 演示任务
type: fix
status: backlog
baselineRef: abc1234
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/demo/af900-demo-2026-11-21.md
    kind: report
gates:
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
---

正文。
`;

const SHEET_PATH = 'docs/worklog/records/demo-context/AF-900/task-sheet.md';
const EMPTY_INDEX = { tasks: [], archivedTasks: [] };

describe('ci-task-gate · 实现提交入场', () => {
  it('提交内带任务单、索引尚无该任务时可入场，并带上声明的工件', () => {
    const derived = deriveImplementationTaskFromCommitSheet({
      commitTaskId: 'AF-900',
      changedFiles: [SHEET_PATH, 'scripts/orchestration/foo.mjs'],
      currentIndex: EMPTY_INDEX,
      parentIndex: EMPTY_INDEX,
      sheetText: SHEET,
    });
    expect(derived.reason).toBe('impl-entry-from-commit-sheet');
    expect(derived.task.status).toBe('submitted');
    expect(derived.task.artifacts.taskSheet).toBe(SHEET_PATH);
    expect(derived.task.plannedArtifacts).toEqual([{ path: 'docs/worklog/completed/demo/af900-demo-2026-11-21.md' }]);
    expect(derived.task.scope.files).toEqual(['scripts/orchestration/']);
  });

  it('任务单不在提交内时不予入场（no-active-task 不被放宽）', () => {
    const derived = deriveImplementationTaskFromCommitSheet({
      commitTaskId: 'AF-900',
      changedFiles: ['scripts/orchestration/foo.mjs'],
      currentIndex: EMPTY_INDEX,
      parentIndex: EMPTY_INDEX,
      sheetText: SHEET,
    });
    expect(derived.task).toBeNull();
    expect(derived.reason).toBe('sheet-not-in-commit');
  });

  it('任务单 taskId 与标题不一致时不予入场', () => {
    const derived = deriveImplementationTaskFromCommitSheet({
      commitTaskId: 'AF-901',
      changedFiles: ['docs/worklog/records/demo-context/AF-901/task-sheet.md'],
      currentIndex: EMPTY_INDEX,
      parentIndex: EMPTY_INDEX,
      sheetText: SHEET,
    });
    expect(derived.task).toBeNull();
    expect(derived.reason).toBe('sheet-unparsable');
  });

  it('索引或父索引已有该任务时不重复入场（走原有判定）', () => {
    const derived = deriveImplementationTaskFromCommitSheet({
      commitTaskId: 'AF-900',
      changedFiles: [SHEET_PATH],
      currentIndex: { tasks: [{ taskId: 'AF-900', status: 'submitted' }], archivedTasks: [] },
      parentIndex: EMPTY_INDEX,
      sheetText: SHEET,
    });
    expect(derived.task).toBeNull();
    expect(derived.reason).toBe('task-known');
  });

  it('入场后越界文件仍被判红，交付记录按声明工件豁免', () => {
    const derived = deriveImplementationTaskFromCommitSheet({
      commitTaskId: 'AF-900',
      changedFiles: [SHEET_PATH, 'scripts/orchestration/foo.mjs', 'docs/worklog/completed/demo/af900-demo-2026-11-21.md'],
      currentIndex: EMPTY_INDEX,
      parentIndex: EMPTY_INDEX,
      sheetText: SHEET,
    });
    const inScope = evaluateCommitSnapshot({
      subject: 'fix(AF-900): 演示',
      changedFiles: [SHEET_PATH, 'scripts/orchestration/foo.mjs', 'docs/worklog/completed/demo/af900-demo-2026-11-21.md'],
      currentIndex: { tasks: [derived.task], archivedTasks: [] },
      parentIndex: EMPTY_INDEX,
      taskSheetExists: true,
      taskSheetPath: SHEET_PATH,
    });
    expect(inScope.pass).toBe(true);

    const outOfScope = evaluateCommitSnapshot({
      subject: 'fix(AF-900): 演示',
      changedFiles: [SHEET_PATH, 'src/engine-core/foo.ts'],
      currentIndex: { tasks: [derived.task], archivedTasks: [] },
      parentIndex: EMPTY_INDEX,
      taskSheetExists: true,
      taskSheetPath: SHEET_PATH,
    });
    expect(outOfScope.pass).toBe(false);
    expect(outOfScope.reason).toBe('scope-residual');
  });

  it('无任务单且索引为空时维持 no-active-task', () => {
    const result = evaluateCommitSnapshot({
      subject: 'chore: 无单提交',
      changedFiles: ['scripts/orchestration/foo.mjs'],
      currentIndex: EMPTY_INDEX,
      parentIndex: EMPTY_INDEX,
      taskSheetExists: undefined,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('no-active-task');
  });
});

describe('ci-task-gate · 标题任务编号解析', () => {
  it('大小写不敏感并归一为 PREFIX-NNN', () => {
    expect(extractCommitTaskId('docs(af221): 补注释')).toBe('AF-221');
    expect(extractCommitTaskId('feat(AF-221): 硬化')).toBe('AF-221');
    expect(canonicalTaskId('af221')).toBe('AF-221');
    expect(canonicalTaskId('AF-221')).toBe('AF-221');
  });

  it('scope 段优先，技术串不被误识别为任务编号', () => {
    expect(extractCommitTaskId('fix(utf-8): 编码')).toBeNull();
    expect(extractCommitTaskId('chore(orchestration): 状态面（索引 227）')).toBeNull();
    expect(canonicalTaskId('utf-8')).toBeNull();
  });

  it('多编号拒绝', () => {
    expect(() => extractCommitTaskId('feat(AF-201 AF-202): 双向')).toThrow(/多个任务编号/);
  });

  it('任务单 artifacts 路径可被解析，缺失时返回空数组', () => {
    expect(parseTaskSheetArtifactPathsForGate(SHEET)).toEqual(['docs/worklog/completed/demo/af900-demo-2026-11-21.md']);
    expect(parseTaskSheetArtifactPathsForGate('没有 frontmatter')).toEqual([]);
  });
});
