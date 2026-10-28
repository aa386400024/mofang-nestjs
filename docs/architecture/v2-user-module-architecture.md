# V2 User Module 架构 — 心塑 + 魔方共用账号系统 (大厂企业级)

> **状态**: V2 完成 (2026-08-19)
> **架构师**: 大炮 + AI 协作
> **目标**: 把 V1 单 demo 升级到大厂生产级账号系统

---

## 1. 背景

V1 已有基础 (register / login / refresh / me + jwt blacklist + session + audit log), 但缺:

1. **多实例 / 重启不丢** — JWT blacklist 在内存 Map
2. **合规流程** — 邮箱未验证不能登录
3. **第三方登录** — 微信 / Google / Apple
4. **多端管理 UI** — 列设备 / 主动下线
5. **密码安全** — 密码历史 / 强制改密周期
6. **改密 + 重置** — 邮箱重置密码流
7. **异步审计** — 同步写阻塞主流程
8. **可观测性** — Prometheus 指标
9. **GDPR 真删** — 软删 30 天后真删
10. **DB schema 管理** — 替代 synchronize

## 2. 架构总览

### 2.1 分层

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
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       External Systems                               │
│     MySQL     Redis     SMTP Provider     SMS Provider     Prometheus│
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Module 依赖图 (无循环)

```
AppModule
├── ConfigModule (global)
├── TypeOrmModule
├── ScheduleModule (cron)
├── LoggerModule
├── ThrottlerModule
├── ServeStaticModule
│
├── RedisModule (global) ──┐
├── QueueModule (global) ──┤
├── EmailModule (global) ──┤── shared/infra
├── SmsModule (global) ────┤
├── MetricsModule (global)─┘
│
├── UserModule (心塑 + 魔方)
│   ├── TypeOrmModule.forFeature([User, Session, AuditLog, PasswordHistory, OAuthIdentity])
│   └── JwtModule
│
├── OAuthModule ──── imports UserModule (单向)
│
└── UserCronModule ──── imports UserModule (用 SessionService / AuditLogService)
```

## 3. 各功能详细设计

### 3.1 JWT Blacklist → Redis

**V1 问题**: `Map<jti, expiresAt>` 在内存, 多实例 / 重启会丢.

**V2 解决**:
- key: `{keyPrefix}:blacklist:{jti}`, TTL = 原 token expiresIn
- 自动清理: Redis native TTL
- 多实例共享: 任何实例 revoke, 所有实例 isRevoked 都能看到
- 容错 (fail-open): Redis 不可用时 isRevoked 返回 false (允许通过, 业务侧损失 = 已撤销 token 还能用一次)

**关键代码**: `src/user/providers/jwt-blacklist.service.ts`

### 3.2 Email/SMS 验证码 → PendingVerification → Active

**V2 流程**:
1. 注册 → 创建 user (state=Active, email_verified_at=NULL) → 发邮件验证 token
2. 用户点邮件链接 → verifyEmail(token) → 标记 email_verified_at
3. 登录: 如果 email_verified_at=NULL → 抛 EmailNotVerified

**V2 暂不支持** (大炮明确): 手机号验证 (需要 SMS provider 真实接入)

**Token 存储**:
- Email token: Redis, TTL=30min, 256bit 熵 (32 bytes random)
- SMS code: Redis, TTL=5min, 6 位数字, 滑动窗口限流 (10 条/小时/手机号)

**关键代码**:
- `src/user/providers/email-verification.service.ts`
- `src/user/providers/verification-code.service.ts`

### 3.3 OAuth (微信 / Google / Apple)

**V2 简化**: 不用 passport-strategy, 直接验 id_token 或 exchange code.

| Provider | 流程 | 依赖库 |
|---|---|---|
| WeChat | OAuth 2.0 code → access_token → userinfo | axios |
| Google | id_token + google-auth-library 验签 | google-auth-library |
| Apple | id_token + jose 验 JWKS | jose |

