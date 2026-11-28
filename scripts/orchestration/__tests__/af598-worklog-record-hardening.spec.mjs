/**
 * AF-598 · 记录包生成器跨平台哈希与未合并分支提示加固。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ensureTaskRecordBundle,
  migrateWorklog,
  readRecordManifest,
  sha256TaskSheet,
  sha256Text,
  taskBundleDir,
  verifyWorklog,
} from '../worklog.mjs';

const roots = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'af598-worklog-'));
  roots.push(root);
  mkdirSync(join(root, 'docs', 'worklog', 'inbox'), { recursive: true });
  mkdirSync(join(root, 'docs', 'worklog', 'pending', 'archive'), { recursive: true });
  mkdirSync(join(root, 'docs', 'worklog', 'records'), { recursive: true });
  return root;
}

function task(overrides = {}) {
  return {
    taskId: 'AF-950',
    contextId: 'ctx-hardening',
    status: 'ready',
    createdAt: '2026-11-28',
    artifacts: { taskSheet: 'docs/worklog/inbox/af950-task.md' },
    ...overrides,
  };
}

function lfSheet(taskId = 'AF-950') {
  return `---\ntaskId: ${taskId}\ncontextId: ctx-hardening\nstatus: ready\n---\n\n# ${taskId} 测试\n`;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('任务单哈希规范口径', () => {
  it('LF / CRLF / BOM+CRLF 同内容得到同一哈希', () => {
    const root = makeRoot();
    const lf = join(root, 'lf.md');
    const crlf = join(root, 'crlf.md');
    const bomCrlf = join(root, 'bom-crlf.md');
    writeFileSync(lf, lfSheet(), { encoding: 'utf8' });
    writeFileSync(crlf, lfSheet().replace(/\n/g, '\r\n'), { encoding: 'utf8' });
    writeFileSync(bomCrlf, `\uFEFF${lfSheet().replace(/\n/g, '\r\n')}`, { encoding: 'utf8' });

    expect(sha256TaskSheet(crlf)).toBe(sha256TaskSheet(lf));
    expect(sha256TaskSheet(bomCrlf)).toBe(sha256TaskSheet(lf));
    expect(sha256TaskSheet(lf)).toBe(sha256Text(lfSheet()));
  });
});

describe('登记阶段自动规范化', () => {
  it('BOM+CRLF 任务单入包后为无 BOM + LF，manifest 使用规范哈希', () => {
    const root = makeRoot();
    const t = task();
    const source = join(root, 'docs', 'worklog', 'inbox', 'af950-task.md');
    const raw = `\uFEFF${lfSheet().replace(/\n/g, '\r\n')}`;
    writeFileSync(source, raw, { encoding: 'utf8' });

    const result = ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source, status: 'submitted' });
    const target = join(taskBundleDir(t, { rootDir: root }), 'task-sheet.md');
    const written = readFileSync(target, 'utf8');

    expect(written.startsWith('\uFEFF')).toBe(false);
    expect(written.includes('\r')).toBe(false);
    expect(result.manifest.taskSheet.sha256).toBe(sha256TaskSheet(target));
    expect(result.manifest.taskSheet.sha256).toBe(sha256Text(lfSheet()));
  });
});

describe('迁移阶段自动规范化', () => {
  it('旧 pending 的 BOM+CRLF 任务单迁移后写规范哈希', () => {
    const root = makeRoot();
    const legacy = join(root, 'docs', 'worklog', 'pending', 'af951-task.md');
    writeFileSync(legacy, `\uFEFF${lfSheet('AF-951').replace(/\n/g, '\r\n')}`, { encoding: 'utf8' });
    const t = task({
      taskId: 'AF-951',
      status: 'completed',
      artifacts: {
        taskSheet: 'docs/worklog/pending/af951-task.md',
        deliveryRecord: 'docs/worklog/completed/af951-delivery.md',
      },
    });
    const delivery = join(root, 'docs', 'worklog', 'completed', 'af951-delivery.md');
    mkdirSync(resolve(delivery, '..'), { recursive: true });
    writeFileSync(delivery, '# AF-951 交付记录\n', 'utf8');

    const report = migrateWorklog({ tasks: [], archivedTasks: [t] }, { rootDir: root, apply: true });
    const target = join(taskBundleDir(t, { rootDir: root }), 'task-sheet.md');
    const manifest = readRecordManifest(t, { rootDir: root });

    expect(report.errors).toEqual([]);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8').startsWith('\uFEFF')).toBe(false);
    expect(manifest.taskSheet.sha256).toBe(sha256Text(lfSheet('AF-951')));
  });
});

describe('verify 可行动提示', () => {
  it('缺 manifest 时提示记录包可能滞留在未合并任务分支', () => {
    const root = makeRoot();
    const t = task({ artifacts: { taskSheet: 'docs/worklog/pending/af952-task.md' } });
    const result = verifyWorklog({ tasks: [t], archivedTasks: [] }, { rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('记录包缺 manifest：AF-950');
    expect(result.errors.join('\n')).toContain('未合并任务分支');
  });

  it('哈希不匹配时提示先规范化再 migrate 重算', () => {
    const root = makeRoot();
    const t = task();
    const source = join(root, 'docs', 'worklog', 'inbox', 'af950-task.md');
    writeFileSync(source, lfSheet(), 'utf8');
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    writeFileSync(join(taskBundleDir(t, { rootDir: root }), 'task-sheet.md'), 'tampered', 'utf8');

    const result = verifyWorklog({ tasks: [t], archivedTasks: [] }, { rootDir: root });
    expect(result.errors.join('\n')).toContain('任务单哈希不匹配：AF-950');
    expect(result.errors.join('\n')).toContain('worklog migrate --apply');
  });

  it('manifest 哈希正确但任务单仍是 CRLF 时给出 docs normalize 指引', () => {
    const root = makeRoot();
    const t = task();
    const source = join(root, 'docs', 'worklog', 'inbox', 'af950-task.md');
    writeFileSync(source, lfSheet(), 'utf8');
    ensureTaskRecordBundle(t, { rootDir: root, sourceSheetPath: source });
    const target = join(taskBundleDir(t, { rootDir: root }), 'task-sheet.md');
    writeFileSync(target, lfSheet().replace(/\n/g, '\r\n'), 'utf8');

    const result = verifyWorklog({ tasks: [t], archivedTasks: [] }, { rootDir: root });
    expect(result.errors.join('\n')).toContain('任务单未规范化：AF-950');
    expect(result.errors.join('\n')).toContain('docs normalize --path');
  });

  it('记录包在未合并分支时点名具体分支', () => {
    const root = makeRoot();
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
    git('init', '-b', 'main');
    git('config', 'user.email', 'af598@example.com');
    git('config', 'user.name', 'AF-598');
    writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
    git('add', '.');
    git('commit', '-m', 'init');

    const branch = 'task/AF-953-record-branch';
    const sheetRef = 'docs/worklog/pending/af953-task.md';
    git('checkout', '-b', branch);
    mkdirSync(resolve(root, sheetRef, '..'), { recursive: true });
    writeFileSync(join(root, sheetRef), lfSheet('AF-953'), 'utf8');
    git('add', '.');
    git('commit', '-m', 'task sheet on unmerged branch');
    git('checkout', 'main');
    rmSync(join(root, sheetRef), { force: true });

    const t = task({ taskId: 'AF-953', artifacts: { taskSheet: sheetRef } });
    const result = verifyWorklog({ tasks: [t], archivedTasks: [] }, { rootDir: root });
    expect(result.errors.join('\n')).toContain(`记录包只存在于未合并分支：${branch}`);
  });
});
