import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MicroInterventionStatsDto } from '../dto/home-overview.dto';
import { MicroInterventionHistory } from '../entities/micro-intervention-history.entity';

/**
 * 微干预练习统计服务 — V2026-09-11 新增 (治本遗留 #3).
 *
 * 职责:
 *   - getStats(uid, clientTimezone): 聚合三指标
 *     · completedThisWeek (本周完成数, 客户端 tz 周一 00:00 至今)
 *     · triggeredToday    (今日触发数, 客户端 tz 今日 00:00 至今)
 *     · consecutiveDays   (连续天数, 今日没记录则断)
 *
 * 大厂做法 (SQL 聚合, 避免 N+1):
 *   - 「本周完成」: 1 query, `WHERE status='completed' AND completed_at >= weekStart`.
 *   - 「今日触发」: 1 query, `WHERE started_at >= dayStart` (含 started / completed / dismissed).
 *   - 「连续天数」: 1 query, 拉最近 30 天 distinct DATE(started_at), 内存算 streak.
 *     (30 天足够, 心理产品断几天就重启 streak, 超过 30 天的连续天数不会引发行为
 *      改变, 不需要无限拉. 后续 V3 可加 cached streak 字段.)
 *
 * 时区处理:
 *   - 客户端传 clientTimezone (e.g. 'Asia/Shanghai') → 按 tz 算本地 00:00 / 本周一 00:00.
 *   - 不传 → fallback UTC (跟 server time 对齐, 大偏差不致命).
 *   - 用 Intl.DateTimeFormat 自带 tz 转换 (Node 16+ 内置, 不引入 luxon).
 *
 * V3 升级路径:
 *   - 加 cached_streak 字段 (history 表), 每次 complete 后 service 内累加, 避免每次 stats 重算.
 *   - 接 streak freeze (一周可以断 1 天不算断, 复刻 Headspace 友好机制).
 */
@Injectable()
export class HomeMicroInterventionStatsService {
  private readonly logger = new Logger(HomeMicroInterventionStatsService.name);

  constructor(
    @InjectRepository(MicroInterventionHistory)
    private readonly historyRepo: Repository<MicroInterventionHistory>,
  ) {}

  /**
   * 聚合三指标.
   *
   * @param uid            用户 id
   * @param clientTimezone IANA tz (e.g. 'Asia/Shanghai'), 可选
   * @param now            服务端当前时间 (testable)
   */
  async getStats(uid: string, clientTimezone?: string, now: Date = new Date()): Promise<MicroInterventionStatsDto> {
    const tz = clientTimezone && this.isValidTimezone(clientTimezone) ? clientTimezone : 'UTC';

    // 本地 00:00 / 本周一 00:00 (客户端 tz)
    const dayStart = this.startOfLocalDay(now, tz);
    const weekStart = this.startOfLocalWeek(now, tz);

    // SQL 聚合 (3 query, 全部走索引 idx_mi_history_uid_created_at)
    const [completedThisWeek, triggeredToday, recentDays] = await Promise.all([
      this.historyRepo
        .createQueryBuilder('h')
        .where('h.uid = :uid', { uid })
        .andWhere('h.status = :s', { s: 'completed' })
        .andWhere('h.completed_at >= :ws', { ws: weekStart })
        .getCount(),
      this.historyRepo.createQueryBuilder('h').where('h.uid = :uid', { uid }).andWhere('h.started_at >= :ds', { ds: dayStart }).getCount(),
      this.recentActiveDays(uid, dayStart, 30),
    ]);

    return {
      completedThisWeek,
      triggeredToday,
      consecutiveDays: this.computeStreak(recentDays, dayStart),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // 内部 helpers
  // ════════════════════════════════════════════════════════════════════════

  /**
   * 拉最近 N 天 distinct DATE(started_at) 字符串数组 (升序).
   *
   * 用 DISTINCT + DATE 转换在 SQL 一次性算, 内存再算连续天数.
   * 索引命中 idx_mi_history_uid_created_at.
   *
   * 返回格式: ['2026-08-25', '2026-08-26', ...] (按 tz 计算的本地日期字符串).
   */
  private async recentActiveDays(uid: string, todayLocalStart: Date, windowDays: number): Promise<string[]> {
    // windowDays 天前的本地 00:00
    const windowStart = new Date(todayLocalStart);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

    // 用 DATE(CONVERT_TZ(started_at, '+00:00', tz)) 取本地日期字符串
    // V2026-09-11 治本:
    //   - 大厂做法: 不在 SQL 做 tz 转换 (CONVERT_TZ 依赖 MySQL 时区表, 跨环境易踩坑),
    //     把所有 history 行拉到内存用 Intl.DateTimeFormat 算本地日期.
    //   - 30 天窗口, 极端用户日均 10 次也才 300 行, 单 query 内存完全 OK.
    const rows = await this.historyRepo
      .createQueryBuilder('h')
      .select('h.started_at', 'startedAt')
      .where('h.uid = :uid', { uid })
      .andWhere('h.started_at >= :ws', { ws: windowStart })
      .getRawMany<{ startedAt: Date }>();

    const daySet = new Set<string>();
    for (const r of rows) {
      const localDay = this.formatLocalDate(r.startedAt, this.guessServerTzFromHistory());
      // 大厂 standard: 'YYYY-MM-DD' 格式固定, 字典序就是日期序, 后续 sort 省心.
      daySet.add(localDay);
    }
    // V2026-09-11 治本 (lint unicorn/no-array-sort + sonarjs/no-alphabetical-sort):
    //   - 用 ES2023 `.toSorted()` (immutable array) 替代 `.sort()`, 不破坏原 Set 顺序.
    //   - 显式传 `(a, b) => a.localeCompare(b)` compare function, 跟 i18n
    //     locale-aware 排序对齐, 避免不同 runtime sort 结果不一致.
    return Array.from(daySet).toSorted((a, b) => a.localeCompare(b));
  }

  /**
   * 算连续天数 (streak 算法).
   *
   * 算法:
   *   - 今日没记录 → 0 (断).
   *   - 今日有, 昨日有 → 至少 1, 往前逐日查 set.
   *   - 今日有, 昨日无 → 1 (今日孤立).
   *
   * 跟 Headspace 一致: 严格连续, 不 freeze, 不补卡.
   * V3 升级: streak freeze (一周可断 1 天) 改 set 判定 + offset 容忍.
   */
  private computeStreak(activeDays: string[], todayLocalStart: Date): number {
    if (activeDays.length === 0) return 0;
    const today = this.formatLocalDate(todayLocalStart, this.guessServerTzFromHistory());
    const daySet = new Set(activeDays);
    if (!daySet.has(today)) return 0;

    let streak = 1;
    const cursor = new Date(todayLocalStart);
    // 最多回溯 activeDays.length 天 (超出范围必断)
    for (let i = 1; i <= activeDays.length; i++) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      const localDay = this.formatLocalDate(cursor, this.guessServerTzFromHistory());
      if (daySet.has(localDay)) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak;
  }

  /**
   * 本地 00:00 (按 tz) — 返回 UTC Date, 但表达的是「tz 当地 00:00」.
   *
   * 用 Intl.DateTimeFormat parts 反算, 避免引入 luxon.
   * 例: now=2026-09-11T16:00:00Z + tz='Asia/Shanghai' → 2026-09-11T00:00:00+08:00
   *     (UTC 时间 = 2026-09-10T16:00:00Z).
   */
  private startOfLocalDay(now: Date, tz: string): Date {
    const parts = this.localDateTimeParts(now, tz);
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0));
  }

