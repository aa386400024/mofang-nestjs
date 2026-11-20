/**
 * AF-161 · worklog 记录包生命周期测试。
 *
 * 覆盖：登记搬移、manifest 哈希、旧指针回退解析、回执幂等入包、
 * 迁移幂等与墓碑、verify 的重复/孤儿/哈希/终态 inbox 检出。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  canonicalTaskSheetPath,
  copyReceiptToBundle,
  ensureTaskRecordBundle,
  migrateWorklog,
  readRecordManifest,
  resolveTaskSheet,
  resolveWorklogArtifact,
  sha256File,
  taskBundleDir,
  verifyWorklog,
} from '../worklog.mjs';

const roots = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'worklog-'));
  roots.push(root);
  mkdirSync(join(root, 'docs', 'worklog', 'inbox'), { recursive: true });
  mkdirSync(join(root, 'docs', 'worklog', 'pending', 'archive'), { recursive: true });
  mkdirSync(join(root, 'docs', 'worklog', 'records'), { recursive: true });
  return root;
}

function task(overrides = {}) {
  return {
    taskId: 'AF-900',
    contextId: 'ctx-test',
    status: 'ready',
    createdAt: '2026-11-20',
    artifacts: { taskSheet: 'docs/worklog/inbox/af900-test-task.md' },
    ...overrides,
  };
}

function writeSheet(root, rel = 'docs/worklog/inbox/af900-test-task.md') {
  const abs = join(root, rel);
  mkdirSync(resolve(abs, '..'), { recursive: true });
  writeFileSync(abs, '---\ntaskId: AF-900\ncontextId: ctx-test\nstatus: ready\n---\n\n# AF-900 测试\n', 'utf8');
  return abs;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('记录包登记', () => {
  it('登记把任务单搬进 records 并写 manifest 哈希', () => {
    const root = makeRoot();
    const t = task();
    const source = writeSheet(root);
    const result = ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source, status: 'submitted' });
    const target = join(taskBundleDir(t, { rootDir: root }), 'task-sheet.md');

    expect(existsSync(source)).toBe(false);
    expect(existsSync(target)).toBe(true);
    expect(result.taskSheetPath).toBe('docs/worklog/records/ctx-test/AF-900/task-sheet.md');
    expect(result.manifest.taskSheet.sha256).toBe(sha256File(target));
    expect(result.manifest.status).toBe('submitted');
    expect(result.manifest.legacyPaths).toEqual(['docs/worklog/inbox/af900-test-task.md']);
  });

  it('登记时把 CRLF 任务单规范为 LF，并同步 manifest 哈希', () => {
    const root = makeRoot();
    const t = task({ taskId: 'AF-902', artifacts: { taskSheet: 'docs/worklog/inbox/af902-crlf-task.md' } });
    const source = join(root, 'docs/worklog/inbox/af902-crlf-task.md');
    writeFileSync(source, '---\r\ntaskId: AF-902\r\ncontextId: ctx-test\r\nstatus: ready\r\n---\r\n\r\n# AF-902 测试\r\n', 'utf8');
    const result = ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    const target = join(taskBundleDir(t, { rootDir: root }), 'task-sheet.md');

    expect(readFileSync(target, 'utf8').includes('\r')).toBe(false);
    expect(result.manifest.taskSheet.sha256).toBe(sha256File(target));
  });

  it('归档投影丢失 contextId 时按 taskId 回退定位 manifest', () => {
    const root = makeRoot();
    const t = task();
    const source = writeSheet(root);
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source, status: 'completed' });
    const archived = {
      taskId: 'AF-900',
      status: 'completed',
      artifacts: { taskSheet: 'docs/worklog/records/ctx-test/AF-900/task-sheet.md' },
    };

    expect(readRecordManifest(archived, { rootDir: root })?.taskId).toBe('AF-900');
  });

  it('JSON 任务单保留 .json 扩展，不伪装成 Markdown', () => {
    const root = makeRoot();
    const t = task({ taskId: 'AF-901', artifacts: { taskSheet: 'docs/worklog/pending/archive/AF-901-task-sheet.json' } });
    const source = writeSheet(root, 'docs/worklog/pending/archive/AF-901-task-sheet.json');
    writeFileSync(source, JSON.stringify({ taskId: 'AF-901', status: 'completed' }), 'utf8');
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    expect(existsSync(canonicalTaskSheetPath(t, { rootDir: root, ext: 'json' }))).toBe(true);
  });

  it('同任务重复 ensure 幂等，不覆盖已登记任务单', () => {
    const root = makeRoot();
    const t = task();
    const source = writeSheet(root);
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    expect(() => ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source })).not.toThrow();
  });

  it('任务单内容 taskId 不匹配时拒绝入包，不误搬别人的任务单', () => {
    const root = makeRoot();
    const t = task({ taskId: 'AF-900' });
    const source = writeSheet(root);
    writeFileSync(source, '---\ntaskId: AF-901\n---\n\n# AF-901 别的任务\n', 'utf8');
    expect(() => ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source })).toThrow(/不匹配/);
    expect(existsSync(source)).toBe(true);
  });

  it('已入包任务单被改写时拒绝覆盖，保留不可变快照', () => {
    const root = makeRoot();
    const t = task();
    const source = writeSheet(root);
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    const canonical = canonicalTaskSheetPath(t, { rootDir: root });
    const rewritten = join(root, 'docs/worklog/inbox/af900-rewritten.md');
    writeFileSync(rewritten, '---\ntaskId: AF-900\n---\n\n# AF-900 改写后的任务单\n', 'utf8');
    expect(() => ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: rewritten })).toThrow(/内容不同/);
    expect(existsSync(canonical)).toBe(true);
  });
});

describe('解析与回执', () => {
  it('索引旧指针失效时从 manifest 回退解析', () => {
    const root = makeRoot();
    const t = task({ artifacts: { taskSheet: 'docs/worklog/pending/af900-old.md' } });
    const source = writeSheet(root);
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });

    const resolved = resolveTaskSheet(t, { rootDir: root });
    expect(resolved.source).toBe('manifest');
    expect(resolved.path.replace(/\\/g, '/')).toContain('docs/worklog/records/ctx-test/AF-900/task-sheet.md');
  });

  it('旧 pending 工件按 basename 回退到记录包 legacy 子目录', () => {
    const root = makeRoot();
    const t = task();
    const source = writeSheet(root);
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    const legacyDir = join(taskBundleDir(t, { rootDir: root }), 'legacy');
    mkdirSync(legacyDir, { recursive: true });
    const artifact = join(legacyDir, 'af900-review.md');
    writeFileSync(artifact, '# AF-900 评审稿\n', 'utf8');
    const manifest = readRecordManifest(t, { rootDir: root });
    manifest.legacyPaths = ['docs/worklog/records/ctx-test/AF-900/legacy/af900-review.md'];
    writeFileSync(join(root, 'docs/worklog/records/ctx-test/AF-900/manifest.json'), JSON.stringify(manifest), 'utf8');

    const resolved = resolveWorklogArtifact(t, 'docs/worklog/pending/af900-review.md', { rootDir: root });
    expect(resolved).toBe('docs/worklog/records/ctx-test/AF-900/legacy/af900-review.md');
  });

  it('回执入包幂等，同 receiptId 同内容不重复', () => {
    const root = makeRoot();
    const t = task();
    const source = writeSheet(root);
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    const receiptFile = join(root, 'receipt.json');
    writeFileSync(receiptFile, JSON.stringify({ receiptId: 'RC-AF-900-1', taskId: 'AF-900', finalStatus: 'completed' }), 'utf8');

    copyReceiptToBundle(t, receiptFile, { receiptId: 'RC-AF-900-1' }, { rootDir: root });
    copyReceiptToBundle(t, receiptFile, { receiptId: 'RC-AF-900-1' }, { rootDir: root });
    const manifest = readRecordManifest(t, { rootDir: root });
    expect(manifest.receipts).toHaveLength(1);
    expect(manifest.receipts[0].path).toContain('receipt-RC-AF-900-1.json');
  });
});

describe('迁移', () => {
  function seedMigration(root) {
    const t = task({ status: 'completed' });
    writeSheet(root, 'docs/worklog/pending/af900-test-task.md');
    t.artifacts = { taskSheet: 'docs/worklog/pending/af900-test-task.md' };
    writeFileSync(
      join(root, 'docs', 'worklog', 'pending', 'archive', 'AF-900-receipt-RC-1.json'),
      JSON.stringify({ payload: { receiptId: 'RC-1', taskId: 'AF-900', finalStatus: 'completed' } }),
      'utf8',
    );
    return { tasks: [], archivedTasks: [t] };
  }

  it('迁移任务单与旧回执，二次执行幂等', () => {
    const root = makeRoot();
    const index = seedMigration(root);

    const first = migrateWorklog(index, { rootDir: root, apply: true });
    expect(first.errors).toEqual([]);
    expect(first.totals.movedSheets).toBe(1);
    expect(first.totals.movedReceipts).toBe(1);
    expect(existsSync(join(root, 'docs', 'worklog', 'pending', 'af900-test-task.md'))).toBe(false);
    expect(existsSync(join(root, 'docs', 'worklog', 'records', 'ctx-test', 'AF-900', 'task-sheet.md'))).toBe(true);
    expect(existsSync(join(root, 'docs', 'worklog', 'records', 'ctx-test', 'AF-900', 'receipt-RC-1.json'))).toBe(true);

    const second = migrateWorklog(index, { rootDir: root, apply: true });
    expect(second.errors).toEqual([]);
    expect(second.totals.movedSheets).toBe(0);
    expect(second.totals.movedReceipts).toBe(0);
  });

  it('指针缺失但旧 archive 有任务单副本时收养，不写墓碑', () => {
    const root = makeRoot();
    const t = task({
      taskId: 'DR-900',
      status: 'completed',
      artifacts: { taskSheet: 'docs/team/agent-orchestration/transport/tasks/DR-900.json' },
    });
    const legacy = join(root, 'docs', 'worklog', 'pending', 'archive', 'DR-900-task-sheet-2026-11-17.json');
    writeFileSync(legacy, JSON.stringify({ taskId: 'DR-900', status: 'completed' }), 'utf8');
    const report = migrateWorklog({ tasks: [], archivedTasks: [t] }, { rootDir: root, apply: true });
    expect(report.errors).toEqual([]);
    expect(report.totals.movedSheets).toBe(1);
    expect(existsSync(join(taskBundleDir(t, { rootDir: root }), 'task-sheet.json'))).toBe(true);
    expect(existsSync(legacy)).toBe(false);
  });

  it('终态任务任务单缺失时写 null 墓碑，不伪造成任务单', () => {
    const root = makeRoot();
    const index = {
      tasks: [],
      archivedTasks: [{ ...task({ taskId: 'AF-902', status: 'canceled' }), artifacts: { taskSheet: 'docs/worklog/pending/missing.md' } }],
    };
    const report = migrateWorklog(index, { rootDir: root, apply: true });
    expect(report.errors).toEqual([]);
    const manifest = readRecordManifest(index.archivedTasks[0], { rootDir: root });
    expect(manifest.taskSheet).toBeNull();
    expect(report.entries[0].note).toBe('task-sheet-missing:tombstone');
  });

  it('指针指向交付记录而非任务单时拒绝搬运', () => {
    const root = makeRoot();
    const delivery = join(root, 'docs', 'worklog', 'completed', 'af900-implementation.md');
    mkdirSync(resolve(delivery, '..'), { recursive: true });
    writeFileSync(delivery, '# AF-900 交付记录\n\n不是任务单。\n', 'utf8');
    const index = {
      tasks: [],
      archivedTasks: [{ ...task({ status: 'completed', artifacts: { taskSheet: 'docs/worklog/completed/af900-implementation.md' } }) }],
    };
    const report = migrateWorklog(index, { rootDir: root, apply: true });
    expect(report.errors[0]).toContain('指针指向非任务单');
    expect(existsSync(delivery)).toBe(true);
  });
});

describe('verify', () => {
  it('哈希篡改判失败', () => {
    const root = makeRoot();
    const t = task();
    const source = writeSheet(root);
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    writeFileSync(join(root, 'docs', 'worklog', 'records', 'ctx-test', 'AF-900', 'task-sheet.md'), 'tampered', 'utf8');
    const result = verifyWorklog({ tasks: [t], archivedTasks: [] }, { rootDir: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('任务单哈希不匹配');
  });

  it('重复 taskId 与孤儿记录包判失败', () => {
    const root = makeRoot();
    const t = task();
    const source = writeSheet(root);
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    mkdirSync(join(root, 'docs', 'worklog', 'records', 'ctx-test', 'AF-999'), { recursive: true });
    writeFileSync(join(root, 'docs', 'worklog', 'records', 'ctx-test', 'AF-999', 'manifest.json'), '{}', 'utf8');
    const result = verifyWorklog({ tasks: [t, { ...t }], archivedTasks: [] }, { rootDir: root });
    expect(result.errors.join('\n')).toContain('重复 taskId');
    expect(result.errors.join('\n')).toContain('孤儿记录包');
  });

  it('终态任务单留在 inbox 判失败', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'docs', 'worklog', 'inbox', 'af901-old-task.md'), '# AF-901\n', 'utf8');
    const result = verifyWorklog({ tasks: [{ ...task({ taskId: 'AF-901', status: 'completed' }) }], archivedTasks: [] }, { rootDir: root });
    expect(result.errors.join('\n')).toContain('终态任务单仍在 inbox');
  });

  it('非终态任务缺任务单判失败，墓碑只允许终态任务', () => {
    const root = makeRoot();
    const t = task({ taskId: 'AF-903', status: 'submitted' });
    const bundle = taskBundleDir(t, { rootDir: root });
    mkdirSync(bundle, { recursive: true });
    writeFileSync(
      join(bundle, 'manifest.json'),
      JSON.stringify({ schemaVersion: 'worklog-record-manifest:1.0.0', taskId: 'AF-903', taskSheet: null, receipts: [] }),
      'utf8',
    );
    const result = verifyWorklog({ tasks: [t], archivedTasks: [] }, { rootDir: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('非终态任务缺任务单');
  });
});
