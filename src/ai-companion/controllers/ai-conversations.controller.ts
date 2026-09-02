import { Controller, Delete, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { AiConversationDto, AiConversationsResponseDto } from '../dto/ai-conversations.dto';
import { AiConversationsService } from '../providers/ai-conversations.service';

/**
 * AI 对话记录 controller — V2.0 §Tab4 「我的数据」AI 对话记录.
 *
 * 端点 (V2.0 范围):
 *   GET    /profile/ai-conversations            - 列出会话 (时间倒序)
 *   GET    /profile/ai-conversations/:id        - 取单条详情
 *   DELETE /profile/ai-conversations/:id        - 删除会话 (二次确认由前端负责)
 *
 * 设计要点:
 *   - 全程 JwtAuthGuard, @CurrentUser() 注入 uid, 业务层强校验不串用户
 *   - 路径挂在 /profile/ 下, 跟其他「我的」Tab 二级页保持一致
 *   - 响应 DTO 跟前端 ProfileAiConversationsPage._Conversation 字段 1:1
 */
@ApiTags('profile-ai-conversations')
@Controller('profile/ai-conversations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AiConversationsController {
  constructor(private readonly service: AiConversationsService) {}

  @Get()
  @ApiOperation({ summary: '列出当前用户的 AI 对话会话 (时间倒序)' })
  public async list(@CurrentUser() user: { userId: string }): Promise<AiConversationsResponseDto> {
    return this.service.listConversations(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: '取单条 AI 对话会话详情' })
  public async getOne(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<AiConversationDto> {
    return this.service.getConversation(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除一条 AI 对话会话' })
  public async delete(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<{ deleted: true; id: string }> {
    return this.service.deleteConversation(user.userId, id);
  }
}
