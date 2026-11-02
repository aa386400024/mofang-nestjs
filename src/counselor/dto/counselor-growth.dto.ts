// V2026-10-13 治本 (Phase 7.10 P0-4 — counselor-growth.dto.ts):
//   心理咨询师学员端「成长」Tab DTO 契约.
//
//   背景:
//     - 7.10 P0-4 接真 server, 成长 Tab 数据 (4 区块: 能力成长 / 训练记录 / 错题本 / 工作室)
//       跟 home 部分字段重叠 (ability + weeklyProgress), 单独 DTO 保持职责正交.
//   修复: DTO 4 区块 — ability (6 维复用) + weeklyProgress (复用) + trainingRecords (V0.5 空)
//       + wrongQuestions (V0.5 空) + studio (V0.5 mock 占位).
//
//   反双胞胎:
//     - 不复用 home dto (4 区块是成长专属, home 是 hub 入口)
//     - 训练记录 / 错题本 V0.5 返空数组 (V1.x 接 training-sessions / wrong-questions 表)

import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * V2026-10-13 (Phase 7.10 P0-4 — CounselorGrowthDto):
 *   心理咨询师学员端「成长」Tab 综合快照.
 */
export class CounselorGrowthDto {
  @ApiProperty({
    description: '6 维能力雷达 (跟 home/overview 1:1 复用)',
    example: { listening: 0.35, empathy: 0.2, questioning: 0.45, boundary: 0.15, voiceProfessionalism: 0.3, caseConceptualization: 0.25 },
  })
  ability!: {
    listening: number;
    empathy: number;
    questioning: number;
    boundary: number;
    voiceProfessionalism: number;
    caseConceptualization: number;
  };

  @ApiProperty({
    description: '4 KPI 本周成长 (跟 home/overview 1:1 复用)',
    example: { toolsCompletedThisWeek: 0, fragmentsEarnedThisWeek: 0, islandsUnlockedThisWeek: 0, consecutiveActiveDays: 0 },
  })
  weeklyProgress!: {
    toolsCompletedThisWeek: number;
    fragmentsEarnedThisWeek: number;
    islandsUnlockedThisWeek: number;
    consecutiveActiveDays: number;
  };

  @ApiProperty({ description: '训练记录 (V0.5 返空数组, V1.x 跨表聚合)', type: [Object] })
  trainingRecords!: {
    id: string;
    occurredAt: string;
    scenarioTitle: string;
    overallScore: number;
    durationSeconds: number;
    aborted: boolean;
  }[];

  @ApiProperty({ description: '错题聚合 (V0.5 返空数组, V1.x 跨表聚合)', type: [Object] })
  wrongQuestions!: {
    id: string;
    errorType: string;
    trainingScene: string;
    practiceCount: number;
    lastPracticedAt: string;
  }[];

  @ApiProperty({
    description: '工作室 (V2.0 阶段 3 上线, V0.5 写死 locked)',
    example: { unlocked: false, unlockedCreatureCount: 0, totalCreatureCount: 12 },
  })
  studio!: {
    unlocked: boolean;
    unlockedCreatureCount: number;
    totalCreatureCount: number;
  };

  @ApiProperty({ description: '用户当前角色 (写死 counselor_learner)', enum: ['counselor_learner'] })
  currentRole!: 'counselor_learner';
}

export class CounselorGrowthQueryDto {
  @ApiProperty({ description: '当前情绪档位 (前端 EmotionBloc 注入)', required: false })
  @IsOptional()
  @IsString()
  emotionLevel?: string;
}
