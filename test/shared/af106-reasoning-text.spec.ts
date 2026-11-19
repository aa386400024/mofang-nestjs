// V2026-11-18 治本 (AF-106 · 推理块零泄漏):
//   钉死共享清洗函数的四条契约:
//     1. 闭合 `<think>` 块被删除;
//     2. 未闭合 `<think>` 尾块被删除（截断场景）;
//     3. `stripReasoningBlocks` 做 trim, `removeReasoningBlocks` 保留空白;
//     4. `safeVisiblePrefix` 对流式半截标签扣住不发, 闭合后才放行.
//
//   为什么单独测共享层: 适配器和咨询师可见输出都依赖它，任一处改坏都会同时影响
//   逐字稿、历史与 TTS；这里用纯函数把边界钉住，不依赖 NestJS / LLM / DB.

import { describe, expect, it } from 'vitest';

import { removeReasoningBlocks, safeVisiblePrefix, stripReasoningBlocks } from '../../src/shared/llm/reasoning-text.js';

describe('AF-106 · reasoning-text', () => {
  it('删除闭合的 `<think>` 块, 保留前后可见台词', () => {
    expect(stripReasoningBlocks('<think>内部推理</think>可见台词')).toBe('可见台词');
    expect(stripReasoningBlocks('前文<THINK>内部</THINK>后文')).toBe('前文后文');
  });

  it('删除命名空间 `<mm:think>` 与孤立 `</mm:think>`', () => {
    expect(stripReasoningBlocks('<mm:think>内部推理</mm:think>可见台词')).toBe('可见台词');
    expect(stripReasoningBlocks('可见台词</mm:think>')).toBe('可见台词');
    expect(stripReasoningBlocks('可见台词<mm:think>被截断的推理')).toBe('可见台词');
  });

  it('删除未闭合的 `<think>` 尾块 (截断场景)', () => {
    expect(stripReasoningBlocks('可见台词<think>被截断的推理')).toBe('可见台词');
  });

  it('strip 做 trim, remove 保留其余空白', () => {
    expect(stripReasoningBlocks('  <think>x</think> 你好  ')).toBe('你好');
    expect(removeReasoningBlocks('  <think>x</think> 你好  ')).toBe('   你好  ');
  });

  it('safeVisiblePrefix 扣住半截 `<think>` 标签, 闭合后放行后续台词', () => {
    expect(safeVisiblePrefix('你好<thi')).toBe('你好');
    expect(safeVisiblePrefix('你好<think>推理')).toBe('你好');
    expect(safeVisiblePrefix('你好<think>推理</think>再见')).toBe('你好再见');
  });

  it('safeVisiblePrefix 扣住半截命名空间标签与孤立闭合标签', () => {
    expect(safeVisiblePrefix('你好<mm:thi')).toBe('你好');
    expect(safeVisiblePrefix('你好<mm:think>推理')).toBe('你好');
    expect(safeVisiblePrefix('你好<mm:think>推理</mm:think>再见')).toBe('你好再见');
    expect(safeVisiblePrefix('你好</mm:think>再见')).toBe('你好再见');
  });

  it('safeVisiblePrefix 对普通文本不扣字', () => {
    expect(safeVisiblePrefix('我最近有点累。')).toBe('我最近有点累。');
    expect(safeVisiblePrefix('小于号<不是标签')).toBe('小于号<不是标签');
    // 回归：`<5` 是正常文本，不能被当成半截标签扣住（否则流结束时永远发不出去）。
    expect(safeVisiblePrefix('价格<5')).toBe('价格<5');
  });
});
