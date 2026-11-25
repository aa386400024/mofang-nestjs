import { describe, expect, it, vi } from 'vitest';

import { QuotaLotSource } from '../../src/membership/domain/membership.enums.js';
import { MembershipTier } from '../../src/membership/domain/membership.enums.js';
import { MembershipQuotaLot } from '../../src/membership/entities/membership-quota-lot.entity.js';
import { MembershipQuotaReservation } from '../../src/membership/entities/membership-quota-reservation.entity.js';
import { MEMBERSHIP_PLANS } from '../../src/membership/membership.constants.js';
import { QuotaInsufficientError, QuotaLedgerService, QuotaDailyLimitError } from '../../src/membership/providers/quota-ledger.service.js';

const NOW = new Date('2026-11-25T12:00:00+08:00');

function createLedger() {
  const lots: any[] = [];
  const reservations: any[] = [];

  const lotRepo = {
    find: vi.fn(async () => lots.filter((lot) => lot.minutesRemaining > 0 && lot.expiresAt.getTime() > NOW.getTime())),
    findOne: vi.fn(async ({ where }: { where: { id?: string; uid?: string; source?: QuotaLotSource; orderId?: string } }) => {
      if (where.id) return lots.find((lot) => lot.id === where.id) ?? null;
      return lots.find((lot) => lot.uid === where.uid && lot.source === where.source && lot.orderId === where.orderId) ?? null;
    }),
    save: vi.fn(async (lot: any) => {
      if (!lots.includes(lot)) lots.push(lot);
      return lot;
    }),
    create: vi.fn((value: any) => value),
    createQueryBuilder: vi.fn(() => {
      let uid = '';
      let source: QuotaLotSource | undefined;
      let orderId: string | undefined;
      let referenceKey: string | null = null;
      const builder: any = {
        where: vi.fn((_sql: string, params: { uid: string }) => {
          uid = params.uid;
          return builder;
        }),
        andWhere: vi.fn((sql: string, params: Record<string, string>) => {
          if (sql.includes('lot.source')) source = params.source as QuotaLotSource;
          if (sql.includes('lot.orderId')) orderId = params.orderId;
          if (sql.includes('lot.referenceKey =')) referenceKey = params.referenceKey;
          return builder;
        }),
        setLock: vi.fn(() => builder),
        getMany: vi.fn(async () =>
          lots.filter((lot) => lot.uid === uid && lot.minutesRemaining > 0 && lot.expiresAt.getTime() > NOW.getTime()),
        ),
        getOne: vi.fn(
          async () =>
            lots.find(
              (lot) => lot.uid === uid && lot.source === source && lot.orderId === orderId && (lot.referenceKey ?? null) === referenceKey,
            ) ?? null,
        ),
      };
      return builder;
    }),
  };

  const reservationRepo = {
    findOne: vi.fn(async ({ where }: { where: { id?: string; sessionId?: string; uid?: string } }) => {
      if (where.id) return reservations.find((row) => row.id === where.id && row.uid === where.uid) ?? null;
      if (where.sessionId) return reservations.find((row) => row.sessionId === where.sessionId && row.uid === where.uid) ?? null;
      return null;
    }),
    find: vi.fn(async () => reservations),
    create: vi.fn((value: any) => value),
    save: vi.fn(async (row: any) => {
      if (!reservations.includes(row)) reservations.push(row);
      return row;
    }),
  };

  const manager = {
    getRepository: (entity: unknown) => (entity === MembershipQuotaLot ? lotRepo : reservationRepo),
  };
  const dataSource = {
    transaction: async (callback: (manager: any) => unknown) => callback(manager),
    getRepository: (entity: unknown) => (entity === MembershipQuotaLot ? lotRepo : reservationRepo),
  };

  return { service: new QuotaLedgerService(dataSource as never), lots, reservations, lotRepo, reservationRepo };
}

async function seedPlan(service: QuotaLedgerService, minutes: number) {
  await service.grantPlan(
    'u-1',
    { ...MEMBERSHIP_PLANS[MembershipTier.Plus], monthlyMinutes: minutes },
    'o-seed',
    new Date('2027-11-25T12:00:00+08:00'),
  );
}

describe('AF-512 配额账本', () => {
  it('同一订单重复发放只建一个 lot', async () => {
    const { service, lots } = createLedger();
    await seedPlan(service, 240);
    await seedPlan(service, 240);
    expect(lots.filter((lot) => lot.source === QuotaLotSource.Plan)).toHaveLength(1);
    expect(lots[0]?.minutesRemaining).toBe(240);
  });

  it('预扣 10 分钟落 held，重复 sessionId 幂等不重复扣', async () => {
    const { service, lots, reservations } = createLedger();
    await seedPlan(service, 30);

    const first = await service.reserve('u-1', 's-1', 10, NOW);
    expect(first.idempotent).toBe(false);
    expect(lots[0]?.minutesRemaining).toBe(20);
    expect(reservations[0]?.status).toBe('held');

    const second = await service.reserve('u-1', 's-1', 10, NOW);
    expect(second.idempotent).toBe(true);
    expect(second.reservationId).toBe(first.reservationId);
    expect(lots[0]?.minutesRemaining).toBe(20);
  });

  it('结算实际 6 分钟退回 4 分钟，余额不为负', async () => {
    const { service, lots } = createLedger();
    await seedPlan(service, 30);
    const reserved = await service.reserve('u-1', 's-1', 10, NOW);
    const settled = await service.settle('u-1', reserved.reservationId, 6, NOW);

    expect(settled.status).toBe('settled');
    expect(lots[0]?.minutesRemaining).toBe(24);
    expect(settled.balance.totalRemainingMinutes).toBe(24);
  });

  it('实际超过预扣时继续扣余额，余额不足记 shortfall 不抛负余额', async () => {
    const { service, lots } = createLedger();
    await seedPlan(service, 30);
    const reserved = await service.reserve('u-1', 's-1', 10, NOW);
    const settled = await service.settle('u-1', reserved.reservationId, 20, NOW);

    expect(settled.settledMinutes).toBe(20);
    expect(settled.shortfallMinutes).toBe(0);
    expect(lots[0]?.minutesRemaining).toBe(10);
  });

  it('释放预扣全额退回', async () => {
    const { service, lots } = createLedger();
    await seedPlan(service, 30);
    const reserved = await service.reserve('u-1', 's-1', 10, NOW);
    const released = await service.release('u-1', reserved.reservationId, NOW);

    expect(released.status).toBe('released');
    expect(lots[0]?.minutesRemaining).toBe(30);
  });

  it('余额不足直接拒绝，不产生 held 记录', async () => {
    const { service, lots, reservations } = createLedger();
    await seedPlan(service, 5);

    await expect(service.reserve('u-1', 's-1', 10, NOW)).rejects.toBeInstanceOf(QuotaInsufficientError);
    expect(lots[0]?.minutesRemaining).toBe(5);
    expect(reservations).toHaveLength(0);
  });

  it('每日 180 分钟上限：第 4 次 50 分钟预扣被拒', async () => {
    const { service } = createLedger();
    await seedPlan(service, 500);

    await service.reserve('u-1', 's-1', 50, NOW);
    await service.reserve('u-1', 's-2', 50, NOW);
    await service.reserve('u-1', 's-3', 50, NOW);
    await expect(service.reserve('u-1', 's-4', 50, NOW)).rejects.toBeInstanceOf(QuotaDailyLimitError);
  });
});
