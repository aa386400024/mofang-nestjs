// V2026-11-08 治本 (影子模式统计面板 · 时间窗口扩展):
//   覆盖从 `admin-debug/cost-view.ts` 抽出来的**共享**上海日历口径.
//   为什么要有这份测试: 这套口径被**三处**复用 (成本看板 / 仪表盘 / 审议统计日 key),
//   一旦漂了, 三处的"今天"就不是同一天 —— 但那不会报错, 只会让数字对不上.
//
//   验证: npx vitest run test/shared/shanghai-date.spec.ts

import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  SHANGHAI_OFFSET_MS,
  isShanghaiDateKey,
  shanghaiDateKey,
  shanghaiDateKeyRange,
  shanghaiDayStartUtc,
  shanghaiDayStartUtcOfKey,
} from '../../src/shared/time/shanghai-date.js';

describe('共享日历口径 · Asia/Shanghai (UTC+8)', () => {
  it('日期键: 北京时间 08:00 之前算前一天 (不是 UTC 日, 也不是服务器本地日)', () => {
    // 2026-11-07T16:30Z = 上海 2026-11-08 00:30
    expect(shanghaiDateKey(new Date('2026-11-07T16:30:00.000Z'))).toBe('2026-11-08');
    // 2026-11-07T15:59Z = 上海 2026-11-07 23:59 (同一天)
    expect(shanghaiDateKey(new Date('2026-11-07T15:59:59.999Z'))).toBe('2026-11-07');
    // 2026-11-07T00:00Z = 上海 2026-11-07 08:00 (同一天 —— UTC 也是同一天, 但凌晨的轮次会分叉)
    expect(shanghaiDateKey(new Date('2026-11-07T00:00:00.000Z'))).toBe('2026-11-07');
    // UTC 已是 11-08, 但上海还是 11-07 (UTC+8 的核心差异)
    expect(shanghaiDateKey(new Date('2026-11-07T15:00:00.000Z'))).toBe('2026-11-07');
  });

  it('日界: 上海 00:00 对应的 UTC 时刻是前一天 16:00', () => {
    const now = new Date('2026-11-08T03:00:00.000Z'); // 上海 2026-11-08 11:00

    const todayStart = shanghaiDayStartUtc(now, 0);
    expect(todayStart.toISOString()).toBe('2026-11-07T16:00:00.000Z');

    const yesterdayStart = shanghaiDayStartUtc(now, 1);
    expect(yesterdayStart.toISOString()).toBe('2026-11-06T16:00:00.000Z');
    expect(shanghaiDateKey(yesterdayStart)).toBe('2026-11-07');
  });

  it('日期键 → 日界: 往返一致', () => {
    const start = shanghaiDayStartUtcOfKey('2026-11-08');
    expect(start.toISOString()).toBe('2026-11-07T16:00:00.000Z');
    expect(shanghaiDateKey(start)).toBe('2026-11-08');
  });

  it('日期键校验: 形状对**不等于**日期存在', () => {
    expect(isShanghaiDateKey('2026-11-08')).toBe(true);
    expect(isShanghaiDateKey('2026-02-28')).toBe(true);
    expect(isShanghaiDateKey('2026-02-30')).toBe(false);
    expect(isShanghaiDateKey('2026-13-01')).toBe(false);
    expect(isShanghaiDateKey('2026-00-10')).toBe(false);
    expect(isShanghaiDateKey('2026-1-1')).toBe(false);
    expect(isShanghaiDateKey('26-01-01')).toBe(false);
    expect(isShanghaiDateKey('')).toBe(false);
  });

  it('日期区间: 闭区间, 升序, 一天不多一天不少', () => {
    expect(shanghaiDateKeyRange('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(shanghaiDateKeyRange('2026-11-01', '2026-11-01')).toEqual(['2026-11-01']);
    // 跨月
    expect(shanghaiDateKeyRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('日期区间: 跨年也连续 (不漏 2 月 29 日那种天)', () => {
    const range = shanghaiDateKeyRange('2028-02-27', '2028-03-01');
    expect(range).toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('常量: 固定 UTC+8, 一天 24 小时 (上海无 DST, 固定偏移成立)', () => {
    expect(SHANGHAI_OFFSET_MS).toBe(8 * 60 * 60 * 1000);
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
});
