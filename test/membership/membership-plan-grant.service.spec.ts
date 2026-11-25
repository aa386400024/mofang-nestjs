import { describe, expect, it, vi } from 'vitest';

import { MembershipPlanGrantStatus, MembershipTier } from '../../src/membership/domain/membership.enums.js';
import { MembershipPlanGrantService } from '../../src/membership/providers/membership-plan-grant.service.js';

function createService() {
  const term = {
    id: 'term-1',
    uid: 'u-1',
    orderId: 'o-annual',
    tier: MembershipTier.Plus,
    monthlyMinutes: 240,
    termStart: new Date('2026-11-25T12:00:00+08:00'),
    termEnd: new Date('2027-11-25T12:00:00+08:00'),
    nextGrantAt: new Date('2026-12-25T12:00:00+08:00'),
    monthsTotal: 12,
    monthsGranted: 1,
    status: MembershipPlanGrantStatus.Active,
  };
  const termRepo = {
    find: vi.fn().mockResolvedValue([term]),
    findOne: vi.fn(),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
    createQueryBuilder: vi.fn(),
  };
  const managedRepo = {
    findOne: vi.fn().mockResolvedValue(term),
    save: vi.fn(async (value: unknown) => value),
  };
  const dataSource = {
    transaction: async (callback: (manager: unknown) => unknown) => callback({ getRepository: () => managedRepo }),
  };
  const quotaLedger = { grantPlan: vi.fn().mockResolvedValue() };
  const service = new MembershipPlanGrantService(termRepo as never, quotaLedger as never, dataSource as never);
  return { service, term, termRepo, managedRepo, quotaLedger };
}

describe('AF-516 年付按月发放', () => {
  it('到期只补发缺失月份，并用 plan:N 作为幂等子键', async () => {
    const { service, quotaLedger } = createService();

    const granted = await service.refreshForUid('u-1', new Date('2026-12-26T12:00:00+08:00'));

    expect(granted).toBe(1);
    expect(quotaLedger.grantPlan).toHaveBeenCalledTimes(1);
    expect(quotaLedger.grantPlan.mock.calls[0][5]).toBe('plan:2');
    expect(quotaLedger.grantPlan.mock.calls[0][3].toISOString()).toBe('2027-01-25T04:00:00.000Z');
  });

  it('同一 term 重跑不会重复补发已发月份', async () => {
    const { service, quotaLedger, term } = createService();
    term.monthsGranted = 2;
    term.nextGrantAt = new Date('2027-01-25T12:00:00+08:00');

    const granted = await service.refreshForUid('u-1', new Date('2026-12-26T12:00:00+08:00'));

    expect(granted).toBe(0);
    expect(quotaLedger.grantPlan).not.toHaveBeenCalled();
  });

  it('升级换档会取消旧 term，避免旧订单继续发分钟', async () => {
    const { service, termRepo } = createService();
    const execute = vi.fn().mockResolvedValue({ affected: 2 });
    const queryBuilder = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute,
    };
    termRepo.createQueryBuilder = vi.fn(() => queryBuilder);

    await service.cancelActiveTerms('u-1', 'o-new', { getRepository: () => termRepo } as never);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('orderId <> :exceptOrderId', { exceptOrderId: 'o-new' });
  });
});
