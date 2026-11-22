// V2026-11-10 建立 (WP-J P1d · #6 · 请求日志凭据打码 · 单测):
//   覆盖交付记录 §8 #6 的验收:
//     ① Authorization 头不再明文进日志 (admin basic auth 凭据能被 base64 直接还原);
//     ② Cookie 头不再明文进日志;
//     ③ 请求 / 响应的 Set-Cookie 不再明文进日志 (会话 cookie 也是凭据);
//     ④ **配置真的接上了**: loggerOptions 里用的就是导出的那组路径
//        (导出了却没接到 pinoHttp 上 = 假脱敏).
//
//   为什么用**真实 pino** 而不是断言配置数组:
//     redact 的路径语法 (尤其带连字符的 'set-cookie' 要写 req.headers["set-cookie"])
//     有坑 —— 写错了 pino 会在**建 logger 时**抛 "Invalid redaction path",
//     而"路径写对了但没接进 pinoHttp"则完全静默.
//     所以这里真建一个 logger、真打一条日志、真看输出里还有没有凭据.
//
//   验证: npx vitest run test/shared/p1d-log-redaction.spec.ts
//   时间戳: 2026-11-10

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS, loggerOptions } from '../../src/config/logger.config.js';

/** 一条假的、带凭据的请求. */
function fakePayload(): Record<string, unknown> {
  return {
    req: {
      method: 'GET',
      url: '/admin/api/auto-practice/sessions',
      headers: {
        authorization: 'Basic YWRtaW46U0VDUkVUA0RVQ1JFREFUSUFM',
        cookie: 'access_token=SECRET_COOKIE',
        'set-cookie': 'connect.sid=SECRET_SESSION',
        'user-agent': 'vitest',
      },
    },
    res: {
      statusCode: 200,
      headers: { 'set-cookie': 'connect.sid=SECRET_SESSION' },
    },
  };
}

/**
 * 用真实 pino + 导出的 redact 配置打一条日志, 抓取输出.
 *
 * @returns 日志输出全文
 */
function captureWithRedact(): string {
  const chunks: string[] = [];
  const sink = {
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
  };
  const logger = pino({ redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR } }, sink as never);
  logger.info(fakePayload());
  return chunks.join('');
}

describe('WP-J P1d · 请求日志凭据打码', () => {
  it('① Authorization 头不再明文进日志', () => {
    const out = captureWithRedact();
    expect(out).not.toContain('YWRtaW46U0VDUkVUA0RVQ1JFREFUSUFM');
    expect(out).not.toContain('Basic ');
    expect(out).toContain(LOG_REDACT_CENSOR);
  });

  it('② Cookie 头不再明文进日志', () => {
    const out = captureWithRedact();
    expect(out).not.toContain('SECRET_COOKIE');
  });

  it('③ 请求 / 响应的 Set-Cookie 不再明文进日志', () => {
    const out = captureWithRedact();
    expect(out).not.toContain('SECRET_SESSION');
  });

  it('非凭据字段照常保留 (别把日志打成空壳)', () => {
    const out = captureWithRedact();
    expect(out).toContain('/admin/api/auto-practice/sessions');
    expect(out).toContain('vitest');
  });

  it('④ 配置真的接上了: loggerOptions.pinoHttp 用的就是导出的那组路径', () => {
    const options = loggerOptions.pinoHttp as unknown[];
    const first = options[0] as { redact?: { paths?: string[]; censor?: string } };
    expect(first.redact?.paths).toEqual([...LOG_REDACT_PATHS]);
    expect(first.redact?.censor).toBe(LOG_REDACT_CENSOR);
  });

  it('路径集合覆盖了全部四个凭据位', () => {
    expect(LOG_REDACT_PATHS).toContain('req.headers.authorization');
    expect(LOG_REDACT_PATHS).toContain('req.headers.cookie');
    expect(LOG_REDACT_PATHS).toContain('req.headers["set-cookie"]');
    expect(LOG_REDACT_PATHS).toContain('res.headers["set-cookie"]');
  });
});
