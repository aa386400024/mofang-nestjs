/**
 * V2026-09-14 治本 (Stage C 后端契约): GrowthWeeklyOverviewService 单测.
 *
 * 目标: 覆盖 GET /growth/weekly-overview 返回值:
 *   - happy path: 返 10 字段 (含 4 KPI), is_personalized=false, 默认 fallback
 *   - 4 KPI 默认 0 (V1.0 V2.1 之前没接 inner_world 跨 feature 聚合)
 *   - 10 字段全部存在 (跟前端 WeeklyOverviewDto 1:1)
 *   - error path: 服务内部抛错 → 转 BizException(40_004, 500)
 *
 * 设计 (大厂 service 单测):
 *   - 不连 DB (V1.0 走 in-memory 默认), 纯 service 单测
 *   - 失败路径用 jest.spyOn mock aggregateKpis 抛错
 *   - 覆盖 happy path + 错误兜底
 *
 * 反双胞胎:
 *   - 不测 KPI 跨 feature 聚合 (V2.1 实现, V1.0 给默认 0)
 */

import { GrowthWeeklyOverviewService } from './growth-weekly-overview.service';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

describe('V2026-09-14 GrowthWeeklyOverviewService — 单测', () => {
  let service: GrowthWeeklyOverviewService;
  const userId = 'test-user-uuid';

  beforeEach(() => {
    service = new GrowthWeeklyOverviewService();
  });

  describe('happy path (V1.0 默认 fallback)', () => {
    it('返 WeeklyOverviewDto 完整 10 字段', async () => {
      const overview = await service.getWeeklyOverview(userId);
      expect(overview.id).toBeDefined();
      expect(overview.week_label).toBeDefined();
      expect(overview.ai_summary).toBeDefined();
      expect(Array.isArray(overview.key_metrics)).toBe(true);
      expect(overview.report_route_path).toBeDefined();
      // V2026-09-14 4 KPI 跨 feature 聚合:
      expect(overview.tools_completed_this_week).toBeDefined();
      expect(overview.fragments_earned_this_week).toBeDefined();
      expect(overview.islands_unlocked_this_week).toBeDefined();
      expect(overview.consecutive_active_days).toBeDefined();
      expect(overview.is_personalized).toBeDefined();
    });

    it('V1.0 默认 is_personalized=false (走 in-memory fallback)', async () => {
      const overview = await service.getWeeklyOverview(userId);
      expect(overview.is_personalized).toBe(false);
    });

    it('4 KPI 默认 0 (V2.1 接 inner_world 跨 feature 聚合后再给真实值)', async () => {
      const overview = await service.getWeeklyOverview(userId);
      expect(overview.tools_completed_this_week).toBe(0);
      expect(overview.fragments_earned_this_week).toBe(0);
      expect(overview.islands_unlocked_this_week).toBe(0);
      expect(overview.consecutive_active_days).toBe(0);
    });

    it('ai_summary 含「被看见」语气 (跟前端 in-memory fallback 一致)', async () => {
      const overview = await service.getWeeklyOverview(userId);
      // V2026-09-14 治本: 跟前端 growth_in_memory_data_source.dart aiSummary 字符级一致.
      expect(overview.ai_summary).toContain('你这一周愿意花时间陪自己');
      expect(overview.ai_summary).toContain('再温柔一点');
    });

    it('key_metrics 默认 3 个 (label/value/trend)', async () => {
      const overview = await service.getWeeklyOverview(userId);
      expect(overview.key_metrics).toHaveLength(3);
      for (const m of overview.key_metrics) {
        expect(m.label).toBeDefined();
        expect(m.value).toBeDefined();
        expect(['up', 'flat', 'down']).toContain(m.trend);
      }
    });

    it('report_route_path 默认 /profile/growth-report', async () => {
      const overview = await service.getWeeklyOverview(userId);
      expect(overview.report_route_path).toBe('/profile/growth-report');
    });

    it('id 包含日期 prefix (V1.0 用 todayIso 作为后缀)', async () => {
      const overview = await service.getWeeklyOverview(userId);
      expect(overview.id).toMatch(/^wo_/);
      expect(overview.id.length).toBeGreaterThan(3);
    });

    it('无 date 参数时不报错', async () => {
      await expect(service.getWeeklyOverview(userId)).resolves.toBeDefined();
    });

    it('有 date 参数时不报错 (V2.1 按 ISO 周计算, V1.0 忽略)', async () => {
      await expect(service.getWeeklyOverview(userId, '2026-09-14')).resolves.toBeDefined();
    });
  });

  describe('error path: aggregateKpis 内部抛错 → BizException', () => {
    it('聚合异常 → 转 BizException(40_004, 500)', async () => {
      // V2026-09-14 治本: spyOn mock 内部 aggregateKpis 抛错, 验证 service 兜底.
      const spy = jest.spyOn(service, 'aggregateKpis');
      spy.mockRejectedValue(new Error('DB 连接失败'));

      await expect(service.getWeeklyOverview(userId)).rejects.toThrow(BizException);
      await expect(service.getWeeklyOverview(userId)).rejects.toMatchObject({
        detail: {
          code: BizCode.GrowthWeeklyOverviewFetchFail,
          statusCode: 500,
        },
      });
    });

    it('BizException 类型直接抛出 → 不被再次包装', async () => {
      // V2026-09-14 治本: catch 块有 if (err instanceof BizException) throw err,
      //   防止内层 BizException 被外层重新包装 (code 错乱).
      const innerErr = new BizException(BizCode.GrowthWeeklyOverviewFetchFail, 'inner');
      const spy = jest.spyOn(service, 'aggregateKpis');
      spy.mockRejectedValue(innerErr);

      await expect(service.getWeeklyOverview(userId)).rejects.toThrow(BizException);
      // 验证 message 是 inner 的 (未被外层 wrap 改 message).
      // V2026-09-14 治本 (Lint fix): 用 .rejects.toMatchObject 无条件 expect,
      //   替代 try/catch + 条件 expect (jest/no-conditional-expect).
      await expect(service.getWeeklyOverview(userId)).rejects.toMatchObject({
        detail: { message: 'inner' },
      });
    });
  });
});
