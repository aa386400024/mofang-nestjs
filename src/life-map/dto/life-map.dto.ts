import { ApiProperty } from '@nestjs/swagger';

import type { LifeStage } from '../../shared/types/practice.types';

/**
 * 人生地图入口 DTO — V2.0 §Tab4 「我的数据」人生轨迹心理地图.
 *
 * V2.0 范围: 仅"入口页面"数据, 不做真正的"阶段梳理 / 事件编辑"功能.
 *   - 三大入口进度 (阶段梳理 / 关键事件 / 心理基因盘点)
 *   - 时间轴缩略预览
 *   - 整体入口数据
 *
 * V2.0 占位: 全 0 (用户没梳理过任何阶段), 跟前端 ProfileLifeMapPage 一致.
 */

/** 单个入口进度. */
export class LifeMapEntryDto {
  @ApiProperty({ description: 'emoji', example: '🧭' })
  emoji!: string;

  @ApiProperty({ description: '强调色 (iris/coral/mint)', example: 'iris' })
  accent!: 'iris' | 'coral' | 'mint';

  @ApiProperty({ description: '入口标题', example: '人生阶段梳理' })
  title!: string;

  @ApiProperty({ description: '入口副标题', example: '青春期 / 初显期 / 转型期 / 中期 任务完成度' })
  subtitle!: string;

  @ApiProperty({ description: '进度文案', example: '已梳理 0 / 4 阶段' })
  tag!: string;

  @ApiProperty({ description: '完成度 (0-1)', example: 0 })
  progress!: number;
}

/** 人生地图主入口响应. */
export class LifeMapOverviewDto {
  @ApiProperty({ type: [LifeMapEntryDto] })
  entries!: LifeMapEntryDto[];

  @ApiProperty({ description: '是否解锁成长报告 (需先完成前 3 步)', example: false })
  reportUnlocked!: boolean;

  @ApiProperty({ description: '是否解锁人生推演引擎', example: false })
  forecastUnlocked!: boolean;
}

/** 单个时间轴节点. */
export class LifeMapTimelineNode {
  @ApiProperty({ description: '阶段标识', enum: ['adolescence', 'emerging_adulthood', 'transition', 'midlife'] })
  stage!: LifeStage;

  @ApiProperty({ description: '年龄范围文案', example: '12-18' })
  ageRange!: string;

  @ApiProperty({ description: '是否已记录 (V2.0 全部 false)', example: false })
  filled!: boolean;
}

/** 时间轴缩略. */
export class LifeMapTimelineDto {
  @ApiProperty({ type: [LifeMapTimelineNode] })
  nodes!: LifeMapTimelineNode[];

  @ApiProperty({ description: '已记录节点数', example: 0 })
  filledCount!: number;
}
