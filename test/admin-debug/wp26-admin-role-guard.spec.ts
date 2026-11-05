// V2026-11-03 治本 (WP26 §1 P2-4 · admin-debug 命名空间加角色校验 · 单测):
//   覆盖任务单 §1 P2-4 的验收:
//     ① 普通学员 (DB admin_role = NULL / 'editor' / 'reviewer') 带有效 JWT → 403;
//     ② DB 里 admin_role = 'admin' 的账号 → 放行;
//     ③ basic 凭据正确 → 放行 (不论 DB 角色);
//     ④ basic 凭据正确但请求带的是**别的**用户 JWT → 仍按 basic 管理员放行;
//     ⑤ DB 查询抛错 → 不放行 (fail-close, 不是 2xx);
//     ⑥ 4 个端点逐个覆盖 (class 级挂 guard, 新增端点自动继承);
//     ⑦ 中间件 → guard 的执行顺序: guard 读得到中间件写在**同一个 request** 上的标记.
//
//   全 mock: 不起 Nest 容器, 不连 DB, 不发网络.
//     · 用户仓储用 stub (只回 admin_role 一列; 可配置为"查不到"或"抛错");
//     · 中间件用仓库既有 `AdminBasicAuthMiddleware` + stub JWT 守卫 (只注入身份).
//
//   验证: npx vitest run test/admin-debug/wp26-admin-role-guard.spec.ts
//   时间戳: 2026-11-03 GMT+8
import { type ExecutionContext, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AdminBasicAuthMiddleware } from '../../src/admin-debug/admin-basic-auth.middleware.js';
import { AdminDebugController } from '../../src/admin-debug/admin-debug.controller.js';
import { AdminDebugModule } from '../../src/admin-debug/admin-debug.module.js';
import { AdminInsightsController } from '../../src/admin-debug/admin-insights.controller.js';
import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { User } from '../../src/user/entities/user.entity.js';

const STUDENT_ID = 'student-a';

/**
 * 假配置服务 (只回 env 字典).
 */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

/**
 * 假响应 (记录状态码与响应体) —— 中间件 401 时会往里写.
 */
function buildResponse(): { readonly res: never; readonly state: { statusCode: number; body: unknown } } {
  const state = { statusCode: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  };
  return { res: res as never, state };
}

/**
 * 假用户仓储 (只回 `admin_role` 一列).
 *
 * 可配置三种现场: 正常返回 / 查不到用户 / 查询抛错.
 */
class StubUserRepo {
  readonly findOneCalls: { readonly where?: unknown; readonly select?: unknown }[] = [];
  /** DB 里的 admin_role 真值 (NULL = 普通学员). */
  adminRole: 'editor' | 'reviewer' | 'admin' | null = null;
  /** 用户是否存在 (false = 查不到, 含软删). */
  found = true;
  /** 查询是否抛错 (模拟 DB 故障). */
  failWith: Error | undefined;

  async findOne(options: {
    readonly where?: unknown;
    readonly select?: unknown;
  }): Promise<{ adminRole: 'editor' | 'reviewer' | 'admin' | null } | null> {
    this.findOneCalls.push(options);
    if (this.failWith) throw this.failWith;
    if (!this.found) return null;
    return { adminRole: this.adminRole };
  }
}

/**
 * 造一个只够 guard 用的最小执行上下文.
 */
function buildContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * 假 JWT 守卫 (默认"没带 token" → 抛错, 与仓库既有守卫同语义).
 */
function jwtStub(): { canActivate(): Promise<boolean> } {
  return {
    canActivate: async () => {
      throw new Error('缺少 access token');
    },
  };
}

/**
 * 假 JWT 守卫 (模拟"token 有效" —— 按仓库既有 JwtAuthGuard 的形状注入身份:
 * `{ userId, username, roles }`, 见 src/user/guards/jwt-auth.guard.ts:93-97).
 */
function jwtStubThatInjects(userId: string): { canActivate(context: ExecutionContext): Promise<boolean> } {
  return {
    canActivate: async (context: ExecutionContext) => {
      const request = context.switchToHttp().getRequest<Record<string, unknown>>();
      request.user = { userId, username: 'student', roles: [] };
      return true;
    },
  };
}

