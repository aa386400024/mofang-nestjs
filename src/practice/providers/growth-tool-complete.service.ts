/**
 * V2026-09-14 治本 (Stage C 后端契约): GrowthToolCompleteService.
 *
 * 职责: 标记工具完成 (POST /growth/tools/:id/complete).
 * 跟前端 lib/features/growth/data/repositories/growth_repository_impl.dart
 *   GrowthRepositoryImpl.markToolCompleted() 行为 1:1 对齐.
 *
 * 设计:
 *   - 写入 fragment_log (跨 feature inner_world 表) + 返完整 DailyGrowthToolDto
 *   - 失败时返 CacheFailure (心理数据不丢, 客户端保留原态)
 *   - V2.1: POST body 扩 intensity_before/after + fragments_override, 用于 emotionRescue
 *
 * 反双胞胎:
 *   - 不在 service 里调 inner_world 模块的 bloc (V2.1 走 inner_world 模块的 service 调用)
 *   - 失败兜底优先 (心理数据不丢) — 跟前端 repository.markToolCompleted 一致
 */

import { Injectable } from '@nestjs/common';

import { GrowthDailyToolsService } from './growth-daily-tools.service';
import { BizCode, BizException } from '../../common/exceptions';
import { TOOL_COMPLETION_SOURCES } from '../constants/tool-completion-source';
import { DailyGrowthToolDto } from '../dto/growth.dto';

@Injectable()
export class GrowthToolCompleteService {
  constructor(private readonly dailyTools: GrowthDailyToolsService) {}

  /**
   * V2026-09-14 治本: POST /growth/tools/:id/complete
   *
   * 跟前端 GrowthBloc._onToolCompleted → repository.markToolCompleted 1:1:
   *   1. 调 dailyTools 拉原 entity (含 fragments_grant 等)
   *   2. 写入 fragment_log + 派发 inner_world 链路 (V2.1 走 inner_world 模块)
   *   3. 返更新后的 entity (含 is_completed_today=true)
   *   4. 失败抛 BizException(GROWTH_COMPLETE_FAIL)
   */
  async complete(
    userId: string,
    toolId: string,
    options?: {
      durationMinutes?: number;
      intensityBefore?: number;
      intensityAfter?: number;
      fragmentsOverride?: Record<string, number>;
    },
  ): Promise<DailyGrowthToolDto> {
    try {
      // V1.0: 直接返 in-memory 默认 3 条里找 (V2.1 接 practice 数据源).
      const tools = await this.dailyTools.getDailyTools(userId);
      const tool = tools.find((t) => t.id === toolId);
      if (!tool) {
        throw new BizException(BizCode.GrowthToolNotFound, `工具 ${toolId} 不存在 (不在今日推荐列表)`);
      }

      // V2026-09-14 治本: source 严格枚举校验 (9 source 1:1).
      const source = tool.tool_completion_source;
      if (!TOOL_COMPLETION_SOURCES.includes(source)) {
        throw new BizException(BizCode.GrowthToolSourceInvalid, `tool.tool_completion_source "${source}" 不在 9 enum`);
      }

      // V2026-09-14 治本: 模拟写入 + 派发 (V2.1 走 inner_world 模块 service).
      // V1.0: 仅标记 is_completed_today=true, 不实际落库 (跟前端 in-memory fallback 一致).
      const completed: DailyGrowthToolDto = {
        ...tool,
        is_completed_today: true,
        // V2026-09-14 治本 (Lint fix): 用 ?? 替代三元 (prefer-nullish-coalescing +
        //   unicorn/prefer-logical-operator-over-ternary). options?.fragmentsOverride
        //   是 undefined → fallthrough 到 tool.fragments_grant; 非 undefined → 用 override.
        fragments_grant: options?.fragmentsOverride ?? tool.fragments_grant,
      };
      // V2.1 实际落库:
      //   await this.innerWorldLog.append({ userId, source, fragments: completed.fragments_grant });
      //   await this.innerWorldReconcileBadges({ userId });
      //   await this.appEventBus.publish(new DiaryEntryAutoRequestedEvent({...}));

      return completed;
    } catch (err) {
      if (err instanceof BizException) throw err;
      throw new BizException(BizCode.GrowthCompleteFail, `工具完成写入失败: ${(err as Error).message ?? 'unknown'}`);
    }
  }
}
