// V2026-10-13 治本 (Phase 7.10 P0-3 — counselor-exam.service.ts):
//   心理咨询师学员端「题库」Tab 业务逻辑服务.
//
//   背景:
//     - 7.10 P0-3 接真 server, 跟 home/training 数据正交, 单独建 service.
//   修复: 全内存 mock (跟 home 同 pattern), V1.x 接 question-bank + answer-history 表.
//
//   V2026-10-13 治本 (TS6133 'userId' unused fix):
//     `pnpm build` 报 5 处 TS6133, 4 file 全是 `userId` 参数声明但 V0.5 mock 不用.
//     治本: 跟 `_emotionLevel` 同 pattern, 改 `_userId` 前缀 (TypeScript convention,
//     下划线开头的参数认为是 "故意保留但未用", 不报 TS6133). V1.x 真接库后删下划线
//     重新使用即可, 零 breaking change.
//
//   反双胞胎:
//     - 不复用 CounselorHomeService (4 Tab 数据正交)
//     - 不引 question bank 库 (V0.x 阶段 11 卡片 mock, V1.x 真实题库)

import { Injectable } from '@nestjs/common';

import { type CounselorExamDto } from '../dto/counselor-exam.dto';

@Injectable()
export class CounselorExamService {
  /**
   * GET /counselor/exam/overview 主入口.
   *
   * @param _userId 当前用户 id (从 JWT @CurrentUser 注入, V0.5 mock 不用, V1.x 改回 userId)
   * @param _emotionLevel 当前情绪档位 (V0.5 暂未使用, V1.x 接入答题推荐)
   */
  async getOverview(_userId: string, _emotionLevel?: string): Promise<CounselorExamDto> {
    return this.buildMockOverview();
  }

  private buildMockOverview(): CounselorExamDto {
    return {
      categories: {
        realPast: { count: 8 },
        mock: { count: 3 },
        wrongReview: { count: 12 },
        handbook: { count: 3 },
      },
      totalRealPastQuestions: 8,
      wrongQuestionsCount: 12,
      handbookChapters: 3,
      currentRole: 'counselor_learner',
    };
  }
}
