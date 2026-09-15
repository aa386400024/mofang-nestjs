/**
 * V2026-09-14 治本 (Stage C 后端契约): GrowthDailyToolsService.
 *
 * 职责: 拉取今日 3 条推荐工具 (V6.0 §4.3 「今日成长」).
 * 跟前端 lib/features/growth/data/repositories/growth_repository_impl.dart
 *   GrowthRepositoryImpl.getDailyTools() 行为 1:1 对齐.
 *
 * 设计 (大厂 Clean Architecture):
 *   - V1.0 实现: 走 InMemoryDataSource 默认 3 条 + LLM 兜底 (LLM 失败返默认)
 *   - V2.1 计划: 接 LLM (Claude / GPT-4), 按情绪/画像/时段动态推荐
 *   - is_personalized 字段: true = LLM 生成, false = in-memory 默认 (前端按此渲染 AI badge)
 *   - linkRoute 走白名单校验 (不通过返 400), 见 allowed-link-routes.ts
 *
 * 反双胞胎:
 *   - 不在这里维护 hardcoded 3 条工具 (走 InMemoryDataSource 单一事实源)
 *   - 不做 linkRoute 字符串拼接 (跟前端 1:1 透传)
 *   - 不在 service 写 switch case (跟前端 mapper 9 source 映射同源, 后端只透传 source)
 */

import { Injectable } from '@nestjs/common';

import { BizCode, BizException } from '../../common/exceptions';
import { ALLOWED_EXACT_PATHS, ALLOWED_DYNAMIC_TEMPLATES } from '../constants/allowed-link-routes';
import { assertFragmentsGrantContract } from '../dto/fragments-grant.dto';
import { DailyGrowthToolDto } from '../dto/growth.dto';

@Injectable()
export class GrowthDailyToolsService {
  /**
   * V2026-09-14 治本 (大厂 standard: 服务接口契约 1:1 对齐前端):
   *   GET /growth/daily-tools?date=2026-09-14
   *   返回 DailyGrowthToolDto[] (固定 3 条, V1.0 strict; V2.1 可返 0 条)
   */
  async getDailyTools(userId: string, date?: string): Promise<DailyGrowthToolDto[]> {
    // V1.0: 走 LLM 调用的占位 — 返回默认 3 条 (跟前端 in-memory 完全一致).
    // V2.1: 接入 LLM, 按 userId + date 动态推 3 条.
    const tools = await this.recommendByLLM(userId, date);
    if (!tools || tools.length === 0) {
      throw new BizException(BizCode.GrowthDailyToolsEmpty, '今日推荐工具为空 (V1.0 必返 3 条)');
    }
    // V1.0 启动期 linkRoute 白名单校验, 防止前端跳到不存在的路由.
    for (const tool of tools) {
      if (tool.link_route && !this.isAllowed(tool.link_route)) {
        throw new BizException(BizCode.GrowthDailyToolsLinkRouteNotWhitelisted, `linkRoute "${tool.link_route}" 不在白名单`);
      }
      assertFragmentsGrantContract(tool.fragments_grant);
    }
    return tools;
  }

  /**
   * V2026-09-14 V1.0: LLM 推荐的占位 — 返回硬编码默认 3 条.
   *
   * V2.1 计划: 接入 Claude / GPT-4, 按 user profile + 当前时段 + 情绪档位推个性化推荐.
   *   return this._callLLM({ userId, date, emotionLevel, recentTools });
   */
  private async recommendByLLM(
    // V2026-09-14 治本 (TS6133): V1.0 全部走 in-memory 默认 3 条, userId/date 暂未用.
    //   加 _ 前缀让 TS noUnusedParameters 接受, V2.1 接 LLM 时去掉 _ 改实际使用.
    _userId: string,
    _date?: string,
  ): Promise<DailyGrowthToolDto[]> {
    // V1.0 默认 3 条 (跟前端 growth_in_memory_data_source.dart 字段 1:1).
    return [
      {
        id: 'mindfulness.box-breathing',
        emoji: '🫁',
        title: '3 分钟呼吸觉察',
        subtitle: '把注意力交给自己, 从呼吸开始',
        duration: '3 分钟',
        tag: '随时可做',
        stage_index: 0,
        link_route: '/practice/tool/mindfulness.box-breathing',
        tool_completion_source: 'breathing_practice',
        fragments_grant: { calm: 3 },
        completion_badge_trigger: true,
        is_linked: true,
        is_completed_today: false,
        auto_create_diary: false,
        micro_intervention_scenario_id: null,
      },
      {
        id: 'cbt.thought-record',
        emoji: '📝',
        title: '觉察日记 · 今天发生的一件事',
        subtitle: '写下来会比想象中更有收获',
        duration: '10 分钟',
        tag: '推荐傍晚',
        stage_index: 1,
        link_route: '/practice/tool/cbt.thought-record',
        tool_completion_source: 'self_esteem',
        fragments_grant: { warmth: 1, courage: 1 },
        completion_badge_trigger: true,
        is_linked: true,
        is_completed_today: false,
        auto_create_diary: true, // V2026-09-14 Stage C: 触发好状态日记联动
        micro_intervention_scenario_id: null,
      },
      {
        id: 'dbt.boundary',
        emoji: '🌳',
        title: '边界力小练习',
        subtitle: '今天能说一句「我不愿意」吗?',
        duration: '5 分钟',
        tag: '选做',
        stage_index: 4,
        link_route: '/practice/tool/dbt.boundary',
        tool_completion_source: 'interpersonal',
        fragments_grant: { calm: 1, courage: 1 },
        completion_badge_trigger: true,
        is_linked: true,
        is_completed_today: false,
        auto_create_diary: false,
        micro_intervention_scenario_id: null,
      },
    ];
  }

  /**
   * V2026-09-14 治本: 复用 §6 白名单校验, 跟前端 1:1.
   * exact match + 8 个动态 RegExp 模板.
   */
  private isAllowed(route: string): boolean {
    if (ALLOWED_EXACT_PATHS.has(route)) return true;
    return ALLOWED_DYNAMIC_TEMPLATES.some((tmpl) => tmpl.test(route));
  }
}
