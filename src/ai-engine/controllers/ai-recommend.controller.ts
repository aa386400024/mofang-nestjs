// V2026-09-04 治本 (V6.0 §3.2):
//   AI 推荐 controller.
//   端点: GET /ai/recommend — 端侧 §3.2 卡片流主入口.
//   反双胞胎: 不写 POST (推荐是服务端跑, 客户端只读).

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { AIRecommendListDto } from '../dto/ai-recommend.dto';
import { AIRecommendService } from '../providers/ai-recommend.service';

@ApiTags('ai-recommend')
@Controller('ai/recommend')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AIRecommendController {
  constructor(private readonly service: AIRecommendService) {}

  @Get()
  @ApiOperation({ summary: '§3.2 卡片流推荐 — 工具 / 科普 / 练习方案 / 岛屿 / 碎片' })
  public async recommend(@CurrentUser('userId') uid: string, @Query('limit') _limit?: string): Promise<AIRecommendListDto> {
    return this.service.recommend(uid);
  }
}
