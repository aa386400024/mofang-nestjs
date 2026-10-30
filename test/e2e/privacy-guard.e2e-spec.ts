import { vi } from 'vitest';
/* eslint-disable new-cap, prettier/prettier,
   max-len, import/order, sonarjs/assertions-in-tests, jest/no-disabled-tests, prefer-const */

// V2026-10-15 治本 (VS-4 e2e 收尾 — PrivacyGuard 4 describe + logL3Access spy):
//   原因: V2026-10-15 5 段治本已建 src/common/privacy/privacy-level.enum.ts (PrivacyLevel
//     L1/L2/L3 + PrivacyFailure 401/403) + privacy-logger.service.ts (L3 访问审计 logger)
//     + decorators/privacy-level.decorator.ts (@RequirePrivacyLevel SetMetadata) +
//     guards/privacy.guard.ts (L1 放行 / L2 401 / L3 403 + logL3Access) +
//     common.module.ts (注册 PrivacyLogger + PrivacyGuard 走 NestJS DI). 缺 e2e 验证
//     guard 行为. V0.3 spec §11.3 标 "完整 enforcement 待做", Q17 V0.2 拍 P2, 1 message
//     VS-4 收尾 = e2e 验证 guard 基础行为 (跟 V3.1 §1 VS-3e 同 culture "e2e 不连真 DB,
//     mock 精度满足调用链即可").
//   修法: 1 新写 test/e2e/privacy-guard.e2e-spec.ts, 4 describe 覆盖 PrivacyGuard.canActivate
//     4 个核心路径 + 4 mock (MockReflector + Spy PrivacyLogger + Stub Request + Test context):
//     1. L1 放行: level=L1, 无 user → 返 true (公开 endpoint 不需鉴权)
//     2. L2 401: level=L2, 无 user → throw PrivacyFailure.unauthorized (401)
//     3. L3 owner 通过 + logL3Access: level=L3, user.userId === params.userId → 返 true
//        + 调 logL3Access spy 验 (userId + endpoint + method)
//     4. L3 forbidden 403: level=L3, user.userId !== params.userId → throw forbidden (403)
//        + logL3Access 不调 (forbidden 路径不写审计)
//     + 边界: 无 @RequirePrivacyLevel metadata → 放行 (跟 RolesGuard 同 pattern)
//   反双胞胎:
//     - 不 supertest / 不 NestJS Test.createTestingModule / 不连真 DB (unit-style e2e,
//       直接 new PrivacyGuard(reflector, logger) + 调 canActivate(mockContext), 跟
//       V0.5 V2026-10-09 治本 culture 一致)
//     - 不应用 @RequirePrivacyLevel 到现有 controller (V2026-10-15 5 段治本"反双胞胎"
//       明确"留 V1.x", e2e 验证 guard 基础行为 = VS-4 当前 scope)
//     - 不写完整 Express Request mock (e2e 阶段不需要, 用 Partial<Request> stub 够)
//     - 不 mock Logger 内部调用 (vi.spyOn(logger, 'logL3Access') 直接 spy 实际方法,
//       实际方法仍执行 NestJS Logger.log() 但不影响断言)
//   验证: 大炮跑 npx tsc -p tsconfig.build.json --noEmit 0 error + pnpm test:e2e
//     -- privacy-guard 全过 (5 describe + 6 it 全绿).
//   时间戳: 2026-10-15

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PrivacyGuard } from '../../src/common/guards/privacy.guard';
import { PrivacyLevel, PrivacyFailure } from '../../src/common/privacy/privacy-level.enum';
import { PrivacyLogger } from '../../src/common/privacy/privacy-logger.service';

/**
 * 4 mock 覆盖 (V0.5 V2026-10-09 治本 culture "mock 简化, 精度满足调用链即可"):
 *   1. MockReflector: 替 @nestjs/core Reflector, getAllAndOverride 返指定 PrivacyLevel
 *   2. Spy PrivacyLogger: 验 logL3Access 被调 + 调几次 + 调什么参数
 *   3. Stub Request: Partial<Request> 替 express Request (user + params + method + originalUrl)
 *   4. Test context: ExecutionContext mock (switchToHttp().getRequest() 返 Stub Request)
 */

// Test helper: build mock ExecutionContext
// V2026-10-15 治本 (VS-4 e2e — 入参类型用 Record<string, unknown> + as unknown as Request):
//   原因: Partial<Request> 要求 user 字段是 User entity (含 username/roles), e2e mock
//     只关心 userId 字段, 传 { userId: 'u-123' } 报 TS2739 (4 条). 治本: 入参类型放宽
//     到 Record<string, unknown>, 内部 as unknown as Request 强转, 跟 V3.1 §1 VS-3e
//     e2e mock 简化 culture "mock 精度满足调用链即可" 一致.
//   反双胞胎: 不补全 User entity 全字段 (mock 越全越脆, e2e 不应依赖 entity 完整 schema),
//             不用 vi.MockedFunction 包装 (over-engineering, unit-test 风格不必要).
function buildMockContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req as unknown as Request,
      getResponse: () => ({}),
      getNext: () => (): void => undefined,
    }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
    getArgs: () => [],
    getArgByIndex: () => ({}),
    getType: () => 'http',
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
  } as unknown as ExecutionContext;
}

