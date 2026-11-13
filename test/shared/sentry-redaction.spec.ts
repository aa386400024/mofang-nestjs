/* eslint-disable sonarjs/no-hardcoded-ip -- 本套件就是要用固定 IP 验证脱敏口径 */

// V2026-11-06 治本 (WP46 · Sentry 通道脱敏 · 心理数据合规闭环):
//   本套件钉住 **脱敏器本身** 的行为 —— pii-redactor.ts 是本地日志与 Sentry 通道
//   共用的**唯一**脱敏实现 (反双胞胎), 它一旦松了, 两边一起漏.
//
//   覆盖:
//     ① redactRecord 对业务内容类 / 凭据类黑名单的递归脱敏 (嵌套对象 / 数组元素);
//     ② redactRecord 对 Buffer / 顶层字符串的整体替换 + 不改入参;
//     ③ redactIp 的 IPv4 / IPv4-mapped IPv6 / IPv6 / undefined 四种口径;
//     ④ redactString 对手机 / 身份证 / 邮箱 / 凭据 / SQL 的遮蔽;
//     ⑤ redactEventForSentry 的编排 (request.data / extra / user / breadcrumbs / exception);
//     ⑥ buildSentryInitOptions 的采集口径 (v11 dataCollection 严格档) + 主机名隐藏;
//     ⑦ SentryService 手动层的脱敏 (captureException / captureMessage) + dev 提示.
//
//   边界: 只读 src/shared/infra/observability/**; 不起 Nest 容器; 不连网络.
//   验证: npx vitest run test/shared/sentry-redaction.spec.ts
//   时间戳: 2026-11-06 GMT+8

import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_LOG_TEXT_LENGTH,
  REDACTED,
  REDACTED_BODY,
  REDACTED_SQL,
  REQUEST_BODY_SENSITIVE_NAMES,
  SENSITIVE_CONTENT_NAMES,
  SENSITIVE_KEY_NAMES,
  collectMatchingKeys,
  redactEventForSentry,
  redactForLog,
  redactIp,
  redactPath,
  redactQueryString,
  redactRecord,
  redactSql,
  redactStack,
  redactString,
  truncateForLog,
} from '../../src/shared/infra/observability/pii-redactor.js';
import { STRICT_DATA_COLLECTION, SentryService, buildSentryInitOptions } from '../../src/shared/infra/observability/sentry.service.js';

// mock 掉 Sentry SDK 的副作用函数 —— 只关心"我们传了什么", 不关心 SDK 真发包.
// 其余导出 (httpIntegration 等) 保持真实, buildSentryInitOptions 仍能跑出真配置.
vi.mock('@sentry/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/node')>();
  return {
    ...actual,
    init: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  };
});

// profiler 是 native 模块, 加载慢且与本套件无关 —— 直接 mock 掉.
vi.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: () => ({ name: 'ProfilingNode' }),
}));

