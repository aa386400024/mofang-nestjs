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
//
// V2026-10-23 治本 (语音微训练 STT 代理 — 新增 POST /counselor/practice/asr):
//   原因: §3.3 评判链路只收**文本**, 而"文本从哪来"一直缺一段 —— 前端录音按钮是纯
//     UI 计时器, 停止后提交空 submittedText. spec §2 拍板: 服务端代理 MiniMax HTTP
//     STT (`asr-1.0`), 音频不落盘, 前端拿到 text/duration 后**仍走现有 §3.3 提交**
//     (submittedText=text, recordSeconds≈duration) —— 评判链路 0 改动.
//   修法: 本端点是**纯代理 + 纯转交**: 参数管道阶段收 multipart, service 做预检与
//     错误归一, client 负责跟上游说话. 端点本身不写任何业务判断.
//   反双胞胎:
//     - 不复用 voice/asr-token 的 WS 通道: 那是全真会谈的实时流式协议, 且未与官方
//       联调验证; 训练题是"录完一次性转写", 用 WS 是过度设计 (spec §2.1 方案 C)
//     - 不在端点里改 §3.3 的 DTO: 语音练习的评判口径不变, 只是把"空文本"换成"真文本"
//     - 不下发 MINIMAX_API_KEY: 前端永远拿不到上游凭证 (spec §2.1 方案 A)
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/practice/asr 可见 (multipart + language 头)
//     3. 无 token 访问 → 401
//     4. 上传一段中文 wav → 200 { text, duration, trace_id }
//
//   时间戳: 2026-10-23
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import 'multer'; // 加载 namespace, 让 Express.Multer.File 全局可用 (跟 profile.controller 同 pattern)

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { PRACTICE_ASR_UPSTREAM_MAX_FILE_BYTES } from '../config/practice-asr.config';
import type { PracticeAsrResultDto } from '../dto/practice-asr.dto';
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
import { PracticeAsrUploadFilter } from '../providers/practice-asr-upload.filter';
import { PracticeAsrService } from '../providers/practice-asr.service';
import { PracticeAsrThrottlerGuard } from '../providers/practice-asr.throttler';
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
    private readonly asrService: PracticeAsrService,
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

  // ══════════════════════════════════════════════════════════════════════
  // §2 POST /counselor/practice/asr — 语音微训练 STT 代理
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 录音文件一次性转写 (服务端代理 MiniMax HTTP STT).
   *
   * 契约见 spec `counselor-practice-asr-stt-and-llm-access-2026-10-23.md` §2.2:
   *   - 请求: `multipart/form-data`, 字段 `file` (音频), 请求头 `language` (可选 BCP-47)
   *   - 响应: `{ text, duration, trace_id }`
   *   - 鉴权: 复用 JwtAuthGuard (用户 JWT)
   *
   * 关键约束:
   *   - **不落盘**: multer 默认 storage 就是 memoryStorage, 音频只在内存里, 处理完即弃
   *   - **体积硬闸**: multer limits.fileSize = 上游硬限制 (50 MiB), 超限直接中断上传
   *   - **限流**: 方法级 guard 排在类级 JwtAuthGuard 之后, 才能拿到 request.user 做
   *     userId 级限流 (见 practice-asr.throttler.ts 的 guard 顺序说明)
   *   - **错误归一**: 路由级 filter 把 413/400 翻成 ASR 专用业务码 (见 upload filter)
   */
  @Post('asr')
  @ApiConsumes('multipart/form-data')
  @ApiHeader({
    name: 'language',
    required: false,
    description:
      'BCP-47 主语言标签 (zh / yue / en / ja / ko / ...). 不传或空 = 混合语言识别. ' + '这是**请求头**, 不是表单字段. 训练题中文传 zh.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            '录音文件. 支持 wav / aiff / flac / alac(m4a) / mp3 / aac / opus / ogg; ' +
            '**不支持裸 PCM**. 建议单声道 16kHz 或 mp3/aac/opus 压缩格式.',
        },
      },
    },
  })
  @ApiOperation({
    summary: '语音微训练录音转写 (服务端代理 STT, 音频不落盘)',
    description:
      '返回 { text, duration, trace_id }. text 为空串表示未识别到内容 (前端据此走' +
      '"未识别只出技术提示"分支, **不得伪造文本**). 拿到结果后仍走 ' +
      'POST /counselor/practice/scenarios/:scenarioId/evaluate 提交 (submittedText=text, ' +
      'recordSeconds≈duration) —— 评判链路不变.',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PRACTICE_ASR_UPSTREAM_MAX_FILE_BYTES } }))
  @UseFilters(PracticeAsrUploadFilter)
  @UseGuards(PracticeAsrThrottlerGuard)
  transcribe(
    @CurrentUser() user: { userId: string },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('language') language?: string,
  ): Promise<PracticeAsrResultDto> {
    return this.asrService.transcribe({ userId: user.userId, file, language });
  }
}
