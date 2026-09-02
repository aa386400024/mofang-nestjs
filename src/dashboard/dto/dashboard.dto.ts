import { ApiProperty } from '@nestjs/swagger';

import type { GymModule } from '../../shared/types/practice.types';

/**
 * 仪表板 DTO — V2.0 §Tab4 「我的数据」心理健身数据.
 *
 * V2.0 占位: 数据全部 sample, 跟前端 ProfileDashboardPage 对齐.
 * 真实数据 V3 由 PracticeSessionEvent / AssessmentScoreEvent 聚合得到.
 *
 * 设计要点:
 *   - 数据走"聚合"而非"原始事件" (大厂 dashboard standard)
 *   - 前端拿到直接渲染, 不再二次计算
 *   - range 参数决定聚合粒度 (1w=本周, 1m=本月, 3m=近三月, etc.)
 */

/** 顶部 Hero 卡数据 — 本周训练时长 + 连续天数 + 累计次数. */
export class DashboardOverviewDto {
  @ApiProperty({ description: '本周训练时长 (分钟)', example: 142 })
  weeklyMinutes!: number;

  @ApiProperty({ description: '本周目标 (分钟)', example: 180 })
  weeklyGoal!: number;

  @ApiProperty({ description: '连续训练天数', example: 12 })
  streakDays!: number;

  @ApiProperty({ description: '累计训练次数', example: 87 })
  totalSessions!: number;
}

/** 单日训练分钟 — 数组索引 0=周一, 6=周日. */
export class DashboardWeeklyChartDto {
  @ApiProperty({ description: '7 天分钟数 (周一→周日)', example: [28, 12, 24, 0, 30, 22, 26] })
  minutes!: number[];

  @ApiProperty({ description: '单日目标 (分钟)', example: 30 })
  dailyGoal!: number;
}

/** 单个训练模块进度. */
export class DashboardModuleDto {
  @ApiProperty({ description: '模块标识', enum: ['physical_basics', 'cognitive_muscle', 'self_esteem_gain', 'interpersonal_efficacy'] })
  module!: GymModule;

  @ApiProperty({ description: 'emoji 图标', example: '🌬️' })
  emoji!: string;

  @ApiProperty({ description: '模块标题', example: '基础体能训练' })
  title!: string;

  @ApiProperty({ description: '模块副标题', example: '呼吸调节 · 身体扫描' })
  subtitle!: string;

  @ApiProperty({ description: '完成度 (0-1)', example: 0.78 })
  percent!: number;

  @ApiProperty({ description: '阶段标签', example: '进阶中' })
  tag!: string;

  @ApiProperty({ description: '强调色 (coral/mint/iris/sand)', example: 'mint' })
  accent!: 'coral' | 'mint' | 'iris' | 'sand';
}

/** 4 模块进度数组. */
export class DashboardModulesDto {
  @ApiProperty({ type: [DashboardModuleDto] })
  items!: DashboardModuleDto[];
}

/** 单条里程碑. */
export class DashboardMilestoneDto {
  @ApiProperty({ description: 'Material icon 名', example: 'local_fire_department_outlined' })
  icon!: string;

  @ApiProperty({ description: '标题', example: '连续 12 天打卡' })
  title!: string;

  @ApiProperty({ description: '副标题', example: '昨天 21:34 完成 · 基础体能' })
  subtitle!: string;

  @ApiProperty({ description: '强调色', example: 'coral' })
  accent!: 'coral' | 'mint' | 'iris' | 'sand';
}

/** 里程碑列表. */
export class DashboardMilestonesDto {
  @ApiProperty({ type: [DashboardMilestoneDto] })
  items!: DashboardMilestoneDto[];
}
