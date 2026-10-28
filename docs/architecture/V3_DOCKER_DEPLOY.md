# V3 Docker 部署 — 单容器 + host 网络 (2 核 2G 服务器最佳实践)

> **完成时间**: 2026-08-19
> **架构师**: 大炮 + AI 协作
> **替代**: V2.5 方案 (pm2 + host mysql/redis, 980KB 源码 + node_modules 散在 `/opt/mofang-nestjs`)

---

## 0. 一句话总结

把 `mofang-nestjs-api` 装进一个 docker 容器,**只跑 api**;MySQL/Redis 保留在 host (ebook-reader 共享);**服务器代码目录只剩 5 个文件**(`.env` + `docker-compose.prod.yml` + `Dockerfile.prod` + `nginx/` + `bin/`),共 **30KB**(从 980MB 减到 30MB)。

---

## 1. 背景与设计目标

### 1.1 V2.5 现状 (8/19 部署的 pm2 方案)

```
服务器 /opt/mofang-nestjs/  (980MB)
├── src/               # 8/18 clone 的副本 (跟本地会 drift)
├── .git/               # 6MB (服务器不需要版本控制)
├── node_modules/       # 843MB (依赖)
├── dist/               # 2.4MB (本地 tsc 编译, scp 上传)
├── docker/             # prometheus/grafana 配置 (没在用)
├── docs/ test/ src/    # 开发资源
├── package.json + ...  # 各种 dev 配置
└── .env                # 生产配置
```

**痛点**:
1. 源码本地 + 服务器两份,**drift 风险**(大炮在本地改,服务器没改 → 启动失败)
2. 服务器跑 pm2,**进程管理脱节**(pm2 自己一份,docker 自己一份,概念混)
3. 升级部署:**本地 tsc → scp dist → 服务器 mv → pm2 reload**,5 步手动
4. 回滚:靠 `dist.bak.HHMMSS/` 留备份,出问题手工 `mv` 回来

### 1.2 V3 设计目标

| 目标 | 怎么达成 |
|---|---|
| 单一事实源 | 服务器**不保留**源码 / node_modules / git;镜像 build 在服务器端用本地 tarball 喂入 |
| 进程隔离 | docker 替代 pm2 (ebook-reader 仍用 pm2,两个独立进程管理) |
| 一键部署 | `bin/deploy-prod.sh` (本地) → 服务器 docker build → 滚动重启 |
| 一键回滚 | `bin/rollback-prod.sh` (本地) → 退到上一个 tag |
| 资源可控 | 2 核 2G 严格限制 (0.5 cpu / 256M memory) |
| 简单 | 单服务、单镜像、host 网络、Compose v2 |

---

## 2. 架构对比

### 2.1 V2.5 (pm2 + host mysql/redis)

```
                      ┌─────────────────────────────────────────┐
                      │       服务器 117.72.30.78                │
                      │                                          │
  外部请求 ──nginx──▶ │   ┌──────────────┐                       │
                      │   │ pm2 进程     │                       │
                      │   │ node dist/app│ ──┐                  │
                      │   │ (3001)       │   │                  │
                      │   └──────────────┘   │                  │
                      │                      │                  │
                      │   ┌──────────────┐   │                  │
                      │   │ MySQL 8.0    │ ◀─┘ (systemd)         │
                      │   │ (3306)       │                      │
                      │   └──────────────┘                      │
                      │   ┌──────────────┐                      │
                      │   │ Redis 7      │ (systemd)            │
                      │   │ (6379)       │                      │
                      │   └──────────────┘                      │
                      └─────────────────────────────────────────┘
```

### 2.2 V3 (docker api + host mysql/redis)

```
                      ┌─────────────────────────────────────────┐
                      │       服务器 117.72.30.78                │
                      │                                          │
  外部请求 ──nginx──▶ │   ┌──────────────────────────┐           │
                      │   │ docker container         │           │
                      │   │ image: mofang-nestjs-api │           │
                      │   │ net: host (= 127.0.0.1)  │           │
                      │   │ user: nestjs (1001)      │           │
                      │   │ cmd: node dist/app.js    │ ──┐       │
                      │   │ limit: 0.5cpu / 256M     │   │       │
                      │   └──────────────────────────┘   │       │
                      │                                  │       │
                      │   ┌──────────────┐               │       │
                      │   │ MySQL 8.0    │ ◀─────────────┘ (systemd)
                      │   │ (3306)       │                      │
                      │   └──────────────┘                      │
                      │   ┌──────────────┐                      │
                      │   │ Redis 7      │ (systemd)            │
                      │   │ (6379)       │                      │
                      │   └──────────────┘                      │
                      └─────────────────────────────────────────┘
```

