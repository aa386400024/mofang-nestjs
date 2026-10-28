// V2026-10-23 治本 (语音微训练 STT 代理 — 上传异常归一 filter, spec §2.4):
//   原因: multipart 上传的失败发生在**框架层**, 不在 service 里:
//     - 超过 multer 的 fileSize 上限 → Nest 的 transformException 转成
//       PayloadTooLargeException (413)
//     - 表单字段名不对 / multipart 损坏 → BadRequestException (400)
//     这些异常走全局 BizExceptionFilter 时, 业务码会退化成 UnknownError (1000),
//     前端拿到的 `{ code: 1000 }` 分不清"音频太大"与"未知错误" —— 而 §2.4 明确要求
//     两者给不同文案、不同 HTTP 语义.
//   修法: 路由级 filter 拦下本端点的异常, 把 413 / 400 翻译成 ASR 专用业务码;
//     其余异常 (含 service 抛的 BizException) 保持项目统一的 { code, message, data }
//     结构, 与全局 filter 行为一致.
//   反双胞胎:
//     - 不改全局 BizExceptionFilter: 它服务全站几十个端点, 为一个端点开特例会污染全局
//     - 不在 controller 里 try/catch: 文件解析发生在参数管道阶段, 根本进不到 handler
//     - 不吞异常: 非预期的 5xx 照常上报 Sentry, 不因为"只是个上传失败"就静默
//   验证:
//     1. tsc 0 错
//     2. 传 60MB 文件 → 413 + code=45102
//     3. 用错字段名 (file → audio) → 400 + code=45101
//     4. 正常请求 → 走 service, 200
//   时间戳: 2026-10-23
import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { SentryService } from '../../shared/infra/observability';

interface ResolvedError {
  readonly code: BizCode;
  readonly message: string;
  readonly httpStatus: HttpStatus;
}

@Catch()
export class PracticeAsrUploadFilter implements ExceptionFilter {
  private readonly logger = new Logger(PracticeAsrUploadFilter.name);

  constructor(private readonly sentry: SentryService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { code, message, httpStatus } = this.resolve(exception);

    if (httpStatus >= HttpStatus.INTERNAL_SERVER_ERROR && code === BizCode.UnknownError) {
      this.sentry.captureException(exception, {
        url: request.url,
        method: request.method,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        code,
      });
    }

    response.status(httpStatus).json({ code, message, data: null });
  }

  /**
   * 异常 → 项目统一响应.
   *
   * 判定顺序 (从具体到宽泛):
   *   ① BizException: 响应体自带 { code, message }, 原样透出 (service 的预检错误走这条)
   *   ② 其它 HttpException: 413 → 音频过大; 400 → 音频不合法; 其余按原状态码兜底
   *   ③ 未知异常: 500
   */
  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      // 显式标 unknown: getResponse() 的声明类型是 string | object, 直接用会让
      // `typeof body === 'object'` 把 null 收窄掉, 于是 `body !== null` 被判定为
      // 恒真 (sonarjs/different-types-comparison) —— 但运行时 body 确实可能是 null.
      // 标成 unknown 后, 收窄行为回到"object | null", 判空既必要又真实.
      const body: unknown = exception.getResponse();
      const httpStatus = exception.getStatus();

      // BizException: body = { code, message }
      if (typeof body === 'object' && body !== null && 'code' in body) {
        const typed = body as { code: BizCode; message?: string };
        return {
          code: typed.code,
          message: typed.message ?? '请求失败',
          httpStatus,
        };
      }

      const detail = typeof body === 'string' ? body : ((body as { message?: string }).message ?? '请求失败');

      if (httpStatus === HttpStatus.PAYLOAD_TOO_LARGE) {
        return { code: BizCode.PracticeAsrAudioTooLarge, message: '音频过大，请缩短后重试', httpStatus };
      }
      if (httpStatus === HttpStatus.BAD_REQUEST) {
        return { code: BizCode.PracticeAsrAudioInvalid, message: '音频格式或时长不支持，请重新录一段', httpStatus };
      }
      return { code: BizCode.UnknownError, message: detail, httpStatus };
    }

    this.logger.error('[asr_upload_unexpected_error]', exception instanceof Error ? exception.stack : String(exception));
    return { code: BizCode.UnknownError, message: '服务内部错误', httpStatus: HttpStatus.INTERNAL_SERVER_ERROR };
  }
}
