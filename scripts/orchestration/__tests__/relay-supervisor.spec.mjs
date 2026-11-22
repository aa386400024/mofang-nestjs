/**
 * AF-069 · Relay Supervisor 定向单测。
 * 覆盖：档位计划、文件稳定判定、命中归档/通知、空文件、超时、崩溃恢复、账本读写。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_RELAY_PROFILE,
  RELAY_FILE_PATTERN,
  ackRelayJob,
  buildRelayJob,
  emptyRelayState,
  inspectRelayFile,
  isRelayJobDue,
  listRelayNotifications,
  processRelayJob,
  readRelayState,
  runRegisteredRelayJobs,
  runRelayTick,
  saveRelayState,
} from '../relay-supervisor.mjs';

const NOW = new Date('2026-11-18T00:20:00.000Z');
const fixtures = [];

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'af069-relay-'));
  const pendingDir = join(root, 'pending');
  const archiveDir = join(root, 'archive');
  const notificationDir = join(root, 'notifications');
  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(notificationDir, { recursive: true });
  const stateFile = join(root, 'relay-jobs.json');
  const auditFile = join(root, 'relay-audit.jsonl');
  const fixture = { root, pendingDir, archiveDir, notificationDir, stateFile, auditFile };
  fixtures.push(fixture);
  return fixture;
}

function relayFile(fixture, taskId = 'AF-069', suffix = '20261118-0100') {
  return join(fixture.pendingDir, `relay-response-${taskId}-${suffix}.md`);
}

function seedJob(fixture, { taskId = 'AF-069', profile = 'S', createdAt = '2026-11-18T00:00:00.000Z', deadline = null } = {}) {
  const job = buildRelayJob({
    taskId,
    file: relayFile(fixture, taskId),
    profile,
    now: new Date(createdAt),
    deadline,
    pendingDir: fixture.pendingDir,
  });
  const state = emptyRelayState();
  state.jobs.push(job);
  saveRelayState(fixture.stateFile, state);
  return job;
}

afterEach(() => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    try {
      rmSync(fixture.root, { recursive: true, force: true });
    } catch {
      // Windows 上被句柄短暂占用时留给系统清理。
    }
  }
});

describe('relay profile plan', () => {
  it('S 档按 10/10/15 分钟排程，deadline 45 分钟', () => {
    const fixture = makeFixture();
    const job = buildRelayJob({
      taskId: 'AF-069',
      file: relayFile(fixture),
      profile: 'S',
      now: new Date('2026-11-18T00:00:00.000Z'),
      pendingDir: fixture.pendingDir,
    });
    expect(job.profile).toBe('S');
    expect(job.nextCheckAt).toBe('2026-11-18T00:10:00.000Z');
    expect(job.deadlineAt).toBe('2026-11-18T00:45:00.000Z');
  });

  it('默认档为 M，且 M 的 deadline 为 90 分钟', () => {
    const fixture = makeFixture();
    const job = buildRelayJob({
      taskId: 'AF-069',
      file: relayFile(fixture),
      now: new Date('2026-11-18T00:00:00.000Z'),
      pendingDir: fixture.pendingDir,
    });
    expect(job.profile).toBe(DEFAULT_RELAY_PROFILE);
    expect(job.deadlineAt).toBe('2026-11-18T01:30:00.000Z');
  });

  it('拒绝非法 taskId、文件名与越界路径', () => {
    const fixture = makeFixture();
    expect(() => buildRelayJob({ taskId: 'AF 069', file: relayFile(fixture), pendingDir: fixture.pendingDir })).toThrow(/任务号/);
    expect(() => buildRelayJob({ taskId: 'AF-069', file: join(fixture.pendingDir, 'reply.md'), pendingDir: fixture.pendingDir })).toThrow(
      /文件名/,
    );
    expect(() =>
      buildRelayJob({ taskId: 'AF-069', file: join(fixture.root, 'relay-response-AF-069-x.md'), pendingDir: fixture.pendingDir }),
    ).toThrow(/必须位于/);
  });

  it('文件名模式只接受 relay-response-*.md', () => {
    expect(RELAY_FILE_PATTERN.test('relay-response-AF-069-20261118-0100.md')).toBe(true);
    expect(RELAY_FILE_PATTERN.test('reply-AF-069.md')).toBe(false);
  });
});

describe('relay file inspection', () => {
  it('不存在 / 空文件 / 稳定文件三种判定', () => {
    const fixture = makeFixture();
    const job = seedJob(fixture);
    expect(inspectRelayFile(job, { pendingDir: fixture.pendingDir, now: NOW }).kind).toBe('missing');

    const emptyPath = join(fixture.pendingDir, job.fileName);
    writeFileSync(emptyPath, '', 'utf8');
    expect(inspectRelayFile(job, { pendingDir: fixture.pendingDir, now: NOW }).kind).toBe('empty');

    writeFileSync(emptyPath, 'reply body', 'utf8');
    utimesSync(emptyPath, NOW, new Date(NOW.getTime() - 5000));
    expect(inspectRelayFile(job, { pendingDir: fixture.pendingDir, now: NOW }).kind).toBe('ready');
  });

  it('刚写入的文件先判定 settling，不抢读半截内容', () => {
    const fixture = makeFixture();
    const job = seedJob(fixture);
    const path = join(fixture.pendingDir, job.fileName);
    writeFileSync(path, 'reply body', 'utf8');
    utimesSync(path, NOW, new Date(NOW.getTime() - 500));
    const result = inspectRelayFile(job, { pendingDir: fixture.pendingDir, now: NOW, settleMs: 2500 });
    expect(result.kind).toBe('settling');
    expect(result.size).toBeGreaterThan(0);
  });
});

describe('relay tick / archive / notification', () => {
  it('到期命中：归档并生成通知，job 置 notified', () => {
    const fixture = makeFixture();
    const job = seedJob(fixture);
    const path = join(fixture.pendingDir, job.fileName);
    writeFileSync(path, 'AF-069 reply body', 'utf8');
    utimesSync(path, NOW, new Date(NOW.getTime() - 5000));

    expect(isRelayJobDue(readRelayState(fixture.stateFile).jobs[0], NOW)).toBe(true);

    const summary = runRelayTick({
      stateFile: fixture.stateFile,
      now: NOW,
      pendingDir: fixture.pendingDir,
      archiveDir: fixture.archiveDir,
      notificationDir: fixture.notificationDir,
      auditFile: fixture.auditFile,
    });
    expect(summary.checked).toBe(1);
    expect(summary.notified).toBe(1);
    expect(summary.timeouts).toBe(0);

    const persisted = readRelayState(fixture.stateFile).jobs[0];
    expect(persisted.state).toBe('notified');
    expect(persisted.nextCheckAt).toBeNull();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(fixture.archiveDir, job.fileName))).toBe(true);

    const notifications = listRelayNotifications({ notificationDir: fixture.notificationDir });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].taskId).toBe('AF-069');
    expect(notifications[0].state).toBe('unread');
    expect(notifications[0].size).toBe(17);
    expect(existsSync(join(fixture.notificationDir, 'AF-069.md'))).toBe(true);
  });

  it('通知已存在但账本未写时，重启可恢复为 notified', () => {
    const fixture = makeFixture();
    const job = seedJob(fixture);
    // 先制造「通知已写、账本仍 pending」的崩溃现场。
    const path = join(fixture.pendingDir, job.fileName);
    writeFileSync(path, 'recovered body', 'utf8');
    utimesSync(path, NOW, new Date(NOW.getTime() - 5000));
    const state = readRelayState(fixture.stateFile);
    processRelayJob({
      job: state.jobs[0],
      state,
      now: NOW,
      pendingDir: fixture.pendingDir,
      archiveDir: fixture.archiveDir,
      notificationDir: fixture.notificationDir,
      auditFile: fixture.auditFile,
    });
    // 人为把账本回滚成 pending，模拟落盘顺序中断。
    const stale = readRelayState(fixture.stateFile);
    stale.jobs[0].state = 'pending';
    stale.jobs[0].nextCheckAt = '2026-11-18T00:10:00.000Z';
    saveRelayState(fixture.stateFile, stale);

    const summary = runRelayTick({
      stateFile: fixture.stateFile,
      now: NOW,
      pendingDir: fixture.pendingDir,
      archiveDir: fixture.archiveDir,
      notificationDir: fixture.notificationDir,
      auditFile: fixture.auditFile,
    });
    expect(summary.notified).toBe(1);
    expect(readRelayState(fixture.stateFile).jobs[0].state).toBe('notified');
  });

  it('空文件不判完成，推进 attempts 与 nextCheckAt', () => {
    const fixture = makeFixture();
    const job = seedJob(fixture);
    writeFileSync(join(fixture.pendingDir, job.fileName), '', 'utf8');
    const summary = runRelayTick({
      stateFile: fixture.stateFile,
      now: NOW,
      pendingDir: fixture.pendingDir,
      archiveDir: fixture.archiveDir,
      notificationDir: fixture.notificationDir,
      auditFile: fixture.auditFile,
    });
    expect(summary.notified).toBe(0);
    const persisted = readRelayState(fixture.stateFile).jobs[0];
    expect(persisted.state).toBe('pending');
    expect(persisted.attempts).toBe(1);
    expect(Date.parse(persisted.nextCheckAt)).toBeGreaterThan(NOW.getTime());
  });

  it('deadline 到期未命中：置 timed-out 并停止', () => {
    const fixture = makeFixture();
    const job = buildRelayJob({
      taskId: 'AF-069',
      file: relayFile(fixture),
      profile: 'S',
      now: new Date('2026-11-18T00:00:00.000Z'),
      deadline: '2026-11-18T00:10:00.000Z',
      pendingDir: fixture.pendingDir,
    });
    const state = emptyRelayState();
    state.jobs.push(job);
    saveRelayState(fixture.stateFile, state);

    const summary = runRelayTick({
      stateFile: fixture.stateFile,
      now: NOW,
      pendingDir: fixture.pendingDir,
      archiveDir: fixture.archiveDir,
      notificationDir: fixture.notificationDir,
      auditFile: fixture.auditFile,
    });
    expect(summary.timeouts).toBe(1);
    const persisted = readRelayState(fixture.stateFile).jobs[0];
    expect(persisted.state).toBe('timed-out');
    expect(persisted.nextCheckAt).toBeNull();
  });

  it('事件命中不等兜底到期：按 taskId 立即处理', () => {
    const fixture = makeFixture();
    const job = seedJob(fixture);
    const eventNow = new Date('2026-11-18T00:05:00.000Z');
    const path = join(fixture.pendingDir, job.fileName);
    writeFileSync(path, 'event body', 'utf8');
    utimesSync(path, eventNow, new Date(eventNow.getTime() - 5000));

    expect(isRelayJobDue(readRelayState(fixture.stateFile).jobs[0], eventNow)).toBe(false);

    const summary = runRegisteredRelayJobs({
      taskIds: ['AF-069'],
      stateFile: fixture.stateFile,
      now: eventNow,
      pendingDir: fixture.pendingDir,
      archiveDir: fixture.archiveDir,
      notificationDir: fixture.notificationDir,
      auditFile: fixture.auditFile,
    });
    expect(summary.checked).toBe(1);
    expect(readRelayState(fixture.stateFile).jobs[0].state).toBe('notified');
  });

  it('ack 清理 job 并把通知置为 read', () => {
    const fixture = makeFixture();
    const job = seedJob(fixture);
    const path = join(fixture.pendingDir, job.fileName);
    writeFileSync(path, 'ack body', 'utf8');
    utimesSync(path, NOW, new Date(NOW.getTime() - 5000));
    runRelayTick({
      stateFile: fixture.stateFile,
      now: NOW,
      pendingDir: fixture.pendingDir,
      archiveDir: fixture.archiveDir,
      notificationDir: fixture.notificationDir,
      auditFile: fixture.auditFile,
    });

    const result = ackRelayJob({
      taskId: 'AF-069',
      stateFile: fixture.stateFile,
      notificationDir: fixture.notificationDir,
      auditFile: fixture.auditFile,
      now: NOW,
    });
    expect(result.previousState).toBe('notified');
    expect(readRelayState(fixture.stateFile).jobs).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(fixture.notificationDir, 'AF-069.json'), 'utf8')).state).toBe('read');
  });
});
