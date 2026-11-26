import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard.js';

import { CertificationDto, SubmitCertificationDto } from '../dto/certification.dto.js';
import { CertificationService } from '../providers/certification.service.js';

/**
 * Certification controller — 心塑「我的」Tab 实名认证控制器 (陪伴者专属).
 *
 * 端点:
 *   GET  /profile/certification  - 查询当前陪伴者认证状态
 *   POST /profile/certification  - 提交实名认证
 *
 * 大厂做法:
 *   - JwtAuthGuard 负责身份认证；"陪伴者"是产品业务身份，不是 RBAC 系统角色，
 *     不能拿 users.admin_role 体系的 RolesGuard 判断（AF-547 修正）。
 *   - 业务校验放 service (大厂: controller 薄, service 厚)
 *   - 提交后 audit log (V3 接)
 */
@ApiTags('Profile-Certification')
@Controller('profile/certification')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
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
