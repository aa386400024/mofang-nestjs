import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import helmet from 'helmet';
import passport from 'passport';

/**
 * Express middleware 装配 (生产级配置).
 *
 * 设计:
 *   - Helmet 严格加固 (CSP / HSTS / X-Frame-Options / X-Content-Type-Options)
 *   - CORS 按 env 配置白名单 (dev 默认 *, 生产强校验)
 *   - 保留 compression 性能优化
 *   - 保留 passport session 给 /auth/* demo 路由用 (V3 删除 auth/ 时连同清理)
 *
 * 安全注意:
 *   - helmet 必须放在其他中间件前 (顺序: helmet → cors → compression → routes)
 *   - CORS credentials=true 时 origin 不能是 * (RFC 严格规定)
 *   - Session secret 生产必须改强随机 (V3 加 startup 校验)
 */
export function middleware(app: INestApplication): INestApplication {
  const isProduction = process.env.NODE_ENV === 'production';
  const logger = new Logger('Middleware');

  // 1. Helmet — 安全 HTTP headers (顺序: 必须第一)
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: [`'["self"'`],
              scriptSrc: [`'["self"'`, `'["unsafe-inline"'`],
              styleSrc: [`'["self"'`, `'["unsafe-inline"'`],
              imgSrc: [`'["self"'`, 'data:', 'https:'],
              connectSrc: [`'["self"'`],
              fontSrc: [`'["self"'`, 'data:'],
              objectSrc: [`'["none"'`],
              frameAncestors: [`'["none"'`],
              baseUri: [`'["self"'`],
              formAction: [`'["self"'`],
            },
          }
        : false,
      crossOriginEmbedderPolicy: isProduction ? { policy: 'credentialless' } : false,
      // HSTS 仅 HTTPS 启用
      strictTransportSecurity: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      // 防 MIME 嗅探
      xContentTypeOptions: true,
      // 防点击劫持
      xFrameOptions: { action: 'deny' },
      // XSS 过滤 (现代浏览器已内置, 但加上无害)
      xXssProtection: true,
      // Referrer 严格
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // 权限策略
      permittedCrossDomainPolicies: false,
    }),
  );

  // 2. CORS — 按环境配置
  const corsOrigins = (process.env.CORS_ORIGINS ?? (isProduction ? '' : '*'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowAll = corsOrigins.length === 1 && corsOrigins[0] === '*';

  app.enableCors({
    origin: allowAll ? true : corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // V2026-10-23 治本 (语音微训练 STT 代理 — CORS 补 `language` 请求头):
    //   原因: §2.2 契约里 `language` 是**自定义请求头** (BCP-47, 不是表单字段).
    //     Web 端 (Flutter Web) 跨源调 POST /counselor/practice/asr 时, 浏览器先发
    //     OPTIONS preflight, 而本白名单没列 `language` → 浏览器直接拒绝预检, 报
    //     "Request header field language is not allowed by Access-Control-Allow-Headers",
    //     POST 根本发不出去 (net::ERR_FAILED).
    //   修法: 白名单补 `language` 一项.
    //   反双胞胎:
    //     - 不改成 `*`: 显式列举是本仓既有风格, 且生产环境 origins 也是白名单制;
    //       放宽会让"到底哪些自定义头在用"失去唯一事实源 (下次再加头还是漏).
    //     - 不另加 multipart 的 Content-Type: 已被现有 `Content-Type` 覆盖
    //       (浏览器对带 boundary 的 multipart 用的是同一个白名单项).
    //     - 不加 OPTIONS 到 methods: 现有 methods 已含 OPTIONS, 且 enableCors
    //       会自动应答 preflight, 不用额外加路由.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id', 'Accept', 'language'],
    // V2026-10-23 治本 (语音微训练 STT 代理 — 暴露限流响应头):
    //   原因: 限流 guard 会打限流信息头, 但 exposedHeaders 只列了 X-Request-Id,
    //     浏览器 JS 读不到 → Web 端被 429 时无法告诉用户"还剩几次/几秒可重试".
    //   修法: 把 @nestjs/throttler 写的限流头全部列出.
    //   注意**带后缀的那几个是 STT 端点的 userId 级限流**: @nestjs/throttler 对非
    //   default 命名限流器会在头名后加 `-<限流器名>` (这里是 `-practice-asr`),
    //   也就是 `X-RateLimit-Remaining-practice-asr` 才是"当前用户还剩几次转写";
    //   不带后缀的是全局 IP 级限流 (60 次/分钟). 两组都暴露, 客户端按需取.
    //   `Retry-After` 是被限流 (429) 时才有的头, 值 = **剩余阻塞秒数**
    //   (throttler v6: Math.ceil((expiresAt - now) / 1000)), 不是时间戳 ——
    //   客户端可直接显示"还有 N 秒", 不用自己算差值.
    exposedHeaders: [
      'X-Request-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-RateLimit-Limit-practice-asr',
      'X-RateLimit-Remaining-practice-asr',
      'X-RateLimit-Reset-practice-asr',
      'Retry-After',
      'Retry-After-practice-asr',
    ],
    credentials: corsOrigins.length > 0 && !allowAll,
    maxAge: 86_400, // 24h preflight cache
  });
  logger.log(`CORS origins: ${allowAll ? '*' : corsOrigins.join(', ') || '(empty - same-origin only)'}`);

  // 3. Compression — gzip 响应
  app.use(compression());

  // 3.5 Cookie parser — V1.1.2 解析 HttpOnly JWT cookies (req.cookies.access_token / refresh_token)
  // 必须在 routes 前, JwtAuthGuard 才拿得到 req.cookies
  app.use(cookieParser());

  // 4. Passport session — 仅给 /auth/* demo 路由用 (V3 删除 auth/ 时连同清理)
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? 'tEsTeD',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: isProduction, sameSite: isProduction ? 'strict' : 'lax' },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  return app;
}
