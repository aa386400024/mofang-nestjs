// V2026-10-13 治本 (Phase 7.10 P0-3 — counselor-exam.dto.ts, counselor 端 exam Tab):
//   心理咨询师学员端「题库」Tab DTO 契约 (跟 xin_su_app CounselorExamBloc 1:1).
//
//   背景:
//     - 7.10 P0-3 接真 server, 题库 Tab 数据 (4 大分类 + 11 卡片) 跟 home/training 正交,
//       单独建 DTO, 不复用 counselor-home.dto.
//   修复: 4 大分类 enum (realPast / mock / wrongReview / handbook) + 11 卡片字段.
//
//   反双胞胎:
//     - 不用 home dto 的 TrainingCategory (4 值, 但语义不同)
//     - 11 卡片 id 跟 xin_su_app CounselorExamPage 1:1 (real_years / real_topic / real_high_freq
//       / mock_chapter / mock_full / mock_prediction / wrong_all / wrong_retry / handbook_basic /
//       handbook_diagnosis / handbook_ethics)

import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * V2026-10-13 (Phase 7.10 P0-3 — CounselorExamDto):
 *   心理咨询师学员端「题库」Tab 综合快照.
 */
export class CounselorExamDto {
  @ApiProperty({
    description: '4 大分类 (真题 / 模拟考 / 错题回顾 / 考点手册) + 11 卡片',
    example: { realPast: { count: 8 }, mock: { count: 3 }, wrongReview: { count: 12 }, handbook: { count: 3 } },
  })
  categories!: {
    realPast: { count: number };
    mock: { count: number };
    wrongReview: { count: number };
    handbook: { count: number };
  };

  @ApiProperty({ description: '真题总数 (server 历次真题累计, 跟下方 3 张卡片分别对应)', example: 8 })
  totalRealPastQuestions!: number;

  @ApiProperty({ description: '当前用户错题总数', example: 12 })
  wrongQuestionsCount!: number;

  @ApiProperty({ description: '考点手册章节数', example: 3 })
  handbookChapters!: number;

  @ApiProperty({ description: '用户当前角色 (写死 counselor_learner)', enum: ['counselor_learner'] })
  currentRole!: 'counselor_learner';
}

export class CounselorExamQueryDto {
  @ApiProperty({ description: '当前情绪档位 (前端 EmotionBloc 注入)', required: false })
  @IsOptional()
  @IsString()
  emotionLevel?: string;
}
