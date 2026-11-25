/** 会员域纯时间/金额辅助函数，禁止依赖 NestJS 或数据库。 */

export function addMonths(base: Date, months: number): Date {
  const result = new Date(base);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function addYears(base: Date, years: number): Date {
  return addMonths(base, years * 12);
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

export function startOfDay(base: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
}

export function endOfDay(base: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
}

export function currentPeriod(base: Date = new Date()): string {
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}

export function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} 必须是非负整数，收到 ${value}`);
  }
}