**关键变化**: 服务器代码目录从 980MB → 30KB。

---

## 3. 关键决策

### 3.1 ✅ MySQL/Redis **不进 docker**

**为什么**:
- ebook-reader 已经用 host MySQL 4 个 schema + Redis OSS 配置
- docker 重启会丢数据 (除非挂卷,但 MySQL 8GB 数据卷会让 2G 服务器吃不消)
- ebook-reader 共享账号库,共享 Redis 是**架构设计**(JWT blacklist / BullMQ 都共用)

**怎么做**:
- docker 容器用 `network_mode: host` 直接访问 host 的 127.0.0.1:3306 / 6379
- 不在 compose 里定义 mysql/redis services
- `.env` 里 `DB_HOST=127.0.0.1` `REDIS_HOST=127.0.0.1`

### 3.2 ✅ `network_mode: host` 而非 bridge

**为什么**:
- bridge 网络下,容器内 `127.0.0.1` 是容器自己,要靠 DNS 解析 `mysql` / `redis` 等服务名
- host 网络下,容器内 `127.0.0.1` = host `127.0.0.1`,MySQL/Redis 直接连,零配置
- 牺牲: 容器端口跟 host 端口绑定 (3001 直接绑 host 3001),**不能用 docker port mapping**

**怎么做**:
- `docker-compose.prod.yml`: `network_mode: host`
- 端口由容器内 app 决定 (`PORT=3001`)
- 不写 `ports:` 段 (host 网络下写了也无效)

### 3.3 ✅ 服务器 build 镜像 (WSL 不装 docker)

**为什么**:
- WSL 装 docker = 222MB Flutter SDK 性质一样,违反"WSL 不装 SDK"红线 (大炮 8/17 明确)
- 服务器已有 docker,带宽够 (内网 daocloud 镜像源)
- 服务器 build = 镜像 label 标记成 prod,本地只负责 `npm run build` 出 `dist/`

**怎么做**:
- 本地: `npm run build` → `dist/` 通过 `rsync` / `scp` 传到服务器 `/tmp/mofang-build/dist/`
- 服务器: `cd /tmp/mofang-build && docker build -f Dockerfile.prod -t mofang-nestjs-api:v1.0.1 .`
- 服务器的 `/tmp/mofang-build/` 用完即删(临时 build context)

### 3.4 ✅ daemon.json 国内镜像源

**为什么**:
- 服务器 IP `117.72.30.78` 是**京东云**(非阿里云,内网 registry 不通)
- docker.io 默认被墙,直连超时
- daocloud.io 在服务器上可达 (HTTP 401 = 通,需要 auth 才能 push,pull OK)

**怎么做**:
- `/etc/docker/daemon.json`: `"registry-mirrors": ["https://docker.m.daocloud.io"]`
- `systemctl restart docker`
- `docker info | grep "Registry Mirrors"` 验证生效

### 3.5 ✅ 资源限制 (2 核 2G 严格)

```yaml
deploy:
  resources:
    limits:
      cpus: '0.5'      # 50% 单核 (爆炸时不拖垮整个服务器)
      memory: 256M     # 实际跑下来 ~143MB,余量 113MB
    reservations:
      cpus: '0.25'     # 保底 25% 单核
      memory: 96M      # 保底 96MB
```

**内存预算 (服务器 2G 减去现有)**:
```
system + sshd ≈ 200M
ebook-reader pm2 (12M) + 旧 mofang pm2 (已停) ≈ 12M
MySQL 8.0 (systemd) ≈ 400M
Redis 7 (systemd) ≈ 100M
dockerd ≈ 150M
docker container api (实测) ≈ 143M
---
总计 ≈ 1.0G ✓ 安全余量 1G
```

**为什么不上 Prometheus/Grafana**:
- Prometheus 内存基线 200M+,Grafana 300M+,2G 跑不动
- 监控先用 `/metrics` endpoint (Prometheus 文本格式)
- V3.1 加 swap 4G 后再考虑上

---

## 4. 部署流程 (从零到上线)

