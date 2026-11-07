// V2026-11-08 WP62 (引擎内核 · 端口类型 barrel 收口):
//   目的: 钉死"适配层不再自带内核符号的副本"这件事 ——
//     ① 内核 barrel 导出的 `clamp01` / `clampValence` / `RecallPolicyOptions`
//        **行为口径**与内核内部那一份逐字一致 (适配层用的就是它, 不是另一份);
//     ② 适配层**不得再出现自写的 clamp01 / clampValence 实现** ——
//        仓库既有教训: 判定逻辑写两份迟早分叉. 这条断言是**机器守卫**:
//        哪天有人又在适配层写一份 clamp, 这条立刻红.
//     ③ `toRecallPolicyOptions()` 的返回值**类型上就是**内核的 `RecallPolicyOptions`
//        (不是结构化替身) —— 内核端口改字段名, 这里编译期就红.
//
//   为什么要有第 ② 条 (源码文本扫描看起来很土):
//     本单的核心问题不是"少一个导出", 而是"同一件事写了两遍". 而"少一个导出"
//     由 boundary 断言⑥守住, "写了两遍"只能靠扫描适配层源码守住 ——
//     断言⑥ 管的是"内核公开面", 管不到"适配层有没有自己抄一份".
//
//   反依赖污染:
//     本文件只 import 内核 barrel + 读适配层源码文本 —— 不起容器、不发网络、不连上游.
//
//   验证: npx vitest run test/engine-adapters/wp62-kernel-barrel-types.spec.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { toRecallPolicyOptions } from '../../src/engine-adapters/persistence/memory-config.js';
import { clamp01, clampValence, type RecallPolicyOptions } from '../../src/engine-core/index.js';

const ROOT = path.join(__dirname, '..', '..');

/** 适配层里**曾经**自带 clamp 副本的三个文件. */
const ADAPTER_FILES = [
  'src/engine-adapters/persistence/memory-config.ts',
  'src/engine-adapters/persistence/qdrant-memory.store.ts',
  'src/engine-adapters/wiring/character/builtin-character-registry.ts',
];

describe('WP62 · 内核端口类型 barrel 收口', () => {
  it('① 内核 barrel 导出的 clamp01 / clampValence 口径逐字钉死', () => {
    // clamp01: 越界夹取; NaN → 0 (不是透传 —— 透传的 NaN 会污染下游排序比较).
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    // clampValence: [-1,1]; NaN → 0.
    expect(clampValence(0.5)).toBe(0.5);
    expect(clampValence(-2)).toBe(-1);
    expect(clampValence(2)).toBe(1);
    expect(clampValence(Number.NaN)).toBe(0);
  });

  it('② 适配层不得再自带 clamp01 / clampValence 实现 (机器守卫: 两份 = 迟早分叉)', () => {
    for (const relative of ADAPTER_FILES) {
      const source = readFileSync(path.join(ROOT, relative), 'utf8');
      // 只看**函数声明** (function clamp01(...) / function clampValence(...)),
      // 不看调用与注释 —— 调用是应该的, 注释里提到"内核 clamp01"更是必须的.
      const declaresClamp01 = /function\s+clamp01\s*\(/.test(source);
      const declaresClampValence = /function\s+clampValence\s*\(/.test(source);
      expect(
        { file: relative, declaresClamp01, declaresClampValence },
        `${relative} 不得再声明本地 clamp01 / clampValence —— 直接从内核 barrel import`,
      ).toEqual({ file: relative, declaresClamp01: false, declaresClampValence: false });
    }
  });

  it('③ 适配层从 barrel import 内核符号 (不走深路径 —— 深路径 import 被断言 ⑪ 拦)', () => {
    // 只看 **import 说明符** (from '...' 的那一段), 不看整份源码 ——
    // 注释里提到 "engine-core/memory/recall-policy.ts" 这类路径是**允许的**
    // (那是给人看的说明), 拿它当违规会误伤, 也守不住真正的问题.
    const importSpecifiers = (source: string): string[] => [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

    for (const relative of ADAPTER_FILES) {
      const source = readFileSync(path.join(ROOT, relative), 'utf8');
      const engineCoreImports = importSpecifiers(source).filter((specifier) => specifier.includes('engine-core/'));
      for (const specifier of engineCoreImports) {
        expect(
          specifier,
          `${relative} 的 engine-core import 只能走 barrel (index.js) 或 in-memory/ —— 深路径 import 不在边界断言⑥的守卫视野内`,
        ).toMatch(/engine-core\/(index\.js|in-memory\/)/);
      }
    }

    // 实际用上内核符号的那两个文件, 必须**确实**从 barrel import.
    const registry = readFileSync(path.join(ROOT, ADAPTER_FILES[2]), 'utf8');
    expect(registry).toMatch(/import\s*\{[^}]*clamp01[^}]*\}\s*from\s*'[^']*engine-core\/index\.js'/);
    const qdrant = readFileSync(path.join(ROOT, ADAPTER_FILES[1]), 'utf8');
    expect(qdrant).toMatch(/import\s*\{[^}]*clamp01[^}]*\}\s*from\s*'[^']*engine-core\/index\.js'/);
  });

  it('④ toRecallPolicyOptions 返回的就是内核端口 (类型不是结构化替身)', () => {
    const options: RecallPolicyOptions = toRecallPolicyOptions({
      decayHalfLifeMs: 30 * 24 * 60 * 60 * 1000,
      recallThreshold: 0.1,
    });
    expect(options.halfLifeMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(options.minEffectiveImportance).toBe(0.1);
  });
});
