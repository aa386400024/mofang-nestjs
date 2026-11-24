// AF-475 · 单进程逐轮配对顺序护栏.
import { describe, expect, it } from 'vitest';

import { pairedTurnOrder } from '../paired-order.mjs';

describe('paired-order', () => {
  it('偶数轮 base 先发，奇数轮 active 先发', () => {
    expect(pairedTurnOrder(0)).toEqual(['base', 'active']);
    expect(pairedTurnOrder(1)).toEqual(['active', 'base']);
    expect(pairedTurnOrder(2)).toEqual(['base', 'active']);
    expect(pairedTurnOrder(29)).toEqual(['active', 'base']);
  });

  it('30 轮里两边各先发 15 次', () => {
    let baseFirst = 0;
    let activeFirst = 0;
    for (let turnIndex = 0; turnIndex < 30; turnIndex += 1) {
      const order = pairedTurnOrder(turnIndex);
      if (order[0] === 'base') baseFirst += 1;
      else activeFirst += 1;
    }
    expect(baseFirst).toBe(15);
    expect(activeFirst).toBe(15);
  });

  it('非法轮次直接报错，不静默回退', () => {
    expect(() => pairedTurnOrder(-1)).toThrow(/非负整数/u);
    expect(() => pairedTurnOrder(1.5)).toThrow(/非负整数/u);
  });
});