### 4.1 服务器一次性准备 (一次性,以后不用重做)

```bash
# 1. 装 docker
curl -fsSL --retry 3 https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
systemctl enable docker

# 2. 配国内镜像源
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << EOF
{
  "registry-mirrors": ["https://docker.m.daocloud.io"],
  "log-driver": "json-file",
  "log-opts": {"max-size": "10m", "max-file": "3"}
}
EOF
systemctl restart docker

# 3. 验证
docker info | grep "Registry Mirrors"
docker pull node:24-alpine  # 测速,alpine ~50MB
```

### 4.2 服务器初始化目录结构 (一次性)

```bash
# 服务器侧 (117.72.30.78)
mkdir -p /opt/mofang-nestjs/{nginx,bin}
# 目录最终只有 5 个东西:
#   .env                       (生产环境变量, 不进 git)
#   docker-compose.prod.yml    (单服务编排)
#   Dockerfile.prod            (镜像构建)
#   nginx/mofang-nestjs.conf   (反代片段)
#   bin/                       (留给将来的 deploy 脚本)
```

### 4.3 上传项目文件 (从本地)

```bash
# 本地 WSL 端 (一次性 / 改 Dockerfile.prod 时)
cd /mnt/e/Work/Project/backend/mofang-nestjs

# 1. 本地 tsc 编译
npm run build

# 2. rsync dist + 构建产物到服务器
sshpass -p '0126ZHang@@' rsync -avz --progress -e "ssh -p 22" \
  dist/ root@117.72.30.78:/tmp/mofang-build/dist/

sshpass -p '0126ZHang@@' scp -P 22 \
  package.json package-lock.json Dockerfile.prod \
  root@117.72.30.78:/tmp/mofang-build/

# 3. 上传编排文件 (只在第一次部署时, 改 compose 时重传)
sshpass -p '0126ZHang@@' scp -P 22 \
  docker-compose.prod.yml Dockerfile.prod \
  root@117.72.30.78:/opt/mofang-nestjs/

sshpass -p '0126ZHang@@' scp -P 22 \
  nginx/mofang-nestjs.conf \
  root@117.72.30.78:/opt/mofang-nestjs/nginx/
```

### 4.4 服务器 build + 启动 (每次新版本)

```bash
# 服务器侧
cd /tmp/mofang-build

# 1. build 镜像 (首次 5 分钟, 有 cache 后 <30 秒)
docker build -f Dockerfile.prod \
  -t mofang-nestjs-api:v1.0.1 \
  -t mofang-nestjs-api:latest \
  --build-arg VERSION=v1.0.1 .

# 2. 停 pm2 旧进程 (如果有)
pm2 delete mofang-nestjs 2>/dev/null || true
pm2 save 2>/dev/null || true

# 3. 起 docker (单服务, host 网络)
cd /opt/mofang-nestjs
docker compose -f docker-compose.prod.yml up -d

# 4. 验证
sleep 15
curl -sS -w "\nHTTP %{http_code}\n" http://127.0.0.1:3001/health
docker ps | grep mofang-nestjs
```

### 4.5 业务验证

```bash
# 服务器侧或本地 (用 ssh 隧道)
curl -X POST http://127.0.0.1:3001/user/register \
  -H "Content-Type: application/json" \
  -d '{"email":"prod-test@mofang.cloud","password":"Test@2026"}'
# 期望: HTTP 201, 返回 user 对象 + UID

curl -X POST http://127.0.0.1:3001/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"prod-test@mofang.cloud","password":"Test@2026"}'
# 期望: HTTP 400 + "请先验证邮箱" (业务规则)

curl -sS http://127.0.0.1:3001/metrics | grep auth_login
# 期望: auth_login_attempts_total{result="failed"} 1
```

---

## 5. 日常运维

### 5.1 部署新版本

**推荐流程** (本地 WSL):

