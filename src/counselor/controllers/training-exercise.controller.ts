// V2026-10-20 治本 (专项技能训练中心改版 — 训练题 Controller):
//   原因: 原 counselor-training.controller.ts 仅 1 个 overview 端点且返回纯 mock,
//     客户端所有训练数据靠内存拼装, 刷新即丢. 设计规格 §10 要求「单请求聚合」,
//     §11 要求埋点可度量, 均需要真实端点支撑.
//   修复: 新增 training-exercise 控制器, 4 个端点覆盖查询 / 进度 / 答题 / 单题.
//   反双胞胎:
//     - 不复用 counselor-training.controller (职责单一, 该 controller 保持 home 总览职责)
//     - 不在 GET 返回 correctOptionIndex (答案泄漏, 见 DTO 设计)
//   验证: swagger /counselor/training-exercises* 可见 4 端点 + tsc 0 错.
//   时间戳: 2026-10-20
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  SubmitTrainingExerciseAttemptDto,
  TrainingExerciseAttemptResultDto,
  TrainingExerciseDto,
  TrainingExerciseListDto,
  TrainingExerciseProgressDto,
  TrainingExerciseQueryDto,
} from '../dto/training-exercise.dto';
import { TrainingExerciseService } from '../providers/training-exercise.service';

@ApiTags('counselor-training-exercises')
@Controller('counselor/training-exercises')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorTrainingExerciseController {
  constructor(private readonly exerciseService: TrainingExerciseService) {}

  @Get()
  @ApiOperation({ summary: '训练题列表 (支持 type / mode / difficulty 过滤, 不返回正确答案索引)' })
  list(@Query() query: TrainingExerciseQueryDto): Promise<TrainingExerciseListDto> {
    return this.exerciseService.listExercises(query);
  }

  @Get('progress')
  @ApiOperation({
    summary: '训练进度聚合 (一次返回 summary + 全部训练项明细, 零 N+1, 设计规格 §10)',
  })
  progress(@CurrentUser() user: { userId: string }, @Query() query: TrainingExerciseQueryDto): Promise<TrainingExerciseProgressDto> {
    return this.exerciseService.getProgress(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '单题详情 (答题页上下文)' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TrainingExerciseDto> {
    return this.exerciseService.getExerciseDto(id);
  }

  @Post(':id/attempts')
  @ApiOperation({
    summary: '提交作答并获得确定性评分 (命中 90 / 未命中 45, 零随机)',
  })
  submit(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitTrainingExerciseAttemptDto,
  ): Promise<TrainingExerciseAttemptResultDto> {
    return this.exerciseService.submitAttempt(user.userId, id, dto);
  }
}