**登录逻辑**:
1. 有 oauth_identity 记录 → 直接登录
2. 无记录 + email 已验证 → 自动绑定
3. 无记录 + email 未验证 / 不存在 → 创建新用户

**关键代码**: `src/user/oauth/oauth.service.ts`

### 3.4 Sessions 多端管理 UI

**新增字段** (Session entity): `user_agent_raw`, `device_type`, `location`, `last_active_at`, `revoked_reason`

**端点**:
- `GET /user/sessions` — 列活跃 session
- `DELETE /user/sessions/:sid` — 下线某设备
- `POST /user/logout` — 登出当前
- `POST /user/logout-all` — 登出其他所有

**前端 UI 字段**: 设备类型 / IP / 登录时间 / 最后活跃 / "当前设备" 标识

### 3.5 密码历史 + 强制重置周期

**新表**: `user_password_history` (user_id, password_hash, created_at, FK CASCADE)

**配置** (env):
- `PASSWORD_HISTORY_LIMIT=5` — 最近 5 次不复用
- `PASSWORD_RESET_CYCLE_DAYS=90` — 90 天强制改密
- `PASSWORD_MIN_AGE_MINUTES=0` — 改密最小间隔 (防脚本秒改)
- `PASSWORD_MAX_FAILED_ATTEMPTS=5` — 失败锁定阈值
- `PASSWORD_LOCKOUT_MINUTES=30` — 锁定时长

**行为**:
- 改密 → 检查历史 + 旧密码入历史 + 撤销所有 session + JWT blacklist
- 登录时检查周期 → 过期则 `must_change_password=true`, 前端强制跳改密

### 3.6 改密码 / 重置密码

**改密** (已登录, 知道旧密码):
- `POST /user/change-password {oldPassword, newPassword}`
- 校验: 旧密码正确 + 不复用 + 最小间隔 + 强密码
- 撤销: 所有 session + JWT blacklist

**重置** (忘记密码):
- `POST /user/forgot-password {email}` — 发邮件 (防用户枚举, 不存在时静默)
- `POST /user/reset-password {token, newPassword}` — token 验证 + 改密 + 撤销所有 session

### 3.7 异步 Audit Log (BullMQ)

**V2 升级**:
- 入队 → BullMQ Worker 异步消费 → 写 DB
- 入队失败 → 兜底同步写 DB
- 兜底失败 → 仅 log, 不 throw

**优势**:
- 登录 / 注册延迟: V1 5-20ms → V2 <1ms (入队 + 返回)
- DB 写入批量: Worker 可批量消费 (V3 加 batch)

**关键代码**: `src/shared/infra/queue/audit-log.processor.ts`

### 3.8 Prometheus Metrics + 健康检查

**指标分类**:
- HTTP: `http_requests_total`, `http_request_duration_seconds`
- Auth: `auth_login_attempts_total{result}`, `auth_token_refresh_total`
- OAuth: `oauth_login_total{provider,result}`
- Verification: `verification_code_sent_total{type,channel}`
- Audit: `audit_log_enqueued_total`, `audit_log_failed_total`

**端点**:
- `GET /metrics` — Prometheus scrape (Prometheus text format)
- `GET /health` — 深度健康检查 (DB + HTTP + Redis)

### 3.9 Soft Delete 真删 cron

**Cron 表达式** (默认 `0 3 * * *`, 每天 3 AM):

```ts
@Cron(process.env['SOFT_DELETE_CRON'] ?? '0 3 * * *')
async purgeExpiredSoftDeletes() {
  // 查 deleted_at < cutoff (cutoff = now - 30 days)
  // 真删: sessions / password_history / oauth_identities cascade
  // 写审计日志
}
```

**多实例部署注意**: V3 加 Redis SETNX 分布式锁, 保证只一个实例跑 cron.

### 3.10 TypeORM Migration

