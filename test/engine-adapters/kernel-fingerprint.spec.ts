// AF-439 (内核指纹 · 单测):
//   覆盖五条路径:
//     ① 指纹格式 kr1-<16 位十六进制>
//     ② 稳定性: 两次调用相等, 模块级 KERNEL_REF 与之一致
//     ③ 13 个算子齐全, 顺序与 FINGERPRINT_EVENT_KINDS 一致
//     ④ 代表系数与内核 DELTA_TABLE 一致 (neutral 全零 / empathy.trust 0.10 /
//        judgment.trust −0.12 / boundary_cross.style 0.15)
//     ⑤ 指纹确实覆盖系数: 手工改一个维度按同算法重算 → 哈希变
//
//   为什么不写死完整哈希快照: 内核正常调参也会改哈希, 写死会让这条测试变成
//   「每次调参都要改测试」的噪声. 这里断言的是**性质**而不是某个具体值.
//
//   验证: pnpm exec vitest run test/engine-adapters/kernel-fingerprint.spec.ts
//   时间戳: 2026-11-24 GMT+8
import { describe, expect, it } from 'vitest';

import {
  FINGERPRINT_EVENT_KINDS,
  KERNEL_FINGERPRINT_SCHEMA,
  KERNEL_REF,
  KERNEL_REF_HEX_LENGTH,
  KERNEL_REF_PREFIX,
  computeKernelFingerprint,
  fingerprintRows,
  hashFingerprintRows,
} from '../../src/engine-adapters/observability/kernel-fingerprint.js';

describe('kernel fingerprint', () => {
  it('① 指纹格式为 kr1- + 16 位小写十六进制', () => {
    expect(KERNEL_FINGERPRINT_SCHEMA).toBe('kernel-ref-v1');
    expect(KERNEL_REF_HEX_LENGTH).toBe(16);
    expect(KERNEL_REF.startsWith(KERNEL_REF_PREFIX)).toBe(true);
    expect(KERNEL_REF).toMatch(/^kr1-[0-9a-f]{16}$/);
  });

  it('② 稳定: 两次计算相等, 模块级常量与之一致', () => {
    expect(computeKernelFingerprint()).toBe(computeKernelFingerprint());
    expect(KERNEL_REF).toBe(computeKernelFingerprint());
  });

  it('③ 13 个算子齐全且顺序固定', () => {
    const rows = fingerprintRows();
    expect(FINGERPRINT_EVENT_KINDS).toHaveLength(13);
    expect(rows.map((row) => row.kind)).toEqual([...FINGERPRINT_EVENT_KINDS]);
    expect(new Set(FINGERPRINT_EVENT_KINDS).size).toBe(13);
  });

  it('④ 代表系数与内核落地值一致', () => {
    const byKind = new Map(fingerprintRows().map((row) => [row.kind, row.delta]));

    const neutral = byKind.get('neutral');
    expect(neutral).toBeDefined();
    for (const value of Object.values(neutral as unknown as Record<string, number>)) {
      expect(value).toBe(0);
    }

    expect(byKind.get('empathy')?.trust).toBeCloseTo(0.1, 6);
    expect(byKind.get('judgment')?.trust).toBeCloseTo(-0.12, 6);
    expect(byKind.get('boundary_cross')?.style).toBeCloseTo(0.15, 6);
    expect(byKind.get('sensitive_touch')?.arousal).toBeCloseTo(0.15, 6);
  });

  it('⑤ 指纹覆盖系数: 改一个维度 → 哈希变化', () => {
    const rows = fingerprintRows();
    const mutated = rows.map((row) =>
      row.kind === 'empathy' ? { kind: row.kind, delta: { ...row.delta, trust: row.delta.trust + 0.01 } } : row,
    );
    expect(hashFingerprintRows(mutated)).not.toBe(KERNEL_REF);
    // 未改动时同算法重算应与模块级常量一致 (证明差异只来自那一维)
    expect(hashFingerprintRows(rows)).toBe(KERNEL_REF);
  });
});
