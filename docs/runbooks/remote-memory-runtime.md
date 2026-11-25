# 远程记忆运行时（Qdrant + TEI + 后端）运行手册

> AF-506 交付。适用场景：本地后端要连京东云 `117.72.30.78` 上的 Qdrant/TEI；
> 或服务器上排查"长时记忆写不进去 / 召回为空"。

## 1. 拓扑

```
本地 mofang-nestjs (3000)
  ├─ QDRANT_URL=http://127.0.0.1:6333 ─┐
  └─ LLM_CUSTOM_BASE_URL=http://127.0.0.1:8080/v1 ─┐
                                                   │ SSH 隧道
117.72.30.78                                      ▼
  ├─ mofang-qdrant (qdrant/qdrant:v1.12.0)  :6333/:6334
  └─ mofang-tei    (TEI cpu-1.5, bge-small-zh-v1.5) :8080
```

生产 `mofang-nestjs-api` 用 host 网络，容器内 `127.0.0.1` 就是宿主机，所以连
`http://127.0.0.1:6333`、`http://127.0.0.1:8080/v1`，不能写 compose 服务名。本地开发用
SSH 隧道把两个端口拉到 `127.0.0.1`。

## 2. 服务器启动

```bash
cd /root/mofang-rag
docker compose --profile rag up -d qdrant tei
docker ps --format '{{.Names}} | {{.Status}} | {{.Ports}}' | grep -E 'qdrant|tei'
```

### 2.1 Qdrant

`docker-compose.yml` 必须同时有 entrypoint 与 command：

```yaml
qdrant:
  image: qdrant/qdrant:v1.12.0
  entrypoint: ['/qdrant/qdrant']
  command:
    - --config-path=/qdrant/config/config.yaml
```

原因：Qdrant 官方镜像没有 ENTRYPOINT，直接写 `command: --config-path=...`
会把参数当可执行文件，报 `exec: "--config-path=...": stat ... no such file`。

`docker/qdrant/config/config.yaml` 必须是 Qdrant 1.12 的结构化 schema：

- `storage.wal` 是对象（`wal_capacity_mb` / `wal_segments_ahead`），不能写
  `wal: true`，否则启动报 `invalid type: boolean true, expected struct WalConfig`。
- 不要在配置文件里写死 `service.api_key`；鉴权只走 `.env` 的
  `QDRANT_API_KEY`（空值会被 Qdrant 当成"启用了空 key"，所以要么配真 key，
  要么把 compose 里的 `QDRANT__SERVICE__API_KEY` 整行删掉）。

### 2.2 TEI

```yaml
tei:
  image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.5
  command:
    - --model-id=/models/bge-small-zh-v1.5
    - --max-client-batch-size=32
    - --max-batch-tokens=16384
    - --pooling=cls
  volumes:
    - /root/models/bge-small-zh-v1.5:/models/bge-small-zh-v1.5:ro
    - tei-data:/data
```

三个踩过的坑：

1. GPU 镜像 `...:1.5` 在没有 CUDA 的机器上会报
   `libcuda.so.1: cannot open shared object file`，必须换 `cpu-1.5`。
2. CPU 镜像不支持 `--normalize=true`，会报 `unexpected argument '--normalize'`。
3. CPU 后端只加载 ONNX，模型目录必须有 `onnx/model.onnx`。`BAAI/bge-small-zh-v1.5`
   原仓没有 ONNX；从 `Xenova/bge-small-zh-v1.5` 取：

```bash
mkdir -p /root/models/bge-small-zh-v1.5/onnx
cd /root/models/bge-small-zh-v1.5
base=https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main
curl -fL -o onnx/model.onnx "$base/onnx/model.onnx"
# config/tokenizer 从 BAAI 原仓取（同目录）
```

国内服务器 `huggingface.co` 常被墙；TEI 的 Rust hf-hub 不认 `HF_ENDPOINT`，
所以采用"宿主机先下载、容器挂载本地目录"的方式，别指望容器内自动拉模型。

### 2.3 验证

```bash
key=$(sed -n 's/^QDRANT_API_KEY=//p' /root/mofang-rag/.env)
curl -s -H "api-key: $key" http://127.0.0.1:6333/collections
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health   # 200
curl -s -X POST http://127.0.0.1:8080/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"咨询师如何回应来访者的沉默"}' | head -c 200
```

## 3. 本地后端配置

`.env`：