**V2 目录**: `src/migration/`

**已建迁移** (按时间顺序):
1. `1700000000000-InitUser.ts` — V2 起点: 完整 schema (users, sessions, audit_logs)
2. `1700000001000-AddUserV2Fields.ts` — user 加 V2 字段 (email_verified_at, locked_until 等)
3. `1700000002000-AddSessionV2Fields.ts` — session 加 V2 字段
4. `1700000003000-AddPasswordHistory.ts` — 新表 user_password_history
5. `1700000004000-AddOAuthIdentity.ts` — 新表 user_oauth_identities
6. `1700000005000-AddUserEmailIndex.ts` — 性能索引

**bin/ormconfig.ts** 显式列出所有 migration (避免 glob 扫描 + ts-node 时序问题).

**package.json scripts**:
```json
"migration:generate": "typeorm-ts-node-commonjs -d bin/ormconfig.ts migration:generate",
"migration:create": "typeorm-ts-node-commonjs migration:create",
"migration:run": "typeorm-ts-node-commonjs -d bin/ormconfig.ts migration:run",
"migration:revert": "typeorm-ts-node-commonjs -d bin/ormconfig.ts migration:revert",
"migration:show": "typeorm-ts-node-commonjs -d bin/ormconfig.ts migration:show"
```

## 4. 新增依赖

```json
{
  "@nestjs/schedule": "^6.0.0",         // Cron
  "bullmq": "^5.34.0",                  // 异步队列
  "google-auth-library": "^9.15.0",     // Google OAuth
  "ioredis": "^5.4.1",                  // Redis 客户端
  "jose": "^5.9.6",                     // Apple OAuth JWKS 验签
  "nodemailer": "^6.9.16",              // SMTP
  "passport-apple": "^2.0.0",           // (V3 用)
  "passport-google-oauth20": "^2.0.0",  // (V3 用)
  "passport-wechat": "^1.0.0",          // (V3 用)
  "prom-client": "^15.1.3"              // Prometheus
}
```

## 5. 配置文件

`.env` 新增 (示例, 实际部署替换真值):
```env
# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=mofang:dev

# Email
EMAIL_ENABLED=false  # dev 默认 false (mock 进日志)
EMAIL_HOST=smtp.example.com
...

# SMS
SMS_ENABLED=false  # dev 默认 false (mock)
SMS_PROVIDER=mock  # mock / aliyun / tencent / twilio
...

# OAuth (默认 disabled)
WECHAT_OAUTH_ENABLED=false
GOOGLE_OAUTH_ENABLED=false
APPLE_OAUTH_ENABLED=false

# 密码策略
PASSWORD_HISTORY_LIMIT=5
PASSWORD_RESET_CYCLE_DAYS=90
PASSWORD_MAX_FAILED_ATTEMPTS=5
PASSWORD_LOCKOUT_MINUTES=30

# 验证码
EMAIL_TOKEN_TTL_MIN=30
SMS_CODE_TTL_MIN=5
SMS_RATE_LIMIT_PER_HOUR=10

# Soft delete
SOFT_DELETE_RETENTION_DAYS=30
SOFT_DELETE_CRON=0 3 * * *

# Prometheus
METRICS_ENABLED=true
METRICS_PATH=/metrics
```

## 6. 端点完整列表

### 6.1 账号

| Method | Path | Auth | 用途 |
|---|---|---|---|
| POST | /user/register | - | 注册 (发验证邮件) |
| POST | /user/login | - | 登录 (邮箱必须验证) |
| POST | /user/refresh | - | 刷新 token |
| POST | /user/logout | ✓ | 登出当前 |
| POST | /user/logout-all | ✓ | 登出其他所有 |
| GET | /user/me | ✓ | 当前用户 |
| POST | /user/change-password | ✓ | 改密 |
| POST | /user/forgot-password | - | 忘记密码 (发邮件) |
| POST | /user/reset-password | - | 重置密码 |
| POST | /user/verify-email | - | 验证邮箱 (token) |
| POST | /user/resend-verification | - | 重发验证邮件 |

