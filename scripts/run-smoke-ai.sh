#!/usr/bin/env bash
# V2026-09-04 治本: 一键跑 smoke-ai-engine 的前置 + 执行.
#
# 用法: ./scripts/run-smoke-ai.sh
# 退出码: 同 smoke 脚本 (0=PASS, 1=DIST 缺, 2=启动超时, ...)
#
# 阶段:
#   0. 检查前置 (node version, dist, mysql, redis)
#   1. 类型校验 (不阻断, 仅警告; build 已包含)
#   2. build (如必要)
#   3. docker mysql + redis 健康检查
#   4. 跑 smoke

set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() { printf "\n${GREEN}==== %s ====${NC}\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; exit 1; }

# ---- 阶段 0: 前置检查 ----
step "0/5: 前置检查"

# Node version (engines >= 24, loadEnvFile 内置要求 21.7+)
node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$node_ver" -lt 21 ]; then
  fail "Node >= 21.7 required (loadEnvFile). 当前: $(node -v)"
fi
printf "Node %s OK\n" "$(node -v)"

# .env 存在?
if [ ! -f "$ROOT/.env" ]; then
  fail ".env 不存在. 先: cp .env.example .env + 编辑填 key"
fi
printf ".env OK\n"

# docker 可用?
if ! command -v docker >/dev/null 2>&1; then
  fail "docker 不可用. 手工起 MySQL/Redis 或装 docker"
fi
printf "docker OK\n"

# ---- 阶段 1: 类型校验 ----
step "1/5: 类型校验"
npx tsc -p tsconfig.build.json --noEmit 2>&1 | tail -5
tsc_exit=${PIPESTATUS[0]}
if [ "$tsc_exit" -ne 0 ]; then
  fail "tsc 失败 exit=$tsc_exit. 修源码后再跑"
fi
printf "tsc exit=0 OK\n"

# ---- 阶段 2: build ----
step "2/5: build"
if [ ! -f "$ROOT/dist/app.js" ]; then
  printf "跑 npm run build ...\n"
  npm run build
  if [ ! -f "$ROOT/dist/app.js" ]; then
    fail "build 后 dist/app.js 仍不存在"
  fi
fi
printf "dist/app.js OK\n"

# ---- 阶段 3: 服务健康 ----
step "3/5: docker 服务"

# 默认连 .env 里的地址 (或 127.0.0.1)
DB_HOST_CHECK="${DB_HOST:-127.0.0.1}"
REDIS_HOST_CHECK="${REDIS_HOST:-127.0.0.1}"

# mysql 探活 (用 timeout 5s, nc 不在时降级用 python)
check_port() {
  local host="$1"
  local port="$2"
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 3 "$host" "$port" 2>/dev/null
    return $?
  fi
  python3 -c "import socket,sys; s=socket.socket(); s.settimeout(3); s.connect(('$host',$port)); s.close()" 2>/dev/null
  return $?
}

if check_port "$DB_HOST_CHECK" 3306; then
  printf "MySQL %s:3306 OK\n" "$DB_HOST_CHECK"
else
  warn "MySQL $DB_HOST_CHECK:3306 未监听. 启动 docker compose mysql"
  docker compose up -d mysql
  sleep 5
  for i in $(seq 1 30); do
    if check_port "$DB_HOST_CHECK" 3306; then
      break
    fi
    sleep 2
  done
  if ! check_port "$DB_HOST_CHECK" 3306; then
    fail "MySQL 启动失败. 看 docker compose logs mysql"
  fi
fi

if check_port "$REDIS_HOST_CHECK" 6379; then
  printf "Redis %s:6379 OK\n" "$REDIS_HOST_CHECK"
else
  warn "Redis $REDIS_HOST_CHECK:6379 未监听. 启动 docker compose redis"
  docker compose up -d redis
  sleep 3
  if ! check_port "$REDIS_HOST_CHECK" 6379; then
    fail "Redis 启动失败. 看 docker compose logs redis"
  fi
fi

# Qdrant 可选
if check_port "${QDRANT_URL_HOST:-127.0.0.1}" 6333; then
  printf "Qdrant OK (RAG 启用)\n"
else
  warn "Qdrant 未监听 — V2 RAG 软降级, 跳"
fi

# ---- 阶段 4: smoke ----
step "4/5: 跑 smoke-ai-engine"
node scripts/smoke-ai-engine.cjs
smoke_exit=$?

step "5/5: 完成"
if [ "$smoke_exit" -eq 0 ]; then
  printf "${GREEN}[PASS] smoke exit 0${NC}\n"
else
  printf "${RED}[FAIL] smoke exit %s${NC}\n" "$smoke_exit"
  cat <<EOF
退出码对照:
  1=dist 缺  2=启动超时  3=register  4=Redis token
  5=verify-email  6=login  7=profile  8=profile upsert
  9=recommend  10=emergency upsert  11=emergency list
  12=chat (没配 LLM key 是 SKIP, 不算 fail)
  13=子进程异常退出
EOF
fi
exit "$smoke_exit"