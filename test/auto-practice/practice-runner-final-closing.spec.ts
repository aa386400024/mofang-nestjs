// AF-143 · runner 侧最终收束触发条件单测
//   关键回归：到 maxTurns 必触发，不再依赖“拼接文本 complete”而漏掉最终通道。

import { describe, expect, it } from 'vitest';

import { shouldForceFinalClosing } from '../../src/auto-practice/practice-runner.service.js';
import { resolveSessionProfile } from '../../src/auto-practice/session-profile.js';

describe('AF-143 · shouldForceFinalClosing', () => {
  const long = resolveSessionProfile('long');

  it('maxTurns 当轮必触发', () => {
    expect(shouldForceFinalClosing(long, 50, 50, false)).toBe(true);
  });

  it('maxTurns 之前不触发', () => {
    expect(shouldForceFinalClosing(long, 49, 50, false)).toBe(false);
  });

  it('危机窗内不抢风险收束', () => {
    expect(shouldForceFinalClosing(long, 50, 50, true)).toBe(false);
  });

  it('legacy 档保持原行为，不启用最终通道', () => {
    expect(shouldForceFinalClosing(resolveSessionProfile('legacy'), 15, 15, false)).toBe(false);
  });
});
