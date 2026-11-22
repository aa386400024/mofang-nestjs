/**
 * 单写者锁（run-lock）护栏：互斥、释放后可重抢、陈旧锁自愈、BOM 容错。
 * 只测纯文件语义，不触碰真实 transport 目录（一律用临时目录）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRunLock, describeRunLock, readRunLock, runLockPath } from '../run-lock.mjs';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orch-lock-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('run-lock', () => {
  it('同一目录只允许一个持锁者', () => {
    const first = acquireRunLock({ dir, actor: 'run-once' });
    expect(first.acquired).toBe(true);
    const second = acquireRunLock({ dir, actor: 'watch' });
    expect(second.acquired).toBe(false);
    expect(second.holder.actor).toBe('run-once');
    first.release();
  });

  it('释放后可以重新抢到锁', () => {
    const first = acquireRunLock({ dir });
    first.release();
    expect(readRunLock(dir)).toBeNull();
    const again = acquireRunLock({ dir });
    expect(again.acquired).toBe(true);
    again.release();
  });

  it('陈旧锁按阈值自愈并留下 stolen 事实', () => {
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    writeFileSync(runLockPath(dir), JSON.stringify({ pid: 4242, host: 'ghost', token: 'x', actor: 'crashed', acquiredAt: old }), 'utf8');
    const lock = acquireRunLock({ dir });
    expect(lock.acquired).toBe(true);
    expect(lock.stolen?.pid).toBe(4242);
    expect(describeRunLock(dir)?.pid).toBe(process.pid);
    lock.release();
  });

  it('带 BOM 的新鲜锁不被误判陈旧', () => {
    const recent = new Date().toISOString();
    writeFileSync(
      runLockPath(dir),
      '\uFEFF' + JSON.stringify({ pid: 777, host: 'ps', token: 'y', actor: 'bom-writer', acquiredAt: recent }),
      'utf8',
    );
    const lock = acquireRunLock({ dir });
    expect(lock.acquired).toBe(false);
    expect(lock.holder.pid).toBe(777);
  });
});
