// V2026-11-03 治本 (WP25 · Phase1 封版审查 · 安全加固回归):
//   职责: 把 WP25 修掉的 4 个安全口子钉成**机器断言** ——
//     ① 生产 CSP 指令的 source list 语法合法 (原来的 `'["self"'` 会被浏览器整条忽略);
//     ② 生产缺 SESSION_SECRET 时**不再落回公开常量**;
//     ③ /admin/api/* 生产环境对匿名请求 **fail-close** (401), 不再"只打 warn 放行";
//     ④ 头像上传失败时**不把底层报错原文**返前端 (fs 绝对路径 / MySQL 表名列名).
//
//   为什么每条都要有用例:
//     ① 语法错的 CSP **不报错、不告警**, 只是"看起来开了, 其实没开";
//     ② 公开常量密钥 = 任何拿到源码的人都能伪造 session cookie;
//     ③ 生产匿名可达 = 任何人都能拉走**全部学员**的咨询逐字稿;
//     ④ 报错原文泄漏 = 服务器目录结构 / 表结构 泄进浏览器控制台.
//
//   边界: 全 mock; 不起 Nest 容器; 不连 DB / 不连上游.
//
//   验证: npx vitest run test/base/wp25-security-hardening.spec.ts
//   时间戳: 2026-11-03 GMT+8

import { Logger } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminBasicAuthMiddleware } from '../../src/admin-debug/admin-basic-auth.middleware.js';
import { PRODUCTION_CSP_DIRECTIVES, resolveSessionSecret } from '../../src/app.middleware.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { ProfileService } from '../../src/profile/providers/profile.service.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

// ── node:fs 的桩 (头像上传要写文件) ──────────────────────────────────────
const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async (): Promise<void> => {}),
  writeFile: vi.fn(async (): Promise<void> => {}),
  unlink: vi.fn(async (): Promise<void> => {}),
}));

vi.mock('node:fs', () => ({ promises: fsMocks }));

/** 记录 logger 调用 (验证 error 级告警确实打了). */
function buildRecordingLogger(): { readonly logger: Logger; readonly errors: string[] } {
  const errors: string[] = [];
  const logger = {
    error: (message: string): void => {
      errors.push(message);
    },
    warn: (): void => {},
    log: (): void => {},
  } as unknown as Logger;
  return { logger, errors };
}

describe('WP25 · ① 生产 CSP 指令语法合法', () => {
  it('每个 source 都不含方括号 —— 带方括号的 source list 会被浏览器整条忽略', () => {
    for (const [directive, sources] of Object.entries(PRODUCTION_CSP_DIRECTIVES)) {
      for (const source of sources) {
        expect(source, `CSP 指令 ${directive} 的 source 不该带方括号`).not.toContain('[');
        expect(source, `CSP 指令 ${directive} 的 source 不该带方括号`).not.toContain(']');
      }
    }
  });

  it("default-src 是 'self' (不是 '[\"self\"') —— 这条决定了 CSP 到底有没有生效", () => {
    expect(PRODUCTION_CSP_DIRECTIVES.defaultSrc).toEqual(["'self'"]);
    expect(PRODUCTION_CSP_DIRECTIVES.defaultSrc).not.toContain(`'["self"'`);
  });

  it('object-src / frame-ancestors 收紧为 none (防 XSS 与点击劫持)', () => {
    expect(PRODUCTION_CSP_DIRECTIVES.objectSrc).toEqual(["'none'"]);
    expect(PRODUCTION_CSP_DIRECTIVES.frameAncestors).toEqual(["'none'"]);
  });
});

