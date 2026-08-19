# mofang-nestjs — 心塑 + 魔方共用账号系统

> **生产级 NestJS 后端** — 心塑 (Flutter app) + 魔方 (Electron + Vue3) 共用账号 / 鉴权 / 多端管理 / OAuth
>
> **架构师**: 大炮 + AI · **状态**: V2 完成 (2026-08-19)

---

## ✨ 核心能力 (V2)

| 模块 | 能力 |
|---|---|
| **账号** | 注册 / 登录 / 刷新 / 改密 / 重置 / 邮箱验证 / 失败锁定 / 改密周期 |
| **Sessions** | 多端登录管理 UI (列设备 / 主动下线 / 撤销原因审计) |
| **OAuth** | 微信 / Google / Apple 三方登录 + 绑定 / 解绑 |
| **JWT 安全** | Redis blacklist (跨实例) + Refresh rotation + Fail-open 容错 |
| **异步审计** | BullMQ 队列 + Worker + 兜底同步 + Prometheus 埋点 |
| **观测** | Prometheus 指标 + /metrics 端点 + Grafana dashboard + Sentry 异常上报 |
| **部署** | Dockerfile + docker-compose + CI (GitHub Actions) + Husky pre-commit |
| **DB** | TypeORM Migration 替代 synchronize (可回滚) + Soft delete cron (GDPR) |

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Controllers (HTTP)                            │
│  /user/*  /user/oauth/*  /metrics  /health  (auth, session, verify) │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Domain Services                                │
│  UserService  SessionService  EmailVerification  PasswordReset       │
│  PasswordHistoryService  VerificationCodeService  OAuthService      │
│  JwtBlacklistService  AuditLogService                               │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Shared Infrastructure (基础设施层)                       │
│  RedisService  BullMQ (audit)  Email (SMTP)  SMS  Prometheus        │
│  Observability (Sentry)  Metrics  Interceptors                       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       External Systems                               │
│     MySQL     Redis     SMTP Provider     SMS Provider     Prometheus│
└─────────────────────────────────────────────────────────────────────┘
```

详见 [`docs/architecture/v2-user-module-architecture.md`](docs/architecture/v2-user-module-architecture.md)

## 📁 项目结构

```
mofang-nestjs/
├── src/
│   ├── auth/              # ⚠️ catsmiaow demo (passport + cookie session), 上线后删
│   ├── user/              # ⭐ V2 真生产 (JWT + Redis + 多端 + OAuth)
│   │   ├── entities/      # User / Session / AuditLog / PasswordHistory / OAuthIdentity
│   │   ├── providers/     # UserService / SessionService / JwtBlacklistService / ...
│   │   ├── controllers/   # 17 个端点 + 路由级限流
│   │   ├── oauth/         # 微信/Google/Apple 三方登录
│   │   ├── cron/          # 软删 30 天真删
│   │   ├── dto/           # 10 个 DTO
│   │   └── user.module.ts
│   ├── shared/infra/      # ⭐ V2 基础设施层
│   │   ├── redis/         # Redis 客户端 + Key 模板
│   │   ├── queue/         # BullMQ 异步队列
│   │   ├── email/         # SMTP
│   │   ├── sms/           # 4 provider 适配
│   │   ├── metrics/       # Prometheus 指标 + interceptor
│   │   └── observability/ # Sentry
│   ├── common/            # 全局公共 (exceptions / filters / decorators / validators)
│   ├── config/            # 配置层 (envs + ConfigService)
│   ├── migration/         # ⭐ V2 TypeORM migrations (6 个)
│   ├── base/              # 健康检查 (重写过)
│   ├── debug/             # ⚠️ demo (上线后删)
│   ├── gql/               # ⚠️ GraphQL demo (上线后删)
│   ├── sample/            # ⚠️ CRUD demo (上线后删)
│   ├── shared/foobar/     # ⚠️ demo (上线后删)
│   └── shared/user/       # ⚠️ mock user (上线后删)
├── docker/                # docker-compose 配置 + Prometheus + Grafana
├── docs/
│   ├── architecture/      # 架构 SPEC
│   └── adr/               # ⭐ Architecture Decision Records
├── test/e2e/              # Jest E2E 测试
├── bin/ormconfig.ts       # TypeORM data source
├── .github/workflows/     # CI
├── .husky/                # pre-commit hooks
├── Dockerfile             # 多阶段构建 (alpine + tini + 健康检查)
├── docker-compose.yml     # 全栈编排
└── .env.example           # 环境变量模板
```

## 🚀 快速开始

### 本地开发

```bash
# 1. 装依赖
npm ci

# 2. 启动依赖服务 (MySQL + Redis)
docker compose up -d mysql redis

# 3. 跑迁移
npm run migration:run

# 4. 配置 .env
cp .env.example .env
# 编辑 .env: DB_HOST=mysql / REDIS_HOST=redis / JWT_SECRET=...

# 5. 启动 dev
npm run start:dev

# 6. 验证
curl http://localhost:3000/health
curl http://localhost:3000/metrics | head -30
```

### 生产部署

```bash
# 1. 配强密码 + 真 secrets
cp .env.example .env
# 改 JWT_SECRET, DB_PASSWORD, REDIS_PASSWORD, SENTRY_DSN 等

# 2. 全栈启动 (含 Prometheus + Grafana)
docker compose --profile monitoring up -d

# 3. 跑迁移 (独立)
docker compose exec api npm run migration:run

# 4. 健康检查
curl http://localhost:3000/health
# {"status":"ok",...}

# 5. 监控
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3001 (admin / <GRAFANA_PASSWORD>)
```

详见 [`docs/architecture/V2_SETUP.md`](docs/architecture/V2_SETUP.md)

## 📋 端点清单

### 账号 (11)

| Method | Path | Auth | Rate Limit | 用途 |
|---|---|---|---|---|
| POST | /user/register | - | 5/min | 注册 |
| POST | /user/login | - | 5/min | 登录 (邮箱必须验证) |
| POST | /user/refresh | - | 10/min | 刷新 token |
| POST | /user/logout | ✓ | 30/min | 登出当前 |
| POST | /user/logout-all | ✓ | 30/min | 登出其他 |
| GET | /user/me | ✓ | 60/min | 当前用户 |
| POST | /user/change-password | ✓ | 10/min | 改密 + 撤销所有 session |
| POST | /user/forgot-password | - | 5/min | 发邮件 (防枚举) |
| POST | /user/reset-password | - | 5/min | token + 新密码 |
| POST | /user/verify-email | - | 10/min | 验证 token |
| POST | /user/resend-verification | - | 5/min | 重发验证邮件 |

### Sessions (2)

| Method | Path | Auth | Rate Limit | 用途 |
|---|---|---|---|---|
| GET | /user/sessions | ✓ | 60/min | 列活跃 session |
| DELETE | /user/sessions/:sid | ✓ | 30/min | 下线某设备 |

### OAuth (4)

| Method | Path | Auth | 用途 |
|---|---|---|---|
| GET | /user/oauth/:provider/url | - | 生成授权 URL |
| POST | /user/oauth/callback | - | 回调 (code 或 id_token) |
| GET | /user/oauth/linked | ✓ | 列已绑定 |
| DELETE | /user/oauth/:provider | ✓ | 解绑 |

### 系统 (2)

| Method | Path | Auth | 用途 |
|---|---|---|---|
| GET | /health | - | DB + Redis + HTTP 健康检查 |
| GET | /metrics | - | Prometheus scrape |

## 📊 监控指标 (Prometheus)

### HTTP

- `http_requests_total{method, route, code}`
- `http_request_duration_seconds{method, route, code}`

### Auth

- `auth_login_attempts_total{result}` (success / failed / locked / expired_password)
- `auth_token_refresh_total{result}` (success / failed / revoked)
- `auth_password_reset_total{result}` (requested / completed / expired / invalid)

### OAuth

- `oauth_login_total{provider, result}` (success / failed / linked)

### Audit

- `audit_log_enqueued_total{event}`
- `audit_log_failed_total{event, phase}` (enqueue / process)

### Verification

- `verification_code_sent_total{type, channel}`

### Grafana Dashboard

预置 [`docker/grafana/dashboards/mofang-overview.json`](docker/grafana/dashboards/mofang-overview.json)，包含 RPS / P99 延迟 / 错误率 / 登录尝试 / OAuth / 审计日志 / CPU+内存 7 个面板。

## 🔐 安全要点

| 维度 | 实现 |
|---|---|
| 密码 | bcrypt (10 rounds) |
| 密码历史 | 最近 5 次不复用 |
| 强制改密 | 90 天周期 |
| 失败锁定 | 5 次失败锁 30 分钟 |
| 邮箱验证 | 注册后必须验证才能登录 |
| JWT | access 15min + refresh 7d + rotation |
| Blacklist | Redis 跨实例 + TTL 自动清理 + fail-open |
| Helmet | CSP / HSTS / X-Frame-Options / X-Content-Type-Options |
| CORS | 白名单 (生产严格, dev 允许 `*`) |
| Rate Limit | 鉴权路由分级 (login 5/min, register 5/min, refresh 10/min) |
| Audit Log | 异步队列 + 18 种事件类型 |
| GDPR | 软删 30 天后真删 (cron) |

## 🛠️ 常用命令

```bash
# 开发
npm run start:dev          # watch 模式启动
npm run start:debug        # debug 模式 (--inspect)
npm run start:repl         # REPL 模式

# 测试
npm test                   # 单元测试
npm run test:e2e           # E2E (需 mysql + redis)

# 代码质量
npm run lint               # eslint
npm run lint:fix           # eslint 自动修
npm run format             # 格式化

# DB
npm run migration:generate # 自动生成 migration
npm run migration:run      # 跑迁移
npm run migration:revert   # 回滚
npm run migration:show     # 看状态

# 构建
npm run build              # nest build
npm start                  # 运行 dist

# Docker
docker compose up -d mysql redis           # 仅依赖
docker compose --profile monitoring up -d  # 全栈
docker compose exec api npm run migration:run
```

## 📚 文档

- [V2 架构 SPEC](docs/architecture/v2-user-module-architecture.md) — 完整设计
- [V2 部署指南](docs/architecture/V2_SETUP.md) — 部署 + 故障排查
- [ADR-0001 JWT vs Cookie Session](docs/adr/0001-jwt-vs-cookie-session.md)
- [ADR-0002 异步审计日志](docs/adr/0002-async-audit-log-via-bullmq.md)
- [ADR-0003 TypeORM Migration](docs/adr/0003-typeorm-migration-replace-synchronize.md)

## 🗺️ 路线图

- [x] V1 (2026-08-18 之前): 基础 register/login/refresh/me
- [x] V2 (2026-08-19): Redis blacklist / OAuth / 邮箱验证 / 密码历史 / Prometheus / Migration / Sessions
- [ ] V3: Redis Sentinel / Cron 分布式锁 / ELK 归档 / HIBP 密码检测 / OAuth passport-strategy
- [ ] V4: 心塑业务模块 (psychology) + 魔方业务模块 (moyin) + 共用计费 (billing)

## ⚠️ 上线清理清单 (V3 必做)

上线前删 demo 代码（保留作 V2 历史参考）：

- [ ] `src/auth/` (passport + cookie session demo)
- [ ] `src/base/controllers/auth.controller.ts` (`/login /logout /check /jwt/*`)
- [ ] `src/sample/` (CRUD demo)
- [ ] `src/debug/` (debug module)
- [ ] `src/gql/` (GraphQL demo)
- [ ] `src/shared/foobar/`, `src/shared/user/`
- [ ] `src/entity/sampledb1/`, `src/entity/sampledb2/`
- [ ] `test/e2e/local-auth.spec.ts`, `test/e2e/jwt-auth.spec.ts`
- [ ] `bin/entity.ts` (entity 同步生成脚本)
- [ ] package.json: 删 `passport-*` `express-session` `@nestjs/passport` `passport` `typeorm-model-generator`

删完应该剩 50% 文件，纯净 V2 真生产。

## 📜 License

MIT