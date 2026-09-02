# syntax=docker/dockerfile:1.7

# ============================================================
# Stage 1: deps — 安装依赖 (含 dev, 用于 build)
# ============================================================
FROM node:24-alpine AS deps
WORKDIR /app

# Alpine 缺 python3 / make / g++ 的话, bcrypt / sharp 等 native module 需要
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# ============================================================
# Stage 2: build — 编译 TS → JS
# ============================================================
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build (lint + nest build)
RUN npm run build

# 把生产 deps 单独拷出来 (省体积)
RUN npm prune --omit=dev

# ============================================================
# Stage 3: prod — 运行时镜像 (最小)
# ============================================================
FROM node:24-alpine AS prod
WORKDIR /app

# 安全: 用非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# 系统依赖 (curl 用于 healthcheck, tini 用于 PID 1 信号处理)
RUN apk add --no-cache curl tini

# 拷贝产物
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/package.json ./package.json

USER nestjs

# Health check — 每 30s 探一次, 超时 5s, 失败 3 次算 down
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3000}/health || exit 1

EXPOSE 3000

# tini 处理 PID 1 信号转发 (SIGTERM / SIGINT 干净退出)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/app.js"]