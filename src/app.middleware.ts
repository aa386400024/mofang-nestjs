import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import compression from 'compression';
import helmet from 'helmet';
import session from 'express-session';
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
  const isProduction = process.env['NODE_ENV'] === 'production';
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
      strictTransportSecurity: isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
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
  const corsOrigins = (process.env['CORS_ORIGINS'] ?? (isProduction ? '' : '*'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowAll = corsOrigins.length === 1 && corsOrigins[0] === '*';

  app.enableCors({
    origin: allowAll ? true : corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Request-Id',
      'Accept',
    ],
    exposedHeaders: ['X-Request-Id'],
    credentials: corsOrigins.length > 0 && !allowAll,
    maxAge: 86_400, // 24h preflight cache
  });
  logger.log(`CORS origins: ${allowAll ? '*' : corsOrigins.join(', ') || '(empty - same-origin only)'}`);

  // 3. Compression — gzip 响应
  app.use(compression());

  // 4. Passport session — 仅给 /auth/* demo 路由用 (V3 删除 auth/ 时连同清理)
  app.use(
    session({
      secret: process.env['SESSION_SECRET'] ?? 'tEsTeD',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: isProduction, sameSite: isProduction ? 'strict' : 'lax' },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  return app;
}