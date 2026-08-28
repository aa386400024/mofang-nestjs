import { Injectable } from '@nestjs/common';

import { LifeMapEntryDto, LifeMapOverviewDto, LifeMapTimelineDto, LifeMapTimelineNode } from '../dto/life-map.dto';

/**
 * 人生地图服务 — V2.0 §Tab4 「我的数据」人生轨迹心理地图.
 *
 * V2.0 范围限定: 仅入口页面数据, 不做真正编辑:
 *   - 三大入口进度 (阶段梳理 / 关键事件 / 心理基因盘点)
 *   - 时间轴缩略预览
 *   - 整体入口数据
 *   - 报告 / 推演解锁状态
 *
 * V2.0 占位: 全 0, 跟前端 ProfileLifeMapPage 一致.
 * V3 接 LifeStageProgress / KeyEventRecord / GeneticDimensionSnapshot 表后真实查询.
 */
@Injectable()
export class LifeMapService {
  async getOverview(_uid: string): Promise<LifeMapOverviewDto> {
    const entries: LifeMapEntryDto[] = [
      {
        emoji: '🧭',
        accent: 'iris',
        title: '人生阶段梳理',
        subtitle: '青春期 / 初显期 / 转型期 / 中期 任务完成度',
        tag: '已梳理 0 / 4 阶段',
        progress: 0,
      },
      {
        emoji: '📌',
        accent: 'coral',
        title: '关键事件记录',
        subtitle: '标记影响你成长的转折点 · 正向 / 负向 / 中性',
        tag: '已记录 0 个事件',
        progress: 0,
      },
      {
        emoji: '🧬',
        accent: 'mint',
        title: '心理基因盘点',
        subtitle: '安全感 · 自尊 · 自主性 · 韧性 · 自我整合',
        tag: '已盘点 0 / 5 维度',
        progress: 0,
      },
    ];
    return {
      entries,
      reportUnlocked: false,
      forecastUnlocked: false,
    };
  }

  async getTimeline(_uid: string): Promise<LifeMapTimelineDto> {
    const nodes: LifeMapTimelineNode[] = [
      { stage: 'adolescence', ageRange: '0-12', filled: false },
      { stage: 'adolescence', ageRange: '12-18', filled: false },
      { stage: 'emerging_adulthood', ageRange: '18-28', filled: false },
      { stage: 'transition', ageRange: '28-35', filled: false },
      { stage: 'midlife', ageRange: '35+', filled: false },
    ];
    return {
      nodes,
      filledCount: nodes.filter((n) => n.filled).length,
    };
  }
}
