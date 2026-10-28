/**
 * V2026-09-14 治本 (Stage C 后端契约): POST /growth/tools/:id/complete.
 *
 * 跟前端 lib/features/growth/data/api/growth_api.dart GrowthApi.markToolComplete() 1:1 对齐.
 *
 * 设计:
 *   - 走 JwtAuthGuard + @CurrentUser 拿 userId
 *   - V2.1 body: { durationMinutes, intensityBefore, intensityAfter, fragmentsOverride }
 *   - V1.0 body 空, 所有参数走 service 默认
 *   - 找不到 tool → BizException(GROWTH_TOOL_NOT_FOUND, 404)
 *
 * 反双胞胎:
 *   - 不在 controller 写 markTool 业务逻辑 (跟 service 分离)
 *   - 不用 @Body 装饰器 (V1.0 body 空, V2.1 加 DTO 后用)
 */

import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { DailyGrowthToolDto } from '../dto/growth.dto';
import { GrowthToolCompleteService } from '../providers/growth-tool-complete.service';

@ApiTags('growth')
@Controller('growth')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GrowthToolCompleteController {
  constructor(private readonly service: GrowthToolCompleteService) {}

  /**
   * V2026-09-14 治本 (大厂 RESTful):
   *   POST /growth/tools/:id/complete
   *   返回完成后的 DailyGrowthToolDto (含 is_completed_today=true).
   *
   * V1.0: body 空 (跟前端 GrowthApi.markToolComplete toolId 入参).
   * V2.1: 扩 body 为 { durationMinutes, intensityBefore, intensityAfter, fragmentsOverride }.
   */
  @Post('tools/:id/complete')
  @ApiOperation({ summary: '标记工具完成, 返完整 entity (V6.0 §4.3 + §10.1)' })
  @ApiParam({ name: 'id', description: '工具 id, 跟 DailyGrowthToolDto.id 对齐' })
  async complete(@CurrentUser() user: { userId: string }, @Param('id') toolId: string): Promise<DailyGrowthToolDto> {
    return this.service.complete(user.userId, toolId);
  }
}
