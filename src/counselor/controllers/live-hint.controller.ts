// V2026-10-21 治本 (V1.2 VS-C — M3.1 实时督导轻提示 controller):
//   原因: v1.2 spec §6.1「命中规则写 live_hint 表, 前端通过 SSE / WebSocket 拉取」——
//     counselor 端此前 0 实时通道, 这是**第一个**.
//   修法: 2 个 endpoint:
//     - GET /counselor/training-sessions/:sessionId/hints         历史提示 (断线重连后补拉)
//     - GET /counselor/training-sessions/:sessionId/hints/stream  实时流 (SSE)
//   通道选型 (已在 v1.2 排期 §4 拍板): SSE 而非 WebSocket ——
//     1) 轻提示是单向推送, SSE 正是这个语义
//     2) 复用 REST 鉴权 (Bearer header), 不必再写一遍 WS 握手鉴权
//     3) 前端已有现成解析范式 (xin_su_app ai_engine/data/llm/llm_client.dart
//        用 http.Request + text/event-stream 手动解析) → 0 新依赖
//     4) 走 WS 要么把 hint 塞进 voice WS (voice → counselor 反向依赖, 违反既有原则),
//        要么新开 WS 网关 + 前端再连第 2 条连接
//   反双胞胎:
//     - 不在 stream 端点里做"只有 light 档才连"的判断: 连不连是前端的事, 服务端保持语义单纯
//       (连了但没提示 = 正常状态; 档位判定在 worker 侧, 关掉档位就不产生提示)
//     - 不用 GET 的 query 带 token: 走 Authorization header (前端 http.Request 能设),
//       不把 token 放进 URL (URL 会被日志/浏览器历史记录)
//     - 不在 stream 里做 LLM 调用: SSE 只负责"推已经产生的事件"
//   验证:
//     1. tsc 0 错
//     2. 大炮开 curl -N http://localhost:3000/counselor/training-sessions/:sid/hints/stream
//        → 另一端触发一轮分析 → 收到 event: live_hint
//   时间戳: 2026-10-21

import { Controller, Get, MessageEvent, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { type Observable } from 'rxjs';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type LiveSupervisionHintDto } from '../dto/session-core.dto';
import { LiveSupervisionHintService } from '../providers/live-hint.service';

/**
 * V2026-10-21 (V1.2 VS-C — CounselorLiveHintController):
 *   M3.1 实时督导轻提示 — 历史查询 + SSE 实时流.
 */
@ApiTags('counselor-live-hints')
@Controller('counselor/training-sessions/:sessionId/hints')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorLiveHintController {
  constructor(private readonly service: LiveSupervisionHintService) {}

  /**
   * GET /counselor/training-sessions/:sessionId/hints — 历史提示.
   */
  @Get()
  @ApiOperation({ summary: '该会话的历史实时提示 (断线重连后补拉用)' })
  async list(@CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string): Promise<LiveSupervisionHintDto[]> {
    return this.service.list(user.userId, sessionId);
  }

  /**
   * GET /counselor/training-sessions/:sessionId/hints/stream — SSE 实时流.
   */
  @Get('stream')
  @ApiOperation({ summary: '订阅该会话的实时提示流 (SSE, text/event-stream)' })
  @ApiProduces('text/event-stream')
  stream(@Param('sessionId') sessionId: string): Observable<MessageEvent> {
    return this.service.stream(sessionId);
  }
}