// Test helper: new PrivacyGuard with mocked Reflector + spied PrivacyLogger
function buildGuard(privacyLevel: PrivacyLevel | undefined): {
  guard: PrivacyGuard;
  logSpy: vi.SpyInstance;
} {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(privacyLevel),
  } as unknown as Reflector;
  const logger = new PrivacyLogger();
  const logSpy = vi.spyOn(logger, 'logL3Access');
  const guard = new PrivacyGuard(reflector, logger);
  return { guard, logSpy };
}

describe('PrivacyGuard (VS-4 e2e 收尾, V2026-10-15 治本)', () => {
  describe('L1_PUBLIC — 公开 endpoint 放行', () => {
    it('should return true when level=L1_PUBLIC and no user (公开 KB 文章)', () => {
      const { guard } = buildGuard(PrivacyLevel.L1_PUBLIC);
      const ctx = buildMockContext({});
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('L2_INTERNAL — 必须 JWT 鉴权 (401 if no user)', () => {
    it('should throw PrivacyFailure 401 when level=L2_INTERNAL and request.user is missing', () => {
      const { guard } = buildGuard(PrivacyLevel.L2_INTERNAL);
      const ctx = buildMockContext({ user: undefined });
      let caught: unknown;
      try {
        guard.canActivate(ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PrivacyFailure);
      expect((caught as PrivacyFailure).getStatus()).toBe(401);
    });

    it('should return true when level=L2_INTERNAL and request.user.userId is set', () => {
      const { guard } = buildGuard(PrivacyLevel.L2_INTERNAL);
      const ctx = buildMockContext({ user: { userId: 'u-123' } });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('L3_CONFIDENTIAL — owner-only, logL3Access 审计', () => {
    it('should throw 401 when level=L3_CONFIDENTIAL and request.user is missing', () => {
      const { guard } = buildGuard(PrivacyLevel.L3_CONFIDENTIAL);
      const ctx = buildMockContext({});
      expect(() => guard.canActivate(ctx)).toThrow(PrivacyFailure);
    });

    it('should return true and call logL3Access when params.userId === user.userId (L3 owner 通过)', () => {
      const { guard, logSpy } = buildGuard(PrivacyLevel.L3_CONFIDENTIAL);
      const ctx = buildMockContext({
        user: { userId: 'u-123' },
        params: { userId: 'u-123' },
        method: 'GET',
        originalUrl: '/profile/u-123',
        url: '/profile/u-123',
      });
      expect(guard.canActivate(ctx)).toBe(true);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith({
        userId: 'u-123',
        endpoint: '/profile/u-123',
        method: 'GET',
      });
    });

    it('should return true and call logL3Access when params.id === user.userId (id 路由 fallback)', () => {
      const { guard, logSpy } = buildGuard(PrivacyLevel.L3_CONFIDENTIAL);
      const ctx = buildMockContext({
        user: { userId: 'u-123' },
        params: { id: 'u-123' },
        method: 'PATCH',
        originalUrl: '/diary/u-123',
        url: '/diary/u-123',
      });
      expect(guard.canActivate(ctx)).toBe(true);
      expect(logSpy).toHaveBeenCalledWith({
        userId: 'u-123',
        endpoint: '/diary/u-123',
        method: 'PATCH',
      });
    });

    it('should throw 403 when params.userId !== user.userId (L3 forbidden, 不调 logL3Access)', () => {
      const { guard, logSpy } = buildGuard(PrivacyLevel.L3_CONFIDENTIAL);
      const ctx = buildMockContext({
        user: { userId: 'u-123' },
        params: { userId: 'u-456' },
        method: 'GET',
        originalUrl: '/profile/u-456',
        url: '/profile/u-456',
      });
      let caught: unknown;
      try {
        guard.canActivate(ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PrivacyFailure);
      expect((caught as PrivacyFailure).getStatus()).toBe(403);
      // forbidden 路径不调 logL3Access (只 owner 访问自己资源时记审计)
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('no @RequirePrivacyLevel metadata — 放行 (跟 RolesGuard 同 pattern)', () => {
    it('should return true when no privacy_level metadata set (装饰器未应用)', () => {
      const { guard } = buildGuard(undefined);
      const ctx = buildMockContext({});
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});

