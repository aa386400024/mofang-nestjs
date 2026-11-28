import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../user/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard.js';

import { DeleteAccountDto, DeleteAccountResponseDto, ExportDataDto, ExportTaskDto } from '../dto/export.dto.js';
import { ExportService } from '../providers/export.service.js';

/**
 * 数据导出 + 一键删除 controller — V2.0 §Tab4 隐私与数据安全.
 *
 * 端点 (V2.0 / Phase4 WP29):
 *   POST /profile/me/export                     - 申请导出我的数据
 *   GET  /profile/me/export/:taskId             - 查询导出任务状态
 *   GET  /profile/me/export/:taskId/download    - 下载导出文件 (24h 有效)
 *   DELETE /profile/me                          - 一键删除账户 (二次确认由前端负责)
 *
 * Phase4 WP29 纵切:
 *   - 导出覆盖 account / profile / 通知 / 会员 / 认证 / 陪伴 / 自护 / 同意与授权
 *   - 已纳入 AI 对话摘要、练习场次与训练记录（schema 1.1）
 *   - 对话消息原文服务端不存储；记忆、语音转写仍待后续批次，scope.pendingDomains 明示
 */
@ApiTags('profile-privacy')
@Controller('profile/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ExportController {
  constructor(private readonly service: ExportService) {}

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '申请导出我的数据 (异步生成, 轮询 GET 查询状态, 任务与文件 24h 有效)' })
  public async exportData(@CurrentUser() user: { userId: string }, @Body() dto: ExportDataDto): Promise<ExportTaskDto> {
    return this.service.exportData(user.userId, dto);
  }

  @Get('export/:taskId')
  @ApiOperation({ summary: '查询导出任务状态' })
  public async getExportTask(@CurrentUser() user: { userId: string }, @Param('taskId') taskId: string): Promise<ExportTaskDto> {
    return this.service.getExportTask(user.userId, taskId);
  }

  @Get('export/:taskId/download')
  @ApiProduces('application/json', 'application/zip')
  @ApiOperation({ summary: '下载导出文件 (24h 内有效, 仅任务所有者)' })
  public async downloadExport(
    @CurrentUser() user: { userId: string },
    @Param('taskId') taskId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.service.getExportDownload(user.userId, taskId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.body);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '一键删除账户 (软删 + 会话/JWT/OAuth 撤销, 冷静期后硬擦除)' })
  public async deleteAccount(@CurrentUser() user: { userId: string }, @Body() dto: DeleteAccountDto): Promise<DeleteAccountResponseDto> {
    return this.service.deleteAccount(user.userId, dto);
  }
}