describe('WP46 · pii-redactor (脱敏器本体)', () => {
  describe('① redactRecord —— 业务内容类黑名单', () => {
    it('遮掉顶层心理内容字段', () => {
      const result = redactRecord({ body: '我想自杀', title: '求助', userId: 'u123' }, SENSITIVE_CONTENT_NAMES);
      expect(result.body).toBe(REDACTED);
      expect(result.title).toBe(REDACTED);
      // userId 不在黑名单里 —— 业务 id 是调试必需的, 必须留
      expect(result.userId).toBe('u123');
    });

    it('递归遮掉嵌套对象里的心理内容字段', () => {
      const result = redactRecord({ outer: { inner: { notes: '情绪崩溃', keep: 'ok' } } }, SENSITIVE_CONTENT_NAMES);
      expect(result.outer.inner.notes).toBe(REDACTED);
      expect(result.outer.inner.keep).toBe('ok');
    });

    it('递归遮掉数组元素里的心理内容字段 (数组本身的键名不命中时)', () => {
      const result = redactRecord({ items: [{ content: '来访者原话' }, { content: '更多原话' }] }, SENSITIVE_CONTENT_NAMES);
      expect(result.items[0].content).toBe(REDACTED);
      expect(result.items[1].content).toBe(REDACTED);
    });

    it('数组本身的键名命中时, 整个数组被替换 (不留元素)', () => {
      const result = redactRecord({ messages: [{ content: '来访者原话' }], tags: ['a', 'b'] }, SENSITIVE_CONTENT_NAMES);
      expect(result.messages).toBe(REDACTED);
      expect(result.tags).toBe(REDACTED);
    });

    it('字段名大小写不敏感 (Password / Body 也要遮)', () => {
      const result = redactRecord({ Password: 'x', BODY: 'y' }, REQUEST_BODY_SENSITIVE_NAMES);
      expect(result.Password).toBe(REDACTED);
      expect(result.BODY).toBe(REDACTED);
    });
  });

  describe('② redactRecord —— 凭据类黑名单 + 整体替换', () => {
    it('遮掉凭据类字段, 保留业务 id', () => {
      const result = redactRecord({ password: 'hunter2', token: 'abc', apiKey: 'k', sessionId: 's1', code: 1000 }, SENSITIVE_KEY_NAMES);
      expect(result.password).toBe(REDACTED);
      expect(result.token).toBe(REDACTED);
      expect(result.apiKey).toBe(REDACTED);
      expect(result.sessionId).toBe('s1');
      expect(result.code).toBe(1000);
    });

    it('Buffer 整体替换 (二进制载荷 = 心理内容)', () => {
      const result = redactRecord({ audio: Buffer.from('binary-audio'), userId: 'u1' }, SENSITIVE_KEY_NAMES);
      expect(result.audio).toBe(REDACTED);
      expect(result.userId).toBe('u1');
    });

    it('顶层 Buffer 整体替换', () => {
      expect(redactRecord(Buffer.from('x'), SENSITIVE_KEY_NAMES)).toBe(REDACTED);
    });

    it('顶层字符串整体替换 (没有字段名可匹配, 宁可全遮)', () => {
      expect(redactRecord('裸的心理原文', SENSITIVE_KEY_NAMES)).toBe(REDACTED);
    });

    it('不改入参 (返回新对象)', () => {
      const input = { body: '原文', nested: { note: 'x' } };
      redactRecord(input, SENSITIVE_CONTENT_NAMES);
      expect(input.body).toBe('原文');
      expect(input.nested.note).toBe('x');
    });

    it('循环引用不炸 (整体遮蔽)', () => {
      const input: Record<string, unknown> = { body: 'x' };
      input['self'] = input;
      const result = redactRecord(input, SENSITIVE_CONTENT_NAMES);
      expect(result['body']).toBe(REDACTED);
      expect(result['self']).toBe(REDACTED);
    });
  });

  describe('③ redactIp —— IP 脱敏口径', () => {
    it('IPv4 保留 /24', () => {
      expect(redactIp('1.2.3.4')).toBe('1.2.3.0');
      expect(redactIp('192.168.10.200')).toBe('192.168.10.0');
    });

    it('IPv4-mapped IPv6 按 IPv4 处理', () => {
      expect(redactIp('::ffff:1.2.3.4')).toBe('1.2.3.0');
      expect(redactIp('::FFFF:10.0.0.7')).toBe('10.0.0.0');
    });

    it('IPv6 保留前 48 位 (前 3 组)', () => {
      expect(redactIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::');
    });

    it('undefined / null → undefined', () => {
      expect(redactIp()).toBeUndefined();
      expect(redactIp(null)).toBeUndefined();
    });

    it('认不出来的形态 → undefined (宁可少一个字段, 也不让它原样出去)', () => {
      expect(redactIp('not-an-ip')).toBeUndefined();
      expect(redactIp('')).toBeUndefined();
    });
  });

  describe('④ redactString / redactForLog —— 文本脱敏', () => {
    it('手机号不进文本', () => {
      expect(redactString('call 13800138000 now')).toBe('call 1********** now');
    });

    it('身份证号不进文本', () => {
      expect(redactString('id 11010119900307771X')).not.toContain('11010119900307771X');
    });

    it('邮箱不进文本', () => {
      expect(redactString('mail zhangsan@example.com')).toBe('mail ***@***');
    });

    it('key=value 凭据不进文本', () => {
      expect(redactString('token=abc123secret')).toBe('token=***');
      expect(redactString('password: hunter2')).toBe('password: ***');
    });

    it('Bearer 凭据不进文本', () => {
      expect(redactString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload')).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    });

    it('SQL 原文整句遮蔽', () => {
      expect(redactString("SELECT id, phone FROM users WHERE phone = '13800138000'")).toBe(REDACTED_SQL);
      expect(redactSql('UPDATE users SET phone = 1 WHERE id = 2')).toBe(REDACTED_SQL);
    });

    it('redactForLog 不做 SQL 整句遮蔽 (本地日志口径保持不变)', () => {
      expect(redactForLog('SELECT id FROM users')).toContain('SELECT id FROM users');
    });

    it('超长文本被截断', () => {
      const long = 'a'.repeat(MAX_LOG_TEXT_LENGTH + 10);
      expect(truncateForLog(long).length).toBeLessThan(long.length);
      expect(truncateForLog(long)).toContain('已截断');
    });

    it('redactPath 只留路由', () => {
      expect(redactPath('/user/list?token=abc')).toBe('/user/list?***');
      expect(redactPath('/user/list')).toBe('/user/list');
    });

    it('redactStack 逐行处理, 保留栈帧', () => {
      const stack = 'Error: boom\n    at foo (/app/src/x.ts:1:2)';
      const result = redactStack(stack);
      expect(result).toContain('/app/src/x.ts:1:2');
      expect(result).toContain('Error: boom');
    });
  });

  describe('⑤ redactEventForSentry —— 事件级编排', () => {
    it('request.data 里的心理内容 / 凭据被遮, 业务 id 保留', () => {
      const event = redactEventForSentry({
        request: {
          data: { body: '我想自杀，日记原文', title: '求助', password: 'abc123', userId: 'u123' },
        },
      });
      const data = (event['request'] as Record<string, unknown>)['data'] as Record<string, unknown>;
      expect(data['body']).toBe(REDACTED);
      expect(data['title']).toBe(REDACTED);
      expect(data['password']).toBe(REDACTED);
      expect(data['userId']).toBe('u123');
    });

    it('request.data 是字符串 (原始 body) 时整体替换', () => {
      const event = redactEventForSentry({
        request: { data: '{"body":"我想自杀","title":"求助"}' },
      });
      expect((event['request'] as Record<string, unknown>)['data']).toBe(REDACTED_BODY);
      expect(JSON.stringify(event)).not.toContain('我想自杀');
    });

    it('request.data 是 Buffer 时整体替换', () => {
      const event = redactEventForSentry({ request: { data: Buffer.from('binary') } });
      expect((event['request'] as Record<string, unknown>)['data']).toBe(REDACTED_BODY);
    });

    it('extra 里只遮凭据类, 业务 id 保留', () => {
      const event = redactEventForSentry({
        extra: { userId: 'u123', sessionId: 's1', code: 1000, password: 'hunter2', token: 'abc' },
      });
      const extra = event['extra'] as Record<string, unknown>;
      expect(extra['userId']).toBe('u123');
      expect(extra['sessionId']).toBe('s1');
      expect(extra['code']).toBe(1000);
      expect(extra['password']).toBe(REDACTED);
      expect(extra['token']).toBe(REDACTED);
    });

    it('event.user 里 email / username 被删, id 保留, ip 截断', () => {
      const event = redactEventForSentry({
        user: { id: 'u123', email: 'a@b.com', username: 'zhangsan', ip_address: '1.2.3.4' },
      });
      const user = event['user'] as Record<string, unknown>;
      expect(user['id']).toBe('u123');
      expect(user['email']).toBeUndefined();
      expect(user['username']).toBeUndefined();
      expect(user['ip_address']).toBe('1.2.3.0');
    });

    it('request.headers 里 authorization / cookie 被删, 其他保留', () => {
      const event = redactEventForSentry({
        request: { headers: { authorization: 'Bearer x', cookie: 'sid=1', 'content-type': 'application/json' } },
      });
      const headers = (event['request'] as Record<string, unknown>)['headers'] as Record<string, unknown>;
      expect(headers['authorization']).toBeUndefined();
      expect(headers['cookie']).toBeUndefined();
      expect(headers['content-type']).toBe('application/json');
    });

    it('request.cookies 被删, request.url 去 query', () => {
      const event = redactEventForSentry({
        request: { cookies: { sid: 'x' }, url: '/api/x?token=abc123' },
      });
      const request = event['request'] as Record<string, unknown>;
      expect(request['cookies']).toBeUndefined();
      expect(request['url']).toBe('/api/x?***');
    });

    it('query_string 里命中黑名单的参数被删', () => {
      expect(redactQueryString('token=abc&page=1')).toBe('page=1');
      expect(redactQueryString('code=1234&page=1')).toBe('page=1');
      expect(redactQueryString({ token: 'abc', page: 1 })).toEqual({ page: 1 });
    });

    it('breadcrumbs 的 data / message / url 都过一遍', () => {
      const event = redactEventForSentry({
        breadcrumbs: [{ message: 'call 13800138000', url: '/a?token=x', data: { token: 'abc', keep: '1' } }],
      });
      const crumb = (event['breadcrumbs'] as Record<string, unknown>[])[0];
      expect(String(crumb['message'])).not.toContain('13800138000');
      expect(crumb['url']).toBe('/a?***');
      const data = crumb['data'] as Record<string, unknown>;
      expect(data['token']).toBe(REDACTED);
      expect(data['keep']).toBe('1');
    });

    it('exception 的 message / 栈帧局部变量过一遍', () => {
      const event = redactEventForSentry({
        exception: {
          values: [
            {
              value: 'failed for 13800138000',
              stacktrace: {
                frames: [
                  {
                    filename: '/app/x.ts',
                    lineno: 12,
                    vars: { userInput: '我想自杀', keep: 'ok' },
                    context_line: 'call 13800138000',
                  },
                ],
              },
            },
          ],
        },
      });
      const value = (event['exception'] as Record<string, unknown>)['values'] as Record<string, unknown>[];
      expect(String(value[0]['value'])).not.toContain('13800138000');
      const frame = (value[0]['stacktrace'] as Record<string, unknown>)['frames'] as Record<string, unknown>[];
      expect(frame[0]['filename']).toBe('/app/x.ts');
      const vars = frame[0]['vars'] as Record<string, unknown>;
      expect(vars['userInput']).toBe(REDACTED);
      expect(vars['keep']).toBe('ok');
      expect(String(frame[0]['context_line'])).not.toContain('13800138000');
    });

    it('不改入参', () => {
      const event = { request: { data: { body: '原文' } } };
      redactEventForSentry(event);
      expect(event.request.data.body).toBe('原文');
    });
  });

  describe('⑥ collectMatchingKeys —— dev 提示用', () => {
    it('收集命中的字段名', () => {
      expect(collectMatchingKeys({ body: 'x', nested: { notes: 'y' }, userId: 'u' }, SENSITIVE_CONTENT_NAMES).sort()).toEqual([
        'body',
        'notes',
      ]);
    });

    it('没命中返空数组', () => {
      expect(collectMatchingKeys({ userId: 'u', code: 1 }, SENSITIVE_CONTENT_NAMES)).toEqual([]);
    });
  });

  describe('⑦ buildSentryInitOptions —— 采集口径', () => {
    const options = buildSentryInitOptions({
      dsn: 'https://publickey@localhost/1',
      environment: 'test',
      tracesSampleRate: 0,
      profileSessionSampleRate: 0,
      profilingIntegration: null,
    });

    it('显式锁死"不采 HTTP 体" (v11 里 sendDefaultPii 已删除, 这是真正的开关)', () => {
      expect(options.dataCollection?.httpBodies).toEqual([]);
      expect(STRICT_DATA_COLLECTION.httpBodies).toEqual([]);
    });

    it('不采 cookie / 不自动填 user.* / 不采栈帧局部变量', () => {
      expect(options.dataCollection?.cookies).toBe(false);
      expect(options.dataCollection?.userInfo).toBe(false);
      expect(options.dataCollection?.stackFrameVariables).toBe(false);
    });

    it('不暴露服务器主机名', () => {
      expect(options.serverName).toBe('unknown');
      expect(options.includeServerName).toBe(false);
    });

    it('保留 ECONNRESET 过滤与 ignoreErrors', () => {
      expect(options.ignoreErrors).toContain('Unauthorized');
      expect(options.beforeSend).toBeTypeOf('function');
      // eslint-disable-next-line sonarjs/deprecation -- v11 标了 deprecated, 但切回 traceLifecycle='static' 时就是最后一道防线
      expect(options.beforeSendTransaction).toBeTypeOf('function');
    });

    it('beforeSend 会真的脱敏 (不是空壳)', () => {
      const beforeSend = options.beforeSend as unknown as (event: unknown, hint: unknown) => unknown;
      const result = beforeSend({ request: { data: { body: '我想自杀', userId: 'u1' } } }, {}) as Record<string, unknown>;
      const data = (result['request'] as Record<string, unknown>)['data'] as Record<string, unknown>;
      expect(data['body']).toBe(REDACTED);
      expect(data['userId']).toBe('u1');
    });

    it('beforeSend 仍然过滤 ECONNRESET (返回 null)', () => {
      const beforeSend = options.beforeSend as unknown as (event: unknown, hint: unknown) => unknown;
      expect(beforeSend({ exception: { values: [{ type: 'ECONNRESET' }] } }, {})).toBeNull();
    });
  });

  describe('⑧ SentryService 手动层', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDsn = process.env.SENTRY_DSN;
    const originalEnv = process.env.SENTRY_ENVIRONMENT;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      process.env.SENTRY_DSN = 'https://publickey@localhost/1';
      process.env.SENTRY_ENVIRONMENT = 'test';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalDsn === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = originalDsn;
      if (originalEnv === undefined) delete process.env.SENTRY_ENVIRONMENT;
      else process.env.SENTRY_ENVIRONMENT = originalEnv;
    });

    it('captureException 的 context 过一遍凭据类脱敏', async () => {
      const service = new SentryService();
      await service.onModuleInit();
      const err = new Error('boom');
      service.captureException(err, { userId: 'u1', password: 'hunter2', sessionId: 's1' });

      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      const call = vi.mocked(Sentry.captureException).mock.calls[0];
      const extra = (call[1]! as unknown as { extra?: Record<string, unknown> }).extra!;
      expect(extra['userId']).toBe('u1');
      expect(extra['sessionId']).toBe('s1');
      expect(extra['password']).toBe(REDACTED);
    });

    it('captureMessage 的 message 过一遍文本脱敏', async () => {
      const service = new SentryService();
      await service.onModuleInit();
      service.captureMessage('boom 13800138000', 'error', { token: 'abc' });

      const call = vi.mocked(Sentry.captureMessage).mock.calls[0];
      expect(String(call[0])).not.toContain('13800138000');
      const extra = (call[1]! as unknown as { extra?: Record<string, unknown> }).extra!;
      expect(extra['token']).toBe(REDACTED);
    });

    it('dev 模式: extra 里出现心理内容字段名时给出提示 (但不自动遮)', async () => {
      process.env.NODE_ENV = 'development';
      const service = new SentryService();
      await service.onModuleInit();
      service.captureException(new Error('boom'), { body: '我想自杀', userId: 'u1' });

      const warn = vi.spyOn(Logger.prototype, 'warn');
      expect(warn).toHaveBeenCalled();
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('body');

      const call = vi.mocked(Sentry.captureException).mock.calls[0];
      const extra = (call[1]! as unknown as { extra?: Record<string, unknown> }).extra!;
      // extra 不遮业务内容类 —— 只提示, 由业务侧自律
      expect(extra['body']).toBe('我想自杀');
      expect(extra['userId']).toBe('u1');
    });

    it('未初始化时不上报', () => {
      const service = new SentryService();
      service.captureException(new Error('boom'), { a: 1 });
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });
});
