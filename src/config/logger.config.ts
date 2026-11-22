import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import type { Params } from 'nestjs-pino';
import { multistream } from 'pino';
import type { ReqId } from 'pino-http';

const passUrl = new Set(['/health', '/graphql']);

/**
 * 请求 / 响应日志里必须打码的凭据字段 (WP-J P1d · 安全).
 *
 * 背景: pino-http 的自动日志会把**整个 req / res 对象**写进日志 —— 包括
 *   `Authorization` 头. 而 `/admin/api/*` 的 basic auth 凭据就是 base64(user:pass),
 *   **base64 不是加密** —— 任何能读日志的人都能直接还原出管理员口令.
 *   (WP-J P1c 验证时在 3100 临时实例日志里实测到了明文 `Authorization: Basic …`.)
 *
 * 为什么走 pino 的 `redact` 而不是自己写序列化器:
 *   pino 的 redact 是**写入前**的路径级打码 —— 不依赖"谁在打这条日志",
 *   任何走这个 logger 的通道 (stdout / stderr / Sentry) 都自动吃到, 不会漏.
 *
 * ⚠️ `set-cookie` 里是会话 cookie (登录凭据), 同样必须打码.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.proxy-authorization',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
] as const;

/** 打码占位符 (与 pii-redactor 的 `[REDACTED body]` 同款口径). */
export const LOG_REDACT_CENSOR = '[REDACTED]';

export const loggerOptions: Params<Request, Response> = {
  assignResponse: true,
  pinoHttp: [
    {
      // https://getpino.io/#/docs/api?id=timestamp-boolean-function
      // Change time value in production log.
      // timestamp: stdTimeFunctions.isoTime,
      quietReqLogger: true,
      enabled: process.env.NODE_ENV !== 'test',
      genReqId: (req): ReqId => req.header('X-Request-Id') ?? nanoid(),
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : {
            level: 'debug',
            // https://github.com/pinojs/pino-pretty
            transport: {
              target: 'pino-pretty',
              options: { sync: true, singleLine: true },
            },
          }),
      autoLogging: {
        ignore: (req) => passUrl.has(req.originalUrl),
      },
      // WP-J P1d: 凭据头打码 (见 LOG_REDACT_PATHS 的注释) ——
      //   放在 pinoHttp 这一层 = 所有走本 logger 的通道都生效, 不依赖调用方自觉.
      redact: {
        paths: [...LOG_REDACT_PATHS],
        censor: LOG_REDACT_CENSOR,
      },
    },
    multistream(
      [
        // https://getpino.io/#/docs/help?id=log-to-different-streams
        { level: 'debug', stream: process.stdout },
        { level: 'error', stream: process.stderr },
        { level: 'fatal', stream: process.stderr },
      ],
      { dedupe: true },
    ),
  ],
};
