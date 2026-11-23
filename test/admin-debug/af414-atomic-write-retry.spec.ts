// AF-414 (调试会话原子写 · Windows 瞬时占用重试 · 单测):
//   覆盖 renameWithRetry 的五条路径:
//     ① 可重试错误码识别 (EPERM / EACCES / EBUSY / ENOTEMPTY)
//     ② 首次成功 → 只 rename 一次
//     ③ 两次 EPERM 后成功 → 3 次 rename, 退避 10ms / 20ms
//     ④ 重试耗尽 → 抛最后一次错误, rename 次数 = attempts
//     ⑤ 非瞬时错误 (ENOENT) → 立即抛, 不 sleep
//
//   全部用注入桩, 不碰真实文件系统 —— 本用例要验证的是**重试策略**,
//   真实落盘行为由 debug-session-persistence.spec.ts 覆盖.
//
//   验证: pnpm exec vitest run test/admin-debug/af414-atomic-write-retry.spec.ts
//   时间戳: 2026-11-24 GMT+8
import { describe, expect, it } from 'vitest';

import {
  cleanupTempFile,
  isRetryableFsError,
  RETRYABLE_FS_CODES,
  uniqueTempPath,
  writeFileWithRetry,
} from '../../src/admin-debug/atomic-write.js';
import {
  isRetryableRenameError,
  RENAME_RETRY_CODES,
  renameWithRetry,
  shouldBackfillLocal,
} from '../../src/admin-debug/debug-session-store.js';
import type { DebugSessionRecord } from '../../src/admin-debug/debug-session-store.js';

/**
 * 构造带 code 的文件系统错误.
 *
 * @param code Node errno 码
 * @returns Error 实例
 */
function fsError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`模拟 ${code}`);
  error.code = code;
  return error;
}

/**
 * 记录调用次数与退避时长的 rename 桩.
 *
 * @param failures 前 N 次抛出的错误; 用尽后成功
 * @returns 桩函数与调用记录
 */
function failingRename(failures: NodeJS.ErrnoException[]): {
  calls: number;
  renameFn: (from: string, to: string) => Promise<void>;
} {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    renameFn: async () => {
      state.calls += 1;
      if (failures.length >= state.calls) throw failures[state.calls - 1];
    },
  };
}

