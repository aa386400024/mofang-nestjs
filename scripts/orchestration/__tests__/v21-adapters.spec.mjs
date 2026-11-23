import { describe, expect, it } from 'vitest';
import { deriveSlug } from '../branch-workflow.mjs';
import { classifyPullRequests } from '../pr-release.mjs';
import { buildReceiptScaffold } from '../receipt-scaffold.mjs';
import { gatePlan, inferRiskFromPaths, resolveRiskClass } from '../risk-gate.mjs';
import { ackSession, createSession, evaluateSession, heartbeatSession, progressSession, requestCancel, terminalSession } from '../executor-session.mjs';

describe('AF-365 risk gating', () => {
  it('docs-only changes are R0 and skip heavy checks', () => {
    expect(inferRiskFromPaths(['docs/team/conventions.md', 'README.md'])).toBe('R0');
    const plan = gatePlan('R0');
    expect(plan.unit).toBe(false);
    expect(plan.e2e).toBe(false);
    expect(plan.build).toBe(false);
    expect(plan.orchestration).toBe(true);
  });

  it('orchestration / engine / contracts paths are R2', () => {
    expect(inferRiskFromPaths(['scripts/orchestration/cli.mjs'])).toBe('R2');
    expect(inferRiskFromPaths(['src/engine-core/foo.ts'])).toBe('R2');
    expect(inferRiskFromPaths(['contracts/agent-collaboration-framework/2.1.0/schemas/versions.json'])).toBe('R2');
    expect(gatePlan('R2').e2e).toBe(true);
    expect(gatePlan('R2').coverage).toBe(true);
  });

  it('explicit R0 is downgraded to R1 when runtime paths changed', () => {
    const resolved = resolveRiskClass({ changedFiles: ['src/user/auth.service.ts'], explicitRiskClass: 'R0' });
    expect(resolved.riskClass).toBe('R1');
    expect(resolved.source).toBe('explicit-downgraded-to-R1');
  });
});

describe('AF-365 branch slug', () => {
  it('never derives a slug containing the task number', () => {
    expect(deriveSlug('AF-365 编排 v2.1 状态面解耦', 'AF-365')).toBe('v2-1');
    expect(deriveSlug('orchestration v21 upgrade', 'AF-365')).toBe('orchestration-v21-upgrade');
  });
});

describe('AF-365 receipt scaffold', () => {
  it('produces all six required groups without fake passed values', () => {
    const scaffold = buildReceiptScaffold({
      taskId: 'AF-900',
      taskSheetText: [
        '---',
        'taskId: AF-900',
        'contextId: demo',
        'type: implementation',
        'agentRole: executor',
        'baselineRef: abc1234',
        'artifacts:',
        '  - name: 交付记录',
        '    path: docs/worklog/completed/demo.md',
        '---',
        '# demo',
      ].join('\n'),
    });
    expect(scaffold.payload.gateResults).toEqual([]);
    expect(scaffold.payload.scopeCheck).toBeNull();
    expect(scaffold.payload.reviewVerdict).toBeNull();
    expect(scaffold.payload.artifactRefs.deliveryRecord).toBe('docs/worklog/completed/demo.md');
    expect(scaffold.scaffold.requiredGroups).toEqual(['gateResults', 'scopeCheck', 'contractChecks', 'backlogItems', 'deviationTable', 'reviewVerdict']);
  });

  it('rejects taskId mismatch', () => {
    expect(() => buildReceiptScaffold({ taskId: 'AF-901', taskSheetText: '---\ntaskId: AF-900\n---\n' })).toThrow(/不一致/);
  });
});

