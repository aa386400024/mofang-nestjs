// V2026-11-02 (已登录态首次设置密码 · POST /user/set-password):
//   覆盖任务单 §4 验收表 8 条:
//     ① 从没设过密码 + set-password → 204, 密码写入, passwordChangedAt 非空, mustChangePassword=false;
//     ② 从没设过密码 + change-password → 现有行为不变 (旧密码错);
//     ③ 已设过密码 + set-password → 400 InvalidParameter "用户已有密码, 请用改密流程";
//     ④ 已设过密码 + change-password → 现有行为不变 (改密成功 + 撤销所有 session);
//     ⑤ 新密码弱 → 400 (isStrongPassword 校验失败);
//     ⑥ set-password 成功后 → **不撤销 session** (当前设备不被踢下线);
//     ⑦ 未登录 → 401 (JwtAuthGuard);
//     ⑧ engine-core git diff 为空 (闸门实测, 不在本文件).
//
//   三层测法:
//     · **HTTP 层** (Nest testing module + supertest): 真路由 / 真守卫 / 真 ValidationPipe
//       / 真 EncryptedFieldsInterceptor —— 401 / 400 / 204 与 uid 解析全是真的;
//     · **Service 层** (真 UserService + stub 依赖): 反查 / 写入 / 审计 / 不撤销 session;
//     · **DTO + 元数据层**: 语义独立 (不复用 ChangePasswordDto) 与路由契约.
//
//   另加一条**既有事实**的钉死 (本单开工前就存在, 本单不动 guard):
//     `JwtAuthGuard` 注入 request.user 的形状是 `{ userId, username, roles }`
//     (userId = JWT payload.sub) —— 所以取 uid 的字段名是 `userId`, `sub` 取不到值.
//
//   全 mock: user 表 / session / blacklist / 审计 / 密码历史 / RSA 全用 stub;
//   不起真实容器 (不连 DB / Redis), 只起一个只有 UserController 的微型 Nest 应用.
//
//   验证: npx vitest run test/user/set-password-first-set.spec.ts
//   时间戳: 2026-11-02

import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Request } from 'express';
import supertest from 'supertest';

import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { EncryptedFieldsInterceptor } from '../../src/common/security/encrypted-fields.interceptor.js';
import { RsaKeyService } from '../../src/common/security/rsa-key.service.js';
import { hashPassword, verifyPassword } from '../../src/shared/infra/security/password-hasher.js';
import { UserController } from '../../src/user/controllers/user.controller.js';
import { ChangePasswordDto } from '../../src/user/dto/change-password.dto.js';
import { SetLoggedInPasswordDto } from '../../src/user/dto/set-password.dto.js';
import { AuditEvent } from '../../src/user/entities/audit-log.entity.js';
import { User } from '../../src/user/entities/user.entity.js';
import { JwtAuthGuard } from '../../src/user/guards/jwt-auth.guard.js';
import { JwtBlacklistService } from '../../src/user/providers/jwt-blacklist.service.js';
import { PasswordResetService } from '../../src/user/providers/password-reset.service.js';
import { SessionService } from '../../src/user/providers/session.service.js';
import { UserService } from '../../src/user/providers/user.service.js';
import { TokenType } from '../../src/user/user.constant.js';

const UID = 'uid-1';
const DB_UID = '11111111-1111-1111-1111-111111111111';
const STRONG_PASSWORD = 'NewPass123';
const WEAK_PASSWORD = '123';

/** 审计条目 (只取关心的字段). */
interface AuditEntry {
  userId: string | null;
  event: AuditEvent;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** 假的 user 表. */
function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.uid = DB_UID;
  user.email = 'student@example.com';
  user.phone = null;
  user.passwordHash = '';
  user.state = 'active' as User['state'];
  user.emailVerifiedAt = new Date();
  user.phoneVerifiedAt = null;
  user.lastLoginAt = null;
  user.passwordChangedAt = null;
  user.mustChangePassword = true;
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.deletedAt = null;
  user.tenantId = DB_UID;
  return Object.assign(user, overrides);
}

