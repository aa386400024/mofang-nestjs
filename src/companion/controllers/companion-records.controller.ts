import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CompanionRecordDto } from '../dto/companion.dto';
import { CompanionRecordService } from '../providers/companion.service';

/**
 * 陪伴记录 controller — V2.0 §Tab2 陪伴记录分区.
 *
 *   GET /companion/records?activePersonId=&since=
 *
 * 设计:
 *   - 1 个端点聚合 (大厂 dashboard standard), UI 一拉到位, 减少瀑布流
 *   - since 是 query 参数, 前端下拉刷新时传最近一次成功的时间
 *   - 数据源走 profile/CompanionRecord 表, 不重复建 records 表
 */
@ApiTags('companion-records')
@Controller('companion/records')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CompanionRecordsController {
  constructor(private readonly service: CompanionRecordService) {}

  @Get()
  @ApiOperation({ summary: '陪伴记录列表 (按时间倒序, 可选 since 过滤)' })
  public async listRecords(
    @CurrentUser() user: { userId: string },
    @Query('activePersonId') activePersonId = 'person-1',
    @Query('since') since?: string,
  ): Promise<CompanionRecordDto[]> {
    const sinceDate = since ? new Date(since) : undefined;
    return this.service.listRecords(user.userId, activePersonId, sinceDate);
  }
}
