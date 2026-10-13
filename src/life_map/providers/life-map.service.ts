// V2026-10-13 治本 (Phase 7.10 P0-6 — life-map.service.ts):
//   心塑 心理地图 Tab 业务逻辑服务.
//
//   修复: V0.5 内存 mock (跟其它 counselor/home 模式一致), 3 大入口 + 2 渐进解锁 +
//         漂流瓶 + 时间轴 6 节点. V1.x 接 life_stages + key_events + genome_dimensions 表.
//
//   V2026-10-13 治本 (ESLint naming-convention strictCamelCase 修):
//     上一轮 TS6133 fix 把 `userId` 加 `_` 前缀, 但项目 ESLint config 走 strictCamelCase
//     模式, 不接受 `_` 前缀, 报 1 个 lint error (L20). 治本: 改回无下划线 `userId`,
//     方法体首行用 `void userId;` 标 "故意保留但未用" 抑制 TS6133. 零 disable 注释.

import { Injectable } from '@nestjs/common';

import { type LifeMapOverviewDto } from '../dto/life-map.dto';

@Injectable()
export class LifeMapService {
  async getOverview(userId: string): Promise<LifeMapOverviewDto> {
    return this.buildMockOverview(userId);
  }

  private buildMockOverview(userId: string): LifeMapOverviewDto {
    // V0.5 unused; V1.x 改回真用查 user-specific 时间轴.
    void userId;
    return {
      entries: [
        {
          id: 'life_stage',
          title: '人生阶段梳理',
          subtitle: '回顾过往阶段, 看清成长轨迹',
          emoji: '🌱',
          progress: 0.3,
          tag: '进行中',
          accent: 'coral',
        },
        {
          id: 'key_event',
          title: '关键事件记录',
          subtitle: '标记关键转折点, 串联生命故事',
          emoji: '📍',
          progress: 0.15,
          tag: '刚开始',
          accent: 'mint',
        },
        {
          id: 'genome_dimension',
          title: '心理基因盘点',
          subtitle: '识别 5 个核心心理基因, 找到根源卡点',
          emoji: '🧬',
          progress: 0.1,
          tag: '刚开始',
          accent: 'softBlue',
        },
      ],
      forecastUnlocked: false,
      reportUnlocked: false,
      driftBottle: {
        enabled: true,
        hint: '海面上漂着的信, 写一封, 捞一封',
      },
      timeline: [
        { ageRange: '0-6', stage: 'infant', filled: true },
        { ageRange: '6-12', stage: 'child', filled: true },
        { ageRange: '12-18', stage: 'teen', filled: false },
        { ageRange: '18-25', stage: 'young_adult', filled: false },
        { ageRange: '25-60', stage: 'adult', filled: false },
        { ageRange: '60+', stage: 'elderly', filled: false },
      ],
      currentRole: 'growth_user',
    };
  }
}