```bash
# 本地
cd /mnt/e/Work/Project/backend/mofang-nestjs

# 1. 改代码 + tsc 编译
npm run build

# 2. rsync dist 到服务器
sshpass -p '0126ZHang@@' rsync -avz --delete -e "ssh -p 22" \
  dist/ root@117.72.30.78:/tmp/mofang-build/dist/

# 3. (如有 package.json 改) 传 lockfile
sshpass -p '0126ZHang@@' scp -P 22 \
  package.json package-lock.json \
  root@117.72.30.78:/tmp/mofang-build/

# 4. 服务器 build + up
sshpass -p '0126ZHang@@' ssh -p 22 root@117.72.30.78 "
  cd /tmp/mofang-build && \
  docker build -f Dockerfile.prod -t mofang-nestjs-api:v1.0.2 -t mofang-nestjs-api:latest --build-arg VERSION=v1.0.2 . && \
  cd /opt/mofang-nestjs && \
  docker compose -f docker-compose.prod.yml up -d
"

# 5. 健康检查 (本地)
sleep 15
curl -fsS http://127.72.30.78:3001/health && echo OK
```

### 5.2 一键部署 (推荐, 用 `bin/deploy-prod.sh`)

```bash
cd /mnt/e/Work/Project/backend/mofang-nestjs
./bin/deploy-prod.sh v1.0.2
```

脚本流程:
1. 本地 build 镜像 (需要本地有 docker,目前**服务器 build 版本稍后适配**)
2. save 镜像到 tarball
3. scp 到服务器
4. 服务器 load 镜像
5. docker compose up -d (滚动重启)
6. 健康检查

**当前状态**: 脚本写好了,适配"本地 docker build"流程。**V3.1 改成"服务器 build"模式**(见 §9 待办)。

### 5.3 一键回滚

```bash
./bin/rollback-prod.sh           # 自动选上一个 tag (按时间倒序)
./bin/rollback-prod.sh v1.0.1    # 退到指定 tag
```

服务器保留最近 5 个 tag (`docker images mofang-nestjs-api`),更老的自动 `docker rmi`。

### 5.4 运维常用命令

```bash
# 看容器状态
ssh root@117.72.30.78 'docker ps | grep mofang-nestjs'

# 看实时日志 (json 格式, pino)
ssh root@117.72.30.78 'docker logs -f mofang-nestjs-api'

# 看最近 100 行
ssh root@117.72.30.78 'docker logs --tail 100 mofang-nestjs-api'

# 进容器排查 (alpine 没 bash, 用 sh)
ssh root@117.72.30.78 'docker exec -it mofang-nestjs-api sh'

# 重启容器
ssh root@117.72.30.78 'cd /opt/mofang-nestjs && docker compose -f docker-compose.prod.yml restart api'

# 看资源占用
ssh root@117.72.30.78 'docker stats --no-stream mofang-nestjs-api'

# 看磁盘
ssh root@117.72.30.78 'docker system df'
```

### 5.5 升级依赖 (改 package.json)

```bash
# 本地
npm install <package>@<version>    # 改 package.json
npm ci                             # 锁文件更新
npm run build                      # 验证编译

# 部署流程同 §5.1 (上传 package-lock.json)
```

---

## 6. 故障排查

### 6.1 docker pull 超时 (国内服务器)

**症状**:
```
failed to do request: Head "https://registry-1.docker.io/v2/...":
dial tcp 104.244.46.104:443: i/o timeout
```

**治本**: 配 daemon.json 国内镜像源 (见 §4.1)。

**调试步骤**:
```bash
# 1. 测试可达性
curl -sS -o /dev/null -w "%{http_code}\n" --connect-timeout 5 \
  https://docker.m.daocloud.io/v2/
# 期望: 401 (通,需 auth)

curl -sS -o /dev/null -w "%{http_code}\n" --connect-timeout 5 \
  https://registry-1.docker.io/v2/
# 期望: 000 (超时, 不可达)

# 2. 检查当前 daemon.json
cat /etc/docker/daemon.json

# 3. 重启 docker daemon
systemctl restart docker
docker info | grep "Registry Mirrors"
```

### 6.2 npm ci 失败 (lockfile 缺失)

**症状**:
```
npm error code EUSAGE
npm error The `npm ci` command can only install with an existing package-lock.json
```

**治本**: `package-lock.json` 必须传到 build context。检查 rsync / scp 是否漏传。

**调试**:
```bash
ssh root@117.72.30.78 'ls -la /tmp/mofang-build/'
# 期望看到: dist/ Dockerfile.prod package.json package-lock.json
```

### 6.3 容器起不来 (host mysql/redis 没起来)

**症状**:
```
docker logs mofang-nestjs-api
{"context":"TypeOrmCoreModule","msg":"Error: getaddrinfo ENOTFOUND mysql"}
```

