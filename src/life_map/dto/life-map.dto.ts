// V2026-10-13 治本 (Phase 7.10 P0-6 — life-map.dto.ts):
//   心塑 心理地图 Tab DTO 契约 (跟 xin_su_app life_map_home_page 1:1).
//
//   背景:
//     - 7.10 P0-6 补 server life_map controller (V2026-09-12 之前 17 file 已有, 缺 controller).
//   修复: DTO 4 区块 — entries (3 大入口) + forecastUnlocked + reportUnlocked +
//         driftBottle + timeline (时间轴节点).
//
//   反双胞胎:
//     - 不复用 home/counselor-home dto (业务正交, 心塑 主体功能 vs 咨询师训练)
//     - 跟 xin_su_app LifeMapOverview 字段 1:1

import { ApiProperty } from '@nestjs/swagger';

export class LifeMapEntryDto {
  @ApiProperty({ description: '入口 id (跟 xin_su_app LifeMapEntry.title 1:1)', example: 'life_stage' })
  id!: string;

  @ApiProperty({ description: '入口标题', example: '人生阶段梳理' })
  title!: string;

  @ApiProperty({ description: '入口副标题', example: '回顾过往阶段, 看清成长轨迹' })
  subtitle!: string;

  @ApiProperty({ description: '入口 emoji 图标', example: '🌱' })
  emoji!: string;

  @ApiProperty({ description: '进度 (0.0 - 1.0)', example: 0.3 })
  progress!: number;

  @ApiProperty({ description: '进度标签 (V0.5 写死「进行中」)', example: '进行中' })
  tag!: string;

  @ApiProperty({ description: '强调色 key (UI 端 palette 查色)', example: 'coral' })
  accent!: 'coral' | 'mint' | 'softBlue';
}

export class LifeMapOverviewDto {
  @ApiProperty({ description: '3 大核心入口 (人生阶段梳理 / 关键事件记录 / 心理基因盘点)', type: [LifeMapEntryDto] })
  entries!: LifeMapEntryDto[];

  @ApiProperty({ description: '人生剧本推演解锁状态 (V0.5 写死 locked)', example: false })
  forecastUnlocked!: boolean;

  @ApiProperty({ description: '成长轨迹报告解锁状态 (V0.5 写死 locked)', example: false })
  reportUnlocked!: boolean;

  @ApiProperty({ description: '漂流瓶入口 (V0.5 写死 enabled=true)', example: { enabled: true, hint: '海面上漂着的信, 写一封, 捞一封' } })
  driftBottle!: {
    enabled: boolean;
    hint: string;
  };

  @ApiProperty({
    description: '时间轴节点 (V0.5 mock 6 个, 对应生命阶段)',
    type: [Object],
    example: [
      { ageRange: '0-6', stage: 'infant', filled: true },
      { ageRange: '6-12', stage: 'child', filled: true },
      { ageRange: '12-18', stage: 'teen', filled: false },
    ],
  })
  timeline!: {
    ageRange: string;
    stage: 'infant' | 'child' | 'teen' | 'young_adult' | 'adult' | 'elderly';
    filled: boolean;
  }[];

  @ApiProperty({ description: '当前用户角色 (心塑 主 app, 非咨询师端)', example: 'growth_user' })
  currentRole!: 'growth_user' | 'companion';
}