describe('AF-365 executor session', () => {
  const t0 = '2026-11-23T06:00:00.000Z';

  it('active session within lease is healthy', () => {
    const session = createSession({ sessionId: 's1', taskId: 'AF-900', executor: 'executor', now: t0, leaseMinutes: 10 });
    expect(evaluateSession(session, { now: '2026-11-23T06:05:00.000Z' }).state).toBe('active');
    const beat = heartbeatSession(session, { now: '2026-11-23T06:08:00.000Z' });
    expect(Date.parse(beat.leaseExpiresAt)).toBeGreaterThan(Date.parse(session.leaseExpiresAt));
  });

  it('session past lease is lost', () => {
    const session = createSession({ sessionId: 's2', taskId: 'AF-900', executor: 'executor', now: t0, leaseMinutes: 1 });
    expect(evaluateSession(session, { now: '2026-11-23T06:02:00.000Z' }).state).toBe('lost');
  });

  it('terminal session must be self-consistent', () => {
    const session = createSession({ sessionId: 's3', taskId: 'AF-900', executor: 'executor', now: t0 });
    const done = terminalSession(session, { now: '2026-11-23T06:01:00.000Z', status: 'completed' });
    expect(evaluateSession(done, { now: '2026-11-23T06:02:00.000Z' }).state).toBe('terminal');
    expect(() => heartbeatSession(done, { now: '2026-11-23T06:03:00.000Z' })).toThrow(/终态/);
  });

  it('ack moves starting to active and renews the lease', () => {
    const session = createSession({ sessionId: 's4', taskId: 'AF-900', executor: 'executor', now: t0, leaseMinutes: 5 });
    const acked = ackSession(session, { now: '2026-11-23T06:01:00.000Z', leaseMinutes: 10 });
    expect(acked.status).toBe('active');
    expect(Date.parse(acked.leaseExpiresAt)).toBe(Date.parse('2026-11-23T06:11:00.000Z'));
    expect(() => ackSession(acked, { now: '2026-11-23T06:02:00.000Z' })).toThrow(/starting/);
  });

  it('progress is a liveness fact and cannot go backwards', () => {
    const session = createSession({ sessionId: 's5', taskId: 'AF-900', executor: 'executor', now: t0, leaseMinutes: 2 });
    const half = progressSession(session, {
      now: '2026-11-23T06:01:00.000Z',
      progressPercent: 40,
      progressNote: '已完成契约包同步',
      artifactRefs: ['contracts/agent-collaboration-framework/2.1.0'],
    });
    expect(half.status).toBe('active');
    expect(half.progressPercent).toBe(40);
    expect(Date.parse(half.leaseExpiresAt)).toBeGreaterThan(Date.parse(session.leaseExpiresAt));
    expect(evaluateSession(half, { now: '2026-11-23T06:02:00.000Z' }).state).toBe('active');
    expect(() => progressSession(half, { now: '2026-11-23T06:02:00.000Z', progressPercent: 30 })).toThrow(/回退/);
    expect(() => progressSession(half, { now: '2026-11-23T06:02:00.000Z', progressPercent: 101 })).toThrow(/0-100/);
  });

  it('cancel is a request, not a terminal transition', () => {
    const session = ackSession(createSession({ sessionId: 's6', taskId: 'AF-900', executor: 'executor', now: t0 }), {
      now: '2026-11-23T06:01:00.000Z',
    });
    const requested = requestCancel(session, { now: '2026-11-23T06:02:00.000Z', note: '用户改方向' });
    expect(requested.cancelRequestedAt).toBe('2026-11-23T06:02:00.000Z');
    expect(requested.status).toBe('active');
    const done = terminalSession(requested, { now: '2026-11-23T06:03:00.000Z', status: 'canceled' });
    expect(evaluateSession(done, { now: '2026-11-23T06:04:00.000Z' }).state).toBe('terminal');
  });
});

describe('AF-365 PR triage', () => {
  it('classifies orphan / duplicate / blocked / ready', () => {
    const tasks = new Map([
      ['AF-900', { status: 'completed' }],
      ['AF-901', { status: 'ready' }],
      ['AF-902', { status: 'completed' }],
    ]);
    const pulls = [
      { number: 1, title: 'a', head: { ref: 'task/AF-900-x' }, updated_at: '2026-11-22T00:00:00Z' },
      { number: 2, title: 'b', head: { ref: 'task/AF-901-y' }, updated_at: '2026-11-22T00:00:00Z' },
      { number: 3, title: 'c', head: { ref: 'task/AF-902-z' }, updated_at: '2026-11-20T00:00:00Z' },
      { number: 4, title: 'd', head: { ref: 'task/AF-902-w' }, updated_at: '2026-11-20T00:00:00Z' },
      { number: 5, title: 'e', head: { ref: 'feature/no-task' }, updated_at: '2026-11-22T00:00:00Z' },
    ];
    const rows = classifyPullRequests(pulls, tasks, Date.parse('2026-11-23T00:00:00Z'));
    expect(rows.find((row) => row.number === 1).state).toBe('ready');
    expect(rows.find((row) => row.number === 2).state).toBe('blocked');
    expect(rows.find((row) => row.number === 3).state).toBe('duplicate');
    expect(rows.find((row) => row.number === 5).state).toBe('orphan');
  });
});
