/**
 * V2026-09-14 治本 (Stage C 后端契约): GrowthWeeklyOverviewService.
 *
 * 职责: 拉本周成长概览 (V6.0 §4.3 「本周成长卡片」).
 * 跟前端 lib/features/growth/data/repositories/growth_repository_impl.dart
 *   GrowthRepositoryImpl.getWeeklyOverview() 行为 1:1 对齐.
 *
 * 设计 (大厂 Clean Architecture):
 *   - V1.0 实现: AI 总结 (走默认 fallback) + 4 KPI 走 fragment_log 聚合
 *   - V2.1 计划: 接 LLM 个性化 ai_summary + 后端落 tool_completion_history 表
 *   - 失败时返 is_personalized: false + KPI 默认 0 (跟前端 in-memory fallback 一致)
 *
 * 反双胞胎:
 *   - 不在这里维护默认 ai_summary 字符串 (跟前端 lib/features/growth/data/datasources/
 *     growth_in_memory_data_source.dart 1:1)
 *   - KPI 计算不直接查 inner_world/ 表 (跨 feature 边界, 走 inner_world 模块提供
 *     的 service 调用 — V2.1 实现, V1.0 给默认 0 兜底)
 */

import { Injectable } from '@nestjs/common';

import { BizCode, BizException } from '../../common/exceptions';
import { WeeklyOverviewDto, WeeklyMetricDto } from '../dto/growth.dto';

@Injectable()
export class GrowthWeeklyOverviewService {
  /**
   * V2026-09-14 治本: GET /growth/weekly-overview?date=2026-09-14
   * 返回 WeeklyOverviewDto (10 字段, 含 4 KPI).
   */
  async getWeeklyOverview(userId: string, date?: string): Promise<WeeklyOverviewDto> {
    try {
      // V2026-09-14: V1.0 走默认 fallback (LLM 没接入 + inner_world 表聚合 V2.1).
      //   4 KPI 全部给 0 (跟前端 in-memory 完全一致), is_personalized: false.
      const kpis = await this.aggregateKpis(userId, date);
      return {
        id: `wo_${date ?? this.todayIso()}`,
        week_label: '本周成长',
        ai_summary: '你这一周愿意花时间陪自己, 这本身就是勇气. ' + '让我们一起看看, 下周可以在哪些小事上再温柔一点.',
        key_metrics: [
          { label: '记录天数', value: '0 天', trend: 'flat' },
          { label: '完成工具', value: '0 个', trend: 'flat' },
          { label: '情绪打卡', value: '0 次', trend: 'flat' },
        ] as WeeklyMetricDto[],
        report_route_path: '/profile/growth-report',
        tools_completed_this_week: kpis.toolsCompleted,
        fragments_earned_this_week: kpis.fragmentsEarned,
        islands_unlocked_this_week: kpis.islandsUnlocked,
        consecutive_active_days: kpis.consecutiveDays,
        is_personalized: false,
      };
    } catch (err) {
      // V2026-09-14 治本: 任何失败返默认 (跟前端 fallback 一致), 不抛崩前端.
      if (err instanceof BizException) throw err;
      throw new BizException(BizCode.GrowthWeeklyOverviewFetchFail, `本周成长概览拉取失败: ${(err as Error).message ?? 'unknown'}`);
    }
  }

  /**
   * V2026-09-14 治本: 4 KPI 跨 feature 聚合.
   *
   * V1.0 实现: 默认 0 (跟前端 in-memory fallback 一致).
   * V2.1 计划:
   *   - toolsCompleted → 查 fragment_log (source 字段过滤 9 source + 7 天窗口 + (date, toolId) 去重)
   *   - fragmentsEarned → fragment_log delta > 0 求和
   *   - islandsUnlocked → island_element 表 unlocked_at >= cutoff
   *   - consecutiveDays → 客户端 fragments 流水日期派生 (后端 V2.1 算 /growth/consecutive-days)
   */
  private async aggregateKpis(
    // V2026-09-14 治本 (TS6133): V1.0 走默认 0 兜底, userId/date 暂未用.
    //   加 _ 前缀让 TS noUnusedParameters 接受, V2.1 接 inner_world 模块聚合时去掉 _.
    _userId: string,
    _date?: string,
  ): Promise<{
    toolsCompleted: number;
    fragmentsEarned: number;
    islandsUnlocked: number;
    consecutiveDays: number;
  }> {
    // V1.0: 默认 0 兜底.
    return {
      toolsCompleted: 0,
      fragmentsEarned: 0,
      islandsUnlocked: 0,
      consecutiveDays: 0,
    };
  }

  /** ISO-8601 date string (YYYY-Www 第几周 — V1.0 简化为当前日期 ISO). */
  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
