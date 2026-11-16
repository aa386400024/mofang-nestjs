// V2026-11-13 (TD-9 · T-1): spec 隔离工具 (替身复位 + env 快照).
//
//   为什么要共享: 每个 spec 各抄一份 reset 钩子 = N 份口径, 漏一处就是跨用例污染
//   (P-DEBT-1 的原始症状: 前序用例的 mock 实现 / spy / env 漏进后序用例).
//   本文件是**唯一**复位出口 —— spec 只调它, 不自己写重置逻辑.
//
//   纯度约定: 本文件**不持有模块级可变状态** (无计数器、无缓存), 每次调用只按入参行事;
//   复位动作由调用方在 beforeEach / afterEach 里显式触发.

import { vi } from 'vitest';

/** 可复位的 mock 替身 (vi.fn / vi.spyOn 造出来的替身都满足). */
export interface ResettableMock {
  mockReset(): unknown;
  mockClear(): unknown;
}

/** 一组具名替身 (名字只用于报错定位, 复位时逐个处理). */
export type MockDoubles = Readonly<Record<string, ResettableMock | readonly ResettableMock[]>>;

/**
 * 重置一组模块级替身: 清调用计数 + 清一次性实现 + 还原默认实现.
 *
 * 为什么用 mockReset 而不是 mockClear:
 *   mockClear 只清调用记录; 用例里 mockRejectedValueOnce(...) 这类**一次性实现**会留在替身上,
 *   后序用例没触发到就会带着旧实现跑 (跨用例污染).
 *   vi.fn(impl) 的 mockReset 会**还原成 vi.fn 工厂里给的默认实现** (vitest 5 语义:
 *   resetToMockImplementation=true), 既清计数也清一次性实现 —— 这正是"复位"要的口径.
 *
 * @param doubles 替身集合
 */
export function resetMockDoubles(doubles: MockDoubles): void {
  for (const mock of flattenDoubles(doubles)) mock.mockReset();
}

/**
 * 还原所有 vi.spyOn 替身 (含前序用例失败时残留的 spy).
 *
 * 注意: vi.restoreAllMocks() 只还原 spy, **不动** vi.fn 造的模块级替身 ——
 *   那部分由 resetMockDoubles 负责, 两者职责不重叠.
 */
export function restoreSpies(): void {
  vi.restoreAllMocks();
}

/**
 * 清掉所有 mock 替身的调用记录 (不动实现).
 *
 * 用于"替身只是只读计数器、断言不看次数"的场景 (共享 embedder 之类).
 */
export function clearMockCalls(): void {
  vi.clearAllMocks();
}

/**
 * spec 级统一复位: 还原 spy + 重置模块级替身.
 *
 * @param doubles 需要复位的模块级替身 (缺省 = 只还原 spy)
 */
export function resetTestDoubles(doubles?: MockDoubles): void {
  restoreSpies();
  if (doubles !== undefined) resetMockDoubles(doubles);
}

/** env 快照 (记录若干键的原始值; 原本不存在 = undefined). */
export interface EnvSnapshot {
  readonly entries: readonly (readonly [string, string | undefined])[];
}

/**
 * 读取一批 env 键的当前值 (只读, 不改 env).
 *
 * @param keys env 键名
 * @returns 快照
 */
export function snapshotEnv(keys: readonly string[]): EnvSnapshot {
  return { entries: keys.map((key) => [key, process.env[key]] as const) };
}

/**
 * 还原 env 快照: 原本不存在的键 → delete; 原本有值 → 赋回原值.
 *
 * @param snapshot 快照
 */
export function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of snapshot.entries) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * 在快照保护下跑一段逻辑 (结束即还原, 异常路径也还原).
 *
 * @param keys 要保护的 env 键名
 * @param run 逻辑体
 * @returns 逻辑体的返回值
 */
export function withEnvSnapshot<T>(keys: readonly string[], run: () => T): T {
  const snapshot = snapshotEnv(keys);
  try {
    return run();
  } finally {
    restoreEnv(snapshot);
  }
}

/** 把替身集合摊平成一维列表 (值可以是单个替身或替身数组). */
function flattenDoubles(doubles: MockDoubles): ResettableMock[] {
  const flat: ResettableMock[] = [];
  for (const value of Object.values(doubles)) {
    if (Array.isArray(value)) flat.push(...(value as readonly ResettableMock[]));
    else flat.push(value as ResettableMock);
  }
  return flat;
}
