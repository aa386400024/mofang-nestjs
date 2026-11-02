// V2026-10-20 治本 (专项技能 Hero 显示偏好 — Controller):
//   原因: 设置页需要读写该偏好 (设计规格 §14-2: 关闭后须能从设置恢复).
//   修复: GET /counselor/preferences + PATCH /counselor/preferences.
//   反双胞胎:
//     - 不挂到 /counselor/training/* 下 (偏好属用户维度, 不属训练维度)
//     - 不用 PUT (语义上应为局部更新 PATCH, 支持前端只提交变更的单个 key)
//   验证: swagger /counselor/preferences 可见 GET + PATCH.
//   时间戳: 2026-10-20
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CounselorUiPreferencesDto, UpdateCounselorUiPreferencesDto } from '../dto/training-exercise.dto';
import { CounselorUiPreferenceService } from '../providers/counselor-ui-preference.service';

@ApiTags('counselor-preferences')
@Controller('counselor/preferences')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorUiPreferenceController {
  constructor(private readonly preferenceService: CounselorUiPreferenceService) {}

  @Get()
  @ApiOperation({ summary: '读取咨询师端界面偏好 (无记录时返回默认值)' })
  get(@CurrentUser() user: { userId: string }): Promise<CounselorUiPreferencesDto> {
    return this.preferenceService.getPreferences(user.userId);
  }

  @Patch()
  @ApiOperation({ summary: '更新界面偏好 (未知键抛 400, 避免静默写入脏数据)' })
  update(@CurrentUser() user: { userId: string }, @Body() dto: UpdateCounselorUiPreferencesDto): Promise<CounselorUiPreferencesDto> {
    return this.preferenceService.updatePreferences(user.userId, dto);
  }
}
