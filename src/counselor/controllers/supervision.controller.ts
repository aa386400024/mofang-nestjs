// V2026-10-15 治本 (V2.5 — supervision.controller.ts, 4 endpoint 1:1 wire):
//   原因: counselor-mode-v1.0 §4.6 + §6.2 拍板 4 流派督导 + polymorphic feedback,
//     V0.3 §13 baseline 0 督导 controller, 1:1 wire 0 破坏. V0.5 已有 5 counselor
//     controller 内存 mock; 本 V1.x 改造, supervision controller 真接 SupervisionService.
//
//   修法 (跟 counselor-long-term-case.controller.ts W1-2 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid (V0.5 已有, 复用)
//     - 4 endpoint: GET list schools / GET detail school / POST generate feedback /
//       POST compare feedback / GET list feedback for session
//     - @ApiBearerAuth() + @ApiTags('counselor-supervision') 跟 V0.5 风格一致
//     - controller thin delegate to SupervisionService (跟 W1-2 风格一致,
//       不在 controller 写业务逻辑, 全部在 service, 大厂 Clean Arch)
//
//   4 endpoint (跟 counselor-mode-v1.0 §4.6 + handoff prompt §7 W3-4 1:1):
//     - GET  /counselor/supervision/schools                       - 4 流派 list
//     - GET  /counselor/supervision/schools/:code                 - 单流派详情 (含 promptTemplate)
//     - POST /counselor/supervision/feedback                      - 生成 1 流派反馈
//     - POST /counselor/supervision/feedback/compare              - 多流派对比 (2-3 流派, 高级会员)
//     - GET  /counselor/supervision/feedback/:sessionId/:sessionType - 历史 N 流派 feedback
//
//   反双胞胎:
//     - 不在 controller 写业务逻辑: 全部 service, 跟 V0.5 6 controller 风格一致
//     - 不复用 counselor-home/long-term-case service: 业务正交 (督导 vs 长程 vs 全流程),
//       跟 V0.5 culture "1 module 6 service 独立" 一致
//     - 不引 GraphQL: V0.5 REST 风格, 跟 client Dio 风格一致
//     - 不暴露 LLM provider 给 client: V0.5 mock 阶段 generateFeedback 直接返 feedback;
//       V1.x 真接 LLM 时改 service 内部, client API 1:1 wire 不变
//
//   验证:
//     1. tsc 0 错 (4 endpoint 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 4 endpoint 端到端
//     3. integration: 4 流派 list / 详情含 promptTemplate / 生成 1 流派 / 多流派对比
//
//   时间戳: 2026-10-15

import { Body, Controller, Get, MessageEvent, Param, Post, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { type Observable } from 'rxjs';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  type CompareSupervisionFeedbackResponseDto,
  type GenerateSupervisionFeedbackDto,
  type SessionReportDto,
  type SupervisionFeedbackDto,
  type SupervisionSchoolDetailDto,
  type SupervisionSchoolListItemDto,
} from '../dto/supervision.dto';
import { type SessionType } from '../enums/session-type.enum';
import { type SupervisionSchoolCode } from '../enums/supervision-school-code.enum';
import { SupervisionReportGuard } from '../guards/supervision-report.guard';
import { SupervisionReportStreamService } from '../providers/supervision-report-stream.service';
import { SupervisionService } from '../providers/supervision.service';

/**
 * V2026-10-15 (V1.x counselor-mode W3-4 — CounselorSupervisionController):
 *   4 流派督导 + polymorphic sessionId feedback REST controller.
 *
 *   跟 xin_su_app SupervisionBloc + SupervisionRepository 端到端 1:1 对应.
 *   V1.x 真接库, V0.5 内存 mock 阶段已过.
 */
