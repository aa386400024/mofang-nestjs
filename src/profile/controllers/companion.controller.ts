import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { BurnoutSettingsDto, UpdateBurnoutSettingsDto } from '../dto/burnout-settings.dto';
import {
  AcceptInviteDto,
  CompanionBindingDto,
  CreateInviteDto,
  InviteCodeResponseDto,
  ListCompanionBindingsResponseDto,
  TerminateBindingDto,
  UpdatePermissionDto,
} from '../dto/companion-binding.dto';
import { CompanionRecordDto, CreateCompanionRecordDto, ListCompanionRecordsResponseDto } from '../dto/companion-record.dto';
import { ConsentDocumentDto, ConsentSignatureDto, SignConsentDto } from '../dto/consent.dto';
import { CreateSelfcareRecordDto, ListSelfcareRecordsResponseDto, SelfcareRecordDto } from '../dto/selfcare-record.dto';
import { BurnoutSettingsService } from '../providers/burnout-settings.service';
import { CompanionBindingService } from '../providers/companion-binding.service';
import { CompanionRecordService } from '../providers/companion-record.service';
import { ConsentService } from '../providers/consent.service';
import { SelfcareRecordService } from '../providers/selfcare-record.service';

/**
 * Companion controller — 心塑「我的」Tab 陪伴者专属控制器.
 *
 * 端点 (V3):
 *   陪伴记录 (V2.0 §Tab4 我的陪伴记录):
 *     GET  /profile/companion-records           - 列表
 *     POST /profile/companion-records           - 新增
 *   关系绑定 (V2.0 §Tab4 绑定关系管理 / 权限与共享管理):
 *     GET  /profile/companion-bindings           - 列表
 *     POST /profile/companion-bindings/invite   - 生成邀请码 (成长用户)
 *     POST /profile/companion-bindings/accept   - 接受邀请码 (陪伴者)
 *     POST /profile/companion-bindings/:id/permission  - 改权限等级 (成长用户)
 *     DELETE /profile/companion-bindings/:id     - 解除 (双端)
 *   自我关怀 (V2.0 §Tab4 自我关怀记录 / 耗竭预警):
 *     GET  /profile/selfcare-records            - 列表
 *     POST /profile/selfcare-records            - 新增
 *     GET  /profile/burnout-settings            - 设置
 *     PUT  /profile/burnout-settings            - 更新
 *   知情同意书 (V2.0 §Tab4 知情同意书):
 *     GET  /profile/consent-document            - 拉文档
 *     POST /profile/consent-sign                - 签字
 *
 * 角色:
 *   - 陪伴者专属: companion-records, selfcare, burnout, consent
 *   - 双角色: companion-bindings (按 owner_uid 区分)
 *
 * 大厂做法:
 *   - 路径按业务子领域分 (companion-records / companion-bindings / selfcare-records / burnout-settings / consent)
 *   - 不依赖 RolesGuard 的列表 (列表也保护, 拉出别人的记录就是越权)
 */
