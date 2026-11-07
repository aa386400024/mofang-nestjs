// V2026-11-08 治本 (影子模式统计面板 · 时间窗口扩展):
//   职责: 仓库里**一份** Asia/Shanghai (UTC+8) 的"按天"口径 ——
//         成本看板 / 仪表盘 / 审议统计日 key 全部走这里.
//   边界: 纯函数; 零 @nestjs/* / IO / 日志 / env.
//
//   为什么从 `admin-debug/cost-view.ts` 抽出来 (而不是各写一份):
//     审议统计的**写侧**在 `engine-adapters/deliberation/` —— 那层比 admin-debug 更靠下.
//     让适配层反过来 import admin-debug 是**反向依赖** (下层依赖上层), 迟早成环;
//     两边各写一份日期口径 = 两张会漂的日历
//     (仓库既有纪律: "两处各算一遍 = 两张会漂的定价表").
//     抽到 shared/ 是唯一能同时喂饱上层的干净位置.
//
//   时区口径 (沿用 WP31 的理由, 不重新发明):
//     · 不用 UTC: 北京时间 08:00 之前开的场会被切到前一天, 运营看"今天"会觉得数字对不上.
//     · 不用服务器本地时区: 本地开发机 (UTC+8) 与生产容器 (常是 UTC) 的分桶边界不同
//       → 同一批数据在两个环境里落进不同的天, 不可比.
//     · 固定 UTC+8: 中国无 DST, 边界确定, 与运行环境无关.
//
//   验证: npx vitest run test/shared/shanghai-date.spec.ts

/** Asia/Shanghai 的 UTC 偏移 (毫秒); 该时区无 DST, 固定偏移成立. */
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 一天的毫秒数 (上海无 DST → 固定 24h 步进成立). */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 日期格式化器 (Asia/Shanghai → `YYYY-MM-DD`).
 *
 * 为什么用 `en-CA`: 这个 locale 的短日期格式**就是** `YYYY-MM-DD` (ISO 序),
 * 不用自己拼 `getFullYear()` + 补零 —— 那样在别的 locale 下就散了.
 * 用 `Intl` 而不是引 luxon: 仓库既有做法 (`home-micro-intervention-stats.service.ts`).
 */
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 日期键的形状 (`YYYY-MM-DD`). */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 取某时刻在 Asia/Shanghai 的日期键 (`YYYY-MM-DD`).
 *
 * @param date 时刻
 * @returns 日期键
 */
export function shanghaiDateKey(date: Date): string {
  return SHANGHAI_DATE_FORMATTER.format(date);
}

/**
 * 取 Asia/Shanghai 某天的 00:00 对应的 **UTC 时刻**.
 *
 * @param now 参考时刻 (取它的上海日期)
 * @param daysBack 往前推几天 (0 = 今天)
 * @returns UTC 时刻
 */
export function shanghaiDayStartUtc(now: Date, daysBack: number): Date {
  const [year, month, day] = shanghaiDateKey(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS - daysBack * DAY_MS);
}

/**
 * 判断一个字符串是不是**合法**的日期键 (`YYYY-MM-DD`).
 *
 * ⚠️ 形状对**不等于**日期存在 —— `2026-02-30` 形状对但那天不存在.
 *   这里用"造一个 UTC 时刻再读回来"的往返校验 (`2026-02-30` 会被 JS 归一成 03-02,
 *   读回来对不上 → 判非法).
 *
 * @param value 待校验的字符串
 * @returns 是否合法日期键
 */
export function isShanghaiDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * 日期键 → 该日上海 00:00 的 **UTC 时刻**.
 *
 * @param dayKey 日期键 (`YYYY-MM-DD`)
 * @returns UTC 时刻
 */
export function shanghaiDayStartUtcOfKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS);
}

/**
 * 列出**闭区间**内的每一天的日期键 (升序).
 *
 * 为什么按上海日界步进而不是按 UTC 天步进:
 *   上海午夜对应的 UTC 时刻是 16:00 (前一天); 按 24h 步进落在**下一个**上海午夜 ——
 *   上海无 DST, 步进永远对齐日界, 不会像有 DST 的时区那样少一天或多一天.
 *
 * @param fromKey 起始日 (含)
 * @param toKey 结束日 (含)
 * @returns 日期键列表 (升序)
 */
export function shanghaiDateKeyRange(fromKey: string, toKey: string): string[] {
  const start = shanghaiDayStartUtcOfKey(fromKey).getTime();
  const end = shanghaiDayStartUtcOfKey(toKey).getTime();
  const keys: string[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    keys.push(shanghaiDateKey(new Date(cursor)));
  }
  return keys;
}
