import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

import { MetricsService } from './metrics.service';

/**
 * HTTP metrics interceptor — 自动记录每次 HTTP 请求的耗时 + 计数.
 *
 * 设计:
 *   - 标签使用 route template (e.g. /user/:id) 而非 raw url
 *     避免 /user/123 /user/456 各自一个 label cardinality
 *   - 在响应结束时记录 (tap operator)
 *   - skip /metrics 自身 (防止 scrape 自身的 metrics)
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = process.hrtime.bigint();

    // 跳过 metrics 端点自身
    if (req.path === '/metrics') {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res, start),
        error: () => this.record(req, res, start),
      }),
    );
  }

  private record(req: Request, res: Response, start: bigint): void {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    // 用 route template (Express 5: req.route?.path)
    const route = (req.route?.path as string | undefined) ?? req.path ?? 'unknown';
    this.metrics.recordHttpRequest(req.method, route, res.statusCode, durationSec);
  }
}