@ApiTags('counselor-supervision')
@Controller('counselor/supervision')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorSupervisionController {
  constructor(
    private readonly service: SupervisionService,
    private readonly reportStreamService: SupervisionReportStreamService,
  ) {}

  /**
   * GET /counselor/supervision/schools
   *
   * 4 流派 list (从 DB 读, isActive=1, 软删过滤).
   */
  @Get('schools')
  @ApiOperation({ summary: '心理咨询师学员端 4 督导流派 list (CBT/精神动力学/人本/家庭治疗)' })
  async listSchools(): Promise<SupervisionSchoolListItemDto[]> {
    return this.service.listSchools();
  }

  /**
   * GET /counselor/supervision/schools/:code
   *
   * 单流派详情 (含 promptTemplate, V0.5 mock 用, V1.x 真接 LLM 改 provider 注入).
   */
  @Get('schools/:code')
  @ApiOperation({ summary: '单督导流派详情 (含 LLM prompt 模板, V0.5 mock 用)' })
  async findSchoolByCode(@Param('code') code: string): Promise<SupervisionSchoolDetailDto> {
    // Param 走 string 强转 enum, 非法直接 service 抛 NotFoundException
    return this.service.findSchoolByCode(code as SupervisionSchoolCode);
  }

  /**
   * POST /counselor/supervision/feedback
   *
   * 生成 1 session + 1 流派 feedback. 落 supervision_feedback 表 (V0.5: 持久化所有生成记录).
   * V0.5 mock 走 SUPERVISION_SCHOOL_PRESETS promptTemplate + 简单规则; V1.x 真接 LLM 改 provider 注入.
   */
  @Post('feedback')
  @ApiOperation({ summary: '生成 1 session + 1 流派 督导反馈 (V0.5 mock, V1.x 真接 LLM)' })
  async generateFeedback(
    @CurrentUser() user: { userId: string },
    @Body() input: GenerateSupervisionFeedbackDto,
  ): Promise<SupervisionFeedbackDto> {
    return this.service.generateFeedback(input, user.userId);
  }

  /**
   * POST /counselor/supervision/feedback/compare
   *
   * 多流派对比 (高级会员, 2-3 流派). V0.5 串行生成 N 份; V1.x 真接 LLM 改 Promise.all.
   */
  @Post('feedback/compare')
  @ApiOperation({ summary: '多流派对比 (高级会员 2-3 流派, V0.5 mock 串行)' })
  async compareFeedback(
    @CurrentUser() user: { userId: string },
    @Body()
    input: {
      sessionId: string;
      sessionType: SessionType;
      schoolCodes: SupervisionSchoolCode[];
    },
  ): Promise<CompareSupervisionFeedbackResponseDto> {
    return this.service.compareFeedback(input, user.userId);
  }

  /**
   * GET /counselor/supervision/feedback/:sessionId/:sessionType
   *
   * 历史 N 流派 feedback (UI 切换流派展示用). 返回的 N 份可能重复 (V0.5 mock 阶段每次生成
   * 都落表, V1.x 优化只返"该流派最新一份").
   */
  @Get('feedback/:sessionId/:sessionType')
  @ApiOperation({ summary: '历史 N 流派 feedback (UI 切换流派展示用)' })
  async listFeedbackForSession(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('sessionType') sessionType: string,
  ): Promise<SupervisionFeedbackDto[]> {
    return this.service.listFeedbackForSession(user.userId, sessionId, sessionType as SessionType);
  }

  /**
   * GET /counselor/supervision/report/:sessionId
   *
   * 本场会谈的**复盘报告** (V2026-10-26, spec 任务 6): 亮点 / 改进建议 / 风险线索 +
   * 技术统计 + 移情阻抗标记 + 4 流派反馈, 整合为一份.
   *
   * 报告还在异步生成时 → `status='pending'` + 其余字段空, **不返回编造内容**.
   */
  @Get('report/:sessionId')
  @ApiOperation({
    summary: '本场会谈复盘报告 (亮点 / 建议 / 技术统计 / 移情标记 / 4 流派反馈)',
    description:
      '整合三个已有来源: agent/supervisor 的结构化督导报告 (亮点 / 改进建议 / 风险线索, 锚时间戳) ' +
      '+ training_sessions.tech_stats (技术统计) + transference_resistance_marks (移情/阻抗标记) ' +
      '+ supervision_feedback (4 流派反馈, 可切 CBT / 精神动力学 / 人本 / 家庭治疗视角). ' +
      '报告还在异步生成时 status=pending 且其余字段为空, **不会返回编造内容**. ' +
      '跨用户访问返 404 (不泄露会话是否存在).',
  })
  async getSessionReport(@CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string): Promise<SessionReportDto> {
    return this.service.getSessionReport(user.userId, sessionId);
  }

  /**
   * GET /counselor/supervision/report/:sessionId/stream
   *
   * 复盘报告的 **SSE 推送** (V2026-10-29, WP21): 前端"先 GET 判断、pending 时开 SSE 等推送".
   *
   * 与 `GET report/:sessionId` 的关系:
   *   - 同一个路径前缀, 同一个 `JwtAuthGuard`, 同一个归属口径 (跨用户/不存在 → 404)
   *   - 推出去的 `data` 就是 GET 会返回的那份报告 JSON (逐字段一致, 同一份装载与拼装)
   *
   * 帧格式: `data: {报告 JSON}\n\n` (默认 `message` 事件, 前端统一监听 `data:` 行).
   *
   * 为什么是 SSE 而不是 WebSocket: 报告是**单向**推送 (服务端 → 客户端),
   * SSE 正是这个语义, 且能复用现成的 REST 鉴权 (Bearer header), 前端不必再写一遍握手.
   *
   * @param user 当前用户 (由 JwtAuthGuard 注入)
   * @param sessionId 会话 id
   * @returns SSE 消息流
   */
  @Get('report/:sessionId/stream')
  @Sse()
  @ApiOperation({
    summary: '复盘报告生成完成推送 (SSE, text/event-stream)',
    description:
      '报告到达终态 (completed / parse_error / no_content) 时推一条完整报告并关流; ' +
      '等待超过上限 (默认 120s) 时推一条 {"status":"timeout"} 并关流. ' +
      '会话不存在 / 不属于当前用户返 404 (与 GET report/:sessionId 同口径). ' +
      '帧格式 data: {报告 JSON} (空行分隔), 不用自定义 event name (默认 message 事件).',
  })
  @ApiProduces('text/event-stream')
  @UseGuards(SupervisionReportGuard)
  async streamSessionReport(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
  ): Promise<Observable<MessageEvent>> {
    // ⚠️ 归属校验放在 `SupervisionReportGuard` (guard 在 interceptor / SSE 通道**之前**跑):
    //   这样"会话不存在 / 跨用户"能在响应被通道接管**之前**抛出 → 异常过滤器写出
    //   **真正的 HTTP 404**; 若只在 handler 里判, SSE 响应头已提交, 只能降级成
    //   `200 + event: error` 帧 (客户端拿不到状态码) —— 2026-10-29 真机实测踩过这个坑.
    //   handler 仍保持 async: 让"装载失败"以 promise 拒绝的形式冒泡, 而不是变成流内错误.
    return this.reportStreamService.streamSessionReport(user.userId, sessionId);
  }
}
