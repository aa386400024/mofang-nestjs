// V2026-11-13 (TD-9 · T-4): 外部命令 (git) 可用性探测.
//
//   为什么需要: 取证会话的 PATH 不继承系统 PATH (本机 git 在 D:\Apps\Git\cmd),
//   依赖 git 的 spec 会报 spawnSync git ENOENT —— 那是**环境缺陷**, 不是回归.
//   判据: 探测不到 git 就跳过相关用例 (既不假装通过, 也不把环境缺陷记成回归).
//
//   口径:
//     ① GIT_BIN env 显式注入优先 (CI / 取证机可用它指向具体可执行文件);
//     ② 否则回退 'git' (走 PATH);
//     ③ 探测失败 → available=false, 由调用方 skip.
//
//   纯函数: 探测结果按需重算, 不缓存 (env 可能被后序用例改写); 无全局状态.

import { spawnSync } from 'node:child_process';

/** 注入 git 可执行文件路径的 env 键. */
export const GIT_BIN_ENV = 'GIT_BIN';

/** 未注入时回退的可执行文件名 (走 PATH). */
export const DEFAULT_GIT_BINARY = 'git';

/** 探测结果: 可用 → 给出可执行文件路径; 不可用 → binary 为 null. */
export interface GitProbe {
  readonly available: boolean;
  readonly binary: string | null;
}

/**
 * 解析 git 可执行文件路径 (只解析, 不探测).
 *
 * @param env env 来源 (缺省 = process.env)
 * @returns 可执行文件路径
 */
export function resolveGitBinary(env: NodeJS.ProcessEnv = process.env): string {
  const injected = env[GIT_BIN_ENV]?.trim();
  return injected !== undefined && injected.length > 0 ? injected : DEFAULT_GIT_BINARY;
}

/**
 * 探测某个可执行文件是否可用 (跑 --version).
 *
 * @param binary 可执行文件路径
 * @returns 可用返回 true
 */
export function probeGitBinary(binary: string): boolean {
  try {
    const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return result.error === undefined && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 探测 git 是否可用 (按 GIT_BIN → 'git' 的顺序解析后探测).
 *
 * @param env env 来源 (缺省 = process.env)
 * @returns 探测结果
 */
export function probeGit(env: NodeJS.ProcessEnv = process.env): GitProbe {
  const binary = resolveGitBinary(env);
  if (!probeGitBinary(binary)) return { available: false, binary: null };
  return { available: true, binary };
}
