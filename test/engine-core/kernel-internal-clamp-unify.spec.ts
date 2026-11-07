// V2026-11-08 治本 (内核内部 clamp01 统一):
//   目的: 钉死"内核里 clamp01 只有**一份**"这件事 ——
//     ① 内核公开那份 `clamp01` 的口径逐字钉死 (NaN → 0);
//     ② `decayImportance` / `effectiveImportance` 对 NaN 输入**不再产出 NaN**
//        (旧口径 NaN 透传 —— 会一路传到召回排序, 比较恒 false, 排序不可预期);
//     ③ **机器守卫**: 内核树里不得再出现第二份 `function clamp01(` 声明 ——
//        这条是本单的核心问题本身, 靠代码评审守住不可靠.
//
//   为什么 ③ 是机器守卫而不是注释:
//     任务单 §一 说的正是"名字一样 = 最容易踩". 内核里两份同名不同义的
//     clamp01 存在了很久没人动 —— 因为它"看起来是正常的". 只有一条会红的
//     断言才能保证它不再长回来.
//
//   为什么 ② 要单独测 (而不是只测 ①):
//     `decayImportance` 是内核**公开导出**的函数, 外部可以直接调用它.
//     旧口径下 `decayImportance(NaN, 0)` 返回 NaN, 违反它自己的文档契约
//     ("结果恒在 [0,1]") —— 契约与实现不一致, 才是真正该钉死的那条.
//
//   反依赖污染:
//     本文件只 import 内核 barrel —— 不起容器、不发网络、不连上游.
//
//   验证: npx vitest run test/engine-core/kernel-internal-clamp-unify.spec.ts

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_DECAY_HALF_LIFE_MS,
  MemorySource,
  MemoryTier,
  clamp01,
  decayImportance,
  effectiveImportance,
  type MemoryEntry,
} from '../../src/engine-core/index.js';

const KERNEL_ROOT = path.join(__dirname, '..', '..', 'src', 'engine-core');

/** 内核里**应该**只有这一处 clamp01 声明 (domain/emotion.ts 那份, 且它已进 barrel). */
const ALLOWED_CLAMP01_DECLARATION = path.join('domain', 'emotion.ts');

/** 递归列出内核树下所有 .ts 文件. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('内核内部 clamp01 统一', () => {
  it('① 公开那份 clamp01 的口径逐字钉死 (NaN → 0, 越界夹取)', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('② decayImportance 对 NaN 不再产出 NaN (旧口径是透传) —— 结果恒在 [0,1]', () => {
    // 旧口径: clamp01(NaN) 透传 → base=NaN → base*factor=NaN → 结果 NaN.
    expect(decayImportance(Number.NaN, 0)).toBe(0);
    expect(decayImportance(Number.NaN, 1_000_000)).toBe(0);
    // 非 NaN 的边界值逐字不变 (两版口径完全一致).
    expect(decayImportance(0.6, 0)).toBeCloseTo(0.6, 10);
    expect(decayImportance(5, 0)).toBe(1);
    expect(decayImportance(-1, 0)).toBe(0);
    expect(decayImportance(1, DEFAULT_DECAY_HALF_LIFE_MS)).toBeCloseTo(0.5, 10);
  });

  it('③ effectiveImportance 对 NaN importance 产出 0 而不是 NaN (排序不再被 NaN 污染)', () => {
    const entry: MemoryEntry = {
      tenantId: 'default',
      id: 'lt-1',
      sessionId: 'session-a',
      visitorId: 'visitor-1',
      tier: MemoryTier.LONG_TERM,
      source: MemorySource.SUMMARY,
      content: '来访者长期提到失眠',
      // 病态值: 旧口径 (NaN 透传) 下会一路传到召回排序.
      importance: Number.NaN,
      occurredAt: 1_700_000_000_000,
    };

    const effective = effectiveImportance(entry, entry.occurredAt);
    expect(Number.isNaN(effective)).toBe(false);
    expect(effective).toBe(0);
  });

  it('④ 机器守卫: 内核树里不得再出现第二份 clamp01 声明 (同名不同语义 = 最容易踩)', () => {
    const declarations: string[] = [];
    for (const file of collectTsFiles(KERNEL_ROOT)) {
      const source = readFileSync(file, 'utf8');
      if (/function\s+clamp01\s*\(/.test(source)) {
        declarations.push(path.relative(KERNEL_ROOT, file).replaceAll('\\', '/'));
      }
    }
    // 只允许 domain/emotion.ts 那一份 (它已进 barrel, 公开面).
    expect(declarations).toEqual(['domain/emotion.ts']);
  });
});