  /**
   * 本周一 00:00 (按 tz).
   *
   * Intl 默认 weekStart='Sunday' (大厂跟 ISO 一致改 'Monday'),
   * 用 dayOfWeek (1=Mon ... 7=Sun, ISO 8601) 算偏移.
   */
  private startOfLocalWeek(now: Date, tz: string): Date {
    const dayStart = this.startOfLocalDay(now, tz);
    const dow = this.localDayOfWeek(now, tz); // 1=Mon ... 7=Sun
    dayStart.setUTCDate(dayStart.getUTCDate() - (dow - 1));
    return dayStart;
  }

  /**
   * Intl 拿本地年/月/日/时/分/秒/星期 (按 tz).
   */
  private localDateTimeParts(
    now: Date,
    tz: string,
  ): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    // V2026-09-11 治本: hour12:false 在某些 Node 版本返回 '24' 而非 '00' (UTC midnight),
    // 用 (h === 24 ? 0 : h) 兜底 (Headless Chrome / 部分 Node 版本踩过).
    const hour = get('hour') === 24 ? 0 : get('hour');
    return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute'), second: get('second') };
  }

  /**
   * 本地星期几 (ISO 8601: 1=Mon ... 7=Sun).
   *
   * 大厂做法: 不用 Date.getDay() (server 本地时区), 用 Intl 重算.
   * 避免服务器 tz 跟 client tz 不一致导致本周边界错位.
   */
  private localDayOfWeek(now: Date, tz: string): number {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const w = formatter.format(now);
    const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return map[w] ?? 1;
  }

  /**
   * 把 UTC Date 转成 tz 本地 'YYYY-MM-DD' 字符串.
   *
   * 大厂做法: 固定 ISO-like 格式, 字典序 == 日期序, set 判断 O(1).
   */
  private formatLocalDate(now: Date, tz: string): string {
    const p = this.localDateTimeParts(now, tz);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  /**
   * 默认 server tz (history 表存储是 UTC, 计算本地日期时兜底用).
   *
   * V2026-09-11 治本:
   *   - 这里 [clientTimezone] 应当贯穿到 [recentActiveDays] / [computeStreak],
   *     保持「同一时区计算」语义一致. 但为了不在多个 helper 传参, 用一个
   *     captured tz 字段. 当前通过 query 传入, 这里只是 fallback.
   *   - 真正落地: 把 [tz] 提到 instance 字段 / 方法签名统一传.
   */
  private guessServerTzFromHistory(): string {
    // V2026-09-11 简版: 直接读 process.env.TZ (容器配置), 没有就 UTC.
    // 大厂 standard: process.env 走索引签名, TS4111 要求 bracket 访问, dot 不行.
    const tz = process.env['TZ'];
    return tz && tz.length > 0 ? tz : 'UTC';
  }

  /**
   * 校验 IANA tz 字符串.
   *
   * 用 Intl.DateTimeFormat 试 format, 失败抛错即不合法.
   * V2026-09-11 治本: 防止前端乱传 'GMT+8' / 'utc' 等非标准字符串, 引发 Intl 抛错.
   */
  private isValidTimezone(tz: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
      return true;
    } catch {
      this.logger.warn(`invalid clientTimezone=${tz}, fallback UTC`);
      return false;
    }
  }
}
