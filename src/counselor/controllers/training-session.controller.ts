// V2026-10-21 治本 (V1.2 VS-A — training session controller):
//   原因: training_sessions 表 (V1.1 §6.5) 落地后一直 **0 controller**, v1.2 的
//     M2 知情同意 / M3 轻提示 / M4 24h 间隔 / §10.1 初访分流 全部没有 HTTP 宿主.
//     本 controller 是 v1.2 后续 4 个模块的**共同前置接口**, 必须先把契约定死.
//   修法: 6 个 endpoint (薄委托, 业务全在 TrainingSessionService, 大厂 Clean Arch 口径):
//     - POST  /counselor/training-sessions                建会话
//     - GET   /counselor/training-sessions                我的会话列表 (分页 + 场景/状态过滤)
//     - GET   /counselor/training-sessions/:id            会话详情 (含 transcript)
//     - PATCH /counselor/training-sessions/:id/status     状态机推进 (5 态)
//     - PATCH /counselor/training-sessions/:id/transcript  逐字稿写入 (append / replace)
//     - POST  /counselor/training-sessions/:id/finish     结束会话 + 异步派发督导生成
//   反双胞胎:
//     - 不写业务逻辑: 全部 service (跟 counselor 既有 11 controller 风格一致)
//     - 不复用 counselor-training.controller: 那个是 Tab2 概览 (训练题进度), 跟会话生命周期正交
//     - 不引 GraphQL / 不用 PUT: 跟既有 REST + PATCH 局部更新风格一致
//     - 不暴露内部 prompt / 评分: 跟 supervision.dto.ts 同口径
//   验证:
//     1. tsc 0 错 (6 endpoint 字段 type 严格)
//     2. 大炮跑 swagger 确认 6 个 endpoint + DTO 字段
//     3. 端到端 curl 见 docs/progress/v1.2-landing-plan-2026-10-21.md §4.4
//   时间戳: 2026-10-21

import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

// V2026-10-21 治本 (V1.2 VS-A — DTO 必须值导入, 不能用 `import { type X }`):
//   原因: 全局 ValidationPipe (src/app.module.ts:255) 开了 transform + whitelist, 它靠
//     `@Body() dto: X` 参数上的 **design:paramtypes 元数据** 拿到 DTO 类来做校验与转型.
//     若 DTO 用 `import { type X }` 引入, TS 编译期会把它擦除, 运行时元数据退化成 Object
//     → ValidationPipe 拿到 Object → **静默跳过全部校验** (不报错, 直接裸传对象进去,
//     业务层拿到 page="1" 这种字符串, 后续算术全错).
//     仓库里 supervision.controller.ts 现有这个坑 (本轮不改, 属独立修复范围),
//     本 controller 一步到位用值导入.
//   修法: DTO 全部值导入 (跟 counselor-ui-preference.controller.ts 的写法一致)
//   反双胞胎: 不用 `import type` + 手动 new DTO() 兜底: 那是绕开框架, 不是治本
//   验证: 大炮 curl 传非法 body (如 age=999) → 期望 400 + 校验消息, 而不是 500
//   时间戳: 2026-10-21
import {
  AppendTranscriptDto,
  CreateTrainingSessionDto,
  FinishTrainingSessionDto,
  FinishTrainingSessionResultDto,
  TrainingSessionDetailDto,
  TrainingSessionListItemDto,
  TrainingSessionListQueryDto,
  UpdateTrainingSessionStatusDto,
} from '../dto/training-session.dto';
import { TrainingSessionService } from '../providers/training-session.service';

/**
 * V2026-10-21 (V1.2 VS-A — CounselorTrainingSessionController):
 *   单次训练会话生命周期 REST controller.
 *
 *   跟 xin_su_app V0.5 client TrainingSession entity 1:1 wire (表已存在于
 *   training_sessions, 本 controller 补上 server 端 API 层).
 */
@ApiTags('counselor-training-sessions')
@Controller('counselor/training-sessions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorTrainingSessionController {
  constructor(private readonly service: TrainingSessionService) {}

  /**
   * POST /counselor/training-sessions — 建会话.
   */
  @Post()
  @ApiOperation({ summary: '创建训练会话 (单次训练场景, 初始状态 idle)' })
  async create(@CurrentUser() user: { userId: string }, @Body() input: CreateTrainingSessionDto): Promise<TrainingSessionDetailDto> {
    return this.service.create(user.userId, input);
  }

  /**
   * GET /counselor/training-sessions — 我的会话列表.
   */
  @Get()
  @ApiOperation({ summary: '我的训练会话列表 (分页 + 场景/状态过滤)' })
  async list(@CurrentUser() user: { userId: string }, @Query() query: TrainingSessionListQueryDto): Promise<TrainingSessionListItemDto[]> {
    return this.service.list(user.userId, query);
  }

  /**
   * GET /counselor/training-sessions/:id — 会话详情.
   */
  @Get(':id')
  @ApiOperation({ summary: '训练会话详情 (含逐字稿)' })
  async findDetail(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<TrainingSessionDetailDto> {
    return this.service.findDetail(user.userId, id);
  }

  /**
   * PATCH /counselor/training-sessions/:id/status — 状态机推进.
   */
  @Patch(':id/status')
  @ApiOperation({ summary: '推进训练会话状态 (idle→listening→thinking→speaking→finished)' })
  async updateStatus(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() input: UpdateTrainingSessionStatusDto,
  ): Promise<TrainingSessionDetailDto> {
    return this.service.updateStatus(user.userId, id, input);
  }

  /**
   * PATCH /counselor/training-sessions/:id/transcript — 逐字稿写入.
   */
  @Patch(':id/transcript')
  @ApiOperation({ summary: '写入逐字稿 (append 追加 / replace 整体覆盖)' })
  async appendTranscript(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() input: AppendTranscriptDto,
  ): Promise<TrainingSessionDetailDto> {
    return this.service.appendTranscript(user.userId, id, input);
  }

  /**
   * POST /counselor/training-sessions/:id/finish — 结束会话 + 异步派发督导生成.
   */
  @Post(':id/finish')
  @ApiOperation({ summary: '结束训练会话 (异步派发督导生成, 结果轮询 /counselor/supervision/feedback/:sessionId)' })
  async finish(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() input: FinishTrainingSessionDto,
  ): Promise<FinishTrainingSessionResultDto> {
    return this.service.finish(user.userId, id, input);
  }
}