/** 装配一个被测的 UserService (依赖全 stub). */
function buildService(options: { row?: User | null } = {}): {
  readonly service: UserService;
  readonly row: User | null;
  readonly audits: AuditEntry[];
  readonly revokedByUid: string[];
  readonly blacklisted: () => number;
} {
  const row = options.row === undefined ? buildUser() : options.row;
  const audits: AuditEntry[] = [];
  const revokedByUid: string[] = [];
  let blacklisted = 0;

  const userRepo = {
    findOne: async (): Promise<User | null> => row,
    save: async (user: User): Promise<User> => user,
    create: (partial: Partial<User>): User => Object.assign(new User(), partial),
  };
  const sessionService = {
    revokeAllByUserId: async (uid: string): Promise<never[]> => {
      revokedByUid.push(uid);
      return [];
    },
  };
  const blacklist = {
    revokeMany: async (): Promise<void> => {
      blacklisted += 1;
    },
  };
  const auditLog = {
    log: async (entry: AuditEntry): Promise<void> => {
      audits.push(entry);
    },
  };
  const passwordHistory = {
    assertNotReused: async (): Promise<void> => {},
    isMinAgeViolation: (): boolean => false,
    recordOldPassword: async (): Promise<void> => {},
  };

  const service = new UserService(
    userRepo as never,
    { sign: () => 'token' } as unknown as JwtService,
    { get: () => 'secret' } as unknown as ConfigService,
    sessionService as never,
    auditLog as never,
    blacklist as never,
    passwordHistory as never,
    { sendVerification: async () => {} } as never,
    { incAuthLogin: () => {} } as never,
    { get: async () => null } as never,
  );
  return { service, row, audits, revokedByUid, blacklisted: () => blacklisted };
}

/** 假请求 (extractContext 只要 headers / ip). */
function fakeRequest(): Request {
  return {
    headers: { 'user-agent': 'jest-agent', 'x-forwarded-for': 'client-ip' },
    ip: 'client-ip',
    socket: {},
  } as unknown as Request;
}

