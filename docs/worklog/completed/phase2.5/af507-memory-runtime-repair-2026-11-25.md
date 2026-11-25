# AF-507 · 修复记忆链路（Qdrant 服务端 + 集合创建缺陷 + TEI embedding + 真链路验收）交付记录

- 任务：AF-507（承接已取消的 AF-506）
- 分支：`task/AF-507-memory-runtime-repair`
- 基线：`48cccbeb535e17e8859ba7ec1ebd85615b0e047c`
- 交付日期：2026-11-25
- 结论：运行态与代码链路均已修复并完成真链路验收；未做生产发布（L4 未授权）。

## 1. 问题与根因

长时记忆此前只有单测绿，真实链路实际不可用，四个独立故障叠加：

1. 京东云 `117.72.30.78` 的 `mofang-qdrant` 处于 `created`，启动 exit 127。compose 把 `--config-path` 拼成了 `--config-ration-filename`；另外 Qdrant 官方镜像没有 ENTRYPOINT，只修参数仍会报 `exec ... no such file`。
2. `mofang-tei` 用 GPU 镜像启动，容器内缺 `libcuda.so.1`，反复 restarting 127。
3. 本地 `.env` 未配 embedding provider，路由默认 qwen 但无 key，`router.embed()` 报 `Embedding provider qwen not registered`。
4. 真链路写入又暴露 `QdrantService.ensureCollection` 的判定缺陷：只匹配 `Not found` / `404`，SDK 实际抛 `Not Found`，集合永不创建，首次 upsert 400，长时记忆静默回落进程内存。

## 2. 改动文件

| 文件                                                       | 改动                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/llm/config/llm.config.ts`                             | 从 `LLM_CUSTOM_BASE_URL` / `LLM_CUSTOM_DEFAULT_MODEL_EMBED` / `LLM_CUSTOM_ENABLED` / `LLM_CUSTOM_DIMENSION` 注册 OpenAI 兼容 `custom` embedding provider；baseUrl 走 `normalizeOpenAiCompatibleBaseUrl`；缺 baseUrl 或模型不注册 |
| `src/ai-engine/providers/qdrant.service.ts`                | `ensureCollection` 改为先 `getCollections()` 按 name 判断存在性，不存在则 `createCollection`，存在再校验维度，不再依赖错误文案                                                                                                   |
| `.env.example`                                             | 补齐 TEI / 私有网关的 custom embedding 配置口径与 `LLM_CUSTOM_DIMENSION=512`                                                                                                                                                     |
| `test/llm/custom-embedding-provider.spec.ts`               | 新增 5 例：注册、`/v1` 归一、缺 base/model 不注册、`LLM_CUSTOM_ENABLED=false` 禁用、非法维度回落 1024                                                                                                                            |
| `test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts`    | 新增 1 例：集合不存在时按 512 维 Cosine 创建；共 5 例                                                                                                                                                                            |
| `docs/runbooks/remote-memory-runtime.md`                   | 新增远端记忆运行手册：拓扑、compose 口径、TEI CPU/ONNX/本地模型、SSH 隧道、本地 env、排障表、遗留项                                                                                                                              |
| 服务器 `/root/mofang-rag/docker-compose.yml`               | Qdrant 加 `entrypoint: ['/qdrant/qdrant']`、`command: [--config-path=/qdrant/config/config.yaml]`；TEI 改 `cpu-1.5`、去 `--normalize=true`、挂载本地模型、`--model-id`                                                           |
| 服务器 `/root/mofang-rag/docker/qdrant/config/config.yaml` | 删除 `storage.wal: true`（1.12 要求对象）、删除写死空 `api_key`，鉴权只走 compose env                                                                                                                                            |
| 服务器 `/root/mofang-rag/.env`                             | 写入 48 位随机 `QDRANT_API_KEY`（值不入库、不入日志）                                                                                                                                                                            |
| 服务器 `/root/models/bge-small-zh-v1.5/`                   | BAAI 模型文件 + `Xenova/bge-small-zh-v1.5` 的 `onnx/model.onnx`                                                                                                                                                                  |

## 3. 关键决策与踩坑

1. **Qdrant 必须显式 entrypoint**：该镜像没有 Dockerfile ENTRYPOINT，只把参数改对仍会 `exec: "--config-path=...": stat ... no such file`。
2. **Qdrant 1.12 的 `storage.wal` 必须是对象**：`wal: true` 会让启动报 `invalid type: boolean true, expected struct WalConfig`；写死空 `api_key` 会被当成启用了空 key。
3. **TEI 镜像与模型获取**：GHCR 拉取卡住，改用 `ghcr.nju.edu.cn/huggingface/text-embeddings-inference:cpu-1.5` 后 `docker tag` 成官方名；服务器无法访问 `huggingface.co` 且 Rust hf-hub 不认 `HF_ENDPOINT`，改为宿主机从 `hf-mirror.com` 下载模型再只读挂载。
4. **CPU 后端只认 ONNX**：BAAI 原仓无 ONNX，补下 `Xenova/bge-small-zh-v1.5` 的 `onnx/model.onnx`（90.4MB）后才 `Ready`。
5. **集合存在性判断**：错误文案在不同 Qdrant 版本不稳定，列集合是稳定契约；修改后首次写入即成功，不再回落内存。
6. **point id 必须是 UUID 或整数**：验收脚本最初用 `verify-a-1` 触发 Bad Request；真实长时记忆 id 来自 `session-closeout` 的 `randomUUID()`，换 UUID 后正常。

## 4. 验收证据

### gateResults

| 闸门               | 命令                                                                                                                    | 结果                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 专项单测           | `pnpm exec vitest run test/llm/custom-embedding-provider.spec.ts test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts` | 2 files / 10 tests passed                                           |
| 全量测试           | `pnpm test`                                                                                                             | 336 passed / 1 skipped files；4961 passed / 4 skipped tests；30.63s |
| Lint               | `pnpm lint`                                                                                                             | 0 error                                                             |
| 类型检查           | `pnpm typecheck`                                                                                                        | 0 error                                                             |
| 构建               | `pnpm build`                                                                                                            | 0 error                                                             |
| engine-core 零改动 | `git diff --stat HEAD -- src/engine-core`                                                                               | 空输出                                                              |

### 运行态

- `curl http://127.0.0.1:6333/healthz` → `healthz check passed`；带 key `GET /collections` 返回 `visitor_long_memory`。
- `curl http://127.0.0.1:8080/v1/embeddings` → 512 维向量。
- `docker ps`：`mofang-qdrant` Up (healthy)、`mofang-tei` Up (healthy)。
- 本地 `/admin/api/memories?limit=20` → `scope=long_term`、`source=qdrant`，验收清理后 `total=0`。
- 本地通过 SSH 隧道访问远端 Qdrant/TEI：`127.0.0.1:6333`、`127.0.0.1:8080`。

