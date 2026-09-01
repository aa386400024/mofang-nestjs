import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { DualExerciseDto, DualSessionDto, StartDualSessionDto, UpdateDualSessionDto } from '../dto/companion.dto';
import { DualExerciseService } from '../providers/companion.service';

/**
 * 双人协同成长 controller — V3.0 新增 (V2.0 占位实现).
 *
 *   GET  /companion/dual-exercises?relationScope=partner,family,friend
 *   GET  /companion/dual-sessions/:id
 *   POST /companion/dual-sessions/start
 *   POST /companion/dual-sessions/:id/update
 *
 * 反双胞胎:
 *   - 不暴露 /companion/dual-practices (跟 home-companion/dual-practices 重复)
 *     走 /companion/dual-exercises, 内部 service.listExercises 实现
 *   - start/update 分两个端点 (大厂 RESTful: 状态机端点独立)
 */
@ApiTags('companion-dual-exercises')
@Controller('companion')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DualExerciseController {
  constructor(private readonly service: DualExerciseService) {}

  @Get('dual-exercises')
  @ApiOperation({ summary: '双人协同练习库 (V3.0 渐进解锁)' })
  public async listExercises(
    @CurrentUser() user: { userId: string },
    @Query('relationScope') relationScope?: string,
  ): Promise<DualExerciseDto[]> {
    const scopes = relationScope ? relationScope.split(',').filter((s) => ['partner', 'family', 'friend'].includes(s)) : undefined;
    return this.service.listExercises(user.userId, scopes);
  }

  @Get('dual-sessions/:id')
  @ApiOperation({ summary: '查询双人协同会话状态' })
  public async getSession(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<DualSessionDto> {
    const session = await this.service.getSession(user.userId, id);
    if (!session) throw new NotFoundException('会话不存在');
    return session;
  }

  @Post('dual-sessions/start')
  @ApiOperation({ summary: '发起双人协同会话' })
  public async startSession(@CurrentUser() user: { userId: string }, @Body() dto: StartDualSessionDto): Promise<DualSessionDto> {
    return this.service.startSession(user.userId, dto.exerciseId, dto.ownerUid);
  }

  @Post('dual-sessions/:id/update')
  @ApiOperation({ summary: '更新双人协同会话状态' })
  public async updateSession(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateDualSessionDto,
  ): Promise<DualSessionDto> {
    const session = await this.service.updateSession(user.userId, id, dto.status, dto.completedStep, dto.notes);
    if (!session) throw new NotFoundException('会话不存在或不属于你');
    return session;
  }
}
