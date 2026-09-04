// V2026-09-04 治本 (V6.0 §6):
//   Inner World 游戏化模块解锁进度 controller.
//   端点:
//     GET   /inner-world/game-unlock           - 拉该用户所有模块进度
//     POST  /inner-world/game-unlock           - upsert 单模块 (端侧变更上报)
//     GET   /inner-world/game-unlock/:moduleId - 单模块详情

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { GameUnlockProgressDto, GameUnlockProgressListDto, UpsertGameUnlockDto } from '../dto/game-unlock.dto';
import { GameUnlockService } from '../providers/game-unlock.service';

@ApiTags('inner-world-game-unlock')
@Controller('inner-world/game-unlock')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GameUnlockController {
  constructor(private readonly service: GameUnlockService) {}

  @Get()
  @ApiOperation({ summary: '拉取所有 Inner World 模块解锁进度' })
  public async list(@CurrentUser('userId') uid: string): Promise<GameUnlockProgressListDto> {
    return this.service.list(uid);
  }

  @Post()
  @ApiOperation({ summary: '上报模块进度变更 (浇水/喂养/解封成就/时间胶囊)' })
  public async upsert(@CurrentUser('userId') uid: string, @Body() dto: UpsertGameUnlockDto): Promise<GameUnlockProgressDto> {
    return this.service.upsert(uid, dto);
  }

  @Get(':moduleId')
  @ApiOperation({ summary: '单模块详情' })
  public async getOne(@CurrentUser('userId') uid: string, @Param('moduleId') moduleId: string): Promise<GameUnlockProgressDto | null> {
    return this.service.getOne(uid, moduleId);
  }
}
