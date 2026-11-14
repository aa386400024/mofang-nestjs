// V2026-11-14 治本 (TD-13 · L-1b 仓储端口抽象试点 · analytics 域):
//   端口替身 spec —— 两个 analytics service 用**端口替身**驱动: 不起真 TypeORM,
//   不连 DB, 不 vi.mock('typeorm'). 替身只记调用参数 + 返回预设计数 / 时间戳序列.
//
//   覆盖:
//     ① tracker: 成功写路径 (5 个业务字段逐字透传) + metadata 缺省落 null +
//        仓储 reject 时**静默 catch 不 throw** + warn 文案只出定位信息 (隐私红线);
//     ② service: KPI 1 发布量 / KPI 2 转化率 / 分母为 0 的保护 / trend 分桶 /
//        末桶 clamp / tenantId + 时间窗参数透传 —— 数值口径跟改前逐字一致.
//
//   时间口径: 用 `vi.useFakeTimers({ toFake: ['Date'] })` 钉住 `new Date()`,
//   否则 `timeRangeWindow` 的窗口随真实时钟漂移, 分桶断言会偶发失败.
//   只 faked Date (不 faked 其它 timer): 本 spec 不依赖定时器, 只要把"现在"钉死.
//
//   替身写法: 直接实现端口 interface (跟 wp18 spec 同款端口替身口径), 不起真库.
//
//   验证: pnpm exec vitest run test/analytics/td13-analytics-repository-port.spec.ts
//   时间戳: 2026-11-14 GMT+8

import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AnalyticsEventRecordInput,
  AnalyticsEventRepository,
} from '../../src/analytics/domain/repositories/analytics-event.repository.js';
import { TimeRange } from '../../src/analytics/dto/analytics.dto.js';
import { AnalyticsEventType } from '../../src/analytics/enums/analytics-event-type.enum.js';
import { AnalyticsEventTrackerService } from '../../src/analytics/providers/analytics-event-tracker.service.js';
import { AnalyticsService } from '../../src/analytics/providers/analytics.service.js';

/** 钉住的"现在" —— 2026-11-14 00:00:00Z. */
const NOW = new Date('2026-11-14T00:00:00.000Z');
/** week 窗口起点 —— NOW - 7 天 (与改前 timeRangeWindow 的口径一致). */
const WEEK_START = new Date('2026-11-07T00:00:00.000Z');

/** 端口替身 —— 只记调用参数, 不连真库. */
class RepositoryDouble {
  /** record 的入参序列. */
  readonly records: AnalyticsEventRecordInput[] = [];
  /** countByType 的调用参数序列. */
  readonly counts: { tenantId: string; eventType: AnalyticsEventType; start: Date; end: Date }[] = [];
  /** findCreatedAtBetween 的调用参数序列. */
  readonly lookups: { tenantId: string; eventType: AnalyticsEventType; start: Date; end: Date }[] = [];
  /** 按事件类型配置的计数 (缺省 0). */
  readonly countByEventType = new Map<AnalyticsEventType, number>();
  /** 按事件类型配置的 createdAt 序列 (缺省空). */
  readonly createdAtByEventType = new Map<AnalyticsEventType, readonly Date[]>();
  /** 注入给 record 的失败 (测静默失败路径; null = 正常). */
  recordFailure: Error | null = null;

  /** 端口替身本体. */
  readonly repo: AnalyticsEventRepository;

  constructor() {
    this.repo = {
      record: async (input: AnalyticsEventRecordInput): Promise<void> => {
        if (this.recordFailure) {
          throw this.recordFailure;
        }
        this.records.push(input);
      },
      countByType: async (tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date): Promise<number> => {
        this.counts.push({ tenantId, eventType, start, end });
        return this.countByEventType.get(eventType) ?? 0;
      },
      findCreatedAtBetween: async (tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date): Promise<readonly Date[]> => {
        this.lookups.push({ tenantId, eventType, start, end });
        return this.createdAtByEventType.get(eventType) ?? [];
      },
    };
  }
}

