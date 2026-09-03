import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { GrantFragmentsDto, GrantFragmentsResponseDto, ListFragmentLogsQueryDto } from '../dto/fragment.dto';
import { FragmentsService } from '../providers/fragments.service';

/**
 * 碎片接口 — V4.0 §3.2.
 *
 *   GET  /inner-world/fragments/balances          — 5 类型余额
 *   GET  /inner-world/fragments/logs?since&limit  — 流水
 *   POST /inner-world/fragments/grant             — 产出 (业务事件触发)
 *   GET  /inner-world/fragments/summary           — 聚合 (首页角标用)
 */
@ApiTags('inner-world/fragments')
@Controller('inner-world/fragments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FragmentsController {
  constructor(private readonly service: FragmentsService) {}

  @Get('balances')
  @ApiOperation({ summary: '5 类型碎片余额' })
  async balances(@CurrentUser() user: { userId: string }) {
    return this.service.getBalances(user.userId);
  }

  @Get('logs')
  @ApiOperation({ summary: '碎片流水 (按时间分页)' })
  async logs(@CurrentUser() user: { userId: string }, @Query() query: ListFragmentLogsQueryDto) {
    return this.service.listLogs(user.userId, query);
  }

  @Post('grant')
  @ApiOperation({ summary: '产出碎片 (业务事件触发, 同步触发徽章检测)' })
  async grant(@CurrentUser() user: { userId: string }, @Body() dto: GrantFragmentsDto): Promise<GrantFragmentsResponseDto> {
    return this.service.grant(user.userId, dto);
  }

  @Get('summary')
  @ApiOperation({ summary: '碎片汇总 (总数 + 5 类型), 用于首页角标' })
  async summary(@CurrentUser() user: { userId: string }) {
    const balances = await this.service.getBalances(user.userId);
    const total = balances.reduce((s, b) => s + b.balance, 0);
    return { total, balances };
  }
}
