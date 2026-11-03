// V2026-11-03 治本 (WP26 · P2-39 · 生产 5xx 也打本地日志):
//   生产原本**只**上报 Sentry —— 一旦 SENTRY_DSN 没配 (内测/自建部署很常见),
//   线上 5xx 就是全盲 (连"到底报了什么错"都拿不到). 现在生产也打 error 级本地日志,
//   但走**脱敏口径**: SQL 原文 / PII (手机号·身份证·邮箱) / 凭据 (密码·token·密钥) /
//   URL 的 query string 一律不进日志.
//
//   本套件钉住:
//     ① 生产 5xx 会打 error 日志 (且含状态码 / 业务错误码 / 错误类型 id / 路径);
//     ② 脱敏口径真的生效 (敏感内容不出现在日志里);
//     ③ **返给前端的内容不变** (仍是业务 message, 不带原始 message 与堆栈);
//     ④ 生产 4xx 不打 error 日志 (4xx 是客户端错, 打进来只会淹掉真故障);
//     ⑤ dev 保持原口径 (原始 message + 完整堆栈).
//
//   边界: 只读 src/common/filters/biz-exception.filter.ts; 不起 Nest 容器.
//
//   验证: npx vitest run test/shared/wp26-biz-exception-log.spec.ts
//   时间戳: 2026-11-03 GMT+8

import { Logger, type ArgumentsHost } from '@nestjs/common';
import { vi } from 'vitest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { BizExceptionFilter } from '../../src/common/filters/biz-exception.filter.js';
import type { SentryService } from '../../src/shared/infra/observability/index.js';

/** 假的 express Response (filter 只用 status / json). */
interface FakeResponse {
  statusCode: number;
  body?: unknown;
  status(code: number): FakeResponse;
  json(body: unknown): FakeResponse;
}

/**
 * 造一个假的 Response.
 *
 * @returns 假的 Response
 */
function createResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: 0,
    status(code: number): FakeResponse {
      response.statusCode = code;
      return response;
    },
    json(body: unknown): FakeResponse {
      response.body = body;
      return response;
    },
  };
  return response;
}

/**
 * 造一个假的 ArgumentsHost.
 *
 * @param request 假请求
 * @returns 假的 host + 假响应
 */
