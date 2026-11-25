import { describe, expect, it } from 'vitest';

import { QuotaLotSource } from '../../src/membership/domain/membership.enums.js';
import { allocateQuota, refundAllocations } from '../../src/membership/providers/quota-allocator.js';

const NOW = new Date('2026-11-25T00:00:00+08:00');
const LATER = new Date('2027-01-25T00:00:00+08:00');
const EARLIER = new Date('2026-12-25T00:00:00+08:00');

describe('AF-512 配额分配顺序', () => {
  it('套餐 → 活动 → 加包 → 迁移，且同来源先到期先扣', () => {
    const result = allocateQuota(
      [
        { id: 'addon', source: QuotaLotSource.Addon, minutesRemaining: 100, expiresAt: LATER },
        { id: 'promo', source: QuotaLotSource.Promotion, minutesRemaining: 50, expiresAt: EARLIER },
        { id: 'plan-late', source: QuotaLotSource.Plan, minutesRemaining: 30, expiresAt: LATER },
        { id: 'plan-early', source: QuotaLotSource.Plan, minutesRemaining: 10, expiresAt: EARLIER },
        { id: 'migration', source: QuotaLotSource.Migration, minutesRemaining: 70, expiresAt: LATER },
      ],
      60,
      NOW,
    );

    expect(result.allocatedMinutes).toBe(60);
    expect(result.allocations).toEqual([
      { lotId: 'plan-early', minutes: 10 },
      { lotId: 'plan-late', minutes: 30 },
      { lotId: 'promo', minutes: 20 },
    ]);
  });

  it('过期 lot 不参与分配', () => {
    const result = allocateQuota(
      [{ id: 'expired', source: QuotaLotSource.Plan, minutesRemaining: 100, expiresAt: new Date('2026-11-01T00:00:00+08:00') }],
      10,
      NOW,
    );
    expect(result.allocatedMinutes).toBe(0);
    expect(result.allocations).toEqual([]);
  });

  it('余额不足返回已分配部分，不抛错', () => {
    const result = allocateQuota([{ id: 'plan', source: QuotaLotSource.Plan, minutesRemaining: 7, expiresAt: LATER }], 10, NOW);
    expect(result.allocatedMinutes).toBe(7);
    expect(result.allocations).toEqual([{ lotId: 'plan', minutes: 7 }]);
  });

  it('退款按原路径反向退回', () => {
    const refund = refundAllocations(
      [
        { lotId: 'plan', minutes: 10 },
        { lotId: 'promo', minutes: 20 },
      ],
      15,
    );
    expect(refund).toEqual([{ lotId: 'promo', minutes: 15 }]);
  });

  it('非法分钟数直接拒绝', () => {
    expect(() => allocateQuota([], 1.5, NOW)).toThrow(RangeError);
    expect(() => allocateQuota([], -1, NOW)).toThrow(RangeError);
    expect(() => refundAllocations([], 1.5)).toThrow(RangeError);
  });
});