### 真链路读写

使用 `QdrantMemoryStore` + 真实 `QdrantService` + TEI embedding，写入 4 条合成记忆（专用 tenant/visitor）：

- 写入数 4。
- 来访 A 查询“睡不着，工作压力大，总担心别人离开我” → 失眠记忆 `0.7167`、照护记忆 `0.5177`。
- 来访 B 查询“最近在跑马拉松” → 跑步记忆 `0.8507`。
- 隔离：`aSeesB=false`、`bSeesA=false`、`tenantBSeesTenantA=false`；租户 B 的同名来访只召回租户 B 自己的条目。
- superseded：同 visitor 同 topicKey 连写两条，旧点 payload `supersededBy` 指向新点，召回只返回新点。
- 验收后按 `visitorId` 删除，`points_count=0`。

## 5. scopeCheck

`scopeCheck: in-scope`

实际改动均落在 AF-507 `scope.files` 内：

- `src/llm/config/llm.config.ts`
- `src/ai-engine/providers/qdrant.service.ts`
- `.env.example`
- `test/llm/`、`test/engine-adapters/`
- `docs/runbooks/`、`docs/worklog/pending/`、`docs/worklog/completed/phase2.5/`、`docs/worklog/records/phase2.5-memory-runtime/`

未修改 `src/engine-core/**`、`src/engine-adapters/persistence/qdrant-memory.store.ts`、仓库根 `docker-compose.yml`、生产镜像。验收数据全部为合成文本并使用专用 tenant/visitor，无真实来访者数据。

## 6. contractChecks

- `engine-core` 纯层零改动，未新增网络、prompt、`process.env`。
- 未把服务器密码、Qdrant API key、记忆正文写入仓库、交付记录或日志；Qdrant key 只存在于服务器 `.env` 与本地 `.env`（均不入库）。
- 未做 `master` 合并 / tag / release / 生产部署。
- executor 不提交；提交与推送由 orchestrator 按仓库发布分层执行。
- 未清理仓库既有并行未提交/未跟踪文件，提交只暂存本任务文件。

## 7. deviationTable

| 项              | 计划                     | 实际                                                            | 原因                                                                                                      |
| --------------- | ------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 任务载体        | AF-506                   | AF-506 取消，AF-507 承接                                        | 真链路验收发现 `QdrantService.ensureCollection` 缺陷，AF-506 scope 未覆盖该文件；先取消再按完整范围重登记 |
| Qdrant 启动     | 只修 `--config-path`     | 追加显式 `entrypoint`、删 `storage.wal: true`、删写死 `api_key` | 镜像无 ENTRYPOINT；1.12 配置 schema 与空 key 语义导致启动失败                                             |
| TEI 镜像        | 直接改 CPU tag           | 南京大学镜像拉取后 `docker tag`，宿主机下载模型 + ONNX 挂载     | GHCR 拉取卡住；服务器不可达 huggingface.co；CPU 后端只认 ONNX                                             |
| 本地 env 模型名 | `BAAI/bge-small-zh-v1.5` | `bge-small-zh-v1.5`                                             | TEI 以本地路径加载模型，模型名只作为请求标识；避免 TEI 再联网解析仓库名                                   |
| 根 compose      | 不在范围                 | 保持原样                                                        | 不在 executor 资源域，留作遗留项                                                                          |

## 8. backlogItems

1. **根 `docker-compose.yml` 同错未修**：仍有 `--config-ration-filename` 且缺 Qdrant entrypoint；需另立任务，按服务器已验证口径同步。
2. **生产 `mofang-nestjs-api` 未更新**：仍是 2026-08-26 旧镜像，`/admin/api/memories` 404，生产 `.env` 无 QDRANT/LLM 配置；本次未获 L4 授权，不发布。
3. **Qdrant SDK 版本偏差**：客户端 1.20 与服务器 1.12 有兼容警告，当前读写正常；是否降客户端版本待评估。
4. **SSH 隧道未固化**：当前为手工后台进程，机器重启或断线需重建；可后续做成脚本/服务。
5. **`QdrantMemoryStore` 冲突消解策略未审**：本次只验 superseded 行为，未改 TopK/衰减/冲突策略。

## 9. reviewVerdict

`reviewVerdict: passed`

代码闸门全绿，运行态真实读写、召回、隔离、superseded 均通过验收；遗留项已登记 backlog，未做未授权的生产发布。
