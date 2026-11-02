// V2026-10-13 治本 (Phase 7.10 P0-5 — counselor-profile.service.ts):
//   心理咨询师学员端「我的」Tab 业务逻辑服务.
//
//   V0.5: 内存 mock (3 toggle 写死 false, membership 写死 none, V1.x 接 billing).
//
//   V2026-10-13 治本 (ESLint naming-convention strictCamelCase 修):
//     上一轮 TS6133 fix 把 `userId`/`dto` 加 `_` 前缀 (TypeScript convention 抑制 unused
//     warning), 但项目 ESLint config `@typescript-eslint/naming-convention` 走
//     strictCamelCase 模式, 不接受 `_` 前缀, 报 3 个 lint error (L20 + L24).
//     治本: 改回无下划线 `userId`/`dto` 满足 strictCamelCase, 方法体首行用
//     `void userId; void dto;` 标 "故意保留但未用" 抑制 TS6133 (void 是合法 expression,
//     不影响运行时, 单纯 type checker 看到 "使用" 即可). 零 disable 注释, 0 disable 依赖.

import { Injectable } from '@nestjs/common';

import { type CounselorProfileDto, type CounselorProfileUpdatePreferenceDto } from '../dto/counselor-profile.dto';

@Injectable()
export class CounselorProfileService {
  async getOverview(userId: string): Promise<CounselorProfileDto> {
    return this.buildMockOverview(userId);
  }

  async updatePreference(userId: string, dto: CounselorProfileUpdatePreferenceDto): Promise<CounselorProfileUpdatePreferenceDto> {
    // V0.5 unused; V1.x 接 Isar / SharedPreferences 持久化时改回真用.
    void userId;
    void dto;
    return dto;
  }

  private buildMockOverview(userId: string): CounselorProfileDto {
    // V0.5 unused; V1.x 改回真用查 user-specific 偏好.
    void userId;
    return {
      trainingPreference: {
        voiceTrainingEnabled: false,
        aiPersonalizationEnabled: false,
        gamificationEnabled: false,
        defaultDifficulty: 'L1',
      },
      membership: 'none',
      currentRole: 'counselor_learner',
    };
  }
}
