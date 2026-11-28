// V2026-11-29 (Phase3 Judge Layer P0 · 指纹):
//   职责: 把 Judge 的 Rubric 配置与脱敏输入压成**可复现**的 SHA-256 指纹.
//   边界: 纯函数, 零 IO; 键序规范化后再哈希, 同一份配置跨机器结果一致.
//
//   为什么要"稳定 JSON"而不是直接 JSON.stringify:
//     对象字面量的键顺序在 TypeScript 里是稳定的, 但一旦配置由不同模块拼装
//     (或将来从 DB 读回), 键序就可能不同 —— 直接 stringify 会得到不同哈希,
//     血缘看起来像"换过 Rubric", 实际没有. 所以先递归按键名排序再序列化.

import { createHash } from 'node:crypto';

import type { JudgeReviewInput } from './judge.types.js';

/**
 * 递归规范化: 数组保序, 对象按键名升序.
 *
 * @param value 任意 JSON 值
 * @returns 规范化后的值
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).toSorted((left, right) => left.localeCompare(right))) out[key] = normalize(record[key]);
    return out;
  }
  return value;
}

/**
 * 稳定序列化 (键序无关).
 *
 * @param value 任意 JSON 值
 * @returns 稳定 JSON 文本
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/**
 * 取 SHA-256 十六进制摘要.
 *
 * @param text 输入文本
 * @returns 64 位十六进制摘要
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 评审输入指纹: Rubric / Prompt 版本 + 脱敏后输入 + 排除轮结论.
 *
 * ⚠️ 指纹只覆盖**脱敏后**内容 —— 原始文本不参与, 也就不可能从指纹反推原文.
 *
 * @param input 脱敏后的场次输入
 * @returns 64 位十六进制指纹
 */
export function computeJudgeInputFingerprint(input: JudgeReviewInput): string {
  return sha256Hex(
    stableStringify({
      sessionId: input.sessionId,
      rubricVersion: input.lineage.rubricVersion,
      promptVersion: input.lineage.promptVersion,
      l0: input.l0,
      l1: input.l1,
      redactedExcerpts: input.redactedExcerpts,
      excludedTurns: input.excludedTurns,
    }),
  );
}