function createHost(request: { method: string; url: string }): { host: ArgumentsHost; response: FakeResponse } {
  const response = createResponse();
  const fakeRequest = { ...request, headers: {}, ip: '127.0.0.1' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => fakeRequest,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

/** 造一个 filter (Sentry 用 stub). */
function createFilter(): BizExceptionFilter {
  const sentry = { captureException: vi.fn() } as unknown as SentryService;
  return new BizExceptionFilter(sentry);
}

describe('WP26 · P2-39 · 生产 5xx 本地日志', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {
      // 空实现: 只关心"打了什么", 不关心日志真的写出去.
    });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('① 生产 5xx 会打 error 日志', () => {
    it('打一条 error 日志, 且含状态码 / 业务错误码 / 错误类型 id / 路径', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'POST', url: '/auth/login' });

      filter.catch(new Error('boom'), host);

      const spy = Logger.prototype.error as unknown as ReturnType<typeof vi.spyOn>;
      expect(spy).toHaveBeenCalledTimes(1);
      const [line] = spy.mock.calls[0] as [string, string | undefined];
      expect(line).toContain('status=500');
      expect(line).toContain(`code=${BizCode.UnknownError}`);
      expect(line).toContain('err=Error');
      expect(line).toContain('POST /auth/login');
    });

    it('业务 5xx (BizException 映射到 500) 也打', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'GET', url: '/growth/tools' });

      filter.catch(new BizException(BizCode.GrowthDailyToolsFetchFail), host);

      const spy = Logger.prototype.error as unknown as ReturnType<typeof vi.spyOn>;
      expect(spy).toHaveBeenCalledTimes(1);
      const [line] = spy.mock.calls[0] as [string, string | undefined];
      expect(line).toContain('status=500');
      expect(line).toContain(`code=${BizCode.GrowthDailyToolsFetchFail}`);
    });
  });

  describe('② 脱敏口径生效', () => {
    /**
     * 把这一条日志 (message + stack) 拼成一段文本, 便于断言"敏感内容没出现".
     *
     * @returns 日志全文
     */
    function loggedText(): string {
      const spy = Logger.prototype.error as unknown as ReturnType<typeof vi.spyOn>;
      const [message, stack] = spy.mock.calls[0] as [string, string | undefined];
      return `${message}\n${stack ?? ''}`;
    }

    it('手机号不进日志', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'POST', url: '/user/register' });

      filter.catch(new Error("Duplicate entry '13800138000-x' for key 'user.phone'"), host);

      expect(loggedText()).not.toContain('13800138000');
      expect(loggedText()).toContain('1**********');
    });

    it('邮箱不进日志', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'POST', url: '/user/register' });

      filter.catch(new Error('failed to send mail to zhangsan@example.com'), host);

      expect(loggedText()).not.toContain('zhangsan@example.com');
    });

    it('token / 密码不进日志', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'POST', url: '/auth/login' });

      filter.catch(new Error('token=abc123secret password: hunter2'), host);

      expect(loggedText()).not.toContain('abc123secret');
      expect(loggedText()).not.toContain('hunter2');
    });

    it('Bearer 凭据不进日志', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'GET', url: '/user/me' });

      filter.catch(new Error('rejected Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload'), host);

      expect(loggedText()).not.toContain('eyJhbGciOiJIUzI1NiJ9.payload');
    });

    it('SQL 原文不进日志 (整句遮蔽, 但堆栈帧保留)', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'GET', url: '/user/list' });

      filter.catch(new Error("QueryFailedError: SELECT id, phone FROM users WHERE phone = '13800138000'"), host);

      expect(loggedText()).not.toContain('SELECT id, phone FROM users');
      expect(loggedText()).not.toContain('13800138000');
      // 堆栈帧是定位问题的第一现场, 不能因为 SQL 遮蔽被整段丢掉.
      expect(loggedText()).toContain('wp26-biz-exception-log.spec.ts');
    });

    it('URL 的 query string 不进日志 (只留路由)', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'GET', url: '/user/list?token=abc123secret&phone=13800138000' });

      filter.catch(new Error('boom'), host);

      expect(loggedText()).toContain('GET /user/list?***');
      expect(loggedText()).not.toContain('abc123secret');
      expect(loggedText()).not.toContain('13800138000');
    });
  });

  describe('③ 返给前端的内容不变', () => {
    it('响应仍是 { code, message, data } 且不含原始 message 与堆栈', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host, response } = createHost({ method: 'POST', url: '/auth/login' });

      filter.catch(new Error('数据库炸了: connection refused'), host);

      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({ code: BizCode.UnknownError, message: '服务内部错误', data: null });
      expect(JSON.stringify(response.body)).not.toContain('connection refused');
    });
  });

  describe('④ 生产 4xx 不打 error 日志', () => {
    it('业务 4xx (404) 不打本地 error 日志', () => {
      process.env.NODE_ENV = 'production';
      const filter = createFilter();
      const { host } = createHost({ method: 'GET', url: '/user/999' });

      filter.catch(new BizException(BizCode.UserNotFound), host);

      const spy = Logger.prototype.error as unknown as ReturnType<typeof vi.spyOn>;
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('⑤ dev 保持原口径', () => {
    it('dev 的未知错误仍打原始 message + 完整堆栈', () => {
      process.env.NODE_ENV = 'development';
      const filter = createFilter();
      const { host } = createHost({ method: 'POST', url: '/auth/login' });

      filter.catch(new Error('数据库炸了: connection refused'), host);

      const spy = Logger.prototype.error as unknown as ReturnType<typeof vi.spyOn>;
      expect(spy).toHaveBeenCalledTimes(1);
      const [message, stack] = spy.mock.calls[0] as [string, string | undefined];
      // dev 的口径是"业务 message + 原始堆栈" (堆栈第一行带原始 message) —— 本次未改动.
      expect(message).toContain('[POST /auth/login]');
      expect(stack).toContain('数据库炸了: connection refused');
      expect(stack).toContain('Error');
    });
  });
});
