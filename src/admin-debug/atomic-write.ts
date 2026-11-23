// V2026-11-24 原子写原语 (Admin Dashboard 调试会话存储):
//   职责: 提供「唯一临时文件名 + Windows 瞬时占用有限重试」两条可复用原语.
//   边界: 只做文件系统原语, 不含会话语义; 由 `debug-session-store.ts` 调用.
//
//   为什么从 store 里拆出来:
//     · 重试原语与 rename/write 语义是独立关注点, 混在 660 行的存储类里会持续膨胀;
//     · 单测可直接导入原语, 不必为了测退避去构造整个存储类.
//
//   为什么临时文件名必须唯一:
//     固定 `${target}.tmp` 时, 两个进程/两个实例同时写同一会话会互相覆盖临时文件,
//     rename 重试只会把这个窗口放大. 唯一名 (pid + 随机) 让每个写者有独立的暂存区.
//
//   为什么 writeFile 也要重试:
//     Windows 上目标文件被短暂占用时, 打开临时文件同样可能 EPERM/EACCES;
//     rename 重试成功但 writeFile 先炸, 等于半个加固.
//
//   验证: pnpm exec vitest run test/admin-debug/af414-atomic-write-retry.spec.ts

import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

/** Windows 上可安全重试的文件系统失败码 (占用类, 过几毫秒通常消失). */
export const RETRYABLE_FS_CODES = ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'] as const;

/**
 * 有限重试策略.
 *
 * attempts 含首次尝试: attempts=3 → 最多 3 次调用、2 次退避 (base, 2×base).
 */
export interface FsRetryPolicy {
  attempts?: number;
  baseDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

/** rename 注入点 (单测用桩替换, 不碰真实文件系统). */
export interface RenameRetryOptions extends FsRetryPolicy {
  renameFn?: (from: string, to: string) => Promise<void>;
}

/** writeFile 注入点. */
export interface WriteFileRetryOptions extends FsRetryPolicy {
  writeFn?: (path: string, data: string, encoding: BufferEncoding, mode: 'wx') => Promise<void>;
}

/** 重试耗尽后仍抛原始错误, 仅附加这两个只读语义标记. */
export interface RetryMarkedError extends NodeJS.ErrnoException {
  retried?: boolean;
  attempts?: number;
}

/**
 * 判断错误是否为 Windows 瞬时占用 (值得重试).
 *
 * @param error 捕获到的错误
 * @returns 命中可重试错误码 → true
 */
export function isRetryableFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && (RETRYABLE_FS_CODES as readonly string[]).includes(code);
}

/**
 * 生成同目录下的唯一临时路径.
 *
 * 必须与目标同目录: rename 跨卷不是原子操作.
 *
 * @param target 目标文件绝对路径
 * @returns `${target}.${pid}.${8位随机}.tmp`
 */
export function uniqueTempPath(target: string): string {
  return `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
}

/**
 * 有限指数退避重试外壳.
 *
 * 非瞬时错误立即抛出; 耗尽后抛最后一次错误并打上 `retried` / `attempts` 标记
 * (不改 `code`, 上游仍可按错误码分流).
 *
 * @param operation 单次操作 (参数为 0 基尝试序号)
 * @param policy 重试策略
 * @returns 操作成功 → 结果
 */
export async function withFsRetry<T>(operation: (attempt: number) => Promise<T>, policy: FsRetryPolicy = {}): Promise<T> {
  const attempts = Math.max(1, Math.trunc(policy.attempts ?? 3));
  const baseDelayMs = Math.max(0, policy.baseDelayMs ?? 10);
  const sleepFn = policy.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const isLast = attempt === attempts - 1;
      if (isLast || !isRetryableFsError(error)) throw markRetryExhausted(error, attempt + 1);
      await sleepFn(baseDelayMs * 2 ** attempt);
    }
  }
  // attempts >= 1 时循环必然 return 或 throw; 这行只为类型收窄, 不可达.
  throw new Error('unreachable');
}

/**
 * 原子 rename, 遇 Windows 瞬时占用时有限指数退避重试.
 *
 * @param temp 临时文件路径
 * @param target 目标文件路径
 * @param options 重试次数 / 基础退避 / 注入依赖
 * @returns rename 成功 → void
 */
export async function renameWithRetry(temp: string, target: string, options: RenameRetryOptions = {}): Promise<void> {
  const renameFn = options.renameFn ?? rename;
  return withFsRetry(() => renameFn(temp, target), options);
}

/**
 * 写临时文件, 与 rename 共用重试白名单与退避.
 *
 * 固定 `wx`: 临时名已唯一, 仍禁止覆盖 —— 撞名等于逻辑错误, 应暴露而不是静默覆盖.
 *
 * @param temp 临时文件路径
 * @param data 文件内容
 * @param options 重试策略 / 注入写函数
 * @returns 写入成功 → void
 */
export async function writeFileWithRetry(temp: string, data: string, options: WriteFileRetryOptions = {}): Promise<void> {
  const writeFn =
    options.writeFn ??
    ((path: string, body: string, encoding: BufferEncoding, mode: 'wx') => writeFile(path, body, { encoding, flag: mode }));
  return withFsRetry(() => writeFn(temp, data, 'utf8', 'wx'), options);
}

/**
 * 删除自己的临时文件 (best effort, 失败不覆盖原错误).
 *
 * @param temp 临时文件路径
 * @returns void
 */
export async function cleanupTempFile(temp: string): Promise<void> {
  await rm(temp, { force: true }).catch(() => {
    // 清理失败不改变主流程结果: 残留的 `.tmp` 会被列目录逻辑忽略.
  });
}

/**
 * 给耗尽错误打标记; 非对象错误原样返回 (不伪造 code).
 *
 * @param error 捕获到的错误
 * @param attempts 已尝试次数
 * @returns 同一错误
 */
function markRetryExhausted(error: unknown, attempts: number): unknown {
  if (error !== null && typeof error === 'object') {
    Object.assign(error, { retried: attempts > 1, attempts });
  }
  return error;
}