describe('WP25 · ② SESSION_SECRET 不落回公开常量', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  });

  it('生产没配 → 用随机密钥, 且**不是**公开常量 tEsTeD', () => {
    process.env.NODE_ENV = 'production';
    const { logger } = buildRecordingLogger();
    const secret = resolveSessionSecret(logger);
    expect(secret).not.toBe('tEsTeD');
    // randomBytes(32) → 64 位 hex.
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('生产没配 → 两次调用得到不同密钥 (不是写死的)', () => {
    process.env.NODE_ENV = 'production';
    const { logger } = buildRecordingLogger();
    expect(resolveSessionSecret(logger)).not.toBe(resolveSessionSecret(logger));
  });

  it('生产没配 → 打的是 error 级日志 (不是 warn —— warn 不拦请求)', () => {
    process.env.NODE_ENV = 'production';
    const { logger, errors } = buildRecordingLogger();
    resolveSessionSecret(logger);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('SESSION_SECRET');
  });

  it('配了 → 用配的值 (不覆盖运维配置)', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = '  a-real-secret-from-env  ';
    const { logger } = buildRecordingLogger();
    expect(resolveSessionSecret(logger)).toBe('a-real-secret-from-env');
  });

  it('dev 没配 → 保持旧行为 tEsTeD (本地无感, 不打 error)', () => {
    process.env.NODE_ENV = 'development';
    const { logger, errors } = buildRecordingLogger();
    expect(resolveSessionSecret(logger)).toBe('tEsTeD');
    expect(errors).toHaveLength(0);
  });
});

