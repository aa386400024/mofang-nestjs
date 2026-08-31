import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  DailyCompanionTipDto,
  DualPracticeListResponseDto,
  PanicCheckResponseDto,
  StartDualPracticeDto,
  StartDualPracticeResponseDto,
  SwitchAccompaniedPersonDto,
  SwitchAccompaniedPersonResponseDto,
} from '../dto/home-companion-overview.dto';
import { HomeCompanionService } from '../providers/home-companion.service';

/**
 * 陪伴者端首页子页面 controller — V2.0 §4 (DESIGN).
 *
 * 端点 (陪伴者端专属, 路径 /home/companion/*):
 *   GET  /home/companion/daily-tip               - 每日陪伴小贴士
 *   POST /home/companion/panic-check             - 一键求助触发检查
 *   GET  /home/companion/dual-practices          - 双人协同练习列表
 *   POST /home/companion/dual-practices/:id/start - 启动双人练习
 *
 * 设计要点:
 *   - 双人协同需双方都 ready 才能执行 (V3 接 WS 推送; V2.0 返回 bothReady=false 让前端轮询)
 */
@ApiTags('home-companion')
@Controller('home/companion')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HomeCompanionController {
  constructor(private readonly service: HomeCompanionService) {}

  @Get('daily-tip')
  @ApiOperation({ summary: '今日陪伴小贴士 (单 endpoint, 供首页独立刷新)' })
  public async getDailyTip(@CurrentUser() user: { userId: string }): Promise<DailyCompanionTipDto> {
    return this.service.pickDailyTip(user.userId, new Date());
  }

  @Post('switch-accompanied-person')
  @ApiOperation({ summary: '切换当前陪伴对象 (DESIGN §4 Tab2「陪伴对象切换」)' })
  public async switchAccompaniedPerson(
    @CurrentUser() user: { userId: string },
    @Body() dto: SwitchAccompaniedPersonDto,
  ): Promise<SwitchAccompaniedPersonResponseDto> {
    if (!dto.bindingId) {
      throw new BadRequestException('bindingId 不能为空');
    }
    const result = await this.service.switchAccompaniedPerson(user.userId, dto.bindingId);
    if (!result) {
      throw new NotFoundException('绑定关系不存在或无权访问');
    }
    return result;
  }

  @Post('panic-check')
  @ApiOperation({ summary: '一键求助触发 (扫最近 24h 信号, 返回风险等级 + 建议)' })
  public async panicCheck(@CurrentUser() user: { userId: string }): Promise<PanicCheckResponseDto> {
    return this.service.panicCheck(user.userId);
  }

  @Get('dual-practices')
  @ApiOperation({ summary: '双人协同练习库 (按关系类型筛选)' })
  public async listDualPractices(@Query('relationScope') relationScope?: string): Promise<DualPracticeListResponseDto> {
    const scope = relationScope
      ? (relationScope.split(',').filter((s) => ['partner', 'family', 'friend'].includes(s)) as ('partner' | 'family' | 'friend')[])
      : undefined;
    return this.service.listDualPractices(scope);
  }

  @Post('dual-practices/:id/start')
  @ApiOperation({ summary: '启动双人协同练习 (返回 sessionId 给前端建立 WS 同步)' })
  public async startDualPractice(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: StartDualPracticeDto,
  ): Promise<StartDualPracticeResponseDto> {
    // V2.0 占位: 直接返回成功, V3 接 WS + 双方 ready 握手
    return {
      sessionId: `dp-${user.userId}-${Date.now()}`,
      practiceId: id,
      routePath: `/companion/dual-practice/${id}?bindingId=${dto.bindingId}`,
      startedAt: new Date().toISOString(),
      bothReady: false,
    };
  }
}
