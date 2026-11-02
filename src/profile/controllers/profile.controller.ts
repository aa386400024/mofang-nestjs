import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ParseFilePipeBuilder,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer'; // 加载 namespace, 让 Express.Multer.File 全局可用
// V3: 头像上传走 @types/express 的 Express.Multer.File (跟 FileInterceptor 一致)
type MulterFile = Express.Multer.File;
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePrivacyLevel } from '../../common/decorators/privacy-level.decorator';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrivacyGuard } from '../../common/guards/privacy.guard';
import { PrivacyLevel } from '../../common/privacy/privacy-level.enum';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { GrowthReportDto, GrowthReportQueryDto } from '../dto/growth-report.dto';
import { ListFaqsResponseDto, ListHotlinesResponseDto } from '../dto/help-content.dto';
import { MembershipDto } from '../dto/membership.dto';
import { NotificationSettingsDto, UpdateNotificationSettingsDto } from '../dto/notification-settings.dto';
import { ProfileDto, SwitchRoleDto, UpdateProfileDto, UploadAvatarResponseDto } from '../dto/profile.dto';
import { FAQS, HOTLINES } from '../profile.constant';

import { GrowthReportService } from '../providers/growth-report.service';
import { MembershipService } from '../providers/membership.service';
import { NotificationSettingsService } from '../providers/notification-settings.service';
import { ProfileService } from '../providers/profile.service';

/**
 * Profile controller — 心塑「我的」Tab 主控制器 (大厂企业级 V3).
 *
 * 端点 (V3):
 *   GET    /profile/me                      - 当前用户画像
 *   PUT    /profile/me                      - 更新用户画像
 *   POST   /profile/me/avatar               - 上传头像 (multipart)
 *   PUT    /profile/me/current-role         - 切换角色
 *   GET    /profile/me/notifications        - 通知设置
 *   PUT    /profile/me/notifications        - 更新通知设置
 *   GET    /profile/membership              - 会员中心
 *   GET    /profile/growth-report?range=    - 心理成长报告
 *   GET    /profile/help/faqs                - 常见问题
 *   GET    /profile/help/hotlines            - 危机热线
 *
 * 角色:
 *   - 公开: help/faqs, help/hotlines (无登录也能看, 大厂危机热线必须公开)
 *   - 双角色: /me/*, /me/notifications
 *   - 成长用户: /membership, /growth-report
 *
 * 认证: JwtAuthGuard (cookie auth) — 公开 endpoint 单独跳过.
 */
