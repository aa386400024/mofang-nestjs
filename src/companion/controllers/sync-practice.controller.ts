import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { SyncPracticeDto } from '../dto/companion.dto';
import { SyncPracticeService } from '../providers/companion.service';

/**
 * 同步练习 controller — V2.0 §Tab2 同步练习分区.
 *
 *   GET  /companion/sync-practices                  — 同步练习列表
 *   POST /companion/sync-practices/:id/initiate     — 发起同步练习 (推送给成长用户)
 *
 * 设计:
 *   - 列表走 1 个端点 (大厂 standard: 配置类资源全量下放前端)
 *   - initiate V2.0 占位返回 ok=true, V3 接 WS 推送 + 成长用户接收 + 双端状态机
 */
@ApiTags('companion-sync-practices')
@Controller('companion/sync-practices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SyncPracticeController {
  constructor(private readonly service: SyncPracticeService) {}

  @Get()
  @ApiOperation({ summary: '同步练习列表 (由成长用户发起, 陪伴者查看)' })
  public async listPractices(@CurrentUser() user: { userId: string }): Promise<SyncPracticeDto[]> {
    return this.service.listPractices(user.userId);
  }

  @Post(':id/initiate')
  @ApiOperation({ summary: '发起同步练习 (V2.0 占位)' })
  public async initiate(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.service.initiate(user.userId, id);
  }
}