**检查**:
```bash
ssh root@117.72.30.78 'systemctl status mysql'
ssh root@117.72.30.78 'systemctl status redis-server'
ssh root@117.72.30.78 'ss -tlnp | grep -E "3306|6379"'
```

**注意**: 因为用 `network_mode: host`,容器内 `127.0.0.1` = host `127.0.0.1`。如果 `.env` 里写了 `DB_HOST=mysql` 而不是 `127.0.0.1`,容器会试图解析 host 网络里没有的 `mysql` hostname → ENOTFOUND。

### 6.4 镜像太大 (>300MB)

**症状**:
```
docker images
mofang-nestjs-api:latest   1.2GB
```

**排查**:
```bash
# 看每层大小
docker history mofang-nestjs-api:latest

# 通常是 node_modules 异常大 (本应该 ~80MB, 实际 >200MB)
# 检查 devDependencies 是否进了 prod 镜像:
docker run --rm mofang-nestjs-api:latest sh -c \
  "ls /app/node_modules | wc -l && cat /app/package.json | jq '.devDependencies | length'"
```

**治本**: Dockerfile.prod 用 `npm ci --omit=dev` (排除 devDependencies)。

### 6.5 健康检查失败 (404 /health)

**症状**:
```
docker ps  # STATUS 显示 "health: starting" 持续
```

**注意**: 当前**没有 `/health` endpoint**(只是 docker compose 文件里写了期望路径)。容器真正启动的标志:
- 日志里看到 `Nest application successfully started`
- `curl /user/register` 返回 201

**V3.1 改进**: 加 `HealthController` 注册 `/health` endpoint (参考 `@nestjs/terminus` 已装但没用)。

---

## 7. 备份与恢复

### 7.1 MySQL 备份 (跟 V2.5 一样)

```bash
# 服务器侧,定时任务 (crontab)
mysqldump -uroot -p<ROOT_PASSWORD> \
  --single-transaction --quick --lock-tables=false \
  mofang_dev > /backup/mofang-$(date +%Y%m%d-%H%M).sql
```

建议: 每天凌晨 3 点跑一次,保留 7 天。

### 7.2 Redis 备份

```bash
# 触发 BGSAVE
redis-cli -a <PASSWORD> BGSAVE
# 备份文件: /var/lib/redis/dump.rdb
```

### 7.3 镜像备份 (可选, build cache 已经够)

```bash
# 服务器侧, save 镜像到 tarball
docker save mofang-nestjs-api:v1.0.1 | gzip > /backup/mofang-api-v1.0.1.tar.gz

# 还原
gunzip -c /backup/mofang-api-v1.0.1.tar.gz | docker load
```

### 7.4 .env 备份

**重要**: `.env` 不进 git,丢了就重建。

```bash
# 服务器侧
cp /opt/mofang-nestjs/.env /backup/.env.$(date +%Y%m%d)
chmod 600 /backup/.env.*  # 只 root 能读
```

---

## 8. 安全 checklist

- [ ] `.env` 文件权限 `chmod 600` (只有 root 能读)
- [ ] 服务器 SSH 改用 key 认证 (现在用密码,9 月前换)
- [ ] nginx 反代加 HTTPS (现在还是明文 HTTP)
- [ ] firewall 只开 80/443/22 端口
- [ ] JWT_SECRET / JWT_REFRESH_SECRET 用 `openssl rand -base64 48` 生成,不要用 dev 默认值
- [ ] DB / Redis 密码 12+ 字符,大小写+数字+符号
- [ ] docker socket 权限 `chown root:docker /var/run/docker.sock` (避免普通用户进容器)
- [ ] 容器跑非 root 用户 (✅ Dockerfile.prod 已用 nestjs uid 1001)

---

## 9. 待办 (V3.x 路线)

### V3.1 (本周内)
- [ ] 加 `/health` endpoint (`@nestjs/terminus` 已装,只需 controller + module)
- [ ] 改 `bin/deploy-prod.sh` 适配"服务器 build"模式(本地不依赖 docker)
- [ ] 写 systemd `mofang-nestjs-api.service` 监控容器(可选,docker 已 restart: unless-stopped)

### V3.2 (1-2 周)
- [ ] nginx 加 HTTPS 反代 (`/etc/nginx/ssl/mystudy.cloud/` 复用)
- [ ] 加 swap 4G (`fallocate -l 4G /swapfile`),为 V3.3 Prometheus/Grafana 腾空间
- [ ] CI/CD: GitHub Actions 自动 build + 推送镜像到阿里云容器仓库