/**
 * 收集 controller 上的路由 + 每个路由的**有效** guard 集合 (class 级 + method 级).
 *
 * 为什么这么算: Nest 的 class 级 `@UseGuards` 对该类**所有** handler 生效 ——
 * 断言"有效集合"才等于断言"这个端点真的被守住了".
 *
 * @param target 控制器 (缺省 = AdminDebugController)
 * @returns 路由清单
 */
function collectRoutes(
  target: unknown = AdminDebugController,
): { readonly path: string; readonly method: number; readonly guards: unknown[] }[] {
  const controller = target as { prototype: unknown };
  const prototype = controller.prototype;
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
  const routes: { path: string; method: number; guards: unknown[] }[] = [];
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = (prototype as Record<string, unknown>)[name];
    if (typeof handler !== 'function') continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (path === undefined) continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
    routes.push({ path, method: method ?? RequestMethod.GET, guards: [...classGuards, ...methodGuards] });
  }
  return routes;
}

describe('WP26 §1 P2-4 · admin-debug 命名空间加角色校验', () => {
  describe('① 学员非 admin 角色 → 403', () => {
    it('DB 里 admin_role = NULL (普通学员) → 403 (BizCode.Forbidden / HTTP 403)', async () => {
      const repo = new StubUserRepo();
      repo.adminRole = null;
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({ user: { userId: STUDENT_ID } }))).rejects.toMatchObject({
        code: BizCode.Forbidden,
        status: 403,
      });
    });

    it("DB 里 admin_role = 'editor' → 403", async () => {
      const repo = new StubUserRepo();
      repo.adminRole = 'editor';
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({ user: { userId: STUDENT_ID } }))).rejects.toMatchObject({
        code: BizCode.Forbidden,
        status: 403,
      });
    });

    it("DB 里 admin_role = 'reviewer' → 403", async () => {
      const repo = new StubUserRepo();
      repo.adminRole = 'reviewer';
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({ user: { userId: STUDENT_ID } }))).rejects.toMatchObject({
        code: BizCode.Forbidden,
        status: 403,
      });
    });

    it('DB 里查不到该用户 (含软删) → 403', async () => {
      const repo = new StubUserRepo();
      repo.found = false;
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({ user: { userId: STUDENT_ID } }))).rejects.toMatchObject({
        code: BizCode.Forbidden,
        status: 403,
      });
    });

    it('匿名请求 (没有身份) → 403 (fail-close, 不当匿名放行)', async () => {
      const repo = new StubUserRepo();
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({}))).rejects.toMatchObject({
        code: BizCode.Forbidden,
        status: 403,
      });
    });
  });

  describe("② DB 里 admin_role = 'admin' → 放行", () => {
    it('放行, 且只读 admin_role 一列 (不把整行拉出来)', async () => {
      const repo = new StubUserRepo();
      repo.adminRole = 'admin';
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({ user: { userId: STUDENT_ID } }))).resolves.toBe(true);

      expect(repo.findOneCalls).toHaveLength(1);
      expect(repo.findOneCalls.at(0)?.where).toEqual({ uid: STUDENT_ID });
      expect(repo.findOneCalls.at(0)?.select).toEqual({ adminRole: true });
    });
  });

  describe('③ basic 凭据 → 放行 (不论 DB 角色)', () => {
    it('中间件标了 adminBasicAuth → 放行, 且根本不查 DB', async () => {
      const repo = new StubUserRepo();
      repo.adminRole = null;
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({ adminBasicAuth: true }))).resolves.toBe(true);

      expect(repo.findOneCalls).toHaveLength(0);
    });

    it('basic 凭据 + 请求带的是**别的**用户 JWT → 仍按 basic 管理员放行 (basic 是独立身份)', async () => {
      const repo = new StubUserRepo();
      repo.adminRole = null;
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({ adminBasicAuth: true, user: { userId: 'someone-else' } }))).resolves.toBe(true);

      expect(repo.findOneCalls).toHaveLength(0);
    });
  });

  describe('④ DB 查询抛错 → fail-close (不放行)', () => {
    it('查询抛错 → 403 (不是 2xx), 不是放行', async () => {
      const repo = new StubUserRepo();
      repo.failWith = new Error('db down');
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext({ user: { userId: STUDENT_ID } }))).rejects.toMatchObject({
        code: BizCode.Forbidden,
        status: 403,
      });
    });
  });

  describe('⑤ 中间件 → guard 的执行顺序 (guard 读得到中间件写的标记)', () => {
    it('中间件判 basic 凭据正确 → 同一个 request 上带 adminBasicAuth → guard 放行', async () => {
      const request: { headers: Record<string, string>; cookies: Record<string, string>; adminBasicAuth?: boolean } = {
        headers: { authorization: `Basic ${Buffer.from('ops:s3cret').toString('base64')}` },
        cookies: {},
      };
      const middleware = new AdminBasicAuthMiddleware(
        stubConfig({ ADMIN_BASIC_AUTH_USER: 'ops', ADMIN_BASIC_AUTH_PASS: 's3cret' }) as never,
        jwtStub() as never,
      );
      const { res } = buildResponse();
      let nextCalled = false;

      await middleware.use(request as never, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(request.adminBasicAuth).toBe(true);

      const repo = new StubUserRepo();
      repo.adminRole = null;
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    });

    it('中间件判学员 JWT 有效 → guard 查 DB 判非 admin → 403', async () => {
      const request: { headers: Record<string, string>; cookies: Record<string, string>; user?: unknown } = {
        headers: {},
        cookies: {},
      };
      const middleware = new AdminBasicAuthMiddleware(stubConfig({}) as never, jwtStubThatInjects(STUDENT_ID) as never);
      const { res } = buildResponse();
      let nextCalled = false;

      await middleware.use(request as never, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);

      const repo = new StubUserRepo();
      repo.adminRole = 'editor';
      const guard = new AdminRoleGuard(repo as never);

      await expect(guard.canActivate(buildContext(request))).rejects.toMatchObject({
        code: BizCode.Forbidden,
        status: 403,
      });
    });
  });

  describe('⑥ 4 个端点全部覆盖', () => {
    it('controller 类级挂了 AdminRoleGuard', () => {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, AdminDebugController) as unknown[] | undefined;

      expect(classGuards).toContain(AdminRoleGuard);
    });

    it('全部端点 (含 WP30 / WP31 新增的) 的有效 guard 都含 AdminRoleGuard', () => {
      const routes = collectRoutes();

      // V2026-11-05 (WP30): 新增 4 个只读端点 —— class 级 guard 自动继承,
      // 这里把端点清单一起列出来, 免得将来加端点时"忘了挂 guard"却没人发现.
      // V2026-11-05 (WP31): 再加 2 个成本看板端点.
      expect(routes.map((route) => route.path).sort()).toEqual([
        'characters',
        'characters/:slug',
        'characters/:slug/sessions',
        'cost/sessions',
        'cost/trend',
        'health',
        'sessions',
        'sessions/:id',
        'sessions/:id/memories',
        'sessions/:id/trajectory',
      ]);
      for (const route of routes) {
        expect(route.method).toBe(RequestMethod.GET);
        expect(route.guards).toContain(AdminRoleGuard);
      }
    });

    it('洞察面 (V2026-11-05) 的 5 个新端点也全部继承 class 级 AdminRoleGuard', () => {
      const routes = collectRoutes(AdminInsightsController);

      expect(routes.map((route) => route.path).sort()).toEqual([
        'dashboard',
        'dashboard/weekly-sessions',
        'memories',
        'psyguard',
        'psyguard/trend',
      ]);
      for (const route of routes) {
        expect(route.method).toBe(RequestMethod.GET);
        expect(route.guards).toContain(AdminRoleGuard);
      }
    });

    it('module 里注册了 AdminRoleGuard 与 User 仓储 (DI 能解析, 不会启动期 UnknownDependencies)', () => {
      const providers = Reflect.getMetadata('providers', AdminDebugModule) as unknown[] | undefined;
      expect(providers).toContain(AdminRoleGuard);

      const imports = Reflect.getMetadata('imports', AdminDebugModule) as { providers?: { provide: unknown }[] }[] | undefined;
      const userRepoToken = getRepositoryToken(User);
      expect(imports?.some((module) => (module.providers ?? []).some((provider) => provider.provide === userRepoToken))).toBe(true);
    });
  });
});
