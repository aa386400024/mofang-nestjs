// AF-570 · 认证链路密码状态语义与验证码限流加固
//
//   钉死的四件事:
//     ① send-code 与 check-email 同档 5 req/min/IP，不能只靠同邮箱 60 秒冷却；
//     ② 空 hash / OAuth 占位值一律“无可用密码”，verify-code 不再返回 hasPassword=true；
//     ③ OAuth 占位账号可以首次设密码，真实已设密码账号仍被拒绝；
//     ④ login-password 对无密码账号对外仍统一 InvalidCredentials，但不计数、不锁定、不抛 500。
//
//   验证: pnpm exec vitest run test/user/af570-auth-password-semantics.spec.ts
//   时间戳: 2026-11-27

import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthController } from '../../src/base/controllers/auth.controller.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { hasUsablePasswordHash, hashPassword, verifyPassword } from '../../src/shared/infra/security/password-hasher.js';
import { User } from '../../src/user/entities/user.entity.js';
import { AuditEvent } from '../../src/user/enums/audit-event.enum.js';
import { UserService } from '../../src/user/providers/user.service.js';
import { buildUserEntityStub, buildUserServiceStub, STUB_USER_EMAIL, STUB_USER_UID } from '../helpers/user-stub.js';

vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

vi.mock('bullmq', async () => {
  const { createBullmqStub } = await import('../helpers/sdk-stubs.js');
  return createBullmqStub();
});

const OAUTH_SENTINEL = '!OAUTH_NO_PASSWORD!';
const STRONG_PASSWORD = 'NewPass123';

/** 假 Request：verifyCode 只取 IP / UA。 */
function fakeRequest(): Request {
  return {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'af570-test' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
}

describe('AF-570 · 可用密码哈希统一判定', () => {
  it.each(['', '!OAUTH_NO_PASSWORD!', '!', 'not-a-hash'])('不可用哈希 %j → false', (stored) => {
    expect(hasUsablePasswordHash(stored)).toBe(false);
  });

  it('null → false', () => {
    expect(hasUsablePasswordHash(null)).toBe(false);
  });

  it('真实 argon2 哈希 → true', async () => {
    const hash = await hashPassword(STRONG_PASSWORD);

    expect(hasUsablePasswordHash(hash)).toBe(true);
  });

  it('空值 / OAuth 占位 / 损坏哈希走 verifyPassword 都 fail-closed，不抛异常', async () => {
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
    await expect(verifyPassword('anything', OAUTH_SENTINEL)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
  });

  it('真实哈希仍能正确校验', async () => {
    const hash = await hashPassword(STRONG_PASSWORD);

    await expect(verifyPassword(STRONG_PASSWORD, hash)).resolves.toBe(true);
    await expect(verifyPassword('WrongPass123', hash)).resolves.toBe(false);
  });
});

describe('AF-570 · send-code 与 check-email 同档限流', () => {
  it('send-code 路由元数据为 5 req/min/IP', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', AuthController.prototype.sendCode)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', AuthController.prototype.sendCode)).toBe(60_000);
  });

  it('check-email 仍是 5 req/min/IP（对照，不回归）', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', AuthController.prototype.checkEmail)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', AuthController.prototype.checkEmail)).toBe(60_000);
  });
});

describe('AF-570 · verify-code.hasPassword 语义', () => {
  function buildVerifyController(user: User): AuthController {
    const userService = {
      findByEmail: async (): Promise<User> => user,
      markEmailVerified: async (): Promise<void> => {},
      createPasswordlessUser: async (): Promise<User> => user,
      buildAuthResponse: async (): Promise<unknown> => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresIn: 900,
        refreshExpiresIn: 86_400,
      }),
    };
    return new AuthController({ verify: async (): Promise<boolean> => true } as never, userService as never, {} as never);
  }

  it('OAuth 占位账号 → hasPassword=false（不再把占位值当已设密码）', async () => {
    const controller = buildVerifyController(buildUserEntityStub({ passwordHash: OAUTH_SENTINEL }));

    const result = await controller.verifyCode(fakeRequest(), { email: STUB_USER_EMAIL, code: '123456' });

    expect(result.hasPassword).toBe(false);
  });

  it('空 hash 的验证码账号 → hasPassword=false', async () => {
    const controller = buildVerifyController(buildUserEntityStub({ passwordHash: '' }));

    const result = await controller.verifyCode(fakeRequest(), { email: STUB_USER_EMAIL, code: '123456' });

    expect(result.hasPassword).toBe(false);
  });

  it('真实已设密码账号 → hasPassword=true', async () => {
    const controller = buildVerifyController(buildUserEntityStub({ passwordHash: await hashPassword(STRONG_PASSWORD) }));

    const result = await controller.verifyCode(fakeRequest(), { email: STUB_USER_EMAIL, code: '123456' });

    expect(result.hasPassword).toBe(true);
  });
});

