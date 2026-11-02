// V2026-11-02 (忘记密码重置 · POST /auth/reset-password):
//   覆盖任务单 §5 验收 7 条:
//     ① 正确验证码 + 新密码 → 204, 密码已更新, passwordChangedAt 刷新;
//     ② 验证码错误 → 400, 密码不变;
//     ③ 邮箱不存在 → 400, 不泄露"邮箱不存在";
//     ④ 新密码太弱 → 400, isStrongPassword 拦截;
//     ⑤ 重置成功后旧 session 全部失效 (所有 session 已撤销);
//     ⑥ 重置后用新密码登录 → 成功 (新密码真的生效了);
//     ⑦ engine-core git diff 为空 (闸门实测, 不在本文件).
//
//   三层测法:
//     · **HTTP 层** (Nest testing module + supertest): 真路由 / 真守卫缺省无 / 真 ValidationPipe
//       / 真 EncryptedFieldsInterceptor —— 204 / 400 / RSA 解密 / 不需要 JWT 全是真的;
//     · **Service 层** (真 V2 UserService + stub 依赖): 改密 / 撤销 session / 审计 / 防枚举;
//     · **边界**: 防枚举的"验证码错"与"邮箱不存在"必须**响应逐字相同**.
//
//   全 mock: Redis 验证码 / email / session / blacklist / 审计 / 密码历史 / RSA 全用 stub;
//   不起真实容器 (不连 DB / Redis).
//
//   验证: npx vitest run test/base/auth-reset-password.spec.ts
//   时间戳: 2026-11-02

import type { INestApplication } from '@nestjs/common';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Request } from 'express';
import supertest from 'supertest';

import { AuthService } from '../../src/auth/auth.service.js';
import { LoginCodeService } from '../../src/auth/login-code.service.js';
import { AuthController } from '../../src/base/controllers/auth.controller.js';
import { ResetPasswordDto } from '../../src/base/dto/reset-password.dto.js';
import { RsaKeyService } from '../../src/common/security/rsa-key.service.js';
import { hashPassword, verifyPassword } from '../../src/shared/infra/security/password-hasher.js';
import { AuditEvent } from '../../src/user/entities/audit-log.entity.js';
import { User } from '../../src/user/entities/user.entity.js';
import { UserService } from '../../src/user/providers/user.service.js';

const EMAIL = 'student@example.com';
const CODE = '123456';
const NEW_PASSWORD = 'NewPass123';
const WEAK_PASSWORD = '123';

/** 审计条目 (只取关心的字段). */
interface AuditEntry {
  userId: string | null;
  event: AuditEvent;
  metadata?: Record<string, unknown>;
}

/** 假的 user 表. */
function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.uid = '11111111-1111-1111-1111-111111111111';
  user.email = EMAIL;
  user.phone = null;
  user.passwordHash = '';
  user.state = 'active' as User['state'];
  user.emailVerifiedAt = new Date();
  user.phoneVerifiedAt = null;
  user.lastLoginAt = null;
  user.passwordChangedAt = null;
  user.mustChangePassword = false;
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.deletedAt = null;
  user.tenantId = '11111111-1111-1111-1111-111111111111';
  return Object.assign(user, overrides);
}

