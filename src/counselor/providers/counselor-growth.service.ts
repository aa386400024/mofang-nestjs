// V2026-10-13 治本 (Phase 7.10 P0-4 — counselor-growth.service.ts):
//   心理咨询师学员端「成长」Tab 业务逻辑服务.
//
//   修复: 复用 M1 CounselorHomeService.getOverview 拿 ability + weeklyProgress, 训练记录
//         + 错题本 V0.5 返空数组 (V1.x 接 training-sessions + wrong-questions 表).

import { Injectable } from '@nestjs/common';

import { CounselorHomeService } from './counselor-home.service';
import { type CounselorGrowthDto } from '../dto/counselor-growth.dto';

@Injectable()
export class CounselorGrowthService {
  constructor(private readonly homeService: CounselorHomeService) {}

  /**
   * GET /counselor/growth/overview 主入口.
   *
   * V0.5: 复用 CounselorHomeService 数据, 投影为成长 Tab 4 区块 shape.
   * V1.x: 跨表聚合 training-sessions + wrong-questions + studio unlock.
   */
  async getOverview(userId: string, emotionLevel?: string): Promise<CounselorGrowthDto> {
    const homeOverview = await this.homeService.getOverview(userId, emotionLevel);

    return {
      ability: {
        listening: homeOverview.ability.listening,
        empathy: homeOverview.ability.empathy,
        questioning: homeOverview.ability.questioning,
        boundary: homeOverview.ability.boundary,
        voiceProfessionalism: homeOverview.ability.voiceProfessionalism,
        caseConceptualization: homeOverview.ability.caseConceptualization,
      },
      weeklyProgress: {
        toolsCompletedThisWeek: homeOverview.weeklyProgress.toolsCompletedThisWeek,
        fragmentsEarnedThisWeek: homeOverview.weeklyProgress.fragmentsEarnedThisWeek,
        islandsUnlockedThisWeek: homeOverview.weeklyProgress.islandsUnlockedThisWeek,
        consecutiveActiveDays: homeOverview.weeklyProgress.consecutiveActiveDays,
      },
      trainingRecords: [], // V0.5 返空数组, V1.x 跨表聚合
      wrongQuestions: [], // V0.5 返空数组, V1.x 跨表聚合
      studio: {
        unlocked: false,
        unlockedCreatureCount: 0,
        totalCreatureCount: 12,
      },
      currentRole: 'counselor_learner',
    };
  }
}
