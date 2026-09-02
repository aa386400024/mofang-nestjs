import { Injectable } from '@nestjs/common';

import {
  DashboardMilestonesDto,
  DashboardModuleDto,
  DashboardModulesDto,
  DashboardOverviewDto,
  DashboardWeeklyChartDto,
} from '../dto/dashboard.dto';

/**
 * 仪表板服务 — V2.0 §Tab4 「我的数据」心理健身数据.
 *
 * V2.0 占位: 所有数据 hardcoded sample (跟前端 ProfileDashboardPage 1:1).
 * V3 接 PracticeSessionEvent / AssessmentScoreEvent 真实聚合:
 *   - 本周分钟数: SUM(duration) WHERE uid=? AND created_at >= week_start
 *   - 连续天数: 滑动窗口 COUNT(DISTINCT date(created_at))
 *   - 模块进度: 按 GYM_MODULES 分组 COUNT(DISTINCT practice_id) / total
 *   - 里程碑: 事件驱动 (新成就触发式生成 + 持久化)
 *
 * V2.0 设计取舍:
 *   - 不在 V2.0 建 events 表 (留 V3), 用 sample 保证前端能演示
 *   - 4 模块进度全部返回 (UI 用 progress bar)
 *   - 里程碑取最近 5 条 (V3 接真实事件后倒序)
 */
@Injectable()
export class DashboardService {
  /** Hero 卡数据 — 本周训练. */
  async getOverview(_uid: string): Promise<DashboardOverviewDto> {
    return {
      weeklyMinutes: 142,
      weeklyGoal: 180,
      streakDays: 12,
      totalSessions: 87,
    };
  }

  /** 本周 7 天分钟数 (周一→周日). */
  async getWeeklyChart(_uid: string): Promise<DashboardWeeklyChartDto> {
    return {
      minutes: [28, 12, 24, 0, 30, 22, 26],
      dailyGoal: 30,
    };
  }

  /** 4 大核心模块进度. */
  async getModules(_uid: string): Promise<DashboardModulesDto> {
    const items: DashboardModuleDto[] = [
      {
        module: 'physical_basics',
        emoji: '🌬️',
        title: '基础体能训练',
        subtitle: '呼吸调节 · 身体扫描',
        percent: 0.78,
        tag: '进阶中',
        accent: 'mint',
      },
      {
        module: 'cognitive_muscle',
        emoji: '🧠',
        title: '认知肌肉训练',
        subtitle: '觉察日记 · 思维重构',
        percent: 0.45,
        tag: '进行中',
        accent: 'iris',
      },
      {
        module: 'self_esteem_gain',
        emoji: '🌱',
        title: '自尊增肌训练',
        subtitle: '自我接纳 · 价值澄清',
        percent: 0.2,
        tag: '基础期',
        accent: 'coral',
      },
      {
        module: 'interpersonal_efficacy',
        emoji: '🤝',
        title: '人际效能训练',
        subtitle: '边界力 · 共情练习',
        percent: 0.05,
        tag: '未开始',
        accent: 'sand',
      },
    ];
    return { items };
  }

  /** 最近里程碑. */
  async getMilestones(_uid: string): Promise<DashboardMilestonesDto> {
    return {
      items: [
        {
          icon: 'local_fire_department_outlined',
          title: '连续 12 天打卡',
          subtitle: '昨天 21:34 完成 · 基础体能',
          accent: 'coral',
        },
        {
          icon: 'psychology_alt_outlined',
          title: '完成 PHQ-9 首次评估',
          subtitle: '8 月 12 日 · 处于正常区间',
          accent: 'iris',
        },
        {
          icon: 'emoji_events_outlined',
          title: '解锁「呼吸调节师」成就',
          subtitle: '8 月 9 日 · 完成 30 次呼吸练习',
          accent: 'mint',
        },
        {
          icon: 'insights_outlined',
          title: '本月觉察日记 14 篇',
          subtitle: '平均长度 287 字 · 已超 8 月目标',
          accent: 'sand',
        },
      ],
    };
  }
}
