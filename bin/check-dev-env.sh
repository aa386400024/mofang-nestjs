#!/bin/bash
# ============================================================
# mofang-nestjs 本地开发环境检查脚本
#
# 用法:
#   bash bin/check-dev-env.sh       # WSL/Linux 直接跑
#   或在 PowerShell 里: wsl bash bin/check-dev-env.sh
#
# 检查项:
#   1. .env 存在 + DB/Redis 配置
#   2. MySQL 可达 (DB_HOST:DB_PORT)
#   3. Redis 可达 (REDIS_HOST:REDIS_PORT)
#   4. Node 版本 (>=24)
#   5. node_modules 已装
# ============================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok() { echo -e "${GREEN}✅${NC} $*"; }
fail() { echo -e "${RED}❌${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️ ${NC} $*"; }
log() { echo -e "${BLUE}▶${NC} $*"; }

# 1. .env 检查
log "1. .env 检查"
if [ ! -f .env ]; then
  fail ".env 不存在"
  echo "   修复: cp .env.example .env && 编辑填值"
  exit 1
fi
ok ".env 存在"

# 2. Node 版本
log "2. Node 版本"
NODE_VER=$(node --version 2>&1 | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -ge 24 ] 2>/dev/null; then
  ok "Node $(node --version)"
else
  fail "Node 版本太低 (需要 >= 24, 当前 $(node --version))"
fi

# 3. node_modules
log "3. node_modules"
if [ -d node_modules ]; then
  ok "node_modules 已装"
else
  fail "node_modules 未装"
  echo "   修复: npm ci"
  exit 1
fi

# 4. MySQL 可达性
log "4. MySQL 连通性"
DB_HOST=$(grep "^DB_HOST=" .env | cut -d= -f2)
DB_PORT=$(grep "^DB_PORT=" .env | cut -d= -f2)
DB_USER=$(grep "^DB_USER=" .env | cut -d= -f2)
DB_NAME=$(grep "^DB_NAME=" .env | cut -d= -f2)

if nc -z -w 3 "$DB_HOST" "$DB_PORT" 2>/dev/null; then
  ok "MySQL $DB_HOST:$DB_PORT 可达"
  # 试连接（用 mysql client，没有就 skip）
  if command -v mysql >/dev/null 2>&1; then
    DB_PASS=$(grep "^DB_PASSWORD=" .env | cut -d= -f2-)
    if mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" \
      -e "USE $DB_NAME; SHOW TABLES;" 2>&1 | head -1 | grep -q "Tables_in_$DB_NAME"; then
      ok "MySQL auth + db '$DB_NAME' 可访问"
    else
      warn "MySQL 连接成功但 db '$DB_NAME' 不存在"
      echo "      创建: mysql -h $DB_HOST -u $DB_USER -p*** -e 'CREATE DATABASE $DB_NAME'"
      echo "      或:   npm run migration:run (会自动建表，前提是 db 存在)"
    fi
  fi
else
  fail "MySQL $DB_HOST:$DB_PORT 不可达"
  echo "   修复: 检查服务器 / docker 是否在跑"
fi

# 5. Redis 可达性
log "5. Redis 连通性"
REDIS_HOST=$(grep "^REDIS_HOST=" .env | cut -d= -f2)
REDIS_PORT=$(grep "^REDIS_PORT=" .env | cut -d= -f2)
REDIS_PASS=$(grep "^REDIS_PASSWORD=" .env | cut -d= -f2-)

if nc -z -w 3 "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
  ok "Redis $REDIS_HOST:$REDIS_PORT 可达"
  if command -v redis-cli >/dev/null 2>&1; then
    if [ -n "$REDIS_PASS" ]; then
      if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASS" PING 2>/dev/null \
        | grep -q PONG; then
        ok "Redis auth 成功"
      else
        fail "Redis auth 失败 (密码不对)"
      fi
    else
      if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" PING 2>/dev/null | grep -q PONG; then
        ok "Redis (无密码) 成功"
      fi
    fi
  fi
else
  fail "Redis $REDIS_HOST:$REDIS_PORT 不可达"
  echo "   方案 A: 本地装 redis (Memurai / redis-windows)"
  echo "   方案 B: 改 .env: REDIS_HOST=117.72.30.78 + REDIS_PASSWORD=*** (服务器密码)"
fi

echo ""
echo "=========================================="
log "下一步:"
echo "   npm run migration:run  # 一次性建表"
echo "   npm run start:dev       # 起 nest (watch)"
echo "=========================================="