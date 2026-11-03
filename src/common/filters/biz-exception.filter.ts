import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { SentryService } from '../../shared/infra/observability/index.js';
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

/** 单条日志的最大文本长度 (超了截断) —— 一条日志不该无限长. */
const MAX_LOG_TEXT_LENGTH = 2000;

/**
 * SQL 原文的形状 —— 命中即整句遮蔽.
 *
 * 为什么是"整句遮蔽"而不是"逐个抠字面量":
 *   逐个抠容易漏 (转义 / 嵌套引号 / 数字字面量), 而"整句遮蔽"的口径简单可验证 ——
 *   宁可少一条线索, 也不能让 SQL 原文进日志.
 */
const SQL_STATEMENT_PATTERNS: readonly RegExp[] = [
  /\bSELECT\b[\s\S]{0,400}?\bFROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\b[\s\S]{0,200}?\bSET\s+/i,
  /\bDELETE\s+FROM\b/i,
];

/** `Bearer xxx` / `Basic xxx` 形态的凭据. */
const CREDENTIAL_SCHEME_PATTERN = /\b(bearer|basic)\s+[\w.\-+/=]+/gi;

/** key=value 形态的凭据 (password / token / secret / api key / cookie ...). */
const SENSITIVE_KEY_VALUE_PATTERN =
  /\b(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|authorization|cookie)\b(\s*[:=]\s*)\S+/gi;

/** 中国大陆手机号. */
const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g;

/** 身份证号 (18 位). */
const ID_CARD_PATTERN = /\b\d{17}[\dXx]\b/g;

/** 邮箱. */
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/**
 * 文本里是不是有 SQL 原文.
 *
 * @param text 文本
 * @returns 是否命中 SQL 形状
 */
function looksLikeSql(text: string): boolean {
  return SQL_STATEMENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 按脱敏口径处理一段文本 (不含 SQL 整句遮蔽).
 *
 * @param text 原始文本
 * @returns 脱敏 (并截断) 后的文本
 */
function redactForLog(text: string): string {
  let result = text;
  result = result.replaceAll(CREDENTIAL_SCHEME_PATTERN, '$1 ***');
  result = result.replaceAll(SENSITIVE_KEY_VALUE_PATTERN, '$1$2***');
  result = result.replaceAll(PHONE_PATTERN, '1**********');
  result = result.replaceAll(ID_CARD_PATTERN, '*******************');
  result = result.replaceAll(EMAIL_PATTERN, '***@***');
  return truncateForLog(result);
}

/**
 * 脱敏一段错误描述 (含 SQL 整句遮蔽).
 *
 * @param text 原始描述
 * @returns 脱敏后的描述
 */
function redactSql(text: string): string {
  return looksLikeSql(text) ? '[SQL 原文已脱敏]' : redactForLog(text);
}

/**
 * 脱敏一段堆栈 (**逐行**处理).
 *
 * 为什么逐行而不是整段遮蔽: 栈帧 (文件/行号) 是定位问题的第一现场, 整段遮蔽等于把
 * 最有用的部分也丢了; 而 SQL 原文通常落在**第一行**(message 那行), 按行判定足够精准.
 * 跨行 SQL 的其余行仍会过一遍 PII / 凭据规则 (值会被遮, 列名可能残留).
 *
 * @param stack 原始堆栈
 * @returns 脱敏后的堆栈
 */
function redactStack(stack: string): string {
  return stack
    .split('\n')
    .map((line) => (looksLikeSql(line) ? '[SQL 原文已脱敏]' : redactForLog(line)))
    .join('\n');
}

/**
 * 截断过长文本.
 *
 * @param text 文本
 * @returns 截断后的文本
 */
function truncateForLog(text: string): string {
  return text.length > MAX_LOG_TEXT_LENGTH ? `${text.slice(0, MAX_LOG_TEXT_LENGTH)}…(已截断)` : text;
}

/**
 * 只保留路径 (去掉 query string).
 *
 * @param url 原始 url
 * @returns 脱敏后的路径
 */
function redactPath(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : `${url.slice(0, queryIndex)}?***`;
}
