/**
 * V2026-09-14 治本 (Stage C 后端契约): GET /growth/daily-tools.
 *
 * 跟前端 lib/features/growth/data/api/growth_api.dart GrowthApi.getDailyTools() 1:1 对齐.
 *
 * 设计:
 *   - 走 JwtAuthGuard (跟现有 practice-tools.controller 一致)
 *   - 业务异常 → 抛 BizException (内部类, 携带 code 字段), GlobalExceptionFilter
 *     统一转 HttpException 返回.
 *   - Swagger @ApiTags('growth') 让 API 文档独立于 practice.
 *
 * 反双胞胎:
 *   - 不复用 practice-tools.controller 的 prefix (避免 /practice/growth/... 双重嵌套)
 *   - 不在 controller 写 try/catch (统一走 GlobalExceptionFilter)
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { DailyGrowthToolDto } from '../dto/growth.dto';
import { GrowthDailyToolsService } from '../providers/growth-daily-tools.service';

@ApiTags('growth')
@Controller('growth')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GrowthDailyToolsController {
  constructor(private readonly service: GrowthDailyToolsService) {}

  /**
   * V2026-09-14 治本 (大厂 RESTful):
   *   GET /growth/daily-tools?date=2026-09-14
   *   返回今日 3 条推荐工具 (V1.0 strict, V2.1 可返 0 条).
   */
  @Get('daily-tools')
  @ApiOperation({ summary: '今日 3 条推荐工具 (V6.0 §4.3)' })
  @ApiQuery({ name: 'date', required: false, description: 'ISO-8601 YYYY-MM-DD, 默认服务端按本地时区' })
  async getDailyTools(@CurrentUser() user: { userId: string }, @Query('date') date?: string): Promise<DailyGrowthToolDto[]> {
    return this.service.getDailyTools(user.userId, date);
  }
}
