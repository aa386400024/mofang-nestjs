#!/bin/bash
# ============================================================
# mofang-nestjs 生产部署脚本 (2 核 2G 服务器)
#
# 用法:
#   ./bin/deploy-prod.sh                # latest tag (默认)
#   ./bin/deploy-prod.sh v1.0.1         # 指定版本 tag
#   ./bin/deploy-prod.sh v1.0.1 --skip-build  # 跳过 build, 只上传已有镜像
#
# 流程 (本地):
#   1. 本地 build 镜像 (npm ci + tsc 已经跑过, docker 只复制 dist)
#   2. save 镜像到 tarball
#   3. scp 到服务器
#   4. 服务器 load 镜像
#   5. docker compose up -d (滚动重启)
#   6. 健康检查
#
# 回滚:
#   ./bin/deploy-prod.sh --rollback              # 退到上一个 tag
#   ./bin/rollback-prod.sh                       # 同上 (单独脚本)
#
# 前置:
#   - 服务器已装 docker + docker compose plugin
#   - /opt/mofang-nestjs/.env 已配好
#   - /opt/mofang-nestjs/docker-compose.prod.yml 已上传
#   - dist/ 已经本地 tsc 编译过 (npm run build)
#   - sshpass 已装 (ssh 自动认证)
# ============================================================

set -euo pipefail

# ==================== 配置 ====================
SERVER="root@117.72.30.78"
SSH_PORT=22
SERVER_DIR="/opt/mofang-nestjs"
IMAGE_NAME="mofang-nestjs-api"
TARBALL="/tmp/${IMAGE_NAME}-${VERSION}.tar.gz"

# ==================== 参数解析 ====================
VERSION="latest"
SKIP_BUILD=false
ROLLBACK=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-build) SKIP_BUILD=true; shift ;;
    --rollback) ROLLBACK=true; shift ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) VERSION="$1"; shift ;;
  esac
done

# ==================== 颜色输出 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok() { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
err() { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*" >&2; }

# ==================== 前置检查 ====================
log "▶ 前置检查"

command -v docker >/dev/null 2>&1 || { err "docker 未装"; exit 1; }
command -v sshpass >/dev/null 2>&1 || { err "sshpass 未装"; exit 1; }
[ -f "$SERVER_DIR/../docker-compose.prod.yml" ] || \
  [ -f "docker-compose.prod.yml" ] || { err "找不到 docker-compose.prod.yml"; exit 1; }

# dist 必须存在且非空 (防止 src/dist 不同步)
if [ "$SKIP_BUILD" = false ] && [ "$ROLLBACK" = false ]; then
  if [ ! -s "dist/app.js" ]; then
    err "dist/app.js 不存在或为空, 请先: npm run build"
    exit 1
  fi
  log "  ✓ dist/app.js 存在 ($(du -h dist/app.js | cut -f1))"
fi

# ==================== Rollback 模式 ====================
if [ "$ROLLBACK" = true ]; then
  log "▶ Rollback 模式: 退到上一个 tag"
  PREV=$(sshpass -p '0126ZHang@@' ssh -p $SSH_PORT $SERVER \
    "docker images ${IMAGE_NAME} --format '{{.Tag}}' | grep -v latest | head -1" 2>/dev/null || echo "")

  if [ -z "$PREV" ]; then
    err "找不到上一个 tag, 请手动指定: ./bin/deploy-prod.sh v1.0.1"
    exit 1
  fi
  VERSION=$PREV
  log "  退回 tag: $VERSION"
fi

# ==================== 1. 本地 build ====================
if [ "$SKIP_BUILD" = false ]; then
  log "▶ [1/6] 本地 build 镜像: ${IMAGE_NAME}:${VERSION}"
  docker build \
    -f Dockerfile.prod \
    -t "${IMAGE_NAME}:${VERSION}" \
    -t "${IMAGE_NAME}:latest" \
    --build-arg VERSION="$VERSION" \
    . 2>&1 | tail -20

  SIZE=$(docker image inspect "${IMAGE_NAME}:${VERSION}" --format '{{.Size}}' | awk '{printf "%.0fMB", $1/1024/1024}')
  ok "镜像构建完成 (${SIZE})"
else
  log "▶ [1/6] 跳过 build (--skip-build)"
fi

# ==================== 2. save 镜像 ====================
log "▶ [2/6] 保存镜像到 tarball"
rm -f "$TARBALL"
docker save "${IMAGE_NAME}:${VERSION}" | gzip > "$TARBALL"
TARBALL_SIZE=$(du -h "$TARBALL" | cut -f1)
ok "tarball: $TARBALL ($TARBALL_SIZE)"

# ==================== 3. scp 上传 ====================
log "▶ [3/6] scp 到服务器"
sshpass -p '0126ZHang@@' scp -P $SSH_PORT "$TARBALL" "${SERVER}:/tmp/"
ok "上传完成"

# ==================== 4. 服务器 load 镜像 ====================
log "▶ [4/6] 服务器 load 镜像"
sshpass -p '0126ZHang@@' ssh -p $SSH_PORT $SERVER "
  set -e
  docker load -i /tmp/$(basename $TARBALL)
  rm -f /tmp/$(basename $TARBALL)
  # 清理 5 个版本前的旧镜像, 防磁盘爆炸
  docker images ${IMAGE_NAME} --format '{{.Tag}}' | \
    grep -v 'latest' | tail -n +6 | while read t; do
      docker rmi ${IMAGE_NAME}:\$t 2>/dev/null || true
    done
"
ok "镜像 load 完成"

# ==================== 5. docker compose up ====================
log "▶ [5/6] docker compose up -d"
sshpass -p '0126ZHang@@' ssh -p $SSH_PORT $SERVER "
  cd $SERVER_DIR
  # 优先停掉 pm2 旧进程 (防止端口冲突)
  pm2 delete mofang-nestjs 2>/dev/null || true
  pm2 save 2>/dev/null || true

  # docker compose 启动
  docker compose -f docker-compose.prod.yml up -d

  # 清理 buildx 缓存
  docker builder prune -f --filter 'until=24h' 2>/dev/null || true
"
ok "容器启动"

# ==================== 6. 健康检查 ====================
log "▶ [6/6] 健康检查 (等 15s 让容器起来)"
sleep 15

HEALTH_URL="http://127.0.0.1:3001/health"
HTTP_CODE=$(curl -s -o /tmp/health-resp.txt -w "%{http_code}" "$HEALTH_URL" || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  ok "✅ 健康检查通过 (HTTP $HTTP_CODE)"
  log "  响应: $(cat /tmp/health-resp.txt | head -c 200)"
else
  err "❌ 健康检查失败 (HTTP $HTTP_CODE)"
  warn "服务器日志:"
  sshpass -p '0126ZHang@@' ssh -p $SSH_PORT $SERVER \
    "docker logs --tail 30 ${IMAGE_NAME%-*}-api" 2>&1 || true
  exit 1
fi

# ==================== 收尾 ====================
echo ""
ok "🎉 部署成功!"
log "  版本: ${IMAGE_NAME}:${VERSION}"
log "  容器: mofang-nestjs-api (host 网络)"
log "  端口: 127.0.0.1:3001 (api 直连, 不经 docker 端口映射)"
log ""
log "运维命令:"
log "  查看日志:   ssh ${SERVER} 'docker logs -f mofang-nestjs-api'"
log "  重启容器:   ssh ${SERVER} 'docker compose -f docker-compose.prod.yml restart api'"
log "  查看状态:   ssh ${SERVER} 'docker ps | grep mofang'"
log "  回滚镜像:   $0 --rollback"