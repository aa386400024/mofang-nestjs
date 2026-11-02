// V2026-10-29 治本 (WP21 — 复盘报告 SSE 端点的归属守卫):
//   原因: 报告 SSE 端点 (`GET /counselor/supervision/report/:sessionId/stream`) 必须把
//     「会话不存在 / 不属于当前用户」判成**真正的 HTTP 404**, 而不是 200 + 一条错误帧.
//
//   为什么必须用 guard (V2026-10-29 真机实测踩出来的):
//     Nest 11 的 SSE 通道接管响应后, 响应头**已经提交** —— 此后任何异常都只能降级成
//     `200 + event: error` 帧 (客户端拿不到状态码). 而本仓 `src/app.ts` 注册了**全局**
//     `LoggerErrorInterceptor` (nestjs-pino), 于是 handler 的 promise 会被包成 Observable,
//     handler 里抛的错只能"在订阅之后"浮现 —— 那时头早就提交了.
//     真 404 只有一个落点: **guard** —— 它在 interceptor 与 SSE 通道**之前**运行,
//     此时响应还没被接管, 异常过滤器可以写出完整的 404 JSON.
//
//   反双胞胎:
//     - 不在 controller 里判: controller 跑在 SSE 通道**内部**, 那时已经晚了 (只能 200)
//     - 不用 `event: error` 帧当"错误通道": 前端 `report_sse_client.dart` 只解析 `data:`
//       里的 JSON, `event: error` 帧会被**静默忽略** → 表现为"流莫名断了、转圈没尽头"
//     - 不自己查库: 归属判定复用 `SupervisionService.assertSessionOwned`
//       (与报告装载用同一套 WHERE 条件, 不另写一份口径)
//
//   验证:
//     1. tsc 0 错
//     2. 拿不存在的 sessionId 调 SSE 端点 → 404 + JSON body (不是 200)
//     3. 拿别人的 sessionId 调 SSE 端点 → 404 (与不存在同口径, 不泄露存在性)
//
//   时间戳: 2026-10-29

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { SupervisionService } from '../providers/supervision.service';

/**
 * 复盘报告端点的归属守卫 (SSE 通道前置校验).
 *
 * 身份认证交给 `JwtAuthGuard` (类级), 本守卫只判"**这个会话是不是你的**".
 */
@Injectable()
export class SupervisionReportGuard implements CanActivate {
  constructor(private readonly supervision: SupervisionService) {}

  /**
   * 校验当前用户是否拥有该会话.
   *
   * @param context 执行上下文
   * @returns 放行返回 true
   * @throws NotFoundException 会话不存在 / 已软删 / 不属于当前用户 (→ HTTP 404)
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: { userId?: string } }>();
    const userId = request.user?.userId ?? '';
    // Express 5 的 `params` 值类型是 `string | string[]` (通配路由可给数组) —— 取首值即可.
    const raw = request.params['sessionId'];
    const sessionId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
    await this.supervision.assertSessionOwned(userId, sessionId);
    return true;
  }
}