describe('AF-414 原子写 rename 重试', () => {
  it('识别 Windows 瞬时占用码，拒绝其他错误码', () => {
    for (const code of RENAME_RETRY_CODES) expect(isRetryableRenameError(fsError(code))).toBe(true);
    expect(isRetryableRenameError(fsError('ENOENT'))).toBe(false);
    expect(isRetryableRenameError(new Error('无 code'))).toBe(false);
    expect(isRetryableRenameError(null)).toBe(false);
  });

  it('首次成功只 rename 一次，不 sleep', async () => {
    const rename = failingRename([]);
    const delays: number[] = [];
    await renameWithRetry('a.tmp', 'a.json', {
      renameFn: rename.renameFn,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    });
    expect(rename.calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('两次 EPERM 后成功：重试 3 次，指数退避 10 / 20ms', async () => {
    const rename = failingRename([fsError('EPERM'), fsError('EPERM')]);
    const delays: number[] = [];
    await renameWithRetry('a.tmp', 'a.json', {
      renameFn: rename.renameFn,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    });
    expect(rename.calls).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  it('重试耗尽后抛最后一次错误', async () => {
    const rename = failingRename([fsError('EBUSY'), fsError('EBUSY'), fsError('EBUSY')]);
    await expect(
      renameWithRetry('a.tmp', 'a.json', {
        renameFn: rename.renameFn,
        sleepFn: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'EBUSY' });
    expect(rename.calls).toBe(3);
  });

  it('非瞬时错误立即抛出，不重试也不 sleep', async () => {
    const rename = failingRename([fsError('ENOENT')]);
    const delays: number[] = [];
    await expect(
      renameWithRetry('a.tmp', 'a.json', {
        renameFn: rename.renameFn,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(rename.calls).toBe(1);
    expect(delays).toEqual([]);
  });
});

describe('AF-416 原子写硬化', () => {
  it('writeFile 与 rename 共用同一份可重试码', () => {
    for (const code of RETRYABLE_FS_CODES) expect(isRetryableFsError(fsError(code))).toBe(true);
    expect(RENAME_RETRY_CODES).toEqual(RETRYABLE_FS_CODES);
  });

  it('混合错误序列：EPERM 重试一次后遇 ENOENT 立即放弃，不掩盖真实故障', async () => {
    const rename = failingRename([fsError('EPERM'), fsError('ENOENT')]);
    const delays: number[] = [];
    await expect(
      renameWithRetry('a.tmp', 'a.json', {
        renameFn: rename.renameFn,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(rename.calls).toBe(2);
    expect(delays).toEqual([10]);
  });

  it('attempts=5 的退避序列为 10/20/40/80，耗尽后带 attempts 标记', async () => {
    const rename = failingRename([fsError('EPERM'), fsError('EPERM'), fsError('EPERM'), fsError('EPERM'), fsError('EPERM')]);
    const delays: number[] = [];
    await expect(
      renameWithRetry('a.tmp', 'a.json', {
        attempts: 5,
        renameFn: rename.renameFn,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toMatchObject({ attempts: 5, retried: true });
    expect(rename.calls).toBe(5);
    expect(delays).toEqual([10, 20, 40, 80]);
  });

  it('夹取边界：attempts=0 收敛为 1 次、baseDelay=0 不等待', async () => {
    const rename = failingRename([fsError('EPERM'), fsError('EPERM')]);
    const delays: number[] = [];
    await expect(
      renameWithRetry('a.tmp', 'a.json', {
        attempts: 0,
        baseDelayMs: 0,
        renameFn: rename.renameFn,
        sleepFn: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toMatchObject({ attempts: 1, retried: false });
    expect(rename.calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('唯一临时名：同目标两次生成不同路径，且带 pid 与 .tmp 后缀', () => {
    const target = String.raw`C:\data\s1.json`;
    const first = uniqueTempPath(target);
    const second = uniqueTempPath(target);
    expect(first).not.toBe(second);
    expect(first).toContain(`.${process.pid}.`);
    expect(first.endsWith('.tmp')).toBe(true);
    expect(first.startsWith(`${target}.`)).toBe(true);
  });

  it('writeFileWithRetry 重试 EPERM 后成功，并以 wx 模式写入', async () => {
    const modes: string[] = [];
    let calls = 0;
    const writeFn = async (_path: string, _body: string, _encoding: BufferEncoding, mode: 'wx'): Promise<void> => {
      calls += 1;
      modes.push(mode);
      if (calls === 1) throw fsError('EPERM');
    };
    await writeFileWithRetry('a.json.123.tmp', '{}', { writeFn, sleepFn: async () => {} });
    expect(calls).toBe(2);
    expect(modes).toEqual(['wx', 'wx']);
  });

  it('cleanupTempFile 对不存在的临时文件不抛错', async () => {
    await expect(cleanupTempFile(String.raw`C:\definitely-missing\x.json.0.deadbeef.tmp`)).resolves.toBeUndefined();
  });

  it('回填判定：本地缺失 / 远端更新才写，本地更新或时间相同不写', () => {
    const base = { updatedAt: '2026-11-24T04:00:00.000Z' } as DebugSessionRecord;
    expect(shouldBackfillLocal(null, base)).toBe(true);
    expect(shouldBackfillLocal({ ...base, updatedAt: '2026-11-24T03:59:59.000Z' }, base)).toBe(true);
    expect(shouldBackfillLocal(base, base)).toBe(false);
    expect(shouldBackfillLocal({ ...base, updatedAt: '2026-11-24T04:00:01.000Z' }, base)).toBe(false);
  });
});
