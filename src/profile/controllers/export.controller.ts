import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { DeleteAccountDto, DeleteAccountResponseDto, ExportDataDto, ExportTaskDto } from '../dto/export.dto';
import { ExportService } from '../providers/export.service';

/**
 * 数据导出 + 一键删除 controller — V2.0 §Tab4 隐私与数据安全.
 *
 * 端点 (V2.0):
 *   POST /profile/me/export              - 申请导出我的数据 (异步任务)
 *   GET  /profile/me/export/:taskId     - 查询导出任务状态
 *   DELETE /profile/me                  - 一键删除账户 (二次确认由前端负责)
 *
 * V2.0 占位说明:
 *   - exportData 仅返回任务 id, 不真生成 ZIP
 *   - deleteAccount 仅审计日志, 真实删除留 V3
 */
@ApiTags('profile-privacy')
@Controller('profile/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ExportController {
  constructor(private readonly service: ExportService) {}

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '申请导出我的数据 (异步任务, V2 占位返回 task id)' })
  public async exportData(@CurrentUser() user: { userId: string }, @Body() dto: ExportDataDto): Promise<ExportTaskDto> {
    return this.service.exportData(user.userId, dto);
  }

  @Get('export/:taskId')
  @ApiOperation({ summary: '查询导出任务状态' })
  public async getExportTask(@CurrentUser() user: { userId: string }, @Param('taskId') taskId: string): Promise<ExportTaskDto> {
    return this.service.getExportTask(user.userId, taskId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '一键删除账户 (二次确认由前端负责, V2 占位仅审计)' })
  public async deleteAccount(@CurrentUser() user: { userId: string }, @Body() dto: DeleteAccountDto): Promise<DeleteAccountResponseDto> {
    return this.service.deleteAccount(user.userId, dto);
  }
}
