import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { GymRecordEntryDto } from '../dto/practice.dto';
import { PracticeRecordService } from '../providers/practice.service';

/**
 * 训练记录 controller — V2.0 §Tab2 训练记录页 + Tab4 我的数据.
 *
 *   GET /practice/records?since=ISO_DATE
 *
 * 反双胞胎:
 *   - 走 /practice/records 端点, 不走 /profile/dashboard/records (后者不存在, 避免命名冲突)
 *   - dashboard 模块的 weekly/modules/milestones 仍走 /profile/dashboard/* 端点
 *   - 数据同源 (practice_records 表), 不分 V1/V2 表
 */
@ApiTags('practice-records')
@Controller('practice/records')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PracticeRecordsController {
  constructor(private readonly service: PracticeRecordService) {}

  @Get()
  @ApiOperation({ summary: '训练记录列表 (按时间倒序, 可选 since 过滤)' })
  public async listRecords(@CurrentUser() user: { userId: string }, @Query('since') since?: string): Promise<GymRecordEntryDto[]> {
    const sinceDate = since ? new Date(since) : undefined;
    return this.service.listRecords(user.userId, sinceDate);
  }
}
