/**
 * AF-223 · 跨机取号仲裁护栏。
 *
 * 覆盖：占号 ref 命名与解析、远端 CAS 抢号成功/竞争失败、释放只删合法 payload、
 * 取号顺延循环、远端不可达降级，以及「重建时排除本机同名分支」的占用口径。
 * 全部 fake runGit，不碰真实仓库、不触网。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitTaskIdReservation, pickReservedTaskId, remoteReservationIds, reservationRef } from '../task-id-reservation.mjs';
import { assertTaskIdAvailable, collectOccupiedTaskIds, nextTaskId } from '../task-id-occupancy.mjs';

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orch-reserve-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 有状态的假 git：维护 refs 与 commit message，模拟 push 的非快进语义。 */
function fakeGit({ refs = {}, objects = {} } = {}) {
  let seq = 0;
  const state = { refs, objects, revParseCalls: 0, mktreeInputs: [] };
  const runGit = (args, opts = {}) => {
    if (args[0] === 'ls-remote') {
      if (args[1] === '--heads') {
        const prefix = args[3].replace(/\*$/, '');
        return Object.entries(state.refs)
          .filter(([ref]) => ref.startsWith(prefix))
          .map(([ref, sha]) => `${sha}\t${ref}`)
          .join('\n');
      }
      const sha = state.refs[args[2]];
      return sha ? `${sha}\t${args[2]}` : '';
    }
    if (args[0] === 'rev-parse') {
      state.revParseCalls += 1;
      return 'tree-1';
    }
    if (args[0] === 'mktree') {
      state.mktreeInputs.push(opts.input);
      return 'empty-tree';
    }
    if (args[0] === 'commit-tree') {
      seq += 1;
      const sha = `c${seq}`;
      state.objects[sha] = { message: args[args.indexOf('-m') + 1], tree: args[1] };
      return sha;
    }
    if (args[0] === 'cat-file') {
      const object = state.objects[args[2]];
      return object ? `tree ${object.tree}\n\n${object.message}` : null;
    }
    if (args[0] === 'fetch') return '';
    if (args[0] === 'push') {
      if (args.includes('--delete')) {
        delete state.refs[args[args.length - 1]];
        return '';
      }
      const [sha, ref] = args[3].split(':');
      if (state.refs[ref]) return null; // 非快进 → 抢号失败
      state.refs[ref] = sha;
      return '';
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { runGit, state };
}

describe('task-id-reservation', () => {
  it('占号 ref 命名为 orchestration-task-ids/<ID>', () => {
    expect(reservationRef('AF-300')).toBe('refs/heads/orchestration-task-ids/AF-300');
    expect(() => reservationRef('')).toThrow();
  });

  it('从 ls-remote 解析已占号编号，忽略非法尾巴', () => {
    const text = [
      'aaa\trefs/heads/orchestration-task-ids/AF-300',
      'bbb\trefs/heads/orchestration-task-ids/AF-301',
      'ccc\trefs/heads/orchestration-task-ids/not-a-task',
      'ddd\trefs/heads/task/AF-302-realism',
    ].join('\n');
    expect(remoteReservationIds(text)).toEqual(['AF-300', 'AF-301']);
  });

  it('首次抢号成功并写入 payload，第二次同号抢号被拒', () => {
    const { runGit, state } = fakeGit();
    const reservation = createGitTaskIdReservation({ rootDir: root, runGit, actor: 'tester', now: () => 1700000000000 });
    const first = reservation.reserve('AF-300');
    expect(first.reserved).toBe(true);
    expect(first.holder.taskId).toBe('AF-300');
    expect(first.holder.actor).toBe('tester');
    expect(Object.keys(state.refs)).toContain(reservationRef('AF-300'));
    const second = reservation.reserve('AF-300');
    expect(second.reserved).toBe(false);
    expect(second.conflict).toBe(true);
    expect(second.holder.taskId).toBe('AF-300');
  });

  it('占号 commit 用空 tree，不再读取 HEAD 整树', () => {
    const { runGit, state } = fakeGit();
    const reservation = createGitTaskIdReservation({ rootDir: root, runGit });
    const result = reservation.reserve('AF-390');
    expect(result.reserved).toBe(true);
    const sha = state.refs[reservationRef('AF-390')];
    expect(state.objects[sha].tree).toBe('empty-tree');
    expect(state.revParseCalls).toBe(0);
    expect(state.mktreeInputs).toEqual(['']);
  });

  it('释放只删合法 payload；ref 不存在视为已释放', () => {
    const { runGit, state } = fakeGit();
    const reservation = createGitTaskIdReservation({ rootDir: root, runGit });
    expect(reservation.release('AF-310')).toBe(true);
    reservation.reserve('AF-311');
    expect(reservation.release('AF-311')).toBe(true);
    expect(state.refs[reservationRef('AF-311')]).toBeUndefined();

    const other = fakeGit({
      refs: { [reservationRef('AF-312')]: 'x' },
      objects: { x: { message: JSON.stringify({ taskId: 'AF-999' }), tree: 'tree-1' } },
    });
    const res2 = createGitTaskIdReservation({ rootDir: root, runGit: other.runGit });
    expect(res2.release('AF-312')).toBe(false);
  });

  it('取号顺延：候选被抢后自动尝试下一个号', () => {
    const { runGit } = fakeGit({ refs: { [reservationRef('AF-320')]: 'held' } });
    const reservation = createGitTaskIdReservation({ rootDir: root, runGit });
    const picked = pickReservedTaskId({
      occupiedIds: ['AF-319'],
      prefix: 'AF',
      nextIdFn: nextTaskId,
      reserve: (taskId) => reservation.reserve(taskId),
    });
    expect(picked.taskId).toBe('AF-321');
    expect(picked.attempts.map((a) => a.taskId)).toEqual(['AF-320', 'AF-321']);
    expect(picked.attempts[0].conflict).toBe(true);
  });

  it('远端不可达时返回 unavailable，不给号码', () => {
    const runGit = (_args, opts = {}) => {
      if (opts.allowFailure) return null;
      throw new Error('offline');
    };
    const reservation = createGitTaskIdReservation({ rootDir: root, runGit });
    const picked = pickReservedTaskId({
      occupiedIds: ['AF-100'],
      nextIdFn: nextTaskId,
      reserve: (taskId) => reservation.reserve(taskId),
    });
    expect(picked.unavailable).toBe(true);
    expect(picked.taskId).toBeNull();
    expect(picked.attempts[0].taskId).toBe('AF-101');
  });
});

describe('task-id-occupancy · 重建排除自身分支（AF-223）', () => {
  function seedIndex(tasks) {
    const dir = join(root, 'docs', 'team', 'agent-orchestration');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'task-state-index.json'), JSON.stringify({ tasks, archivedTasks: [] }), 'utf8');
  }

  it('编号仅被本机同名分支占用时按重建放行，并留下 warning', () => {
    seedIndex([]);
    const runGit = (args, opts = {}) => {
      if (args[0] === 'ls-remote' && args[1] === '--heads' && args[3] === 'task/*') {
        return 'x\trefs/heads/task/AF-330-hardening';
      }
      if (args[0] === 'ls-remote' && args[1] === '--heads') return '';
      if (args[0] === 'ls-remote') return '';
      if (args[0] === 'show') return JSON.stringify({ tasks: [], archivedTasks: [] });
      if (opts.allowFailure) return null;
      throw new Error(`unexpected ${args.join(' ')}`);
    };
    const occupancy = collectOccupiedTaskIds({
      rootDir: root,
      runGit,
      excludeRefs: ['refs/heads/task/AF-330-hardening'],
    });
    expect(occupancy.selfOnlyIds).toContain('AF-330');
    expect(occupancy.sources.excludedRemoteBranches).toContain('AF-330');
    const verdict = assertTaskIdAvailable('AF-330', { occupancy });
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe('self-branch-only');
    expect(verdict.warnings.join('\n')).toMatch(/同名分支/);
  });

  it('排除自身分支后，若编号还出现在远端索引或占号 ref 里，仍然拒绝', () => {
    seedIndex([]);
    const runGit = (args, opts = {}) => {
      if (args[0] === 'ls-remote' && args[1] === '--heads' && args[3] === 'task/*') {
        return 'x\trefs/heads/task/AF-331-hardening';
      }
      if (args[0] === 'ls-remote' && args[1] === '--heads') {
        return 'y\trefs/heads/orchestration-task-ids/AF-331';
      }
      if (args[0] === 'ls-remote') return '';
      if (args[0] === 'show') return JSON.stringify({ tasks: [], archivedTasks: [] });
      if (opts.allowFailure) return null;
      throw new Error(`unexpected ${args.join(' ')}`);
    };
    const occupancy = collectOccupiedTaskIds({
      rootDir: root,
      runGit,
      excludeRefs: ['refs/heads/task/AF-331-hardening'],
    });
    expect(occupancy.selfOnlyIds).toEqual([]);
    expect(occupancy.sources.remoteReservations).toContain('AF-331');
    expect(() => assertTaskIdAvailable('AF-331', { occupancy })).toThrow(/remoteReservations/);
  });
});