describe('AF-570 · 首次设密码语义', () => {
  it('OAuth 占位账号可以首次设密码', async () => {
    const row = buildUserEntityStub({ passwordHash: OAUTH_SENTINEL });
    const { service } = buildUserServiceStub({ row });

    await service.setInitialPassword(STUB_USER_UID, STRONG_PASSWORD);

    expect(hasUsablePasswordHash(row.passwordHash)).toBe(true);
    await expect(verifyPassword(STRONG_PASSWORD, row.passwordHash)).resolves.toBe(true);
  });

  it('真实已设密码账号仍被拒绝', async () => {
    const row = buildUserEntityStub({ passwordHash: await hashPassword('OldPass123') });
    const { service } = buildUserServiceStub({ row });

    await expect(service.setInitialPassword(STUB_USER_UID, STRONG_PASSWORD)).rejects.toMatchObject({
      code: BizCode.InvalidParameter,
      message: '用户已有密码, 请用改密流程',
    });
  });

  it('已登录态 set-password 对 OAuth 占位账号放行，对真实密码账号 400', async () => {
    const oauthRow = buildUserEntityStub({ passwordHash: OAUTH_SENTINEL });
    const setInitialPassword = vi.fn(async (): Promise<void> => {});
    const oauthController = new AuthController(
      {} as never,
      {
        findByUid: async (): Promise<User> => oauthRow,
        setInitialPassword,
      } as never,
      {} as never,
    );

    await expect(oauthController.setPassword(STUB_USER_UID, { password: STRONG_PASSWORD })).resolves.toEqual({
      success: true,
    });
    expect(setInitialPassword).toHaveBeenCalledWith(STUB_USER_UID, STRONG_PASSWORD);

    const passwordRow = buildUserEntityStub({ passwordHash: await hashPassword('OldPass123') });
    const passwordController = new AuthController(
      {} as never,
      { findByUid: async (): Promise<User> => passwordRow, setInitialPassword } as never,
      {} as never,
    );

    await expect(passwordController.setPassword(STUB_USER_UID, { password: STRONG_PASSWORD })).rejects.toMatchObject({
      status: 400,
    });
    expect(setInitialPassword).toHaveBeenCalledTimes(1);
  });
});

describe('AF-570 · login-password 对无密码账号不计数、不锁定', () => {
  interface LoginHarness {
    readonly service: UserService;
    readonly row: User;
    readonly saves: User[];
    readonly audits: { event: AuditEvent; metadata?: Record<string, unknown> }[];
  }

  function buildLoginHarness(row: User): LoginHarness {
    const saves: User[] = [];
    const audits: { event: AuditEvent; metadata?: Record<string, unknown> }[] = [];
    const userRepo = {
      findOne: async (): Promise<User> => row,
      save: async (user: User): Promise<User> => {
        saves.push(user);
        return user;
      },
    };
    const config = {
      get: (key: string): unknown => (key === 'password' ? { maxFailedAttempts: 5, lockoutMinutes: 30 } : 'secret'),
    };
    const auditLog = {
      log: async (entry: { event: AuditEvent; metadata?: Record<string, unknown> }): Promise<void> => {
        audits.push(entry);
      },
    };
    const service = new UserService(
      userRepo as never,
      { sign: (): string => 'token' } as never,
      config as never,
      { revokeAllByUserId: async (): Promise<unknown[]> => [] } as never,
      auditLog as never,
      { revokeMany: async (): Promise<void> => {} } as never,
      { isPasswordExpired: (): boolean => false } as never,
      { sendVerification: async (): Promise<void> => {} } as never,
      { incAuthLoginAttempt: (): void => {} } as never,
      { get: async (): Promise<null> => null } as never,
    );
    return { service, row, saves, audits };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['空 hash', ''],
    ['OAuth 占位', OAUTH_SENTINEL],
    ['损坏哈希', 'not-a-hash'],
  ])('%s → 统一 InvalidCredentials，不计数不锁定不写库', async (_label, passwordHash) => {
    const harness = buildLoginHarness(buildUserEntityStub({ passwordHash, failedLoginCount: 4 }));

    await expect(harness.service.login({ email: STUB_USER_EMAIL, password: 'Anything123' })).rejects.toMatchObject({
      code: BizCode.InvalidCredentials,
    });

    expect(harness.row.failedLoginCount).toBe(4);
    expect(harness.row.lockedUntil).toBeNull();
    expect(harness.saves).toHaveLength(0);
    expect(harness.audits).toHaveLength(1);
    expect(harness.audits[0]).toMatchObject({
      event: AuditEvent.UserLoginFailed,
      metadata: { reason: 'password_not_set' },
    });
  });

  it('真实密码错仍按原失败计数与锁定策略走', async () => {
    const harness = buildLoginHarness(buildUserEntityStub({ passwordHash: await hashPassword(STRONG_PASSWORD), failedLoginCount: 0 }));

    await expect(harness.service.login({ email: STUB_USER_EMAIL, password: 'WrongPass123' })).rejects.toMatchObject({
      code: BizCode.InvalidCredentials,
    });

    expect(harness.row.failedLoginCount).toBe(1);
    expect(harness.saves).toHaveLength(1);
    expect(harness.audits[0]).toMatchObject({
      event: AuditEvent.UserLoginFailed,
      metadata: { reason: 'bad_password' },
    });
  });

  it('无密码账号即使已累计 4 次失败也不会被第 5 次锁死', async () => {
    const harness = buildLoginHarness(buildUserEntityStub({ passwordHash: OAUTH_SENTINEL, failedLoginCount: 4 }));

    await expect(harness.service.login({ email: STUB_USER_EMAIL, password: 'Anything123' })).rejects.toMatchObject({
      code: BizCode.InvalidCredentials,
    });

    expect(harness.row.failedLoginCount).toBe(4);
    expect(harness.row.lockedUntil).toBeNull();
  });

  it('不新增“未设密码”业务码：对外仍只返回 11_002', async () => {
    const harness = buildLoginHarness(buildUserEntityStub({ passwordHash: '' }));

    await expect(harness.service.login({ email: STUB_USER_EMAIL, password: 'Anything123' })).rejects.toBeInstanceOf(BizException);
    await expect(harness.service.login({ email: STUB_USER_EMAIL, password: 'Anything123' })).rejects.toMatchObject({
      code: 11_002,
    });
  });
});