describe('WP25 · ③ /admin/api 生产 fail-close', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  /** 假 response: 只记 status + json. */
  function buildResponse(): { readonly res: Response; readonly status: number[]; readonly bodies: unknown[] } {
    const status: number[] = [];
    const bodies: unknown[] = [];
    const res = {
      status(code: number): typeof res {
        status.push(code);
        return res;
      },
      json(body: unknown): typeof res {
        bodies.push(body);
        return res;
      },
    } as unknown as Response;
    return { res, status, bodies };
  }

  /** 假 request. */
  function buildRequest(headers: Record<string, string> = {}, cookies: Record<string, string> = {}): Request {
    return { headers, cookies } as unknown as Request;
  }

  /**
   * 装配中间件.
   *
   * @param env basic auth 账号口令 (两个都非空 = 配了)
   * @param jwtOk JWT 校验是否通过
   */
  function buildMiddleware(options: { readonly user?: string; readonly pass?: string; readonly jwtOk?: boolean } = {}): {
    readonly middleware: NestMiddleware;
    readonly config: ConfigService;
  } {
    const values: Record<string, string> = {};
    if (options.user !== undefined) values['ADMIN_BASIC_AUTH_USER'] = options.user;
    if (options.pass !== undefined) values['ADMIN_BASIC_AUTH_PASS'] = options.pass;
    const config = { get: (key: string): string | undefined => values[key] } as unknown as ConfigService;
    const jwtAuth = {
      canActivate: async (): Promise<boolean> => {
        if (options.jwtOk ?? false) return true;
        throw new Error('unauthorized');
      },
    } as unknown as NestMiddleware;
    return { middleware: new AdminBasicAuthMiddleware(config, jwtAuth as never), config };
  }

  it('生产 + 匿名 + 没配凭据 → 401 (不放行)', async () => {
    process.env.NODE_ENV = 'production';
    const { middleware } = buildMiddleware();
    const { res, status } = buildResponse();
    const next = vi.fn();

    await middleware.use(buildRequest(), res, next);

    expect(status).toEqual([401]);
    expect(next).not.toHaveBeenCalled();
  });

  it('生产 + 匿名 + 带了无效 token → 401 (不按匿名放行)', async () => {
    process.env.NODE_ENV = 'production';
    const { middleware } = buildMiddleware();
    const { res, status } = buildResponse();
    const next = vi.fn();

    await middleware.use(buildRequest({ authorization: 'Bearer bad-token' }), res, next);

    expect(status).toEqual([401]);
    expect(next).not.toHaveBeenCalled();
  });

  it('生产 + 凭据正确 → 放行并标记管理员身份', async () => {
    process.env.NODE_ENV = 'production';
    const { middleware } = buildMiddleware({ user: 'admin', pass: 's3cret' });
    const { res, status } = buildResponse();
    const next = vi.fn();
    const req = buildRequest({ authorization: `Basic ${Buffer.from('admin:s3cret').toString('base64')}` });

    await middleware.use(req, res, next);

    expect(status).toEqual([]);
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as { adminBasicAuth?: boolean }).adminBasicAuth).toBe(true);
  });

  it('生产 + 凭据错误 → 401 (不回落成学员身份)', async () => {
    process.env.NODE_ENV = 'production';
    const { middleware } = buildMiddleware({ user: 'admin', pass: 's3cret' });
    const { res, status } = buildResponse();
    const next = vi.fn();
    const req = buildRequest({ authorization: `Basic ${Buffer.from('admin:wrong').toString('base64')}` });

    await middleware.use(req, res, next);

    expect(status).toEqual([401]);
    expect(next).not.toHaveBeenCalled();
  });

  it('dev + 匿名 + 没配凭据 → 放行 (本地调试器免登录, 老口径不变)', async () => {
    process.env.NODE_ENV = 'development';
    const { middleware } = buildMiddleware();
    const { res, status } = buildResponse();
    const next = vi.fn();

    await middleware.use(buildRequest(), res, next);

    expect(status).toEqual([]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('配了凭据 + 匿名 → 401 (不管 dev 还是 prod)', async () => {
    process.env.NODE_ENV = 'development';
    const { middleware } = buildMiddleware({ user: 'admin', pass: 's3cret' });
    const { res, status } = buildResponse();
    const next = vi.fn();

    await middleware.use(buildRequest(), res, next);

    expect(status).toEqual([401]);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('WP25 · ④ 头像上传失败不泄漏底层报错原文', () => {
  /** 假 repo. */
  function buildRepo(options: { readonly saveError?: Error } = {}): { readonly repo: unknown; readonly saved: unknown[] } {
    const saved: unknown[] = [];
    const repo = {
      findOne: async (): Promise<unknown> => ({ uid: 'u1', nickname: null, avatarUrl: null, currentRole: 'growth_user' }),
      create: (data: unknown): unknown => data,
      save: async (entity: unknown): Promise<unknown> => {
        if (options.saveError) throw options.saveError;
        saved.push(entity);
        return entity;
      },
    };
    return { repo, saved };
  }

  /** 造一个假的 multipart 文件. */
  function buildFile(): Express.Multer.File {
    return {
      originalname: 'avatar.png',
      buffer: Buffer.from('fake-bytes'),
      size: 10,
    } as unknown as Express.Multer.File;
  }

  /** 造 config (两个上传 env 都要有, 否则走"未配置"分支). */
  function buildConfig(): ConfigService {
    const values: Record<string, string> = {
      UPLOAD_STORAGE_DIR: './uploads',
      UPLOAD_PUBLIC_BASE_URL: 'http://localhost:3000',
    };
    return { get: (key: string): string | undefined => values[key] } as unknown as ConfigService;
  }

  beforeEach(() => {
    fsMocks.mkdir.mockClear();
    fsMocks.writeFile.mockClear();
    fsMocks.unlink.mockClear();
  });

  it('写文件失败 → 抛固定文案, 不含服务器绝对路径', async () => {
    fsMocks.writeFile.mockRejectedValueOnce(
      new Error(String.raw`ENOENT: no such file or directory, open 'D:\prod\mofang\uploads\avatar\x.png'`),
    );
    const { repo } = buildRepo();
    const service = new ProfileService(repo as never, buildConfig());

    let thrown: unknown;
    try {
      await service.uploadAvatar('u1', buildFile());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BizException);
    const message = (thrown as BizException).message;
    expect(message).not.toContain(String.raw`D:\prod\mofang`);
    expect(message).not.toContain('ENOENT');
    expect(message).toBe('头像文件保存失败，请稍后重试');
  });

  it('DB 写失败 → 抛固定文案, 不含表名/列名/冲突值', async () => {
    const { repo } = buildRepo({
      saveError: new Error("ER_DUP_ENTRY: Duplicate entry 'u1' for key 'user_profiles.user_profiles_pkey'"),
    });
    const service = new ProfileService(repo as never, buildConfig());

    let thrown: unknown;
    try {
      await service.uploadAvatar('u1', buildFile());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BizException);
    const message = (thrown as BizException).message;
    expect(message).not.toContain('ER_DUP_ENTRY');
    expect(message).not.toContain('user_profiles');
    expect(message).toBe('头像信息保存失败，请稍后重试');
  });
});
