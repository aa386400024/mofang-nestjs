import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { AiGuideTipDto } from '../dto/companion.dto';
import { AiGuideService } from '../providers/companion.service';

/**
 * AI 辅助指引 controller — V2.0 §Tab2 AI 陪伴辅助指引分区.
 *
 *   GET /companion/ai-guide/tips?minLevel=L1|L2|L3
 *
 * 设计:
 *   - 1 个端点, query 参数 minLevel 决定过滤后返回的指引列表
 *   - 前端根据 activePerson.permissionLevel 决定调用哪个 minLevel (L1 兜底)
 *   - V2.0 静态配置, V3 接 LLM 个性化推荐时, Service 内部加 cache
 */
@ApiTags('companion-ai-guide')
@Controller('companion/ai-guide')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AiGuideController {
  constructor(private readonly service: AiGuideService) {}

  @Get('tips')
  @ApiOperation({ summary: 'AI 辅助指引列表 (按最低权限等级过滤)' })
  public async listTips(
    @CurrentUser() _user: { userId: string },
    @Query('minLevel') minLevel: 'L1' | 'L2' | 'L3' = 'L1',
  ): Promise<AiGuideTipDto[]> {
    return this.service.listTips(minLevel);
  }
}
