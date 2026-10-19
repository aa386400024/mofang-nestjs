// V2026-10-16 治本续 (V0.5 stage 2 治本续 V2 — A1+B1+C1 service schema):
//   心理咨询师学员端「首页」Tab 业务逻辑.
//
//   V2026-10-16 治本续 (C1 — 3 个全流程 card 合并 1 个 full_process):
//     原因: 之前「全流程模拟」分 3 个 card (full_l1 / full_l2 / full_l3), 用户在 tab
//       入口就要选 L1/L2/L3. 大炮 2026-10-16 17:10 反馈 "感觉合并成一个, 再来访者
//       设置这里选择难度是不是就够用了啊" 1:1 反馈.
//     修法: 3 个 card 合并 1 个 full_process, difficulty 字段保留默认 L1, 用户在
//       xin_su_app VisitorPresetPage 顶部 "难度" 段 1:1 wire 改 L1/L2/L3 (C1 大炮
//       17:10 拍板).
//     反双胞胎: 不用 enum fullProcess (over-engineering, 1 个 string id 'full_process'
//       足够, 跟 client 1:1 wire 1:1 落地).
//
//   V0.5 简化: 全内存 mock 数据 (跟 xin_su_app Batch 1 Stage 1 mock 1:1 对应, 7 场景).
//   V1.x 改造:
//     - 4 大分类从 `training_scenarios` 表 (新) 拉, 走 Repository 注入
//     - 6 维能力从 `ai-profile` 跨模块聚合 (ai-engine 模块服务)
//     - 4 KPI 从 `training-sessions` 跨表聚合 (voice 模块服务)
//     - AI 推荐 emotion-aware 跟 home-overview.recommendation/today 复用
//
//   V2026-10-13 治本 (TS6133 'userId' unused fix):
//     `pnpm build` 报 5 处 TS6133, 4 file 全是 `userId` 参数声明但 V0.5 mock 不用.
//     治本: 跟 counselor-exam `_emotionLevel` 同 pattern, 改 `_userId` 前缀 (TypeScript
//     convention, 下划线开头的参数认为是 "故意保留但未用", 不报 TS6133). V1.x 真接库后
//     删下划线重新使用即可, 零 breaking change. (注: `emotionLevel` 仍用, 不加 `_`.)
//
//   治本:
//     - 服务端 Mock 跟客户端 Mock 必须独立维护 (不能直接 import xin_su_app 代码)
//     - 用「API 契约 = 真理源」模式, server 跟 client 各自从 DTO 同步
//     - 不在 service 写业务, 全部 builder 抽 private method (大厂 Clean Arch)

import { Injectable } from '@nestjs/common';

import {
  type CounselorAbilitySnapshotDto,
  type CounselorHomeOverviewDto,
  type CounselorTrainingCategoryDto,
  type CounselorWeeklyProgressDto,
} from '../dto/counselor-home.dto';

/**
 * V2026-10-13 (Phase 7.10 — CounselorHomeService):
 *   心理咨询师学员端「首页」Tab 业务逻辑服务.
 *
 *   V0.5 简化: 内存 mock, 跟 xin_su_app CounselorHomeRepositoryMock 字段 1:1.
 *   V1.x 改造: 抽 interface, 注入 Repository, 走 ai-profile + training-sessions.
 */
