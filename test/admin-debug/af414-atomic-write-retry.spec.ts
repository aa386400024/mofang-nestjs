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

import { isRetryableRenameError, RENAME_RETRY_CODES, renameWithRetry } from '../../src/admin-debug/debug-session-store.js';

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