/** 假 ExecutionContext (只提供 switchToHttp().getRequest). */
function fakeExecutionContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('已登录态首次设置密码 · POST /user/set-password', () => {
  describe('① DTO: 语义独立 + 强密码校验', () => {
    it('DTO 只有 newPassword 一个字段 (没有 oldPassword —— 与改密语义分开)', () => {
      const dto = plainToInstance(SetLoggedInPasswordDto, {});

      expect(Object.keys(dto)).toEqual(['newPassword']);
      expect('oldPassword' in dto).toBe(false);
      // 对照: 改密 DTO 必须有 oldPassword.
      expect('oldPassword' in plainToInstance(ChangePasswordDto, {})).toBe(true);
    });

    it('强密码通过校验', async () => {
      const errors = await validate(plainToInstance(SetLoggedInPasswordDto, { newPassword: STRONG_PASSWORD }));

      expect(errors).toHaveLength(0);
    });

    it('弱密码 "123" → 校验失败 (400)', async () => {
      const errors = await validate(plainToInstance(SetLoggedInPasswordDto, { newPassword: WEAK_PASSWORD }));

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]?.constraints).toHaveProperty('isStrongPassword');
    });
  });

  describe('② 路由契约: 独立路径 + JWT 鉴权 + RSA 解密 + 204', () => {
    it('路由元数据: POST user/set-password, 204, JwtAuthGuard + EncryptedFieldsInterceptor', () => {
      const handler = UserController.prototype.setLoggedInPassword;

      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('set-password');
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(204);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(JwtAuthGuard);
      expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toContain(EncryptedFieldsInterceptor);
    });

    it('与改密路由互不干扰 (两个路径都在, 各自独立)', () => {
      expect(Reflect.getMetadata(PATH_METADATA, UserController.prototype.changePassword)).toBe('change-password');
      expect(Reflect.getMetadata(PATH_METADATA, UserController.prototype.setLoggedInPassword)).toBe('set-password');
    });
  });

  describe('③ HTTP 层 (真路由 + 真守卫 + 真校验管)', () => {
    let app: INestApplication;
    /** service 收到的调用 (uid / 密码). */
    const calls: { uid: string; password: string }[] = [];
    /** service 抛错开关 (模拟"用户已有密码"). */
    let serviceError: Error | undefined;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [UserController],
        providers: [
          {
            provide: UserService,
            useValue: {
              setLoggedInPassword: async (uid: string, password: string): Promise<void> => {
                if (serviceError) throw serviceError;
                calls.push({ uid, password });
              },
              changePassword: async (): Promise<void> => {},
            },
          },
          { provide: SessionService, useValue: { revoke: async () => {} } },
          { provide: JwtBlacklistService, useValue: { revoke: async () => {}, isRevoked: async () => false } },
          { provide: PasswordResetService, useValue: { requestReset: async () => {} } },
          // JwtAuthGuard 的三个依赖.
          { provide: JwtService, useValue: { verify: () => ({ sub: UID, jti: 'jti-1', type: TokenType.Access }) } },
          { provide: ConfigService, useValue: { get: () => 'secret' } },
          // EncryptedFieldsInterceptor 的依赖 (假解密: base64 → 明文).
          {
            provide: RsaKeyService,
            useValue: { decrypt: (cipher: string) => Buffer.from(cipher, 'base64').toString('utf8') },
          },
          // 真守卫 + 真拦截器 (Nest 自己构造, 依赖上面那些 stub).
          JwtAuthGuard,
          EncryptedFieldsInterceptor,
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      // 与 app.module 的全局管道同配置 (transform + whitelist).
      app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(() => {
      calls.length = 0;
      serviceError = undefined;
    });

    it('⑦ 未登录 (无 token) → 401', async () => {
      const res = await supertest(app.getHttpServer()).post('/user/set-password').send({ newPassword: STRONG_PASSWORD });

      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it('⑤ 新密码弱 → 400 (isStrongPassword 校验失败)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/user/set-password')
        .set('Authorization', 'Bearer token-1')
        .send({ newPassword: WEAK_PASSWORD });

      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    });

    it('① 合法密码 → 204, 且 service 收到**正确的 uid** 与明文密码', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/user/set-password')
        .set('Authorization', 'Bearer token-1')
        .send({ newPassword: STRONG_PASSWORD });

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(calls).toEqual([{ uid: UID, password: STRONG_PASSWORD }]);
    });

    it('密码走 RSA: 发 newPasswordEnc → 拦截器解密成 newPassword', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/user/set-password')
        .set('Authorization', 'Bearer token-1')
        .send({ newPasswordEnc: Buffer.from(STRONG_PASSWORD, 'utf8').toString('base64') });

      expect(res.status).toBe(204);
      expect(calls).toEqual([{ uid: UID, password: STRONG_PASSWORD }]);
    });

    it('③ 已设过密码 → 400 "用户已有密码, 请用改密流程" (service 的反查原样冒泡)', async () => {
      serviceError = new BizException(BizCode.InvalidParameter, '用户已有密码, 请用改密流程');

      const res = await supertest(app.getHttpServer())
        .post('/user/set-password')
        .set('Authorization', 'Bearer token-1')
        .send({ newPassword: STRONG_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('用户已有密码, 请用改密流程');
    });
  });

  describe('④ Service 层: 复用 setInitialPassword (反查 + 写入 + 审计)', () => {
    it('① 从没设过密码 → 写入 hash, passwordChangedAt 非空, mustChangePassword=false', async () => {
      const { service, row } = buildService();

      await service.setLoggedInPassword(UID, STRONG_PASSWORD);

      expect(row?.passwordHash).toBeTruthy();
      expect(await verifyPassword(STRONG_PASSWORD, row?.passwordHash ?? '')).toBe(true);
      expect(row?.passwordChangedAt).toBeInstanceOf(Date);
      expect(row?.mustChangePassword).toBe(false);
    });

    it('③ 已设过密码 → BizException(InvalidParameter, "用户已有密码, 请用改密流程")', async () => {
      const { service } = buildService({ row: buildUser({ passwordHash: await hashPassword('OldPass123') }) });

      await expect(service.setLoggedInPassword(UID, STRONG_PASSWORD)).rejects.toBeInstanceOf(BizException);
      await expect(service.setLoggedInPassword(UID, STRONG_PASSWORD)).rejects.toMatchObject({
        code: BizCode.InvalidParameter,
        message: '用户已有密码, 请用改密流程',
      });
    });

    it('用户不存在 → UserNotFound', async () => {
      const { service } = buildService({ row: null });

      await expect(service.setLoggedInPassword(UID, STRONG_PASSWORD)).rejects.toMatchObject({
        code: BizCode.UserNotFound,
      });
    });

    it('审计: 记 user_password_first_set (与改密的 user_password_changed 分开)', async () => {
      const { service, audits } = buildService();

      await service.setLoggedInPassword(UID, STRONG_PASSWORD, { ipAddress: 'client-ip', userAgent: 'jest-agent' });

      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        userId: UID,
        event: AuditEvent.UserPasswordFirstSet,
        ipAddress: 'client-ip',
        userAgent: 'jest-agent',
      });
    });

    it('失败时**不写**审计 (已设过密码 → 只报错)', async () => {
      const { service, audits } = buildService({ row: buildUser({ passwordHash: await hashPassword('OldPass123') }) });

      await expect(service.setLoggedInPassword(UID, STRONG_PASSWORD)).rejects.toBeInstanceOf(BizException);

      expect(audits).toHaveLength(0);
    });

    it('⑥ 不撤销 session (用户是刚登录进来主动设密码的, 撤销会把自己踢下线)', async () => {
      const { service, revokedByUid, blacklisted } = buildService();

      await service.setLoggedInPassword(UID, STRONG_PASSWORD);

      expect(revokedByUid).toHaveLength(0);
      expect(blacklisted()).toBe(0);
    });
  });

  describe('②④ change-password 现有行为不变 (零回归)', () => {
    it('旧密码错 → InvalidCredentials "旧密码错误"', async () => {
      const { service } = buildService({ row: buildUser({ passwordHash: await hashPassword('OldPass123') }) });

      await expect(service.changePassword(UID, 'WrongPass123', STRONG_PASSWORD)).rejects.toMatchObject({
        code: BizCode.InvalidCredentials,
        message: '旧密码错误',
      });
    });

    it('旧密码对 → 改密成功 + 撤销所有 session + 审计 user_password_changed', async () => {
      const { service, row, audits, revokedByUid } = buildService();
      // 先设一次密码, 拿到真 hash (走真实 argon2).
      await service.setLoggedInPassword(UID, STRONG_PASSWORD);
      audits.length = 0;
      revokedByUid.length = 0;

      await service.changePassword(UID, STRONG_PASSWORD, 'Another456');

      expect(await verifyPassword('Another456', row?.passwordHash ?? '')).toBe(true);
      // 改密要撤销所有 session —— 这条**不变**.
      expect(revokedByUid).toEqual([UID]);
      // 审计事件仍是改密那档, 没被首次设置那档污染.
      expect(audits.map((entry) => entry.event)).toEqual([AuditEvent.UserPasswordChanged]);
    });
  });

  describe('鉴权上下文: 新接口取 uid 用 userId (不是 sub)', () => {
    it('守卫注入 request.user = { userId, username, roles } → 取 uid 用 userId', async () => {
      const guard = new JwtAuthGuard(
        { verify: () => ({ sub: UID, jti: 'jti-1', type: TokenType.Access }) } as unknown as JwtService,
        { get: () => 'secret' } as unknown as ConfigService,
        { isRevoked: async () => false } as never,
      );
      const request: { headers: Record<string, string>; cookies: Record<string, string>; user?: unknown } = {
        headers: { authorization: 'Bearer token-1' },
        cookies: {},
      };
      const ctx = fakeExecutionContext(request);

      await guard.canActivate(ctx);

      expect(request.user).toEqual({ userId: UID, username: '', roles: [] });
      // ⚠️ 既有事实 (本单开工前就存在, 本单**不动** guard):
      //   request.user 里没有 `sub` 字段 —— `sub` 是 JWT payload 的字段名, 不是 request.user 的.
      //   所以 `@CurrentUser('sub')` 在这个 guard 下取不到值 (本仓另外几个路由还这么写着).
      expect((request.user as Record<string, unknown>)['sub']).toBeUndefined();
      expect((request.user as Record<string, unknown>)['userId']).toBe(UID);
    });

    it('CurrentUser 装饰器: 真工厂在真实 ctx 上取 userId → 拿到 uid', () => {
      const request = { user: { userId: UID, username: '', roles: [] } };
      const ctx = fakeExecutionContext(request);

      // Nest 把自定义参数装饰器的**工厂**挂在路由参数元数据里 (键名带随机 paramtype),
      //   这里按 index 找到 uid 那一个, 用**Nest 运行时同样的口径**调它 (factory(data, ctx)).
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, UserController, 'setLoggedInPassword') as Record<
        string,
        { index: number; data: unknown; factory: (data: unknown, ctx: ExecutionContext) => unknown }
      >;
      const params = Object.values(args).filter((entry) => typeof entry?.factory === 'function');
      const uidParam = params.find((entry) => entry.index === 0);

      expect(uidParam).toBeDefined();
      // 本接口取 uid 的字段名必须是 'userId' (guard 注入的就是它) —— 钉死, 免得被改成 'sub'.
      expect(uidParam?.data).toBe('userId');
      expect(uidParam?.factory(uidParam?.data, ctx)).toBe(UID);
    });
  });
});