@Injectable()
export class CounselorHomeService {
  /**
   * GET /counselor/home/overview 主入口.
   *
   * @param _userId 当前用户 id (从 JWT @CurrentUser 注入, V0.5 mock 不用, V1.x 改回 userId)
   * @param emotionLevel 当前情绪档位 (可选, 影响 AI 推荐)
   */
  async getOverview(_userId: string, emotionLevel?: string): Promise<CounselorHomeOverviewDto> {
    // V0.5 内存构建; V1.x 走 Repository 聚合
    return {
      greeting: this.buildGreeting(),
      dateLabel: this.buildDateLabel(),
      todayRecommendation: this.buildRecommendation(emotionLevel),
      ability: this.buildAbility(),
      weeklyProgress: this.buildWeeklyProgress(),
      trainingCategories: this.buildTrainingCategories(),
      currentRole: 'counselor_learner',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 builder 方法 (V0.5 mock, V1.x 抽 Repository 注入)
  // ══════════════════════════════════════════════════════════════════════════

  private buildGreeting(): string {
    return '今天可以开始哪一项训练?';
  }

  private buildDateLabel(): string {
    // V0.5 用 server 本地时间; V1.x 接 timezone 包按 Asia/Shanghai 格式化
    const now = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}`;
  }

  /**
   * AI 推荐 emotion-aware:
   *   - crisis / low → 推「倾听与共情 · 入门」(L1, 5 分钟, 救场)
   *   - okay / great → 推「全流程模拟 · 入门 L1」(50 分钟, 完整训练)
   *
   * 跟 xin_su_app CounselorHomeRepositoryMock.getOverview 推荐逻辑一致.
   */
  private buildRecommendation(emotionLevel?: string): CounselorHomeOverviewDto['todayRecommendation'] {
    if (emotionLevel === 'crisis' || emotionLevel === 'low') {
      return {
        title: '倾听与共情 · 入门',
        subtitle: '针对「倾听」维度低分, 推 3 次 5 分钟专项练习',
        scenarioId: 'skill_listening',
        difficulty: 'L1',
      };
    }
    return {
      title: '完整咨询流程',
      subtitle: '包含 4 阶段完整咨询, 进入后可调难度 (入门/进阶/挑战) + 来访者人格',
      scenarioId: 'full_process',
      difficulty: 'L1',
    };
  }

  /** 6 维能力雷达 (V0.5 mock 写死 0.15-0.45, V1.x 从 ai-profile 7 维聚合) */
  private buildAbility(): CounselorAbilitySnapshotDto {
    return {
      listening: 0.35,
      empathy: 0.2,
      questioning: 0.45,
      boundary: 0.15,
      voiceProfessionalism: 0.3,
      caseConceptualization: 0.25,
    };
  }

  /** 4 KPI 本周成长 (V0.5 mock 全 0, V1.x 跨表聚合) */
  private buildWeeklyProgress(): CounselorWeeklyProgressDto {
    return {
      toolsCompletedThisWeek: 0,
      fragmentsEarnedThisWeek: 0,
      islandsUnlockedThisWeek: 0,
      consecutiveActiveDays: 0,
    };
  }

  /**
   * 4 大训练分类 + 7 场景 (跟 xin_su_app CounselorTrainingRepositoryMock.getOverview 1:1).
   *
   * 治本: 7 场景 id 跟 xin_su_app mock 1:1 (skill_listening / skill_questioning / skill_voice /
   * full_process / script_polish / script_reading / case_concept / case_ethics).
   * 全流程模拟 1 个 card (C1 大炮 17:10 拍板合并 3 个 full_l1/l2/l3 1:1 落地),
   * 难度用户在 VisitorPresetPage 顶部 "难度" 段选 (1:1 wire client).
   * 全 unlocked (V0.5 简化, V1.x 跟 training_records 聚合判断).
   */
  private buildTrainingCategories(): CounselorTrainingCategoryDto[] {
    return [
      {
        category: 'skill',
        emoji: '🎯',
        title: '专项技能',
        scenarios: [
          {
            id: 'skill_listening',
            title: '倾听与共情',
            subtitle: '主动倾听 · 情绪反映 · 共情验证',
            mode: 'text',
            difficulty: 'L1',
            durationMinutes: 5,
            unlocked: true,
          },
          {
            id: 'skill_questioning',
            title: '提问技术',
            subtitle: '开放式提问 · 澄清 · 引导性提问',
            mode: 'text',
            difficulty: 'L1',
            durationMinutes: 5,
            unlocked: true,
          },
          {
            id: 'skill_voice',
            title: '语音微训练',
            subtitle: '语速 / 音调 / 打断节奏',
            mode: 'voice',
            difficulty: 'L2',
            durationMinutes: 10,
            unlocked: true,
          },
        ],
      },
      {
        category: 'fullSession',
        emoji: '⏱️',
        title: '全流程模拟',
        // V2026-10-16 治本续 (C1): 3 个 full_l1/l2/l3 card 合并 1 个 full_process.
        // 大炮 17:10 拍板 "感觉合并成一个, 再来访者设置这里选择难度是不是就够用了啊" 1:1 落地.
        // 难度 L1/L2/L3 用户在 xin_su_app VisitorPresetPage 顶部 "难度" 段 1:1 wire 选.
        scenarios: [
          {
            id: 'full_process',
            title: '完整咨询流程',
            subtitle: '60-90 分钟 · 包含完整 4 阶段 · 进入后可选难度 + 来访者人格',
            mode: 'text_voice',
            difficulty: 'L1',
            durationMinutes: 50,
            unlocked: true,
          },
        ],
      },
      {
        category: 'script',
        emoji: '🗣️',
        title: '话术工坊',
        scenarios: [
          {
            id: 'script_polish',
            title: '一句话多版',
            subtitle: '同一情境 · 多版回应范式对比',
            mode: 'text',
            difficulty: 'L1',
            durationMinutes: 3,
            unlocked: true,
          },
          {
            id: 'script_reading',
            title: '跟读示范',
            subtitle: '经典回应跟读 · 标准化训练',
            mode: 'voice',
            difficulty: 'L1',
            durationMinutes: 5,
            unlocked: true,
          },
        ],
      },
      {
        category: 'caseConcept',
        emoji: '🧠',
        title: '个案训练',
        scenarios: [
          {
            id: 'case_concept',
            title: '个案概念化',
            subtitle: '标准化对照表 · 评估 / 鉴别 / 干预',
            mode: 'text',
            difficulty: 'L2',
            durationMinutes: 15,
            unlocked: true,
          },
          {
            id: 'case_ethics',
            title: '伦理决策',
            subtitle: '边界 / 保密 / 转介 · 案例决策训练',
            mode: 'text',
            difficulty: 'L2',
            durationMinutes: 15,
            unlocked: true,
          },
        ],
      },
    ];
  }
}