```dotenv
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=<与服务器 /root/mofang-rag/.env 一致>
LLM_DEFAULT_EMBEDDING_PROVIDER=custom
LLM_CUSTOM_ENABLED=true
LLM_CUSTOM_BASE_URL=http://127.0.0.1:8080
LLM_CUSTOM_DEFAULT_MODEL_EMBED=bge-small-zh-v1.5
LLM_CUSTOM_API_KEY=tei-local
LLM_CUSTOM_DIMENSION=512
```

`LLM_CUSTOM_API_KEY` 只是让 LangChain 客户端有非空 key；TEI 不校验。
`LLM_CUSTOM_BASE_URL` 会被归一补 `/v1`，填 `http://host:8080` 或
`http://host:8080/v1` 都行。

隧道（已固化为脚本，不再手工敲长命令）：

```powershell
# 密码只放环境变量，脚本不会落盘明文
$env:SSH_PASS = '<server-password>'
pwsh -File scripts/ops/memory-runtime-tunnel.ps1 start
pwsh -File scripts/ops/memory-runtime-tunnel.ps1 status
pwsh -File scripts/ops/memory-runtime-tunnel.ps1 stop
```

脚本用 `-N -L 127.0.0.1:6333:127.0.0.1:6333 -L 127.0.0.1:8080:127.0.0.1:8080`，
带 `ExitOnForwardFailure`、`ServerAliveInterval=30`，PID 写 `%LOCALAPPDATA%\mofang\memory-runtime-tunnel.pid`。
也可以直接配置 SSH key，此时无需 `SSH_PASS`。

## 4. 排障对照

| 现象                                                       | 根因                                                 | 处理                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `Embedding provider qwen not registered`                   | 没配 `LLM_QWEN_API_KEY`，默认却走 qwen               | `LLM_DEFAULT_EMBEDDING_PROVIDER=custom` + custom 四项          |
| `ensureCollection ... skipped: Not Found`，随后 upsert 400 | 旧代码只匹配 `Not found` / `404`，真实是 `Not Found` | 已改为先 `getCollections()` 判断存在性；见 `qdrant.service.ts` |
| 写入 warn `Bad Request`                                    | point id 不是 UUID                                   | 长时记忆 id 必须走 `randomUUID()`（session-closeout 默认就是） |
| `/admin/api/memories` 返回 `source: unavailable`           | 后端没配 `QDRANT_URL` 或 Qdrant 不可达               | 配 env / 起隧道后重启                                          |
| Qdrant 容器 `Created` 不启动                               | compose 把参数当可执行文件                           | 加 `entrypoint: ['/qdrant/qdrant']`                            |
| TEI `Restarting (127)`                                     | GPU 镜像缺 libcuda                                   | 换 `cpu-1.5`                                                   |
| TEI `File "/models/.../onnx/model.onnx" does not exist`    | CPU 后端只认 ONNX                                    | 下载 Xenova ONNX 到模型目录                                    |

## 5. 已验证（2026-11-25）

- Qdrant `visitor_long_memory`：512 维 Cosine，真实写入 4 条 → 召回 Top2/Top1，
  跨 visitor / 跨 tenant 均隔离；验收后已清空合成点。
- TEI `/v1/embeddings`：512 维，真实 provider 两条文本均返回。
- 本地 `/admin/api/memories`：`source=qdrant`，能列出真实写入。
- 记忆专项单测 185 例 + Qdrant SDK 契约 5 例全绿。

## 6. 收尾状态（2026-11-25 AF-509）

- 仓库根 `docker-compose.yml` 已改为 `entrypoint: ['/qdrant/qdrant']` +
  `--config-path=/qdrant/config/config.yaml`，健康检查改用 bash `/dev/tcp`（镜像没有 curl）。
- 仓库 `docker/qdrant/config/config.yaml` 已按 1.12 schema 修正：`storage.wal: {}`，
  不写死 `service.api_key`，鉴权只走 compose env。
- `@qdrant/js-client-rest` 已固定 `1.12.0`，与服务器 Qdrant 1.12 同大版本同小版本，
  运行时版本不兼容警告消失。
- SSH 隧道已固化为 `scripts/ops/memory-runtime-tunnel.ps1`（start/stop/status/restart）。
- 生产 `mofang-nestjs-api` 镜像已重建并补 `.env` QDRANT/LLM 配置，发布与回滚见
  `docs/runbooks/memory-runtime-production-release.md`。
- 服务器 `mofang-qdrant` / `mofang-tei` 的 Docker healthcheck 已改 bash `/dev/tcp`，
  两者恢复 `Up (healthy)`。
