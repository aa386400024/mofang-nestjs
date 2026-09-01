import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { SendSoothingCardDto, SoothingCardDto } from '../dto/companion.dto';
import { SoothingService } from '../providers/companion.service';

/**
 * 安抚卡片 controller — V2.0 §Tab2 陪伴者端安抚卡片分区.
 *
 *   GET  /companion/soothing/cards?direction=sent|received&activePersonId=
 *   POST /companion/soothing/cards                        — 发送
 *   POST /companion/soothing/cards/:id/read               — 标记已读
 *
 * 设计:
 *   - direction + activePersonId 是 query 参数 (前端 soothing_bloc 实时注入)
 *   - 发送端点走 POST, body 含 templateKey + toPersonId + body (允许用户改写模板正文)
 *   - 标记已读幂等, 已读时静默 ok=true
 */
@ApiTags('companion-soothing')
@Controller('companion/soothing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SoothingController {
  constructor(private readonly service: SoothingService) {}

  @Get('cards')
  @ApiOperation({ summary: '安抚卡片列表 (sent/received)' })
  public async listCards(
    @CurrentUser() user: { userId: string },
    @Query('direction') direction: 'sent' | 'received' = 'sent',
    @Query('activePersonId') activePersonId = 'person-1',
  ): Promise<SoothingCardDto[]> {
    return this.service.listCards(user.userId, direction, activePersonId);
  }

  @Post('cards')
  @ApiOperation({ summary: '发送安抚卡片' })
  public async sendCard(@CurrentUser() user: { userId: string }, @Body() dto: SendSoothingCardDto): Promise<SoothingCardDto> {
    return this.service.sendCard(user.userId, dto.templateKey, dto.toPersonId, dto.body);
  }

  @Post('cards/:id/read')
  @ApiOperation({ summary: '标记安抚卡片已读' })
  public async markRead(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.service.markRead(user.userId, id);
  }
}
