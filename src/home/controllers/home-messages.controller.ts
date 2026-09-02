import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { MarkMessagesReadDto, MarkMessagesReadResponseDto, UnreadMessageCountDto } from '../dto/home-overview.dto';
import { HomeMessagesService } from '../providers/home-messages.service';

/**
 * 首页消息未读 controller — V2.0 §3 (DESIGN Tab1 顶部消息入口).
 *
 * 端点:
 *   GET  /home/messages/unread-count - 当前未读数 (红点)
 *   POST /home/messages/mark-read    - 标记已读 (支持批量 / 全量)
 *
 * 设计要点:
 *   - mark-read 幂等 (重复调用无害)
 *   - 全量 = 不传 messageIds
 *   - 部分 = 传 messageIds (供未来「某些已读」场景)
 */
@ApiTags('home-messages')
@Controller('home/messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HomeMessagesController {
  constructor(private readonly service: HomeMessagesService) {}

  @Get('unread-count')
  @ApiOperation({ summary: '当前未读消息数 (顶部红点)' })
  public async getUnreadCount(@CurrentUser() user: { userId: string }): Promise<UnreadMessageCountDto> {
    return this.service.getUnreadCount(user.userId);
  }

  @Post('mark-read')
  @ApiOperation({ summary: '标记消息已读 (支持批量 / 全量)' })
  public async markRead(@CurrentUser() user: { userId: string }, @Body() dto: MarkMessagesReadDto): Promise<MarkMessagesReadResponseDto> {
    return this.service.markRead(user.userId, dto.messageIds);
  }
}
