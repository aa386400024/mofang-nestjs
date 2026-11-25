# 生产记忆链路发布与回滚（mofang-nestjs-api）

> 适用：`/opt/mofang-nestjs` 单容器 + host 网络生产部署。
> 最近执行：2026-11-25 AF-509（镜像 `af509-20261125`）。

## 1. 前置条件

- 本地已完成 `pnpm build`，`dist/app.js` 存在。
- 服务器 `/tmp/mofang-build` 可写，磁盘至少 8G 可用（构建 npm 依赖需要）。
- 服务器 Qdrant/TEI 已 `Up (healthy)`：

```bash
docker ps --filter name=mofang-qdrant --filter name=mofang-tei \
  --format '{{.Names}}|{{.Status}}'
```

- 生产 `.env` 已备份：

```bash
cp /opt/mofang-nestjs/.env /opt/mofang-nestjs/.env.bak.$(date +%Y%m%d-%H%M%S)
```

- 旧镜像保留回滚标签：

```bash
docker tag mofang-nestjs-api:latest mofang-nestjs-api:rollback-$(date +%Y%m%d)
```

## 2. 生产 `.env` 必填键

生产 API 是 host 网络，容器内 `127.0.0.1` 就是宿主机，所以 Qdrant/TEI 都写本机回环：

```dotenv
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=<与 /root/mofang-rag/.env 同一个 48 位 hex>
LLM_DEFAULT_EMBEDDING_PROVIDER=custom
LLM_CUSTOM_ENABLED=true
LLM_CUSTOM_BASE_URL=http://127.0.0.1:8080/v1
LLM_CUSTOM_DEFAULT_MODEL_EMBED=bge-small-zh-v1.5
LLM_CUSTOM_API_KEY=tei-local
LLM_CUSTOM_DIMENSION=512
```

启动硬性前置（缺任意一个 `NestFactory` 会在 `LlmService` / `AsrTokenService`
构造时报 `Missing required env var` 并退出）：

```dotenv
MINIMAX_BASE_URL=https://api.minimax.chat
MINIMAX_API_KEY=<从本机 .env 或密钥库取，不回显>
MINIMAX_LLM_MODEL=MiniMax-M3
MINIMAX_ASR_TOKEN_SECRET=<从本机 .env 或密钥库取，不回显>
LLM_DEFAULT_CHAT_PROVIDER=minimax
```

- `QDRANT_API_KEY`、`MINIMAX_API_KEY`、`MINIMAX_ASR_TOKEN_SECRET` 不要回显、不要提交、不要贴进聊天记录。
- `LLM_CUSTOM_BASE_URL` 填不填 `/v1` 都行，启动层会归一。
- 不要写 `http://qdrant:6333` / `http://tei:80`：生产 API 不在 `mofang-net`。
- 改完 `.env` 必须 `docker compose -f docker-compose.prod.yml up -d --force-recreate`；
  `up -d` 不会因 env 文件变化重建容器。

## 3. 构建与发布

```bash
# 本地
pnpm build
rsync -avz --delete dist/ root@<server>:/tmp/mofang-build/dist/
scp Dockerfile.prod package.json pnpm-lock.yaml root@<server>:/tmp/mofang-build/

# 服务器
cd /tmp/mofang-build
docker build -f Dockerfile.prod \
  -t mofang-nestjs-api:af509-20261125 \
  -t mofang-nestjs-api:latest \
  --build-arg VERSION=af509-20261125 .

cd /opt/mofang-nestjs
docker compose -f docker-compose.prod.yml up -d
```

说明：

- `Dockerfile.prod` 只 `COPY dist`，不在容器里编译 TS；漏 `pnpm build` 会构建失败或镜像缺文件。
- 构建上下文必须有 `dist/`、`package.json`、`Dockerfile.prod`；`pnpm-lock.yaml` 一并带上便于排查。
- 服务器 2G 内存构建较慢，`pnpm install --prod --frozen-lockfile` 阶段可能 3-8 分钟，不要中途 Ctrl-C。
- 基础镜像 `node:26-alpine`，运行时依赖（curl/tini）在镜像内 `apk add`，不依赖宿主。

## 4. 发布后验证

```bash
curl -fsS http://127.0.0.1:3001/health && echo OK
docker ps --filter name=mofang-nestjs-api --format '{{.Names}}|{{.Image}}|{{.Status}}'
docker inspect mofang-nestjs-api --format 'created={{.Created}} image={{.Config.Image}}'

# 记忆接口：带管理员 JWT 时应 200，至少不应再 404
curl -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:3001/admin/api/memories?limit=1
```

期望：

- `/health` 200。
- `mofang-nestjs-api` `Up (healthy)`，`created` 是本次构建时间。
- `/admin/api/memories` 不再 404（401 表示鉴权生效，路由已存在）。
- 应用日志不再出现 Qdrant 客户端版本不兼容警告。

## 5. 回滚

```bash
docker tag mofang-nestjs-api:rollback-af509 mofang-nestjs-api:latest
cd /opt/mofang-nestjs
docker compose -f docker-compose.prod.yml up -d --force-recreate
curl -fsS http://127.0.0.1:3001/health
```

`.env` 回滚：

```bash
cp /opt/mofang-nestjs/.env.bak.af509 /opt/mofang-nestjs/.env
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

## 6. 已知边界

- 镜像升级不改数据库 schema；本次没有 migration。
- `Dockerfile.prod` 没有 `package-lock.json` 时会走 `npm install` 兜底，依赖按 `package.json`
  版本范围解析，生产构建结果以镜像 digest 为准。
- Qdrant/TEI 仍只监听宿主机回环，公网不开放 6333/6334/8080。
