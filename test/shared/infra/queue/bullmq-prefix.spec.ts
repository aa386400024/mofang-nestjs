// AF-526 单测: BullMQ 队列前缀解析.
//   覆盖: 显式覆盖 / production 兼容 / test 兼容 / vitest 兼容 / dev 按 DB + 工作树隔离 / 同工作树稳定.
//   全纯函数, 不改 process.env、不连 Redis.

import { describe, expect, it } from 'vitest';

import { DEFAULT_BULLMQ_PREFIX, resolveBullPrefix } from '../../../../src/shared/infra/queue/bullmq-prefix.js';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe('resolveBullPrefix', () => {
  it('显式 BULLMQ_PREFIX 优先于任何环境默认值', () => {
    expect(resolveBullPrefix(env({ NODE_ENV: 'production', BULLMQ_PREFIX: 'validation-a' }), '/work/a', 'host-a')).toBe('validation-a');
    expect(resolveBullPrefix(env({ NODE_ENV: 'development', BULLMQ_PREFIX: 'validation-b' }), '/work/a', 'host-a')).toBe('validation-b');
  });

  it('production 未配置时回落存量 bullmq', () => {
    expect(resolveBullPrefix(env({ NODE_ENV: 'production' }), '/work/a', 'host-a')).toBe(DEFAULT_BULLMQ_PREFIX);
  });

  it('test / Vitest 环境回落 bullmq, 保持既有队列断言', () => {
    expect(resolveBullPrefix(env({ NODE_ENV: 'test' }), '/work/a', 'host-a')).toBe(DEFAULT_BULLMQ_PREFIX);
    expect(resolveBullPrefix(env({ NODE_ENV: 'development', VITEST: 'true' }), '/work/a', 'host-a')).toBe(DEFAULT_BULLMQ_PREFIX);
  });

  it('development 按 REDIS_DB + 主机 + 工作树生成隔离前缀', () => {
    const prefix = resolveBullPrefix(env({ NODE_ENV: 'development', REDIS_DB: '5' }), 'D:/work/a', 'dev-pc');
    expect(prefix).toMatch(/^bullmq:dev:5:dev-pc:[0-9a-f]{8}$/);
    expect(prefix).not.toBe(DEFAULT_BULLMQ_PREFIX);
  });

  it('同工作树稳定, 不同工作树 / DB 隔离', () => {
    const first = resolveBullPrefix(env({ NODE_ENV: 'development', REDIS_DB: '5' }), 'D:/work/a', 'dev-pc');
    const again = resolveBullPrefix(env({ NODE_ENV: 'development', REDIS_DB: '5' }), 'D:/work/a', 'dev-pc');
    const otherTree = resolveBullPrefix(env({ NODE_ENV: 'development', REDIS_DB: '5' }), 'D:/work/b', 'dev-pc');
    const otherDb = resolveBullPrefix(env({ NODE_ENV: 'development', REDIS_DB: '6' }), 'D:/work/a', 'dev-pc');

    expect(again).toBe(first);
    expect(otherTree).not.toBe(first);
    expect(otherDb).not.toBe(first);
  });

  it('主机名里的非法字符被归一化, 空主机名有兜底', () => {
    expect(resolveBullPrefix(env({ NODE_ENV: 'development', REDIS_DB: '0' }), '/work/a', 'dev.pc:123')).toMatch(
      /^bullmq:dev:0:dev-pc-123:[0-9a-f]{8}$/,
    );
    expect(resolveBullPrefix(env({ NODE_ENV: 'development', REDIS_DB: '0' }), '/work/a', '')).toMatch(
      /^bullmq:dev:0:unknown-host:[0-9a-f]{8}$/,
    );
  });
});