@ApiTags('Profile-Companion')
@Controller('profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles('companion')
export class CompanionController {
  constructor(
    private readonly record: CompanionRecordService,
    private readonly binding: CompanionBindingService,
    private readonly selfcare: SelfcareRecordService,
    private readonly burnout: BurnoutSettingsService,
    private readonly consent: ConsentService,
  ) {}

  // ════════════════════════════════════════════════════════════════
  // 陪伴记录
  // ════════════════════════════════════════════════════════════════

  @Get('companion-records')
  @ApiOperation({ summary: '陪伴记录列表' })
  public async listRecords(@CurrentUser() user: { userId: string }): Promise<ListCompanionRecordsResponseDto> {
    return this.record.list(user.userId);
  }

  @Post('companion-records')
  @ApiOperation({ summary: '新增陪伴记录' })
  public async createRecord(@CurrentUser() user: { userId: string }, @Body() dto: CreateCompanionRecordDto): Promise<CompanionRecordDto> {
    return this.record.create(user.userId, dto);
  }

  // ════════════════════════════════════════════════════════════════
  // 关系绑定
  // ════════════════════════════════════════════════════════════════

  @Get('companion-bindings')
  @ApiOperation({ summary: '关系绑定列表 (双角色共用, 按 owner_uid 区分)' })
  public async listBindings(@CurrentUser() user: { userId: string }): Promise<ListCompanionBindingsResponseDto> {
    return this.binding.listBindings(user.userId);
  }

  @Post('companion-bindings/invite')
  @ApiOperation({ summary: '生成邀请码 (成长用户)' })
  public async createInvite(@CurrentUser() user: { userId: string }, @Body() dto: CreateInviteDto): Promise<InviteCodeResponseDto> {
    return this.binding.createInvite(user.userId, dto);
  }

  @Post('companion-bindings/accept')
  @ApiOperation({ summary: '接受邀请码 (陪伴者)' })
  public async acceptInvite(@CurrentUser() user: { userId: string }, @Body() dto: AcceptInviteDto): Promise<CompanionBindingDto> {
    return this.binding.acceptInvite(user.userId, dto);
  }

  @Post('companion-bindings/:id/permission')
  @ApiOperation({ summary: '修改权限等级 (成长用户对自己创建的 binding 操作)' })
  public async updatePermission(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdatePermissionDto,
  ): Promise<CompanionBindingDto> {
    return this.binding.updatePermission(user.userId, id, dto);
  }

  @Delete('companion-bindings/:id')
  @ApiOperation({ summary: '解除绑定 (双端任一方可操作)' })
  public async terminateBinding(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: TerminateBindingDto,
  ): Promise<{ success: true }> {
    await this.binding.terminateBinding(user.userId, id, dto.reason);
    return { success: true };
  }

  // ════════════════════════════════════════════════════════════════
  // 自我关怀
  // ════════════════════════════════════════════════════════════════

  @Get('selfcare-records')
  @ApiOperation({ summary: '自我关怀记录列表' })
  public async listSelfcare(@CurrentUser() user: { userId: string }): Promise<ListSelfcareRecordsResponseDto> {
    return this.selfcare.list(user.userId);
  }

  @Post('selfcare-records')
  @ApiOperation({ summary: '新增自我关怀打卡' })
  public async createSelfcare(@CurrentUser() user: { userId: string }, @Body() dto: CreateSelfcareRecordDto): Promise<SelfcareRecordDto> {
    return this.selfcare.create(user.userId, dto);
  }

  @Get('burnout-settings')
  @ApiOperation({ summary: '耗竭预警设置' })
  public async getBurnout(@CurrentUser() user: { userId: string }): Promise<BurnoutSettingsDto> {
    return this.burnout.getSettings(user.userId);
  }

  @Put('burnout-settings')
  @ApiOperation({ summary: '更新耗竭预警设置' })
  public async updateBurnout(@CurrentUser() user: { userId: string }, @Body() dto: UpdateBurnoutSettingsDto): Promise<BurnoutSettingsDto> {
    return this.burnout.updateSettings(user.userId, dto);
  }

  // ════════════════════════════════════════════════════════════════
  // 知情同意书
  // ════════════════════════════════════════════════════════════════

  @Get('consent-document')
  @ApiOperation({ summary: '拉取知情同意书文档' })
  public async getConsent(): Promise<ConsentDocumentDto> {
    return this.consent.getDocument();
  }

  @Post('consent-sign')
  @ApiOperation({ summary: '签字 (防跳过阅读校验 scrolledToBottom)' })
  public async signConsent(
    @CurrentUser() user: { userId: string } & { ipAddress?: string; userAgent?: string },
    @Body() dto: SignConsentDto,
  ): Promise<ConsentSignatureDto> {
    return this.consent.sign(user.userId, dto, {
      ipAddress: user.ipAddress ?? '',
      userAgent: user.userAgent ?? '',
    });
  }
}
