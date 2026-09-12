import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { DriftBottleEntryDto } from '../dto/drift-bottle-entry.dto';
import { DriftBottleStatsDto } from '../dto/drift-bottle-stats.dto';
import { PostDriftBottleDto } from '../dto/post-drift-bottle.dto';
import { RespondDriftBottleDto } from '../dto/respond-drift-bottle.dto';

import { DriftBottleService } from '../providers/drift-bottle.service';

/**
 * 漂流瓶 controller — V2026-09-12 §6.5 心塑 V6.0.
 *
 *   POST /life-map/drift-bottles                      投一封信
 *   GET  /life-map/drift-bottles/sea                  海面列表 (默认 tab)
 *   GET  /life-map/drift-bottles/mine                 我投的
 *   GET  /life-map/drift-bottles/inbox                收到的回信
 *   GET  /life-map/drift-bottles/stats                4 个 counter
 *   POST /life-map/drift-bottles/:id/respond          给作者写回信
 *
 * 大厂 standard:
 *   - @UseGuards(JwtAuthGuard) 全 controller 锁定 (跟 companion dual-exercise 一致)
 *   - @CurrentUser() 取 userId (前端从 SessionBloc 拿, 后端 JWT payload)
 *   - 6 个端点拆清楚, 跟前端 6 个 usecase 一一对应
 *
 * 反双胞胎:
 *   - 不暴露 /drift-bottles/respond-all (跟 inbox 重复)
 *   - 不重命名端点 (跟前端 DriftBottleBloc 一致, 防止前端 usecase 错位)
 */
@ApiTags('life-map-drift-bottles')
@Controller('life-map/drift-bottles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DriftBottleController {
  constructor(private readonly service: DriftBottleService) {}

  /**
   * 投一封信到海里 (DRIFT → DRIFT + 新瓶).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '投一封信到海上 (V6.0 §6.5 漂流瓶)' })
  @ApiResponse({
    status: 201,
    description: '投递成功',
    type: DriftBottleEntryDto,
  })
  public async postBottle(@CurrentUser() user: { userId: string }, @Body() dto: PostDriftBottleDto): Promise<DriftBottleEntryDto> {
    return this.service.postBottle({
      authorId: user.userId,
      content: dto.content,
      authorAnonymousName: dto.authorAnonymousName,
    });
  }

  /**
   * 海面列表 (DRIFT + 我被捞起的 PICKED).
   */
  @Get('sea')
  @ApiOperation({ summary: '海面列表 (DRIFT 状态瓶, 排除自己)' })
  @ApiResponse({
    status: 200,
    description: '海面在漂的信 (按 createdAt DESC)',
    type: [DriftBottleEntryDto],
  })
  public async listSea(@CurrentUser() user: { userId: string }): Promise<DriftBottleEntryDto[]> {
    return this.service.listSea(user.userId);
  }

  /**
   * 我投过的瓶子 (mine 视角).
   */
  @Get('mine')
  @ApiOperation({ summary: '我投过的瓶子 (按 createdAt DESC)' })
  @ApiResponse({
    status: 200,
    description: '我的瓶子列表',
    type: [DriftBottleEntryDto],
  })
  public async listMine(@CurrentUser() user: { userId: string }): Promise<DriftBottleEntryDto[]> {
    return this.service.listMyBottles(user.userId);
  }

  /**
   * 我收到的回信 (作者写给我的).
   */
  @Get('inbox')
  @ApiOperation({ summary: '收到的回信 (我捞起 + 作者已回)' })
  @ApiResponse({
    status: 200,
    description: '我的收件箱 (按 respondedAt DESC)',
    type: [DriftBottleEntryDto],
  })
  public async listInbox(@CurrentUser() user: { userId: string }): Promise<DriftBottleEntryDto[]> {
    return this.service.listRespondedBottles(user.userId);
  }

  /**
   * 4 个 counter 统计 (hero card 用).
   */
  @Get('stats')
  @ApiOperation({ summary: '漂流瓶统计 (4 个 counter)' })
  @ApiResponse({
    status: 200,
    description: '海面 / 我投的 / 我捞的 / 我回的',
    type: DriftBottleStatsDto,
  })
  public async getStats(@CurrentUser() user: { userId: string }): Promise<DriftBottleStatsDto> {
    return this.service.getStats(user.userId);
  }

  /**
   * 给作者写回信 (PICKED → RESPONDED).
   *
   * 注: 这里的 :id 是瓶子 id, 不需要单独的 pick 端点 (捞起在 sea 列表点击时已标记 PICKED).
   */
  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '给作者写回信 (PICKED → RESPONDED)' })
  @ApiParam({ name: 'id', description: '瓶子 id' })
  @ApiResponse({
    status: 200,
    description: '回信成功',
    type: DriftBottleEntryDto,
  })
  @ApiResponse({ status: 404, description: '瓶子不存在' })
  public async respondToBottle(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: RespondDriftBottleDto,
  ): Promise<DriftBottleEntryDto> {
    const updated = await this.service.respondToBottle({
      bottleId: id,
      currentUserId: user.userId,
      responseText: dto.responseText,
    });
    if (!updated) {
      throw new NotFoundException('瓶子不存在');
    }
    return updated;
  }
}