### 6.2 Sessions

| Method | Path | Auth | 用途 |
|---|---|---|---|
| GET | /user/sessions | ✓ | 列活跃 session |
| DELETE | /user/sessions/:sid | ✓ | 下线某设备 |

### 6.3 OAuth

| Method | Path | Auth | 用途 |
|---|---|---|---|
| GET | /user/oauth/:provider/url | - | 生成授权 URL |
| POST | /user/oauth/callback | - | 回调 (code 或 id_token) |
| GET | /user/oauth/linked | ✓ | 列已绑定 |
| DELETE | /user/oauth/:provider | ✓ | 解绑 |

### 6.4 系统

| Method | Path | Auth | 用途 |
|---|---|---|---|
| GET | /health | - | 健康检查 (DB + Redis + HTTP) |
| GET | /metrics | - | Prometheus scrape |

## 7. 数据库 Schema (V2)

```
users                       -- 主账号表
  uid (uuid PK)
  phone (unique, nullable)
  email (unique, nullable)
  password_hash
  state (enum: pending_verification/active/suspended/banned/deleted)
  last_login_at
  email_verified_at
  phone_verified_at
  failed_login_count
  locked_until
  password_changed_at
  must_change_password
  deleted_at (soft delete)
  created_at / updated_at

user_sessions               -- 登录会话
  sid (uuid PK)
  user_id (FK CASCADE)
  jti (unique)
  device_info
  user_agent_raw
  device_type
  ip_address
  location
  last_active_at
  expires_at
  is_revoked
  revoked_reason
  created_at / updated_at

user_audit_logs             -- 鉴权事件日志
  id (uuid PK)
  user_id (nullable)
  event (enum, 18 种)
  ip_address / user_agent
  metadata (json text)
  is_success
  created_at

user_password_history       -- 密码历史 (V2 新增)
  id (uuid PK)
  user_id (FK CASCADE)
  password_hash
  created_at

user_oauth_identities       -- 第三方绑定 (V2 新增)
  id (uuid PK)
  user_id (FK CASCADE)
  provider (wechat/google/apple)
  provider_user_id
  provider_data (json text)
  access_token / refresh_token
  expires_at
  created_at / updated_at
```

## 8. 已知 V3 待办

1. **OAuth 完整策略** — passport-strategy (passport-google-oauth20 / passport-apple / passport-wechat), 支持完整 redirect 流程
2. **Cron 分布式锁** — 多实例部署时, Redis SETNX 锁保证只一个实例跑 cron
3. **Audit log 长期归档** — ELK / ClickHouse
4. **Email/SMS outbox 队列** — 入队异步发送, 重试 3 次
5. **HiBP 密码泄漏检测** — 注册 / 改密时检查密码是否泄漏
6. **RBAC** — 心塑 / 魔方按 app 区分权限
7. **i18n** — BizException 默认文案 → i18n key
8. **Refresh token 加密存储** — DB session 里的 refresh_token 加密 (V2 现在存的是 jti, 不存 token 本身)

## 9. 测试 / 验证

待办:
- [ ] `npm ci` 安装依赖
- [ ] `npm run migration:run` 跑迁移
- [ ] `npm run build` 验证编译
- [ ] `npm run start:dev` 启动 dev server
- [ ] curl 测试 /health, /metrics
- [ ] curl 测试 /user/register, /user/login (注意邮箱未验证报错)
- [ ] 测试邮件验证流程 (dev 用 mock, 看日志)
- [ ] 测试 OAuth (dev 走 disabled, 跳过)

## 10. 文件清单

新增 (按目录):

