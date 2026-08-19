import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { SentryService } from '../../shared/infra/observability';
import { BizCode } from '../exceptions/biz-code.enum';

/**
 * 全局 BizException filter (大厂统一响应格式).
 *
 * 响应格式 (前后端契约):
 *   {
 *     code: number,    // 业务错误码, 0 = 成功
 *     message: string, // 用户可读信息
 *     data: T | null   // 业务数据, 错误时为 null
 *   }
 *
 * 拦截范围:
 *   - BizException (业务异常, 推荐 throw)
 *   - HttpException (NestJS 内置, 比如 NotFoundException)
 *   - 任何未捕获异常 (兜底, 返回 UnknownError)
 *
 * Sentry 集成:
 *   - 仅 5xx 异常上报 (4xx 是客户端错, 不浪费告警额度)
 *   - BizException 业务异常不上报 (已经在 metrics 监控, 已知错误)
 *   - HttpException 5xx 上报 (框架层意外)
 *   - 兜底 UnknownError 5xx 上报 (代码 bug / 外部依赖)
 *
 * 注册位置: AppModule providers, 用 APP_FILTER token
 */
@Catch()
export class BizExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(BizExceptionFilter.name);

  constructor(private readonly sentry: SentryService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { code, message, httpStatus } = this.resolve(exception);

    // 5xx + 兜底异常上报 Sentry
    if (httpStatus >= HttpStatus.INTERNAL_SERVER_ERROR && code === BizCode.UnknownError) {
      this.sentry.captureException(exception, {
        url: request.url,
        method: request.method,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        code,
      });
    }

    // 生产环境不该泄漏内部错误, 但 dev 环境给原始信息便于排查
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction && code === BizCode.UnknownError) {
      this.logger.error(`[${request.method} ${request.url}] ${message}`, exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(httpStatus).json({
      code,
      message,
      data: null,
    });
  }

  private resolve(exception: unknown): { code: BizCode; message: string; httpStatus: HttpStatus } {
    // BizException (我们的业务异常)
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      // BizException 的 body 是 { code, message }
      // eslint-disable-next-line sonarjs/different-types-comparison
      if (typeof response === 'object' && response !== null && 'code' in response) {
        const body = response as { code: BizCode; message: string };
        return {
          code: body.code,
          message: body.message,
          httpStatus: exception.getStatus(),
        };
      }
      // 其他 HttpException (NestJS 内置, 比如 NotFoundException)
      return {
        code: BizCode.UnknownError,
        message: typeof response === 'string' ? response : ((response as { message?: string }).message ?? '请求失败'),
        httpStatus: exception.getStatus(),
      };
    }

    // 兜底: 任何未处理异常
    return {
      code: BizCode.UnknownError,
      message: '服务内部错误',
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }
}
