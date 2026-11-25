import { QuotaLotSource } from '../domain/membership.enums.js';
import type { QuotaAllocation, QuotaAllocationResult, QuotaLotSnapshot } from '../domain/membership.types.js';
import { MEMBERSHIP_QUOTA_RULES } from '../membership.constants.js';

const SOURCE_PRIORITY: ReadonlyMap<QuotaLotSource, number> = new Map(
  MEMBERSHIP_QUOTA_RULES.deductionOrder.map((source, index) => [source, index]),
);

/**
 * 纯分配器：只回答“从哪些 lot 扣多少”，不写库。
 *
 * 顺序：套餐 → 活动赠送 → 加包 → 迁移存量；同来源先到期的先扣。
 * 余额不足时返回已分配部分，由调用方决定拒绝还是记录 shortfall。
 */
export function allocateQuota(lots: readonly QuotaLotSnapshot[], requestedMinutes: number, now: Date): QuotaAllocationResult {
  if (!Number.isInteger(requestedMinutes) || requestedMinutes < 0) {
    throw new RangeError('requestedMinutes 必须是非负整数');
  }

  const candidates = lots
    .filter((lot) => lot.minutesRemaining > 0 && lot.expiresAt.getTime() > now.getTime())
    .toSorted((left, right) => {
      const priorityDiff = (SOURCE_PRIORITY.get(left.source) ?? 99) - (SOURCE_PRIORITY.get(right.source) ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return left.expiresAt.getTime() - right.expiresAt.getTime();
    });

  const allocations: QuotaAllocation[] = [];
  let remaining = requestedMinutes;

  for (const lot of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.minutesRemaining);
    if (take <= 0) continue;
    allocations.push({ lotId: lot.id, minutes: take });
    remaining -= take;
  }

  return {
    allocations,
    allocatedMinutes: requestedMinutes - remaining,
    requestedMinutes,
  };
}

/** 纯退款：按原分配路径退回，返回每个 lot 应加回多少分钟。 */
export function refundAllocations(allocations: readonly QuotaAllocation[], refundMinutes: number): QuotaAllocation[] {
  if (!Number.isInteger(refundMinutes) || refundMinutes < 0) {
    throw new RangeError('refundMinutes 必须是非负整数');
  }

  const result: QuotaAllocation[] = [];
  let remaining = refundMinutes;

  for (const allocation of [...allocations].reverse()) {
    if (remaining <= 0) break;
    const refund = Math.min(remaining, allocation.minutes);
    if (refund <= 0) continue;
    result.push({ lotId: allocation.lotId, minutes: refund });
    remaining -= refund;
  }

  return result;
}