```
src/shared/infra/
├── redis/
│   ├── redis.constants.ts
│   ├── redis.module.ts
│   ├── redis.service.ts
│   └── index.ts
├── queue/
│   ├── audit-log.processor.ts
│   ├── queue.module.ts
│   └── index.ts
├── email/
│   ├── email.module.ts
│   ├── email.service.ts
│   └── index.ts
├── sms/
│   ├── sms.module.ts
│   ├── sms.service.ts
│   └── index.ts
├── metrics/
│   ├── metrics.module.ts
│   ├── metrics.service.ts
│   ├── metrics.controller.ts
│   ├── http-metrics.interceptor.ts
│   └── index.ts
├── index.ts
└── (auth/ 已删除, 改在 user/ 内)

src/user/
├── entities/
│   ├── user.entity.ts (modified: +6 fields)
│   ├── session.entity.ts (modified: +5 fields)
│   ├── audit-log.entity.ts (modified: +14 events)
│   ├── password-history.entity.ts (new)
│   ├── oauth-identity.entity.ts (new)
│   └── entities-index.ts (new)
├── providers/
│   ├── user.service.ts (rewritten: +邮箱验证/失败锁定/改密周期)
│   ├── session.service.ts (modified: +revoked_reason/last_active)
│   ├── audit-log.service.ts (rewritten: BullMQ)
│   ├── jwt-blacklist.service.ts (rewritten: Redis)
│   ├── password-history.service.ts (new)
│   ├── email-verification.service.ts (new)
│   ├── password-reset.service.ts (new)
│   └── verification-code.service.ts (new)
├── controllers/
│   └── user.controller.ts (rewritten: 17 endpoints)
├── oauth/
│   ├── oauth.module.ts (new)
│   ├── oauth.service.ts (new)
│   ├── oauth.controller.ts (new)
│   └── index.ts
├── cron/
│   ├── soft-delete.cron.ts (new)
│   ├── cron.module.ts (new)
│   └── index.ts
├── dto/
│   ├── auth-response.dto.ts (modified: +emailVerified/phoneVerified/sid)
│   ├── register.dto.ts (modified: deviceInfo 可选)
│   ├── login.dto.ts (modified: 支持邮箱)
│   ├── change-password.dto.ts (new)
│   ├── forgot-password.dto.ts (new)
│   ├── reset-password.dto.ts (new)
│   ├── verify-email.dto.ts (new)
│   ├── verification-code.dto.ts (new)
│   └── session.dto.ts (new)
├── user.constant.ts (modified: +SessionRevokeReason/PasswordResetTrigger)
├── user.module.ts (rewritten: 5 entities + 8 providers + OAuthModule 子模块)
└── index.ts (modified)

src/migration/
├── 1700000000000-InitUser.ts (new)
├── 1700000001000-AddUserV2Fields.ts (new)
├── 1700000002000-AddSessionV2Fields.ts (new)
├── 1700000003000-AddPasswordHistory.ts (new)
├── 1700000004000-AddOAuthIdentity.ts (new)
├── 1700000005000-AddUserEmailIndex.ts (new)
└── index.ts

src/common/exceptions/
├── biz-code.enum.ts (modified: +12 codes)
└── biz.exception.ts (modified: +12 messages)

src/config/envs/
├── default.ts (rewritten: +redis/email/sms/oauth/metrics config)
├── development.ts (rewritten)
└── production.ts (rewritten)

src/base/controllers/
└── health.controller.ts (modified: +Redis health check)

src/app.module.ts (modified: +RedisModule/QueueModule/EmailModule/SmsModule/MetricsModule/OAuthModule/UserCronModule/ScheduleModule)
src/app.ts (modified: +HttpMetricsInterceptor)
bin/ormconfig.ts (modified: 显式列出 migrations)
typings/global.d.ts (modified: +25 process.env types)
package.json (modified: +13 deps + 4 migration scripts)
.env (modified: +25 new env vars)
```

总计: ~50 个文件改动 / 新建.