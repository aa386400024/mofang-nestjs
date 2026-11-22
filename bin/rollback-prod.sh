#!/bin/bash
# ============================================================
# mofang-nestjs 快速回滚脚本
#
# 用法:
#   ./bin/rollback-prod.sh              # 退到上一个 tag (按时间倒序)
#   ./bin/rollback-prod.sh v1.0.1       # 退到指定 tag
#
# 适用场景:
#   - 新版本启动失败 (deploy-prod.sh 健康检查失败)
#   - 新版本功能 bug 紧急回退
# ============================================================

set -euo pipefail

SERVER="root@117.72.30.78"
SSH_PORT=22
SERVER_DIR="/opt/mofang-nestjs"
IMAGE_NAME="mofang-nestjs-api"

VERSION="${1:-}"

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok() { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $*"; }
err() { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*" >&2; }

# 如果没指定 tag, 自动找上一个
if [ -z "$VERSION" ]; then
  log "▶ 未指定 tag, 自动选上一个版本"
  VERSION=$(sshpass -p '0126ZHang@@' ssh -p $SSH_PORT $SERVER \
    "docker images ${IMAGE_NAME} --format '{{.Tag}}\t{{.CreatedAt}}' | \
     grep -v 'latest' | sort -k2 -r | head -1 | cut -f1" 2>/dev/null || echo "")
  if [ -z "$VERSION" ]; then
    err "找不到可回滚的 tag, 请手动指定"
    exit 1
  fi
fi

log "▶ 回滚到: ${IMAGE_NAME}:${VERSION}"

# 1. 服务器 tag 上一个版本为 latest
log "▶ 服务器操作: 重新打 latest tag + restart"
sshpass -p '0126ZHang@@' ssh -p $SSH_PORT $SERVER "
  set -e
  cd $SERVER_DIR

  # 检查目标镜像是否存在
  if ! docker images ${IMAGE_NAME}:${VERSION} --format '{{.Repository}}:{{.Tag}}' | grep -q .; then
    echo '镜像 ${IMAGE_NAME}:${VERSION} 不存在'
    exit 1
  fi

  # 打 latest tag
  docker tag ${IMAGE_NAME}:${VERSION} ${IMAGE_NAME}:latest

  # 重启容器
  docker compose -f docker-compose.prod.yml up -d

  echo '回滚完成'
"

# 2. 健康检查
log "▶ 健康检查 (等 15s)"
sleep 15

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3001/health" || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  ok "✅ 回滚成功 (HTTP $HTTP_CODE)"
else
  err "❌ 回滚后健康检查失败 (HTTP $HTTP_CODE)"
  exit 1
fi

log "  容器: mofang-nestjs-api @ ${VERSION}"