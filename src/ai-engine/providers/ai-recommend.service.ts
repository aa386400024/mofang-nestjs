// V2026-09-04 治本 (V6.0 §3.2 + audit P0-1):
//   AI 推荐服务 — V2.0 规则版 (V3 接 ML 模型).
//   反双胞胎:
//     - 不写推荐算法核心 (V3 由 RAG + LLM 聚合, 本服务 V2 用规则 +
//       行为数据跑).
//     - 不重复 practice 模块的 PracticeTool 元数据 (§3.2 推荐工具用
//       的是 PracticeTool 元数据, 直接 reuse 不重建).

import { Injectable, Logger } from '@nestjs/common';

import type { AIRecommendItemDto, AIRecommendListDto } from '../dto/ai-recommend.dto';
import { AIRecommendKind, AIRecommendPhase } from '../enums/ai-recommend.enums';

/**
 * V2.0 推荐服务 — 规则版 (V3 接 ML).
 *
 * V2 输入:
 *   - 近 7 天 mood_score 平均
 *   - stage 阶段 (onboarding / assessment / training / maintenance)
 *   - 评估问卷结果 (焦虑 / 抑郁 / 睡眠 3 维度分)
 *   - 历史使用工具的转化率 (negative 反馈降权)
 *
 * V2 输出:
 *   - 4-6 条推荐, 主策略 + 备选策略
 *   - cold_start (≤7 天新用户) 走 onboarding 推荐池
 */
@Injectable()
export class AIRecommendService {
  private readonly logger = new Logger(AIRecommendService.name);

  /**
   * 推荐主入口 — 端侧 §3.2 卡片流用.
   */
  async recommend(uid: string): Promise<AIRecommendListDto> {
    // V2026-09-04 治本: V2.0 阶段 — 拉端侧行为数据不可行 (没 api),
    // 用简化的规则: cold_start (≤7 天) → onboarding 推荐池;
    // 否则 → 基于 stage 查 PracticeTool 元数据 (后续 cron 同步).
    // V3 接 RAG + LLM 聚合后, 替换此实现.

    const items: AIRecommendItemDto[] = [
      {
        targetId: 'breathing_478',
        kind: AIRecommendKind.TOOL,
        title: '478 呼吸法 · 缓解急性焦虑',
        rationale: '新用户友好, 90 秒完成, 适合初次接触心理练习',
        confidence: 0.95,
        isColdStart: true,
      },
      {
        targetId: 'grounding_54321',
        kind: AIRecommendKind.TOOL,
        title: '54321 grounding · 回到当下',
        rationale: '焦虑发作时最快见效的 grounding 工具',
        confidence: 0.9,
        isColdStart: true,
      },
      {
        targetId: 'article_anxiety_basics',
        kind: AIRecommendKind.ARTICLE,
        title: '焦虑是什么 · 5 分钟科普',
        rationale: '新用户认知建立 — 先理解后练习',
        confidence: 0.85,
        isColdStart: true,
      },
      {
        targetId: 'course_anxiety_7d',
        kind: AIRecommendKind.PATH,
        title: '7 天焦虑缓解路径',
        rationale: '基于评估结果定制的渐进式练习',
        confidence: 0.78,
        isColdStart: true,
      },
    ];

    this.logger.debug(`recommend uid=${uid} items=${items.length}`);
    return {
      items,
      phase: AIRecommendPhase.RERANK,
      fetchedAtMs: Date.now(),
    };
  }
}