### V3.3 (1 月)
- [ ] 加 Prometheus + Grafana (监控容器 + DB + Redis)
- [ ] 加 Loki 收集 docker logs
- [ ] 加自动备份脚本(crontab + S3 归档)

---

## 10. 踩坑清单 (本次新增 6 条)

### ⚠️ 不要在 WSL 装 docker

跟 Flutter SDK 一样,WSL 装 docker 会下 ~150MB 二进制,违反"WSL 不装 SDK"红线。
**正解**: 服务器 build 镜像,本地只负责 `dist/`。

### ⚠️ 京东云服务器 docker.io 不通

117.72.30.78 是京东云(JCloud),**不是阿里云**。`registry.cn-hangzhou.aliyuncs.com` 在京东云上也通,但慢。
**正解**: daemon.json 用 `docker.m.daocloud.io`(国内通用,京东云实测 50KB/s+)。

### ⚠️ rsync 传 522 个小文件比 scp 快

scp 传 522 个小文件超时,rsync 增量同步秒级。
**正解**: 大量小文件用 rsync,大文件用 scp。

### ⚠️ Dockerfile COPY 必须显式 package-lock.json

`npm ci` 必须有 lockfile,否则 fallback 到 `npm install` 但**安装结果可能跟本地不一致**。
**正解**: Dockerfile.prod `COPY package.json package-lock.json* ./`,**部署时务必上传 lockfile**。

### ⚠️ .dockerignore 默认排除 Dockerfile + docker-compose.yml

导致 `Dockerfile.prod` 和 `docker-compose.prod.yml` 进了 .git 但 docker build 找不到。
**正解**: 改 `.dockerignore`,精确排除 `Dockerfile` / `docker-compose.yml`,但**保留** `Dockerfile.prod` / `docker-compose.prod.yml`。

### ⚠️ docker compose 配 host 网络后 `ports:` 段失效

`network_mode: host` 下,容器端口直接绑 host 端口,**写 `ports:` 段会被 docker 警告但不影响**。
**正解**: host 网络服务不写 `ports:` 段,端口由容器内 app 决定 (`PORT=3001`)。

---

## 11. 关键文件速查

| 文件 | 位置 | 作用 |
|---|---|---|
| `Dockerfile.prod` | 项目根 | 服务器专用镜像构建 (单阶段精简) |
| `docker-compose.prod.yml` | 项目根 | 单服务编排 (host 网络 + 资源限制) |
| `nginx/mofang-nestjs.conf` | 项目根 | nginx 反代片段 (含限流 + metrics 内部屏蔽) |
| `bin/deploy-prod.sh` | 项目根 | 一键部署 (本地 docker build + save + scp) |
| `bin/rollback-prod.sh` | 项目根 | 一键回滚 (退到上一个 tag) |
| `.dockerignore` | 项目根 | 排除 dev 文件,**保留** Dockerfile.prod |
| `/opt/mofang-nestjs/.env` | 服务器 | 生产配置(不进 git) |
| `/opt/mofang-nestjs/docker-compose.prod.yml` | 服务器 | 服务器用编排 |
| `/opt/mofang-nestjs/Dockerfile.prod` | 服务器 | 服务器用构建 |
| `/etc/docker/daemon.json` | 服务器 | docker 镜像加速 |
| `/var/lib/docker/` | 服务器 | 镜像 + 容器 + 卷实际存储 |

---

## 12. 一行命令速查

```bash
# 服务器侧
docker ps | grep mofang                          # 容器状态
docker logs -f mofang-nestjs-api                  # 实时日志
docker stats --no-stream mofang-nestjs-api        # 资源占用
docker exec -it mofang-nestjs-api sh              # 进容器
docker compose -f /opt/mofang-nestjs/docker-compose.prod.yml restart api  # 重启
docker compose -f /opt/mofang-nestjs/docker-compose.prod.yml down        # 停掉
docker system prune -af                           # 清理无用镜像/容器
docker builder prune -af --filter 'until=24h'    # 清理 24h 前的 build cache

# 本地侧
sshpass -p '0126ZHang@@' ssh -p 22 root@117.72.30.78 'docker ps | grep mofang'
```