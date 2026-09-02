import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CertificationDto, SubmitCertificationDto } from '../dto/certification.dto';
import { CertificationService } from '../providers/certification.service';

/**
 * Certification controller — 心塑「我的」Tab 实名认证控制器 (陪伴者专属).
 *
 * 端点:
 *   GET  /profile/certification  - 查询当前陪伴者认证状态
 *   POST /profile/certification  - 提交实名认证
 *
 * 大厂做法:
 *   - @Roles('companion') + RolesGuard 兜底 (V2.0 简化: 仅靠 @RolesGuard)
 *   - 业务校验放 service (大厂: controller 薄, service 厚)
 *   - 提交后 audit log (V3 接)
 */
@ApiTags('Profile-Certification')
@Controller('profile/certification')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles('companion')
export class CertificationController {
  constructor(private readonly cert: CertificationService) {}

  @Get()
  @ApiOperation({ summary: '查询当前陪伴者认证状态' })
  public async get(@CurrentUser() user: { userId: string }): Promise<CertificationDto> {
    return this.cert.getCertification(user.userId);
  }

  @Post()
  @ApiOperation({ summary: '提交实名认证' })
  public async submit(@CurrentUser() user: { userId: string }, @Body() dto: SubmitCertificationDto): Promise<CertificationDto> {
    return this.cert.submitCertification(user.userId, dto);
  }
}
