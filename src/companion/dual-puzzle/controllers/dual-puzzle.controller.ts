import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../user/guards/jwt-auth.guard';

import { DualPuzzleResultDto, DualPuzzleSetDto } from '../dto/dual-puzzle-dtos';
import { SubmitDualPuzzleAnswerDto } from '../dto/submit-dual-puzzle-answer.dto';
import { DualPuzzleCategory } from '../enums/dual-puzzle-category.enum';

import { DualPuzzleService } from '../providers/dual-puzzle.service';

/**
 * 默契拼图 controller — V2026-09-12 §6.4 心塑 V6.0.
 *
 *   POST /companion/dual-puzzles/random?category=  出一组 5 题
 *   POST /companion/dual-puzzles/answer           提交答案
 *   GET  /companion/dual-puzzles/:setId/result?partnerUserId=  取结果
 *   GET  /companion/dual-puzzles/recent            我的历史题目组
 *
 * 大厂 standard:
 *   - @UseGuards(JwtAuthGuard) 锁定
 *   - @CurrentUser() 取 userId
 *   - 4 个端点拆清楚, 跟前端 DualPuzzleBloc 1:1
 *
 * 反双胞胎:
 *   - 不暴露 /dual-puzzles/:id (走 setId 走 random + result 端点对齐前端)
 *   - 不复用 companion/dual-exercises (业务不同: 拼图 vs 协同练习)
 */
@ApiTags('companion-dual-puzzles')
@Controller('companion/dual-puzzles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DualPuzzleController {
  constructor(private readonly service: DualPuzzleService) {}

  /**
   * 出一组 5 题 (随机抽题库, 跨类别凑齐).
   */
  @Post('random')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '出一组默契拼图 (随机 5 题, V6.0 §6.4)' })
  @ApiQuery({ name: 'category', required: false, enum: DualPuzzleCategory })
  @ApiResponse({
    status: 200,
    description: '题目组',
    type: DualPuzzleSetDto,
  })
  public async fetchRandom(@Query('category') category?: DualPuzzleCategory): Promise<DualPuzzleSetDto> {
    return this.service.fetchRandomSet(category);
  }

  /**
   * 提交答案 (1 人 1 set 仅 1 次).
   *
   * 大厂 standard: 这里不传 partnerUserId (走结果端点传).
   */
  @Post('answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '提交答案 (V6.0 §6.4 默契拼图)' })
  @ApiResponse({ status: 200, description: '提交成功 (无 body)' })
  @ApiResponse({ status: 404, description: '题目组不存在' })
  @ApiResponse({ status: 409, description: '已答过这组' })
  public async submit(@CurrentUser() user: { userId: string }, @Body() dto: SubmitDualPuzzleAnswerDto): Promise<void> {
    await this.service.submitAnswer({
      setId: dto.setId,
      userId: user.userId,
      choiceByQuestionId: dto.choiceByQuestionId,
    });
  }

  /**
   * 取结果 (双方都答完 → 算 chemistryScore).
   *
   * 未齐返 null (前端轮询).
   */
  @Get(':setId/result')
  @ApiOperation({ summary: '取默契结果 (V6.0 §6.4)' })
  @ApiQuery({ name: 'partnerUserId', required: true })
  @ApiResponse({
    status: 200,
    description: '默契结果 (未齐返 null)',
    type: DualPuzzleResultDto,
  })
  public async fetchResult(
    @CurrentUser() user: { userId: string },
    @Query('setId') setId: string,
    @Query('partnerUserId') partnerUserId: string,
  ): Promise<DualPuzzleResultDto | null> {
    return this.service.fetchResult({
      setId,
      userId: user.userId,
      partnerUserId,
    });
  }

  /**
   * 我的历史题目组 (按 createdAt DESC).
   */
  @Get('recent')
  @ApiOperation({ summary: '我的历史默契题目组 (按 createdAt DESC)' })
  @ApiQuery({ name: 'limit', required: false, description: '默认 10, 上限 50' })
  @ApiResponse({
    status: 200,
    description: '历史题目组列表',
    type: [DualPuzzleSetDto],
  })
  public async recent(@Query('limit') limit?: string): Promise<DualPuzzleSetDto[]> {
    return this.service.recentSets(limit ? Math.min(50, Number.parseInt(limit, 10)) : 10);
  }
}
