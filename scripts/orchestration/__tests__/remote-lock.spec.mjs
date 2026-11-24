/**
 * AF-221 批次子项 01 · 跨机单写者锁（远端 ref CAS）护栏。
 *
 * 全部用 fake runGit 模拟远端 ref 语义，不触网、不碰真实仓库：
 *   - 空远端可抢到并写入 payload；
 *   - 他人持新鲜锁时抢不到，返回持有者事实；
 *   - 陈旧锁自愈并保留 stolen；
 *   - token 不匹配不释放，匹配才删 ref；
 *   - 远端不可达时显式 unavailable，不伪装成抢到。
 */
import { describe, expect, it } from 'vitest';
import { createGitRemoteLock, describeRemoteRunLock, REMOTE_LOCK_REF } from '../remote-lock.mjs';

function createFakeRemote({ held = null, lsRemoteFails = false } = {}) {
  const state = { refSha: null, commits: new Map(), lsRemoteFails, revParseCalls: 0, mktreeInputs: [] };
  if (held) {
    state.refSha = 'seed';
    state.commits.set('seed', { message: JSON.stringify(held), tree: 'seed-tree' });
  }
  const runGit = (args, opts = {}) => {
    const fail = () => {
      if (opts.allowFailure) return null;
      throw new Error('fake git failure');
    };
    const [cmd, ...rest] = args;
    if (cmd === 'ls-remote') {
      if (state.lsRemoteFails) return fail();
      return state.refSha ? `${state.refSha}\t${REMOTE_LOCK_REF}` : '';
    }
    if (cmd === 'fetch') return '';
    if (cmd === 'log') {
      const commit = state.commits.get(state.refSha);
      return commit ? commit.message : null;
    }
    if (cmd === 'rev-parse') {
      state.revParseCalls += 1;
      return 'tree-sha';
    }
    if (cmd === 'mktree') {
      state.mktreeInputs.push(opts.input);
      return 'empty-tree';
    }
    if (cmd === 'cat-file') {
      const commit = state.commits.get(String(rest[rest.length - 1]));
      if (!commit) return fail();
      return `tree ${commit.tree ?? 'tree-sha'}\nauthor fake <fake@example.com>\n\n${commit.message}`;
    }
    if (cmd === 'commit-tree') {
      const message = rest[rest.indexOf('-m') + 1];
      const sha = `c${state.commits.size + 1}`;
      state.commits.set(sha, { message, tree: rest[0] });
      return sha;
    }
    if (cmd === 'push') {
      if (rest.includes('--delete')) {
        state.refSha = null;
        return '';
      }
      const spec = String(rest[rest.length - 1]);
      if (state.refSha) return fail();
      state.refSha = spec.split(':')[0];
      return '';
    }
    throw new Error(`fake runGit 不支持的命令：${args.join(' ')}`);
  };
  return { state, runGit };
}

const T0 = Date.parse('2026-11-21T09:00:00+08:00');

describe('remote-lock', () => {
  it('空远端可抢到锁，payload 写进 commit message', () => {
    const { state, runGit } = createFakeRemote();
    const lock = createGitRemoteLock({ runGit, now: () => T0 });
    const result = lock.acquire({ actor: 'run-once', token: 'tok-local', acquiredAt: new Date(T0).toISOString() });
    expect(result.acquired).toBe(true);
    expect(state.refSha).toBe(result.sha);
    const holder = JSON.parse(state.commits.get(state.refSha).message);
    expect(holder.token).toBe('tok-local');
    expect(holder.actor).toBe('run-once');
  });

  it('锁 commit 用空 tree，不再读取 HEAD 整树', () => {
    const { state, runGit } = createFakeRemote();
    const lock = createGitRemoteLock({ runGit, now: () => T0 });
    const result = lock.acquire({ token: 'tok-local' });
    expect(result.acquired).toBe(true);
    const commit = state.commits.get(state.refSha);
    expect(commit.tree).toBe('empty-tree');
    expect(state.revParseCalls).toBe(0);
    expect(state.mktreeInputs).toEqual(['']);
  });

  it('他人持新鲜锁时抢不到，并返回持有者事实', () => {
    const { state, runGit } = createFakeRemote({
      held: { host: 'DESKTOP-E3EVQ9P', actor: 'run-once', token: 'peer', acquiredAt: new Date(T0 - 60_000).toISOString() },
    });
    const lock = createGitRemoteLock({ runGit, now: () => T0 });
    const result = lock.acquire({ token: 'tok-local' });
    expect(result.acquired).toBe(false);
    expect(result.holder.host).toBe('DESKTOP-E3EVQ9P');
    expect(state.refSha).toBe('seed');
  });

  it('陈旧锁按阈值自愈并保留 stolen 事实', () => {
    const staleAt = new Date(T0 - 90 * 60_000).toISOString();
    const { state, runGit } = createFakeRemote({
      held: { host: 'ghost', actor: 'run-once', token: 'crashed', acquiredAt: staleAt },
    });
    const lock = createGitRemoteLock({ runGit, now: () => T0 });
    const result = lock.acquire({ token: 'tok-local' });
    expect(result.acquired).toBe(true);
    expect(result.stolen.host).toBe('ghost');
    expect(JSON.parse(state.commits.get(state.refSha).message).token).toBe('tok-local');
  });

  it('token 匹配才释放，不误删他人锁', () => {
    const { state, runGit } = createFakeRemote();
    const lock = createGitRemoteLock({ runGit, now: () => T0 });
    const result = lock.acquire({ token: 'tok-local' });
    expect(lock.release('wrong-token')).toBe(false);
    expect(state.refSha).not.toBeNull();
    expect(result.release()).toBe(true);
    expect(state.refSha).toBeNull();
  });

  it('远端不可达时显式 unavailable', () => {
    const { runGit } = createFakeRemote({ lsRemoteFails: true });
    const lock = createGitRemoteLock({ runGit, now: () => T0 });
    const result = lock.acquire({ token: 'tok-local' });
    expect(result.acquired).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.error).toContain('远端不可达');
  });

  it('status 摘要把不可读与空闲区分开', () => {
    const { runGit } = createFakeRemote({ lsRemoteFails: true });
    const described = describeRemoteRunLock({ lock: createGitRemoteLock({ runGit, now: () => T0 }) });
    expect(described.unavailable).toBe(true);

    const idle = describeRemoteRunLock({ lock: createGitRemoteLock({ runGit: createFakeRemote().runGit, now: () => T0 }) });
    expect(idle).toBeNull();
  });
});
