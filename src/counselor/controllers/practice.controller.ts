// V2026-10-22 治本 (V1.3 §3 — 微技能自由练习 REST 控制器, 1:1 wire §3.1-§3.5 + §7.2):
//   原因: counselor-practice-engine-v1.3-freeform.md §3 拍板 5 个端点, 前端
//     (xin_su_app) 已按同一契约写好 Dart model + Repository 接口 + mock 兜底.
//     本控制器是**契约的实现面**: 只做入参转交 + 出参声明, 业务逻辑全在 service.
//   修法: 端点按 spec 原文一一对应:
//     GET  /counselor/practice/progress                          §3.1 进度聚合
//     GET  /counselor/practice/scenarios/:scenarioId              §3.2 取场景开练
//     POST /counselor/practice/scenarios/:scenarioId/evaluate     §3.3 提交作答+评判
//     POST /counselor/practice/random                             §3.4 随机抽练
//     POST /counselor/practice/custom-scenarios                   §3.5 真实场景生成 (旧契约)
//     POST /counselor/practice/scenarios:generate                 §7.2 三问表单生成 (新契约)
//     GET  /counselor/practice/scenarios/mine                     §7.2 我的真实场景列表
//   V2026-10-22 治本 (V1.3 §7.2 — 新增 2 端点):
//     「我遇到了真实情况」是本引擎区别于所有题库类竞品的护城河功能:
//       - POST scenarios:generate  三问 → 生成一条贴合用户真实情况的私有场景
//       - GET  scenarios/mine      我的真实场景列表 (按最近练过倒序)
//     两者与 §3.1-§3.5 共用同一套场景实体与练习链路 (0 新页面, 0 新引擎).
//
//   反双胞胎:
//     - 不复用 training-exercise.controller: 那是 MCQ 计分链路 (有分数/对错),
//       与零压自由作答是两套语义 (spec §2.2 反双胞胎)
//     - 不在 controller 里写业务判断 (可见性/批注/随机): 放 controller 会被别的
//       端点复制粘贴, 必然漂移
//     - 不下发分数: 出参 DTO 里根本没有分数字段 (spec §6.2)
//     - 不新增 practice 前缀之外的路径: 跟既有 counselor/training-exercises 风格一致
//     - 不用 `scenarios:generate` 的裸冒号写法: Express 5 用的 path-to-regexp v8
//       会把 `:generate` 当成**路由参数名** (params.generate = ':generate'),
//       虽然匹配结果碰巧对, 但那是个有幽灵参数的写法; 转义成 `scenarios\\:generate`
//       才是真正的字面量冒号 (params 为空), 语义明确.
//
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/practice* 可见 7 个端点, 字段与 spec §3/§7 一致
//     3. 无 token 访问 → 401
//     4. POST /counselor/practice/scenarios:generate → 命中本端点 (不是 :scenarioId 路由)
//     5. GET  /counselor/practice/scenarios/mine → 命中本端点 (不是 :scenarioId 路由)
//
//   时间戳: 2026-10-22
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import type {
  CreateCustomPracticeScenarioDto,
  CustomPracticeScenarioListDto,
  CustomPracticeScenarioResultDto,
  GenerateCustomPracticeScenarioDto,
  GeneratedCustomPracticeScenarioDto,
  PracticeEvaluationResultDto,
  PracticeProgressDto,
  PracticeScenarioDetailDto,
  RandomPracticeScenarioDto,
  RandomPracticeScenarioResultDto,
  SubmitPracticeAttemptDto,
} from '../dto/practice.dto';
import { PracticeAttemptService } from '../providers/practice-attempt.service';
import { PracticeCustomScenarioService } from '../providers/practice-custom-scenario.service';
import { PracticeScenarioService } from '../providers/practice-scenario.service';

@ApiTags('counselor-practice')
@Controller('counselor/practice')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorPracticeController {
  constructor(
    private readonly scenarioService: PracticeScenarioService,
    private readonly attemptService: PracticeAttemptService,
    private readonly customScenarioService: PracticeCustomScenarioService,
  ) {}

  @Get('progress')
  @ApiOperation({
    summary: '练习进度聚合 (summary + 10 个基本功的全部场景变体 + 弱项推荐 + 随机入口, 零 N+1)',
  })
  progress(@CurrentUser() user: { userId: string }): Promise<PracticeProgressDto> {
    return this.scenarioService.getProgress(user.userId);
  }

  @Get('scenarios/mine')
  @ApiOperation({
    summary: '「我的真实场景」列表 (V1.3 §7.2: 用户自建场景, 按最近练过倒序, 不含 content 全文)',
  })
  listMine(@CurrentUser() user: { userId: string }): Promise<CustomPracticeScenarioListDto> {
    return this.customScenarioService.listMine(user.userId);
  }

  @Get('scenarios/:scenarioId')
  @ApiOperation({ summary: '取场景开练 (来访者画像 + 开场白 + 任务说明 + 本场景第几次作答)' })
  findScenario(
    @CurrentUser() user: { userId: string },
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
  ): Promise<PracticeScenarioDetailDto> {
    return this.scenarioService.getScenarioDetail(user.userId, scenarioId);
  }

  @Post(String.raw`scenarios\:generate`)
  @ApiOperation({
    summary: '「我遇到了真实情况」场景生成 (V1.3 §7.2: 三问表单 → 一条贴合真实情况的私有场景)',
    description:
      '请求体: { visitorQuote 必填, counselorReply 可选, stuckPoint 可选, hintExerciseId 可选 }. ' +
      '配额用尽 / LLM 不可用时**软降级**: 仍返回一条可练的场景, 并在 degraded / degradedReason 标明. ' +
      '响应的 id 直接作为 GET /counselor/practice/scenarios/:scenarioId 的路径参数.',
  })
  generateCustomScenario(
    @CurrentUser() user: { userId: string },
    @Body() dto: GenerateCustomPracticeScenarioDto,
  ): Promise<GeneratedCustomPracticeScenarioDto> {
    return this.customScenarioService.generate(user.userId, dto);
  }

  @Post('scenarios/:scenarioId/evaluate')
  @ApiOperation({
    summary: '提交作答并获得零压技术批注 (无分数无对错; LLM 不可用时自动降级为确定性关键词判定)',
  })
  evaluate(
    @CurrentUser() user: { userId: string },
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
    @Body() dto: SubmitPracticeAttemptDto,
  ): Promise<PracticeEvaluationResultDto> {
    return this.attemptService.submit(user.userId, scenarioId, dto);
  }

  @Post('random')
  @ApiOperation({ summary: '随机抽一个场景 (优先未练过的; 可避开当前基本功)' })
  random(@CurrentUser() user: { userId: string }, @Body() dto: RandomPracticeScenarioDto): Promise<RandomPracticeScenarioResultDto> {
    return this.scenarioService.pickRandomScenarioId(user.userId, dto.exceptMode).then((scenarioId) => ({ scenarioId }));
  }

  @Post('custom-scenarios')
  @ApiOperation({
    summary: '把用户描述的真实情况生成成一条私有练习场景 (旧契约入口; 与 §7.2 共用同一张表)',
  })
  createCustomScenario(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCustomPracticeScenarioDto,
  ): Promise<CustomPracticeScenarioResultDto> {
    return this.attemptService.createCustomScenario(user.userId, dto);
  }
}
