# V2 部署步骤 — 心塑 + 魔方共用账号系统

> **完成时间**: 2026-08-19
> **架构师**: 大炮 + AI 协作

## 1. 安装依赖

```bash
cd /mnt/e/Work/Project/backend/mofang-nestjs
npm ci
```

新增依赖 (~13 个):
- `@nestjs/schedule` (cron)
- `bullmq` (异步队列)
- `ioredis` (Redis 客户端)
- `prom-client` (Prometheus)
- `nodemailer` (SMTP)
- `google-auth-library` (Google OAuth)
- `jose` (Apple OAuth JWKS)
- `passport-wechat`, `passport-google-oauth20`, `passport-apple` (V3 用, 已装)
- `axios` 已存在

## 2. 启动 Redis

```bash
# Docker
docker run -d --name mofang-redis -p 6379:6379 redis:7-alpine

# 或 apt/yum 安装 redis-server, 跑 redis-server --daemonize yes
```

## 3. 配置 .env

`.env` 已经写好 dev 默认值, 检查 REDIS_HOST 等:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=mofang:dev

EMAIL_ENABLED=false  # dev 默认 mock (进日志)
SMS_ENABLED=false    # dev 默认 mock
WECHAT_OAUTH_ENABLED=false  # dev 默认 false
```

生产部署: 改真值, 设强密码.

## 4. 跑迁移

```bash
# 查看所有 migration 状态
npm run migration:show

# 跑全部
npm run migration:run

# 如果有错, 回滚
npm run migration:revert

# 单个 migration 文件可改用 typeorm migration:create 生成
```

迁移按时间顺序:
1. `1700000000000-InitUser` — V2 起点 schema (users / sessions / audit_logs)
2. `1700000001000-AddUserV2Fields` — user 加 V2 字段
3. `1700000002000-AddSessionV2Fields` — session 加 V2 字段
4. `1700000003000-AddPasswordHistory` — 新表 user_password_history
5. `1700000004000-AddOAuthIdentity` — 新表 user_oauth_identities
6. `1700000005000-AddUserEmailIndex` — 性能索引

## 5. 启动 dev server

```bash
npm run start:dev
```

启动日志应该显示:
- `Redis connected: 127.0.0.1:6379/0`
- `Email SMTP ...` (如果 EMAIL_ENABLED=true)
- `AuditLogProcessor started: queue=audit-log`
- `Nest application successfully started`

## 6. 验证端点

```bash
# 健康检查 (DB + Redis + HTTP)
curl http://localhost:3000/health

# Prometheus metrics
curl http://localhost:3000/metrics | head -30

# 注册 (dev 用 mock email, 看日志)
curl -X POST http://localhost:3000/user/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"MyP@ssw0rd"}'

# 登录 (邮箱未验证会报错 EmailNotVerified)
curl -X POST http://localhost:3000/user/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"MyP@ssw0rd"}'

# 重发验证邮件 (mock 进日志)
curl -X POST http://localhost:3000/user/resend-verification \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com"}'
```

## 7. 部署到生产

### 7.1 服务器清单

- 服务器: `117.72.30.78` (mystudy.cloud)
- 已有: nginx + pm2 + ebook-reader (Node 24)
- 需新增: Redis (7+)

### 7.2 部署命令

```bash
# 在服务器上
ssh root@117.72.30.78

# 1. 安装 Redis (Debian/Ubuntu)
apt update && apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server
# 设密码: redis-cli CONFIG SET requirepass 'STRONG_PASSWORD'

# 2. 部署 mofang-nestjs
mkdir -p /opt/mofang-nestjs
cd /opt/mofang-nestjs
git clone <repo> .
npm ci --production

# 3. 写 .env (强密码 + 真 secrets)
cat > .env <<EOF
NODE_ENV=production
PORT=3000
DB_HOST=127.0.0.1
... (其他)
EOF

# 4. 跑迁移
npm run migration:run

# 5. 启动 (pm2)
pm2 start dist/app.js --name mofang-nestjs
pm2 save
pm2 startup

# 6. 配 nginx 反向代理 + HTTPS
# /etc/nginx/sites-available/mofang.conf
# ...
nginx -t && nginx -s reload
```

### 7.3 监控

- Prometheus scrape: `GET /metrics` (Prometheus.yml 加 scrape config)
- 健康检查: `GET /health` (LB / k8s probe)
- 日志: `pino` JSON 进 stdout → pm2 收集 → 后续接入 ELK

## 8. 故障排查

### 8.1 启动报 "Redis ECONNREFUSED"

检查 `REDIS_HOST` / `REDIS_PORT` 是否对, Redis 是否启动.

### 8.2 启动报 "Cannot find module 'ioredis'"

跑 `npm ci` 重新装依赖.

### 8.3 启动报 "Cannot find module '@nestjs/schedule'"

同上.

### 8.4 /health 返回 redis: down

Redis 不可用. 检查 Redis 是否在跑 + 网络是否通.

### 8.5 邮件不进收件箱

`EMAIL_ENABLED=false` → mock 模式, 邮件进应用日志 (不真发).
设 `EMAIL_ENABLED=true` + 填 SMTP credentials 才能真发.

### 8.6 OAuth 登录 500

检查对应 provider 的 env (`WECHAT_APP_ID` / `GOOGLE_CLIENT_ID` 等) 是否填对.
`WECHAT_OAUTH_ENABLED=false` → 抛 OAuthProviderError.

### 8.7 跑迁移失败 "Cannot find entity"

确认 `bin/ormconfig.ts` 的 `entities` path 是否对 (默认 `src/entity/**/*.{js,ts}`).
新 entity 在 `src/user/entities/`, 已通过 `autoLoadEntities: true` 自动加载.

## 9. V3 路线图

1. **OAuth passport-strategy** — 完整 redirect 流程
2. **Cron 分布式锁** — 多实例防重复跑
3. **Audit log ELK 归档** — 长期分析
4. **Email/SMS outbox 队列** — 异步发送 + 重试
5. **HIBP 密码泄漏** — 注册 / 改密时检测
6. **RBAC** — 心塑 / 魔方按 app 区分权限
7. **i18n** — BizException 错误码 → i18n 文案