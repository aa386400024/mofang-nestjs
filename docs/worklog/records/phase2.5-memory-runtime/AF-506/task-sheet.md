---
taskId: AF-506
contextId: phase2.5-memory-runtime
title: 修复记忆链路：Qdrant 服务器配置 + TEI embedding 接入 + 真链路验收
type: fix
status: backlog
baselineRef: 48cccbeb535e17e8859ba7ec1ebd85615b0e047c
dependsOn: []
priorTasks: [AF-505]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T12:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/llm/config/llm.config.ts
    - .env.example
    - test/llm/
    - docs/runbooks/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-memory-runtime/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af506-memory-runtime-repair-2026-11-25.md
    kind: report
  - name: 远端记忆运行手册
    path: docs/runbooks/remote-memory-runtime.md
    kind: report
gates:
  - command: pnpm exec vitest run test/llm/custom-embedding-provider.spec.ts
    check: 自定义 TEI embedding 注册单测全绿
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
  - 京东云 117.72.30.78 上的 mofang-qdrant 从 created/exit 127 恢复为 running，127.0.0.1:6333/healthz 返回正常。
  - 京东云上的 TEI 改用 CPU 镜像后在 127.0.0.1:8080 提供 /v1/embeddings，bge-small-zh-v1.5 返回 512 维向量。
  - 通过本地 SSH 隧道 + 真实 Qdrant，完成 visitor_long_memory 的写入、按 visitor 召回、跨 visitor 隔离、superseded 排除验收。
  - 远端 Qdrant / TEI 的启停与配置口径写入 docs/runbooks/remote-memory-runtime.md。
  - 不修改 src/engine-core；不把测试密钥、服务器密码、记忆正文写入仓库或日志。
---

# AF-506 · 修复记忆链路（Qdrant 服务器 + TEI embedding + 真链路验收）

> 状态：📋 待执行（2026-11-25）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af281r，分支 integrate
> 服务器：京东云 117.72.30.78（root，现有 mofang-rag / mofang-qdrant / mofang-tei）
> 任务性质：运行态修复 + 小型配置接线
> 改动范围：仓库 LLM 配置/示例 env/测试/运行手册 + 服务器容器；不改 engine-core

## 1. 背景

记忆专项验收发现长时记忆链路实际不可用：

1. 服务器上 `mofang-qdrant` 容器状态 `created`，启动失败，退出码 127。原因是 compose 的 `--config-ration-filename` 拼写错误，Qdrant 正确参数是 `--config-path`；服务器 `/root/mofang-rag/docker-compose.yml` 与仓库根 `docker-compose.yml` 同错。
2. 服务器 `mofang-tei` 用 GPU 镜像启动，日志报 `libcuda.so.1` 缺失，反复 restarting 127；自托管 embedding 不可用。
3. 本地 `.env` 的 `LLM_DEFAULT_EMBEDDING_PROVIDER` 未配置，路由默认 qwen，但 `LLM_QWEN_API_KEY` 缺失，`router.embed()` 直接报 `Embedding provider qwen not registered`；豆包旧 embedding 模型 404。
4. 结果：`QdrantMemoryStore.remember()` 在 embed 步骤拿到空向量，回落进程内存；长时记忆不进 Qdrant，进程重启即丢。

## 2. 范围

**在范围内：**

- `src/llm/config/llm.config.ts`：从 env 注册 OpenAI 兼容 `custom` embedding provider（TEI 用），不新增厂商硬编码。
- `.env.example`：补齐 `LLM_CUSTOM_*` 的真实可配口径。
- `test/llm/custom-embedding-provider.spec.ts`：覆盖 custom embedding 注册与 baseUrl 归一。
- `docs/runbooks/remote-memory-runtime.md`：远端 Qdrant/TEI 启停、端口、SSH 隧道、collection 维度口径。
- 服务器 `/root/mofang-rag/docker-compose.yml`：修正 Qdrant 参数；`mofang-tei` 改 CPU 镜像。
- 服务器容器启停、Qdrant collection 创建、TEI 健康检查、本地 SSH 隧道验收。

**明确不在范围内：**

- 不修改 `src/engine-core/**`；`git diff --stat HEAD -- src/engine-core` 必须为空。
- 不修改仓库根 `docker-compose.yml`：根 compose 不在 executor Agent Card 资源域，另立任务处理；本次以服务器 compose 为运行事实源，并在运行手册里记录这条遗留。
- 不修改 `QdrantMemoryStore` 的召回策略、TopK、衰减、冲突消解逻辑。
- 不修改生产 API 镜像、不做 `master` 合并 / tag / release / 对外部署（L4 需另行批准）。
- 不清理仓库既有未提交/未跟踪文档；提交只暂存本任务文件。
- 不把服务器密码、API key、来访者记忆正文写入日志、交付记录或提交。

## 3. 实施要点

1. 服务器 `/root/mofang-rag/docker-compose.yml`：
   - `--config-ration-filename=/qdrant/config/config.yaml` → `--config-path=/qdrant/config/config.yaml`；
   - `mofang-tei` 镜像从 GPU 默认 tag 改为 `ghcr.io/huggingface/text-embeddings-inference:cpu-1.5`；
   - 不改变 Qdrant 端口映射、数据卷、profile。
2. `llm.config.ts`：
   - 读 `LLM_CUSTOM_BASE_URL`、`LLM_CUSTOM_DEFAULT_MODEL_EMBED`、`LLM_CUSTOM_API_KEY`、`LLM_CUSTOM_DIMENSION`；
   - baseUrl 走 `normalizeOpenAiCompatibleBaseUrl`；
   - 用 `createCustomEmbeddingProvider` 注册 `AIProviderId.CUSTOM`；
   - 未配置 baseUrl/model 时不注册，不影响现有四家 provider。
3. 本地 `.env` 验证口径（不提交）：
   - `QDRANT_URL=http://127.0.0.1:6333`（经 SSH 隧道到服务器）
   - `LLM_DEFAULT_EMBEDDING_PROVIDER=custom`
   - `LLM_CUSTOM_BASE_URL=http://127.0.0.1:8080`（经 SSH 隧道到 TEI）
   - `LLM_CUSTOM_DEFAULT_MODEL_EMBED=BAAI/bge-small-zh-v1.5`
   - `LLM_CUSTOM_DIMENSION=512`
   - `LLM_CUSTOM_API_KEY=tei-local`（TEI 不校验，但 router 要求非空）
4. 验收脚本只读业务数据，不写入真实来访者；用专用 `tenantId=af506-test` / `visitorId=af506-*` 测试点，验收后按 id 清理。

## 4. 验收

- 服务器 `curl 127.0.0.1:6333/healthz` 正常；`GET /collections` 可见 `visitor_long_memory`。
- 服务器 `curl 127.0.0.1:8080/v1/embeddings` 返回 512 维。
- `router.embed()` 不再报 provider 未注册。
- 真实 `QdrantMemoryStore` 写入后，`scroll` 可查到 payload；同 visitor 召回命中；异 visitor 不命中；同 topicKey 旧点被 `supersededBy` 标记且不返回。
- 后端 lint/typecheck 0 error；custom embedding 单测全绿；engine-core 零改动。
