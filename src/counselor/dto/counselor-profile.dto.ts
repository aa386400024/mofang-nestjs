// V2026-10-13 治本 (Phase 7.10 P0-5 — counselor-profile.dto.ts):
//   心理咨询师学员端「我的」Tab DTO 契约.
//
//   背景:
//     - 7.10 P0-5 接真 server, profile Tab 数据 (训练偏好 + 会员状态 + 关于) 跟 home 正交.
//   修复: DTO 3 区块 — trainingPreference (3 toggle + defaultDifficulty) + membership (status enum)
//         + currentRole. 隐私/高级设置/关于 V0.5 不接 server (V1.x 走设置模块).
//
//   反双胞胎:
//     - 不复用 home dto (业务正交)
//     - 训练偏好 V0.5 简单 3 toggle + difficulty 字符串, V1.x 加更多维度

import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/**
 * V2026-10-13 (Phase 7.10 P0-5 — CounselorProfileDto):
 *   心理咨询师学员端「我的」Tab 综合快照.
 */
export class CounselorProfileDto {
  @ApiProperty({
    description: '训练偏好 (3 toggle + 默认难度)',
    example: {
      voiceTrainingEnabled: false,
      aiPersonalizationEnabled: false,
      gamificationEnabled: false,
      defaultDifficulty: 'L1',
    },
  })
  trainingPreference!: {
    voiceTrainingEnabled: boolean;
    aiPersonalizationEnabled: boolean;
    gamificationEnabled: boolean;
    defaultDifficulty: 'L1' | 'L2' | 'L3';
  };

  @ApiProperty({
    description: '会员状态 (V0.5 写死 none, V1.x 接 billing 模块)',
    enum: ['none', 'monthly', 'quarterly', 'yearly', 'lifetime'],
    example: 'none',
  })
  membership!: 'none' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime';

  @ApiProperty({ description: '用户当前角色 (写死 counselor_learner)', enum: ['counselor_learner'] })
  currentRole!: 'counselor_learner';
}

export class CounselorProfileUpdatePreferenceDto {
  @ApiProperty({ description: '语音训练 toggle', required: false })
  @IsOptional()
  @IsBoolean()
  voiceTrainingEnabled?: boolean;

  @ApiProperty({ description: 'AI 个性化 toggle', required: false })
  @IsOptional()
  @IsBoolean()
  aiPersonalizationEnabled?: boolean;

  @ApiProperty({ description: '游戏化元素 toggle', required: false })
  @IsOptional()
  @IsBoolean()
  gamificationEnabled?: boolean;

  @ApiProperty({ description: '默认难度', required: false, enum: ['L1', 'L2', 'L3'] })
  @IsOptional()
  @IsString()
  @IsIn(['L1', 'L2', 'L3'])
  defaultDifficulty?: 'L1' | 'L2' | 'L3';
}