describe('TD-13 · analytics 仓储端口 (端口替身驱动)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('① AnalyticsEventTrackerService · 事件追踪 (静默失败语义)', () => {
    it('成功路径 → 端口 record 收到 5 个业务字段 (逐字透传)', async () => {
      const double = new RepositoryDouble();
      const service = new AnalyticsEventTrackerService(double.repo);

      await service.record('tenant-1', AnalyticsEventType.KbPublished, 'item-1', 'user-1', { fromStatus: 'draft' });

      expect(double.records).toHaveLength(1);
      expect(double.records[0]).toEqual({
        tenantId: 'tenant-1',
        eventType: AnalyticsEventType.KbPublished,
        itemId: 'item-1',
        userId: 'user-1',
        metadata: { fromStatus: 'draft' },
      });
    });

    it('metadata / userId 缺省 → 落 null (与改前 create({...}) 的缺省一致)', async () => {
      const double = new RepositoryDouble();
      const service = new AnalyticsEventTrackerService(double.repo);

      await service.record('tenant-1', AnalyticsEventType.DraftSubmitted, 'item-1', null);

      expect(double.records).toHaveLength(1);
      expect(double.records[0]?.metadata).toBeNull();
      expect(double.records[0]?.userId).toBeNull();
    });

    it('仓储 reject → 静默 catch, 不 throw (analytics 挂了不拖崩主流程)', async () => {
      const double = new RepositoryDouble();
      double.recordFailure = new Error('db down');
      const service = new AnalyticsEventTrackerService(double.repo);

      await expect(service.record('tenant-1', AnalyticsEventType.KbPublished, 'item-1', 'user-1')).resolves.toBeUndefined();
      expect(double.records).toHaveLength(0);
    });

    it('仓储 reject → warn 文案只出 eventType / itemId / 错误信息 (无心理内容)', async () => {
      const warnings: string[] = [];
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
        warnings.push(typeof message === 'string' ? message : String(message));
      });
      const double = new RepositoryDouble();
      double.recordFailure = new Error('db down');
      const service = new AnalyticsEventTrackerService(double.repo);

      await service.record('tenant-1', AnalyticsEventType.KbPublished, 'item-1', 'user-1');

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('type=KB_PUBLISHED');
      expect(warnings[0]).toContain('itemId=item-1');
      expect(warnings[0]).toContain('db down');
    });

    it('仓储成功 → 不打 warn (静默失败不等于一直失败)', async () => {
      const warnings: string[] = [];
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
        warnings.push(typeof message === 'string' ? message : String(message));
      });
      const double = new RepositoryDouble();
      const service = new AnalyticsEventTrackerService(double.repo);

      await service.record('tenant-1', AnalyticsEventType.KbPublished, 'item-1', 'user-1');

      expect(warnings).toHaveLength(0);
      expect(double.records).toHaveLength(1);
    });
  });

  describe('② AnalyticsService · 4 KPI + 4 trend', () => {
    beforeEach(() => {
      // 只 faked Date: 把 timeRangeWindow 的窗口钉死, 别的 timer 一律不动.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });

    it('KPI 1 发布量 = KbPublished 计数 (端口 countByType 透传)', async () => {
      const double = new RepositoryDouble();
      double.countByEventType.set(AnalyticsEventType.KbPublished, 3);
      double.countByEventType.set(AnalyticsEventType.DraftSubmitted, 6);
      const service = new AnalyticsService(double.repo);

      const overview = await service.getOverview('tenant-1', TimeRange.Week);

      expect(overview.kbPublished).toBe(3);
      expect(overview.timeRange).toBe(TimeRange.Week);
      // 改前是 2 次 count (KPI 1 分子 + KPI 2 分母) + 1 次 find (trend): 端口化后**不多不少**.
      expect(double.counts).toHaveLength(2);
      expect(double.lookups).toHaveLength(1);
    });

    it('KPI 2 转化率 = published / submitted', async () => {
      const double = new RepositoryDouble();
      double.countByEventType.set(AnalyticsEventType.KbPublished, 3);
      double.countByEventType.set(AnalyticsEventType.DraftSubmitted, 6);
      const service = new AnalyticsService(double.repo);

      const overview = await service.getOverview('tenant-1', TimeRange.Week);

      expect(overview.draftToPublishRate).toBe(0.5);
    });

    it('分母为 0 → 转化率返 0 (不 NaN / 不 Infinity), 转化率 trend 同样全 0', async () => {
      const double = new RepositoryDouble();
      double.countByEventType.set(AnalyticsEventType.KbPublished, 3);
      double.countByEventType.set(AnalyticsEventType.DraftSubmitted, 0);
      double.createdAtByEventType.set(AnalyticsEventType.KbPublished, [new Date('2026-11-09T00:00:00.000Z')]);
      const service = new AnalyticsService(double.repo);

      const overview = await service.getOverview('tenant-1', TimeRange.Week);

      expect(overview.draftToPublishRate).toBe(0);
      expect(overview.draftToPublishRateTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it('trend 按桶计数 (7 桶 / week, 口径跟改前逐字一致)', async () => {
      const double = new RepositoryDouble();
      double.countByEventType.set(AnalyticsEventType.KbPublished, 3);
      double.countByEventType.set(AnalyticsEventType.DraftSubmitted, 6);
      double.createdAtByEventType.set(AnalyticsEventType.KbPublished, [
        new Date('2026-11-07T00:00:00.000Z'),
        new Date('2026-11-09T00:00:00.000Z'),
        new Date('2026-11-13T00:00:00.000Z'),
      ]);
      const service = new AnalyticsService(double.repo);

      const overview = await service.getOverview('tenant-1', TimeRange.Week);

      expect(overview.kbPublishedTrend).toEqual([1, 0, 1, 0, 0, 0, 1]);
      expect(overview.draftToPublishRateTrend).toEqual([1 / 6, 0, 1 / 6, 0, 0, 0, 1 / 6]);
      expect(overview.scheduledPublishTrend).toEqual([1 / 3, 0, 1 / 3, 0, 0, 0, 1 / 3]);
      expect(overview.avgReviewSlaTrend).toEqual(overview.kbPublishedTrend);
      expect(overview.avgReviewSlaHours).toBe(0);
      expect(overview.scheduledPublishRatio).toBe(0);
    });

    it('trend 落在窗口末端 → 夹进最后一桶 (bucketCount - 1)', async () => {
      const double = new RepositoryDouble();
      double.countByEventType.set(AnalyticsEventType.KbPublished, 1);
      double.createdAtByEventType.set(AnalyticsEventType.KbPublished, [new Date('2026-11-14T00:00:00.000Z')]);
      const service = new AnalyticsService(double.repo);

      const overview = await service.getOverview('tenant-1', TimeRange.Week);

      expect(overview.kbPublishedTrend).toEqual([0, 0, 0, 0, 0, 0, 1]);
    });

    it('tenantId + 时间窗逐字透传给端口 (租户隔离口径不改)', async () => {
      const double = new RepositoryDouble();
      const service = new AnalyticsService(double.repo);

      await service.getOverview('tenant-9', TimeRange.Week);

      expect(double.counts[0]?.tenantId).toBe('tenant-9');
      expect(double.counts[0]?.eventType).toBe(AnalyticsEventType.KbPublished);
      expect(double.counts[0]?.start).toEqual(WEEK_START);
      expect(double.counts[0]?.end).toEqual(NOW);
      expect(double.counts[1]?.tenantId).toBe('tenant-9');
      expect(double.counts[1]?.eventType).toBe(AnalyticsEventType.DraftSubmitted);
      expect(double.lookups[0]?.tenantId).toBe('tenant-9');
      expect(double.lookups[0]?.eventType).toBe(AnalyticsEventType.KbPublished);
      expect(double.lookups[0]?.start).toEqual(WEEK_START);
      expect(double.lookups[0]?.end).toEqual(NOW);
    });
  });
});