/** 装配一个被测的 V2 UserService (依赖全 stub). */
function buildService(options: { row?: User | null } = {}): {
  readonly service: UserService;
  readonly row: User | null;
  readonly audits: AuditEntry[];
  readonly revokedByUid: string[];
  readonly blacklisted: () => number;
  readonly reuseChecks: string[];
  readonly historyWrites: { uid: string; hash: string }[];
} {
  const row = options.row === undefined ? buildUser() : options.row;
  const audits: AuditEntry[] = [];
  const revokedByUid: string[] = [];
  const reuseChecks: string[] = [];
  const historyWrites: { uid: string; hash: string }[] = [];
  let blacklisted = 0;

  const userRepo = {
    findOne: async (): Promise<User | null> => row,
    save: async (user: User): Promise<User> => user,
    create: (partial: Partial<User>): User => Object.assign(new User(), partial),
  };
  const sessionService = {
    revokeAllByUserId: async (uid: string): Promise<{ jti: string; expiresAtMs: number }[]> => {
      revokedByUid.push(uid);
      return [{ jti: 'jti-1', expiresAtMs: 1_800_000_000_000 }];
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
    assertNotReused: async (uid: string): Promise<void> => {
      reuseChecks.push(uid);
    },
    isMinAgeViolation: (): boolean => false,
    recordOldPassword: async (uid: string, hash: string): Promise<void> => {
      historyWrites.push({ uid, hash });
    },
  };

  const service = new UserService(
    userRepo as never,
    { sign: () => 'token' } as never,
    { get: () => 'secret' } as never,
    sessionService as never,
    auditLog as never,
    blacklist as never,
    passwordHistory as never,
    { sendVerification: async () => {} } as never,
    { incAuthLogin: () => {}, incAuthPasswordReset: () => {} } as never,
    { get: async () => null } as never,
  );
  return { service, row, audits, revokedByUid, blacklisted: () => blacklisted, reuseChecks, historyWrites };
}

describe('忘记密码重置 · POST /auth/reset-password', () => {
  describe('① HTTP 层 (真路由 + 真校验管 + 真解密拦截器)', () => {
    let app: INestApplication;
    /** service 收到的调用 (email / 明文密码). */
    const calls: { email: string; password: string }[] = [];
    /** 验证码校验结果开关. */
    let codeOk = true;
    /** service 返 null (模拟邮箱不存在). */
    let userMissing = false;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: { jwtSign: () => ({}) } },
          {
            provide: LoginCodeService,
            useValue: {
              verify: async (): Promise<boolean> => codeOk,
            },
          },
          {
            provide: UserService,
            useValue: {
              resetPasswordByEmail: async (email: string, password: string): Promise<User | null> => {
                if (userMissing) return null;
                calls.push({ email, password });
                return buildUser();
              },
            },
          },
          // EncryptedFieldsInterceptor 的依赖 (假解密: base64 → 明文).
          {
            provide: RsaKeyService,
            useValue: { decrypt: (cipher: string) => Buffer.from(cipher, 'base64').toString('utf8') },
          },
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
      codeOk = true;
      userMissing = false;
    });

    it('① 正确验证码 + 合法密码 → 204, 且 service 收到 email 与**明文**密码', async () => {
      const res = await supertest(app.getHttpServer()).post('/auth/reset-password').send({
        email: EMAIL,
        code: CODE,
        newPassword: NEW_PASSWORD,
      });

      expect(res.status).toBe(204);
      expect(calls).toEqual([{ email: EMAIL, password: NEW_PASSWORD }]);
      // 不发新 token —— 响应体里没有任何凭证.
      expect(res.body).toEqual({});
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('密码走 RSA: 发 newPasswordEnc → 拦截器解密成 newPassword', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          email: EMAIL,
          code: CODE,
          newPasswordEnc: Buffer.from(NEW_PASSWORD, 'utf8').toString('base64'),
        });

      expect(res.status).toBe(204);
      expect(calls).toEqual([{ email: EMAIL, password: NEW_PASSWORD }]);
    });

    it('不需要 JWT (不带任何 token 也能调通)', async () => {
      const res = await supertest(app.getHttpServer()).post('/auth/reset-password').send({
        email: EMAIL,
        code: CODE,
        newPassword: NEW_PASSWORD,
      });

      expect(res.status).toBe(204);
    });

    it('② 验证码错误 → 400, 且**不碰**改密', async () => {
      codeOk = false;

      const res = await supertest(app.getHttpServer()).post('/auth/reset-password').send({
        email: EMAIL,
        code: '000000',
        newPassword: NEW_PASSWORD,
      });

      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    });

    it('③ 邮箱不存在 → 400, 且与"验证码错误"的响应**逐字相同** (防枚举)', async () => {
      codeOk = false;
      const wrongCode = await supertest(app.getHttpServer()).post('/auth/reset-password').send({
        email: 'nobody@example.com',
        code: '000000',
        newPassword: NEW_PASSWORD,
      });

      codeOk = true;
      userMissing = true;
      const unknownEmail = await supertest(app.getHttpServer()).post('/auth/reset-password').send({
        email: 'nobody@example.com',
        code: CODE,
        newPassword: NEW_PASSWORD,
      });

      expect(unknownEmail.status).toBe(400);
      expect(unknownEmail.body).toEqual(wrongCode.body);
    });

    it('④ 新密码太弱 → 400 (isStrongPassword 拦截), 不碰 service', async () => {
      const res = await supertest(app.getHttpServer()).post('/auth/reset-password').send({
        email: EMAIL,
        code: CODE,
        newPassword: WEAK_PASSWORD,
      });

      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    });

    it('路由契约: POST auth/reset-password, 204, 无 JWT 守卫', () => {
      const handler = AuthController.prototype.resetPassword;

      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('reset-password');
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(204);
      // 不需要 JWT —— 路由上**不能**挂鉴权守卫.
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
    });
  });

  describe('② DTO 校验', () => {
    it('合法 body 通过校验', async () => {
      const errors = await validate(plainToInstance(ResetPasswordDto, { email: EMAIL, code: CODE, newPassword: NEW_PASSWORD }));

      expect(errors).toHaveLength(0);
    });

    it('弱密码 → 校验失败', async () => {
      const errors = await validate(plainToInstance(ResetPasswordDto, { email: EMAIL, code: CODE, newPassword: WEAK_PASSWORD }));

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]?.constraints).toHaveProperty('isStrongPassword');
    });

    it('验证码必须是 6 位', async () => {
      const errors = await validate(plainToInstance(ResetPasswordDto, { email: EMAIL, code: '12345', newPassword: NEW_PASSWORD }));

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('③ Service 层: 改密 + 撤销所有 session + 审计', () => {
    it('① 密码已更新 (新密码能验过), passwordChangedAt 刷新, mustChangePassword=false', async () => {
      const { service, row } = buildService({ row: buildUser({ passwordHash: await hashPassword('OldPass123') }) });

      const user = await service.resetPasswordByEmail(EMAIL, NEW_PASSWORD);

      expect(user).not.toBeNull();
      expect(await verifyPassword(NEW_PASSWORD, row?.passwordHash ?? '')).toBe(true);
      expect(row?.passwordChangedAt).toBeInstanceOf(Date);
      expect(row?.mustChangePassword).toBe(false);
    });

    it('⑤ 撤销该用户**所有** session + blacklist (旧登录态全部失效)', async () => {
      const { service, revokedByUid, blacklisted } = buildService();

      await service.resetPasswordByEmail(EMAIL, NEW_PASSWORD);

      expect(revokedByUid).toHaveLength(1);
      expect(revokedByUid[0]).toBe('11111111-1111-1111-1111-111111111111');
      expect(blacklisted()).toBe(1);
    });

    it('记审计 user_password_reset_completed + 指标 (跟邮件 token 流程同款)', async () => {
      const { service, audits } = buildService();

      await service.resetPasswordByEmail(EMAIL, NEW_PASSWORD);

      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ event: AuditEvent.UserPasswordResetCompleted });
      expect(audits[0]?.metadata).toMatchObject({ via: 'email_code' });
    });

    it('③ 邮箱不存在 → 返 null (**不抛错**, 防枚举由调用方统一文案)', async () => {
      const { service, audits, revokedByUid } = buildService({ row: null });

      const user = await service.resetPasswordByEmail('nobody@example.com', NEW_PASSWORD);

      expect(user).toBeNull();
      expect(audits).toHaveLength(0);
      expect(revokedByUid).toHaveLength(0);
    });

    it('密码复用检查被调用 (跟邮件 token 流程同款: 最近 5 次不许复用)', async () => {
      const { service, reuseChecks } = buildService();

      await service.resetPasswordByEmail(EMAIL, NEW_PASSWORD);

      expect(reuseChecks).toEqual(['11111111-1111-1111-1111-111111111111']);
    });

    it('旧密码进历史 (防立即复用)', async () => {
      const { service, row, historyWrites } = buildService();

      await service.resetPasswordByEmail(EMAIL, NEW_PASSWORD);

      expect(historyWrites).toHaveLength(1);
      expect(historyWrites[0]?.uid).toBe('11111111-1111-1111-1111-111111111111');
      // 入历史的是**旧** hash, 不是刚写进去的新 hash.
      expect(historyWrites[0]?.hash).not.toBe(row?.passwordHash);
    });
  });
});
