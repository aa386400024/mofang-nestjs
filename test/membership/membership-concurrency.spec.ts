import { describe, expect, it } from 'vitest';

import { forEachWithConcurrency, MEMBERSHIP_CRON_CONCURRENCY } from '../../src/membership/providers/concurrency.js';

describe('AF-595 · 会员 cron 有界并发', () => {
  it('全部处理且同时在跑的任务数不超过上限', async () => {
    let active = 0;
    let maxActive = 0;
    const processed: number[] = [];

    await forEachWithConcurrency(
      Array.from({ length: 40 }, (_, i) => i),
      8,
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        processed.push(item);
        active -= 1;
      },
    );

    expect(processed).toHaveLength(40);
    expect(new Set(processed).size).toBe(40);
    expect(maxActive).toBeLessThanOrEqual(MEMBERSHIP_CRON_CONCURRENCY);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('空列表直接返回，不启动协程', async () => {
    await expect(
      forEachWithConcurrency([], MEMBERSHIP_CRON_CONCURRENCY, async () => {
        throw new Error('never');
      }),
    ).resolves.toBeUndefined();
  });
});
