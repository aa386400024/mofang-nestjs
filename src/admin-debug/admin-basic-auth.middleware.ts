// V2026-10-30 治本 (WP19-R · /admin/api 鉴权中间件):
//   职责: 给 `/admin/api/*` 补上**访问控制** —— basic auth (管理员) / 学员 JWT (学员),
//         并把"这次请求是谁"交给下游 (会话列表按人过滤).
//   边界: 只做"你是谁 / 你能不能进"; 不做权限系统, 不做角色表, 不改任何业务数据.
//
//   为什么必须有这层 (WP19 交付时漏掉的):
//     WP19 的 `/admin/api/*` 整条路由**零鉴权** —— 任何人都能拉到全部学员的
//     会话逐字稿 (含咨询内容). 调试器是内测期的眼睛, 但"眼睛"不等于"大门敞开".
//
//   两种访问身份 (互斥, 不叠加):
//     ① **管理员**: `Authorization: Basic base64(user:pass)`.
//        env `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASS` **两个都配**才生效;
//        配了就必须带凭据 —— 无凭据 / 凭据错误 → 401.
//        管理员**不过滤**会话列表 (调试器要看全场).
//     ② **学员**: 带产品自己的 access token (HttpOnly cookie 或 Bearer header).
//        学员只看得到**自己**的会话.
//
//   为什么"两个 env 都配才生效" (而不是配一个就生效):
//     配一半 = 运营以为开了鉴权, 实际没开 —— 那比明确没开更危险.
//     所以口径是"要么两个都配 (开), 要么两个都没配 (关)", 中间态一律按"关"处理
//     并打 warn, 让人看见自己没配全.
//
//   缺省态 (两个 env 都没配) 的行为:
//     · dev 口径 (WP19 原单: "dev 裸奔") → 放行, 但**带 token 的请求仍按学员处理**
//       (有身份就按身份隔离, 不会因为"没开 basic auth"就把学员的隔离也关掉);
//     · prod 口径 → 同样放行, 但**打 warn**: 这条路由零防护, 必须有人看见.
//
//   反双胞胎:
//     - 不新造第 4 套鉴权体系: 学员身份直接复用仓库既有 `JwtAuthGuard`
//       (cookie / Bearer + 黑名单), 不自己解 JWT.
//     - 不做角色 / 权限系统: 管理员与否只看"有没有 basic 凭据", 不查 users.admin_role.
//     - 不静默降级: 带 token 但 token 无效 → 401 (不把"看起来已登录"的请求
//       当成匿名放行 —— 那等于给伪造请求开后门).
//     - 不在中间件里查业务数据: 只解析身份, 数据过滤在 controller 里做.

