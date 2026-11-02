// V2026-10-13 治本 (Phase 7.10 P0-5 — counselor-profile.controller.ts):
//   心理咨询师学员端「我的」Tab 主 controller.
//
//   端点 (V0.5 简化):
//     GET    /counselor/profile/overview  - 综合快照 (训练偏好 + 会员状态)
//     PUT    /counselor/profile/preference - 更新训练偏好 (V0.5 echo, V1.x 持久化)
//
//   反双胞胎 (跟 counselor-home/training/exam/growth controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid
//     - 不复用 home-overview.controller (业务正交)

import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type CounselorProfileDto, CounselorProfileUpdatePreferenceDto } from '../dto/counselor-profile.dto';
import { CounselorProfileService } from '../providers/counselor-profile.service';

/**
 * V2026-10-13 (Phase 7.10 P0-5 — CounselorProfileController):
 *   心理咨询师学员端「我的」Tab 主 controller.
 */
@ApiTags('counselor-profile')
@Controller('counselor/profile')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorProfileController {
  constructor(private readonly service: CounselorProfileService) {}

  @Get('overview')
  @ApiOperation({ summary: '心理咨询师学员端「我的」Tab 综合快照 (训练偏好 + 会员状态)' })
  async getOverview(@CurrentUser() user: { userId: string }): Promise<CounselorProfileDto> {
    return this.service.getOverview(user.userId);
  }

  @Put('preference')
  @ApiOperation({ summary: '更新训练偏好 (V0.5 echo, V1.x 持久化)' })
  async updatePreference(
    @CurrentUser() user: { userId: string },
    @Body() dto: CounselorProfileUpdatePreferenceDto,
  ): Promise<CounselorProfileUpdatePreferenceDto> {
    return this.service.updatePreference(user.userId, dto);
  }
}