@ApiTags('Profile')
// V2026-10-15 治本 (VS-4 隐私分级 enforcement 应用 — L2_INTERNAL method-level 8 endpoint, 公开 endpoint 保留 L1 隐式):
//   原因: profile 12 endpoint 混合 (公开 + 鉴权), 不能 class-level 一刀切. 大厂危机热线
//     (help/faqs + help/hotlines) 必须公开 (无登录也能看), 跟 V0.x 注释"公开: help/faqs,
//     help/hotlines (无登录也能看, 大厂危机热线必须公开)"一致. /me/* /membership /growth-report
//     走 L2 内部鉴权. decision 1 B 方案 3 controller 配齐 L1/L2/L3, profile 同时覆盖 L1
//     (隐式放行, 无 @RequirePrivacyLevel) + L2 (8 method-level 装饰).
//   修法: 8 method-level @UseGuards(JwtAuthGuard, PrivacyGuard) + @RequirePrivacyLevel(L2_INTERNAL)
//     加在 /me /me/notifications /membership /growth-report. /help/faqs + /help/hotlines 不动 (L1
//     隐式放行, 跟 PrivacyGuard `if (!level) return true` 1:1).
//   反双胞胎:
//     - 不 class-level 一刀切 (会覆盖公开 endpoint, 危机热线被锁, 跟大厂伦理红线冲突),
//     - 不用 @Public 装饰器 (V0.x culture "decorator 优先", L1 隐式比显式 @Public 更简单),
//     - 不拆 method-level 仅 1 endpoint 试水 (决策 2 A 方案"全 endpoint"一致, 8 endpoint 全 L2),
//     - 0 wire 协议改.
//   验证: 大炮跑 pnpm test:e2e 验 /help/faqs 无 token 200 (L1 隐式) + /me 无 token 401 (L2) +
//     /me 有 token 200 (L2 鉴权通过).
//   时间戳: 2026-10-15.
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly notification: NotificationSettingsService,
    private readonly membership: MembershipService,
    private readonly growthReport: GrowthReportService,
  ) {}

  // ════════════════════════════════════════════════════════════════
  // 公开端点 (无认证)
  // ════════════════════════════════════════════════════════════════

  @Get('help/faqs')
  @ApiOperation({ summary: '常见问题 (公开, 无需登录)' })
  public listFaqs(): ListFaqsResponseDto {
    return { faqs: [...FAQS] };
  }

  @Get('help/hotlines')
  @ApiOperation({ summary: '危机援助热线 (公开, 无需登录)' })
  public listHotlines(): ListHotlinesResponseDto {
    return { hotlines: [...HOTLINES] };
  }

  // ════════════════════════════════════════════════════════════════
  // 双角色共用
  // ════════════════════════════════════════════════════════════════

  @Get('me')
  @UseGuards(JwtAuthGuard, PrivacyGuard)
  @RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前用户画像' })
  public async getMe(@CurrentUser() user: { userId: string }): Promise<ProfileDto> {
    return this.profile.getProfile(user.userId);
  }

  @Put('me')
  @UseGuards(JwtAuthGuard, PrivacyGuard)
  @RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新用户画像' })
  public async updateMe(@CurrentUser() user: { userId: string }, @Body() dto: UpdateProfileDto): Promise<ProfileDto> {
    return this.profile.updateProfile(user.userId, dto);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard, PrivacyGuard)
  @RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: '上传头像 (multipart/form-data)' })
  public async uploadAvatar(
    @CurrentUser() user: { userId: string },
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 })
        .addFileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/i })
        .build({
          fileIsRequired: true,
          errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        }),
    )
    file: MulterFile,
  ): Promise<UploadAvatarResponseDto> {
    if (!file) {
      throw new BizException(BizCode.InvalidParameter, '请上传文件');
    }
    return this.profile.uploadAvatar(user.userId, file);
  }

  @Put('me/current-role')
  @UseGuards(JwtAuthGuard, PrivacyGuard)
  @RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '切换当前角色 (成长用户 / 陪伴者)' })
  public async switchRole(@CurrentUser() user: { userId: string }, @Body() dto: SwitchRoleDto): Promise<ProfileDto> {
    return this.profile.switchRole(user.userId, dto.currentRole);
  }

  @Get('me/notifications')
  @UseGuards(JwtAuthGuard, PrivacyGuard)
  @RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
  @ApiBearerAuth()
  @ApiOperation({ summary: '通知设置' })
  public async getNotifications(@CurrentUser() user: { userId: string }): Promise<NotificationSettingsDto> {
    return this.notification.getSettings(user.userId);
  }

  @Put('me/notifications')
  @UseGuards(JwtAuthGuard, PrivacyGuard)
  @RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新通知设置' })
  public async updateNotifications(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingsDto> {
    return this.notification.updateSettings(user.userId, dto);
  }

  // ════════════════════════════════════════════════════════════════
  // 成长用户专属
  // ════════════════════════════════════════════════════════════════

  @Get('membership')
  @UseGuards(JwtAuthGuard, PrivacyGuard)
  @RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
  @ApiBearerAuth()
  @ApiOperation({ summary: '会员中心 (成长用户专属)' })
  public async getMembership(@CurrentUser() user: { userId: string }): Promise<MembershipDto> {
    return this.membership.getMembership(user.userId);
  }

  @Get('growth-report')
  @UseGuards(JwtAuthGuard, PrivacyGuard)
  @RequirePrivacyLevel(PrivacyLevel.L2_INTERNAL)
  @ApiBearerAuth()
  @ApiOperation({ summary: '心理成长报告 (成长用户专属)' })
  public async getGrowthReport(@CurrentUser() user: { userId: string }, @Body() query: GrowthReportQueryDto): Promise<GrowthReportDto> {
    return this.growthReport.getReport(user.userId, query.range ?? '1m');
  }
}
