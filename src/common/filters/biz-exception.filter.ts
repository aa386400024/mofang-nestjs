import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { SentryService } from '../../shared/infra/observability/index.js';
import { redactIp, redactPath, redactSql, redactStack, truncateForLog } from '../../shared/infra/observability/pii-redactor.js';
import { BizCode } from '../exceptions/biz-code.enum.js';

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
 * 本地日志 (V2026-11-03 治本 · WP26 P2-39):
 *   - dev: 原始 message + 完整堆栈 (本地排查要的就是这个)
 *   - production: **5xx 也打 error 级本地日志**, 但走脱敏口径 (SQL 原文 / PII / 凭据 /
 *     query string 一律不进日志 —— 详见文件末尾的脱敏口径说明).
 *     为什么: 生产原本只靠 Sentry, 而 Sentry 是"配了 DSN 才有"的外部依赖 ——
 *     没配 DSN 的部署 (内测/自建) 遇到 5xx 就是全盲.
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

    // 治本: 强制 stdout UTF-8 (Windows GBK 环境默认乱码)
    // 这是幂等的, 已经设过也不会报错
    if (process.stdout.setDefaultEncoding) {
      process.stdout.setDefaultEncoding('utf8');
      process.stderr.setDefaultEncoding('utf8');
    }

    const { code, message, httpStatus } = this.resolve(exception);

    // 5xx + 兜底异常上报 Sentry
    if (httpStatus >= HttpStatus.INTERNAL_SERVER_ERROR && code === BizCode.UnknownError) {
      // V2026-11-06 治本 (WP46 · Sentry 通道脱敏): extra 里的 url / ip / userAgent
      //   原样上报就是泄漏面 (query 常带 token / 手机号, ip 是个人标识, UA 可被伪造注入).
      //   口径与本地日志**共用** pii-redactor.ts (反双胞胎: 不在 filter 里重写脱敏逻辑).
      this.sentry.captureException(exception, {
        url: redactPath(request.url),
        method: request.method,
        ip: redactIp(request.ip),
        userAgent: truncateForLog(request.headers['user-agent'] ?? '', 200),
        code,
      });
    }

    // 生产环境不该泄漏内部错误, 但 dev 环境给原始信息便于排查
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      // V2026-11-03 治本 (WP26 · P2-39 · 生产 5xx 也打本地日志):
      //   之前生产**只**上报 Sentry —— 一旦 SENTRY_DSN 没配 (自建/内测部署很常见),
      //   线上 5xx 就是**全盲**: 连"到底报了什么错"都拿不到, 只能等用户口头反馈.
      //   本地日志是**兜底** (Sentry 挂了/没配时仍有一份现场), 不是替代.
      //   只打 5xx: 4xx 是客户端错, 打进来只会把真故障淹掉 (与 Sentry 的口径一致).
      if (httpStatus >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logProductionError(request, httpStatus, code, exception);
      }
    } else if (code === BizCode.UnknownError) {
      // dev 保持原口径: 原始 message + 完整堆栈 (本地排查要的就是这个).
      this.logger.error(`[${request.method} ${request.url}] ${message}`, exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(httpStatus).json({
      code,
      message,
      data: null,
    });
  }

  /**
   * 打生产环境的 5xx 本地日志 (脱敏后).
   *
   * 日志字段口径:
   *   · status —— HTTP 状态码;
   *   · code   —— 业务错误码 (BizCode 数值, 与返给前端的 code 同源, 便于对账);
   *   · err    —— 错误类型 id (异常类名, 如 QueryFailedError): 定位问题的第一现场;
   *   · path   —— 请求路径 (**去掉 query**: query 常带 token / 手机号 / 验证码);
   *   · desc   —— 脱敏后的错误描述 (不含 SQL 原文 / PII / 凭据, 见 redactForLog).
   *
   * 返给前端的内容**不变** (仍是业务 message, 不带原始 message 与堆栈) —— 那部分原实现是对的.
   *
   * @param request 请求
   * @param httpStatus HTTP 状态码
   * @param code 业务错误码
   * @param exception 原始异常
   */
  private logProductionError(request: Request, httpStatus: HttpStatus, code: BizCode, exception: unknown): void {
    const errorName = exception instanceof Error ? exception.name : typeof exception;
    const rawDescription = exception instanceof Error ? exception.message : String(exception);
    const line = `[${request.method} ${redactPath(request.url)}] status=${httpStatus} code=${code} err=${errorName}: ${redactSql(rawDescription)}`;
    const stack = exception instanceof Error && typeof exception.stack === 'string' ? redactStack(exception.stack) : undefined;
    if (stack === undefined) {
      this.logger.error(line);
      return;
    }
    this.logger.error(line, stack);
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

// ============================================================================
// 脱敏口径 (WP26 · P2-39 · 生产 5xx 本地日志)
// ============================================================================
//
// **不进日志的内容** (为什么这么脱敏):
//   ① 请求体 (body) —— 含密码 / 手机号 / 验证码等 PII; 5xx 排查根本不需要它;
//   ② 请求头 (含 Cookie / Authorization) —— 凭据; 日志会被转存到日志平台 / 备份, 出了日志等于出了库;
//   ③ URL 的 query string —— 常带 token / 手机号 / 分页游标; 只留**路由**;
//   ④ SQL 原文 —— 语句里常带用户数据与表结构; 定位问题靠"错误类型 + 堆栈", 不靠 SQL 原文;
//   ⑤ PII (手机号 / 身份证 / 邮箱) 与凭据 (密码 / token / 密钥) —— 同 ② 的理由.
//
// **保留的内容** (脱敏后): 错误类型 id / HTTP 状态码 / 业务错误码 / 路径 / 脱敏后的描述 / 脱敏后的堆栈.
//   这是定位 5xx 的**最小充分集**: 少了它就只能靠猜, 多了它就是泄漏面变大.
//
// **为什么生产也要打本地日志** (而不是继续只靠 Sentry):
//   Sentry 是"有 DSN 才有"的外部依赖 —— 内测/自建部署常常没配 DSN, 那时生产 5xx 属于**全盲**
//   (连"到底报了什么错"都拿不到). 本地日志是兜底: 外部通道挂了, 现场还在服务器上.
//
// 注意: Sentry 上报走的是**另一条通道** (原始异常 + url/method/ip/userAgent),
//   本次只收紧**本地日志**口径; Sentry 侧要脱敏属于另一次改动 (本次不做).

// 注意: Sentry 上报走的是**另一条通道** —— WP46 (2026-11-06) 已把该通道也收紧了:
//   脱敏口径 (SQL / PII / 凭据 / query string / 请求体) 现在**只有一份实现**,
//   放在 src/shared/infra/observability/pii-redactor.ts; 本文件与 Sentry 通道共用它.
//
// ============================================================================
// 脱敏实现的位置 (WP46 · 反双胞胎)
// ============================================================================
//
// V2026-11-06: 本文件底部原本有一份**私有副本** (长度上限常量 / SQL 形状正则 / 凭据正则 /
//   key=value 凭据正则 / 手机号正则 / 身份证正则 / 邮箱正则, 以及 looksLikeSql / redactForLog /
//   redactSql / redactStack / truncateForLog / redactPath 六个函数). 那份副本只服务本地日志,
//   Sentry 通道完全没用 —— 两套口径迟早分叉.
//
//   现在: 全部搬到 src/shared/infra/observability/pii-redactor.ts (纯函数, 零 @nestjs /
//   零 @sentry / 零网络), 本文件直接 import. 全仓的正则定义**只剩一处**.
//
//   口径本身**没变** —— 只是搬了位置 (WP26 P2-39 的行为一字不改, 见 test/shared/wp26-biz-exception-log.spec.ts).
