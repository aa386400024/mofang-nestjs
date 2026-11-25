---
taskId: AF-507
contextId: phase2.5-memory-runtime
title: 修复记忆链路：Qdrant 服务端配置 + QdrantService 集合创建缺陷 + TEI embedding 接入 + 真链路验收
type: fix
status: backlog
baselineRef: 48cccbeb535e17e8859ba7ec1ebd85615b0e047c
dependsOn: []
priorTasks: [AF-505, AF-506]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T13:25:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/llm/config/llm.config.ts
    - src/ai-engine/providers/qdrant.service.ts
    - .env.example
    - test/llm/
    - test/engine-adapters/
    - docs/runbooks/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-memory-runtime/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af507-memory-runtime-repair-2026-11-25.md
    kind: report
  - name: 远端记忆运行手册
    path: docs/runbooks/remote-memory-runtime.md
    kind: report
gates:
  - command: pnpm exec vitest run test/llm/custom-embedding-provider.spec.ts test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts
    check: custom embedding 注册与 Qdrant 集合创建单测全绿
    threshold: 0 failed
  - command: pnpm lint
    check: 后端 lint 0 error / 记录 warning
    threshold: 0 error
  - command: pnpm typecheck
    check: 后端 typecheck 0 error
    threshold: 0 error
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty output
successCriteria:
  - llm.config.ts 支持从 LLM_CUSTOM_BASE_URL / LLM_CUSTOM_API_KEY / LLM_CUSTOM_DEFAULT_MODEL_EMBED / LLM_CUSTOM_DIMENSION 注册 OpenAI 兼容 embedding provider。
  - LLM_DEFAULT_EMBEDDING_PROVIDER=custom 时，LlmRouterService.embed() 能解析 custom provider 并返回 TEI 的 512 维向量。
  - QdrantService.ensureCollection 不再依赖错误文案判断集合是否存在；集合缺失时能真实创建 visitor_long_memory。
  - 京东云 117.72.30.78 上的 mofang-qdrant 从 created/exit 127 恢复为 running，127.0.0.1:6333/healthz 返回正常。
  - 京东云上的 TEI 改用 CPU 镜像后在 127.0.0.1:8080 提供 /v1/embeddings，bge-small-zh-v1.5 返回 512 维向量。
  - 通过本地 SSH 隧道 + 真实 Qdrant，完成 visitor_long_memory 的写入、按 visitor 召回、跨 visitor 隔离、同 topicKey 旧点 superseded 排除验收。
  - 远端 Qdrant / TEI 的启停与配置口径写入 docs/runbooks/remote-memory-runtime.md。
  - 不修改 src/engine-core；不把测试密钥、服务器密码、记忆正文写入仓库或日志。
---

# AF-507 · 修复记忆链路（Qdrant 服务端 + 集合创建缺陷 + TEI embedding + 真链路验收）

> 状态：📋 待执行（2026-11-25）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af281r
> 服务器：京东云 117.72.30.78（root，现有 mofang-rag / mofang-qdrant / mofang-tei）
> 承接：AF-506 因范围未覆盖 `QdrantService.ensureCollection` 缺陷而取消，由本任务完整承接

## 1. 背景

记忆专项验收发现长时记忆链路实际不可用，且真链路写入又暴露集合创建缺陷：

1. 服务器 `mofang-qdrant` 容器 `created`、exit 127，原因是 compose 把 `--config-path` 拼成 `--config-ration-filename`；且 Qdrant 官方镜像无 ENTRYPOINT，需显式 entrypoint。
2. `mofang-tei` 用 GPU 镜像启动报 `libcuda.so.1` 缺失；改 CPU 镜像后又遇到模型仓库不可达、CPU 后端只认 ONNX 等问题。
3. 本地 `.env` 默认 embedding provider 是 qwen 但无 key，`router.embed()` 报 `Embedding provider qwen not registered`。
4. `QdrantService.ensureCollection` 只匹配 `Not found` / `404`，SDK 真实抛 `Not Found`，导致集合永不创建、首次 upsert 400、长时记忆静默回落内存。

## 2. 范围

**在范围内：**

- `src/llm/config/llm.config.ts`：从 env 注册 OpenAI 兼容 `custom` embedding provider（TEI 用）。
- `src/ai-engine/providers/qdrant.service.ts`：集合存在性改为列集合判断，修复创建路径。
- `.env.example`：补齐 `LLM_CUSTOM_*` 的真实可配口径。
- `test/llm/custom-embedding-provider.spec.ts`、`test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts`：覆盖注册与集合创建。
- `docs/runbooks/remote-memory-runtime.md`：远端 Qdrant/TEI 启停、端口、SSH 隧道、collection 维度口径。
- 服务器 `/root/mofang-rag/docker-compose.yml`、`docker/qdrant/config/config.yaml`、`/root/mofang-rag/.env`、`/root/models/bge-small-zh-v1.5/`。
- 服务器容器启停、Qdrant collection 创建、TEI 健康检查、本地 SSH 隧道与真链路验收。

**明确不在范围内：**

- 不修改 `src/engine-core/**`；`git diff --stat HEAD -- src/engine-core` 必须为空。
- 不修改仓库根 `docker-compose.yml`：根 compose 不在 executor 资源域，另立任务处理，运行手册记录遗留。
- 不修改 `QdrantMemoryStore` 的召回策略、TopK、衰减、冲突消解逻辑。
- 不修改生产 API 镜像、不做 `master` 合并 / tag / release / 对外部署（L4 需另行批准）。
- 不清理仓库既有未提交/未跟踪文档；提交只暂存本任务文件。
- 不把服务器密码、API key、来访者记忆正文写入日志、交付记录或提交。

## 3. 实施要点

1. 服务器 compose：`--config-path` 修正 + `entrypoint: ['/qdrant/qdrant']`；Qdrant 配置删 `storage.wal: true` 与写死 `api_key`，鉴权走 `QDRANT__SERVICE__API_KEY`。
2. TEI：`cpu-1.5` 镜像、去 `--normalize=true`、宿主机 hf-mirror 下载 BAAI 模型 + Xenova ONNX，挂载 `/models/bge-small-zh-v1.5`。
3. `llm.config.ts`：读 `LLM_CUSTOM_*`，baseUrl 走 `normalizeOpenAiCompatibleBaseUrl`，注册 `AIProviderId.CUSTOM`。
4. `QdrantService.ensureCollection`：先 `getCollections()` 按 name 判断，不存在再 `createCollection`，存在再校验维度。
5. 验收用专用 tenant/visitor，验收后按 id 清理，不写真实来访者。

## 4. 验收

- 服务器 `curl 127.0.0.1:6333/healthz` 正常；`GET /collections` 可见 `visitor_long_memory`。
- 服务器 `curl 127.0.0.1:8080/v1/embeddings` 返回 512 维。
- 本地 `/admin/api/memories?limit=20` 返回 `scope=long_term`、`source=qdrant`。
- 同 visitor 召回命中；异 visitor / 异 tenant 不命中；同 topicKey 旧点 `supersededBy` 标记且召回不返回。
- lint/typecheck 0 error；专项单测全绿；engine-core 零改动。
