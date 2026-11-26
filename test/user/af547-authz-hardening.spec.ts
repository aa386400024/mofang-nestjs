import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';

import { COOKIE_PATHS } from '../../src/common/security/cookie-token.js';
import { normalizeEmail } from '../../src/common/security/email-normalize.js';
import { detectImageExtension } from '../../src/common/security/image-signature.js';
import { hashOpaqueIdentifier } from '../../src/common/security/verification-code-hash.js';
import { REDIS_KEYS, SmsPurpose } from '../../src/shared/infra/redis/redis.constants.js';
import { LoginDto } from '../../src/user/dto/login.dto.js';
import { PasswordResetService } from '../../src/user/providers/password-reset.service.js';
import { buildTokenClaims } from '../../src/user/providers/user.service.js';
import { VerificationCodeService } from '../../src/user/providers/verification-code.service.js';
import { TokenType } from '../../src/user/user.constant.js';

describe('AF-547 cookie / 邮箱 / 图片魔数', () => {
  it('refresh cookie path 覆盖真实刷新端点 /user/refresh', () => {
    expect(COOKIE_PATHS.REFRESH).toBe('/user');
    expect('/user/refresh'.startsWith(COOKIE_PATHS.REFRESH)).toBe(true);
    expect('/auth/refresh'.startsWith(COOKIE_PATHS.REFRESH)).toBe(false);
  });

  it('邮箱统一 trim + 小写', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });

  it('LoginDto 拒绝非法邮箱', async () => {
    const dto = plainToInstance(LoginDto, { email: 'not-an-email', password: 'x' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });

  it('按文件头识别 JPG/PNG/WebP，伪扩展名不通过', () => {
    expect(detectImageExtension(Buffer.from('ffd8ffe000104a464946', 'hex'))).toBe('.jpg');
    expect(detectImageExtension(Buffer.from('89504e470d0a1a0a0000000d', 'hex'))).toBe('.png');
    expect(detectImageExtension(Buffer.from('524946460000000057454250', 'hex'))).toBe('.webp');
    expect(detectImageExtension(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });

  it('PII Redis key 片段稳定且不可逆', () => {
    const first = hashOpaqueIdentifier('pepper', '13800138000');
    const second = hashOpaqueIdentifier('pepper', '13800138000');
    expect(first).toBe(second);
    expect(first).not.toContain('13800138000');
    expect(first).toHaveLength(64);
  });
});

describe('AF-547 短信验证码 Redis key 不含明文手机号', () => {
  it('sendCode 写入的 code / rate-limit key 都不包含手机号', async () => {
    const redis = {
      slidingWindowAdd: vi.fn(async (..._args: unknown[]) => {}),
      slidingWindowCount: vi.fn(async (..._args: unknown[]) => 1),
      set: vi.fn(async (..._args: unknown[]) => {}),
      del: vi.fn(async (..._args: unknown[]) => 1),
    };
    const config = {
      get: vi.fn((key: string): unknown => {
        if (key === 'sms.codePepper') return 'pepper';
        if (key === 'verification') {
          return { smsRateLimitPerHour: 10, smsCodeLength: 6, smsCodeTtlMin: 5 };
        }
        return null;
      }),
      getOrThrow: vi.fn(() => 'pepper'),
    };
    const service = new VerificationCodeService(
      redis as never,
      { send: vi.fn(async () => {}) } as never,
      config as never,
      { incVerificationCodeSent: vi.fn() } as never,
    );

    await service.sendCode('13800138000', SmsPurpose.Register);

    const keys = [
      ...redis.set.mock.calls.map((call) => String(call[0])),
      ...redis.slidingWindowAdd.mock.calls.map((call) => String(call[0])),
    ];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('13800138000');
      expect(key).not.toContain('138****8000');
    }
  });
});

describe('AF-547 密码重置 token 单次消费 + 旧 token 失效', () => {
  const user = { uid: 'u1', email: 'foo@example.com' };

  function buildService(): {
    service: PasswordResetService;
    redis: {
      getdel: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      setnx: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      del: ReturnType<typeof vi.fn>;
    };
  } {
    const redis = {
      getdel: vi.fn(),
      get: vi.fn(),
      setnx: vi.fn(async () => true),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
    };
    const service = new PasswordResetService(
      { findOne: vi.fn(async () => user) } as never,
      redis as never,
      { send: vi.fn(async () => {}) } as never,
      { get: vi.fn(() => ({ passwordResetTokenTtlMin: 60 })) } as never,
      { incAuthPasswordReset: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, redis };
  }

  it('verifyToken 走 GETDEL，第二次拿不到 uid', async () => {
    const { service, redis } = buildService();
    redis.getdel.mockResolvedValueOnce('u1').mockResolvedValueOnce(null);
    await expect(service.verifyToken('token-1')).resolves.toBe('u1');
    await expect(service.verifyToken('token-1')).rejects.toThrow('重置链接无效或已过期');
    expect(redis.getdel).toHaveBeenCalledWith(REDIS_KEYS.passwordReset('token-1'));
  });

  it('requestReset 先消费旧 token 再写新 token', async () => {
    const { service, redis } = buildService();
    redis.getdel.mockResolvedValueOnce('old-token');

    await service.requestReset(' Foo@Example.COM ');

    expect(redis.getdel).toHaveBeenCalledWith(REDIS_KEYS.passwordResetByUid('u1'));
    expect(redis.del).toHaveBeenCalledWith(REDIS_KEYS.passwordReset('old-token'));
    expect(redis.set).toHaveBeenCalledTimes(2);
  });
});

describe('AF-547 JWT access token 带 roles + adminRole', () => {
  it('buildTokenClaims 生成 JwtAuthGuard / RolesGuard 可读的 claim', () => {
    const claims = buildTokenClaims(
      { uid: 'u1', phone: null, email: 'foo@example.com', adminRole: 'admin', tenantId: '' },
      'jti-1',
      TokenType.Access,
    );

    expect(claims).toMatchObject({
      sub: 'u1',
      username: 'foo@example.com',
      roles: ['user', 'admin'],
      adminRole: 'admin',
      tenantId: 'u1',
      type: TokenType.Access,
      iss: 'mofang-nestjs',
      aud: 'mofang-client',
    });
  });

  it('普通用户只有 user 角色', () => {
    const claims = buildTokenClaims({ uid: 'u2', phone: null, email: null, adminRole: null, tenantId: '' }, 'jti-2', TokenType.Access);
    expect(claims.roles).toEqual(['user']);
    expect(claims).not.toHaveProperty('adminRole');
  });
});