import { Injectable, Logger, type ExecutionContext, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { COOKIE_NAMES } from '../common/security/cookie-token.js';
import { JwtAuthGuard } from '../user/guards/jwt-auth.guard.js';

/**
 * 带调试标记的请求 (admin/api 的身份解析结果挂在这里).
 *
 * 为什么 `Omit<Request, 'user'>`: Express 的 `Request.user` 走的是 passport 的
 * 全局 `User` 类型 (空接口), 与仓库实际注入的 `{ userId, username, roles }`
 * 形状对不上 —— 这里重定义它, 让"这次请求是谁"有**一个**明确类型.
 */
export type AdminDebugRequest = Omit<Request, 'user'> & {
  /** 请求带的是**管理员** basic 凭据 (true = 不过滤会话列表). */
  adminBasicAuth?: boolean;
  /** 学员身份 (由仓库既有 JwtAuthGuard 注入). */
  user?: { userId?: string; username?: string; roles?: string[] };
};

/**
 * basic auth 账号口令 (两个 env 都配才非空).
 */
export interface BasicAuthCredentials {
  readonly user: string;
  readonly pass: string;
}

/**
 * `/admin/api/*` 访问控制中间件 (WP19-R).
 */
@Injectable()
export class AdminBasicAuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AdminBasicAuthMiddleware.name);
  /** 是否已经打过"未开启鉴权"的告警 (同一进程只打一次, 免得每个请求刷屏). */
  private warned = false;

  constructor(
    private readonly config: ConfigService,
    private readonly jwtAuth: JwtAuthGuard,
  ) {}

  /**
   * 解析访问身份并决定放行 / 401.
   *
   * @param req 请求
   * @param res 响应
   * @param next 下一个中间件
   */
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const request = req as AdminDebugRequest;
    const configured = this.readConfiguredCredentials();
    const provided = extractBasicCredentials(req);

    // ① 带了 basic 头 → 只按 basic 判 (凭据错就是错, 不再回落到学员身份).
    if (provided) {
      if (configured && matchesCredentials(provided, configured)) {
        request.adminBasicAuth = true;
        next();
        return;
      }
      unauthorized(res, 'basic auth 凭据错误');
      return;
    }

    // ② 没带 basic 头 → 试学员身份 (仓库既有 JWT 口径: cookie / Bearer + 黑名单).
    const hasToken = hasJwtCredential(req);
    try {
      await this.jwtAuth.canActivate(buildHttpContext(req));
      next();
      return;
    } catch {
      // 带 token 却验不过 → 401 (不把"看起来已登录"的请求当匿名放行).
      if (hasToken) {
        unauthorized(res, '身份凭据无效或已过期');
        return;
      }
      // 没带 token → 落到下面的匿名分支 (这里的异常只是"本来就没 token").
    }

    // ③ 匿名请求: basic auth 没开 → 放行 (dev 裸奔口径), 但必须让人看见.
    if (configured) {
      unauthorized(res, '缺少访问凭据');
      return;
    }
    next();
  }

  /**
   * 读 env 里的 basic auth 账号口令.
   *
   * 口径: **两个都非空**才算配了; 只配一个 = 配错 → 按"没配"处理.
   *
   * @returns 配好了则返回账号口令, 否则 undefined
   */
  private readConfiguredCredentials(): BasicAuthCredentials | undefined {
    const user = (this.config.get<string>('ADMIN_BASIC_AUTH_USER') ?? '').trim();
    const pass = (this.config.get<string>('ADMIN_BASIC_AUTH_PASS') ?? '').trim();
    if (user.length === 0 && pass.length === 0) {
      this.warnOnce('ADMIN_BASIC_AUTH_USER / ADMIN_BASIC_AUTH_PASS 都没配 —— /admin/api/* 当前零鉴权 (仅限本地调试环境)');
      return undefined;
    }
    if (user.length === 0 || pass.length === 0) {
      this.warnOnce('ADMIN_BASIC_AUTH_USER / ADMIN_BASIC_AUTH_PASS 只配了一半 —— 按"未开启鉴权"处理, 请两个都配');
      return undefined;
    }
    return { user, pass };
  }

  /**
   * 打一次 warn (同一进程只打一次, 免得每个请求刷屏).
   *
   * @param message 告警文案
   */
  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(message);
  }
}

/**
 * 401 响应 (沿用仓库统一响应体: code / message / data).
 *
 * @param res 响应
 * @param message 提示文案
 */
function unauthorized(res: Response, message: string): void {
  res.status(401).json({ code: BizCode.Unauthorized, message, data: null });
}

/**
 * 从请求里取 basic 凭据 (有 `Authorization: Basic` 才算).
 *
 * @param req 请求
 * @returns 凭据; 没有 basic 头 → undefined
 */
export function extractBasicCredentials(req: Request): BasicAuthCredentials | undefined {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return undefined;
  const encoded = header.slice('Basic '.length).trim();
  if (encoded.length === 0) return undefined;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return undefined;
  }
  const separator = decoded.indexOf(':');
  if (separator === -1) return undefined;
  return { user: decoded.slice(0, separator), pass: decoded.slice(separator + 1) };
}

/**
 * 常量时间比较 (防时序攻击).
 *
 * 为什么先哈希再比: `timingSafeEqual` 要求等长, 直接比长度不同的串会抛.
 * 先各取一次 SHA-256 → 恒等长 → 再常量时间比.
 *
 * @param left 左值
 * @param right 右值
 * @returns 是否相等
 */
export function safeEquals(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

/**
 * 凭据是否匹配 (账号与口令都要对).
 *
 * @param provided 请求带来的凭据
 * @param configured env 配的凭据
 * @returns 是否匹配
 */
function matchesCredentials(provided: BasicAuthCredentials, configured: BasicAuthCredentials): boolean {
  return safeEquals(provided.user, configured.user) && safeEquals(provided.pass, configured.pass);
}

/**
 * 请求是否带了学员 token (cookie 或 Bearer).
 *
 * @param req 请求
 * @returns 是否带了 token
 */
export function hasJwtCredential(req: Request): boolean {
  const cookies = (req.cookies ?? {}) as Record<string, string>;
  if (typeof cookies[COOKIE_NAMES.ACCESS_TOKEN] === 'string' && cookies[COOKIE_NAMES.ACCESS_TOKEN].length > 0) return true;
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ');
}

/**
 * 造一个只够 `JwtAuthGuard` 用的最小执行上下文.
 *
 * @param req 请求
 * @returns 执行上下文
 */
function buildHttpContext(req: Request): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}
