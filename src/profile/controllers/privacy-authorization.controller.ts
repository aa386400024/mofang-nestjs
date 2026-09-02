import { Controller, Delete, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { PrivacyAuthorizationsResponseDto } from '../dto/privacy-authorization.dto';
import { PrivacyAuthorizationService } from '../providers/privacy-authorization.service';

/**
 * 隐私授权 controller — V2.0 §Tab4 「授权管理」.
 *
 * 端点 (V2.0):
 *   GET    /profile/privacy/authorizations       - 列出当前用户所有授权
 *   DELETE /profile/privacy/authorizations/:id   - 撤销单个授权 (软删)
 *
 * 设计: 独立 controller 不挂 PrivacySettingsPage 路径, 让"授权管理"UI 有专属入口.
 *   - 跟前端 PrivacySettingsPage 列表项"授权管理"路由一致
 *   - 全程 JwtAuthGuard, @CurrentUser() 注入 uid, 业务层强校验
 */
@ApiTags('profile-privacy')
@Controller('profile/privacy/authorizations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PrivacyAuthorizationController {
  constructor(private readonly service: PrivacyAuthorizationService) {}

  @Get()
  @ApiOperation({ summary: '列出当前用户所有授权 (OAuth 第三方 + 设备权限 + 推送)' })
  public async list(@CurrentUser() user: { userId: string }): Promise<PrivacyAuthorizationsResponseDto> {
    return this.service.listAuthorizations(user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '撤销一个授权 (软删, 保留 audit)' })
  public async revoke(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<{ revoked: true; id: string }> {
    return this.service.revokeAuthorization(user.userId, id);
  }
}
