# 心塑 LLM 模块 (V2026-10-14 治本 — VS-3a)

> V0.5 (V2026-09-12 卸 `@langchain/core` + `@langchain/openai`) 装 `langchain-stubs.ts` 临时 stub,
> VS-3a (本目录 2 改 + 1 删 + 1 写) 删 stub + 改 import 真包, **装包是大炮跑 (红线)**.

---

## V0.5 → V1.x 装包命令 (大炮跑, 装包前 tsc 编译会 fail)

```bash
# 必须装的 2 个核心包 (VS-3a 治本依赖)
pnpm add @langchain/core @langchain/openai

# 可选: Node.js types (AbortSignal / AsyncIterable 等)
pnpm add -D @types/node
```

---

## 装包后验证 (大炮跑)

| 验证项               | 命令                                           | 预期                                                |
| -------------------- | ---------------------------------------------- | --------------------------------------------------- |
| TypeScript 编译      | `npx tsc -p tsconfig.build.json --noEmit`      | exit 0                                              |
| pnpm build           | `pnpm build`                                   | exit 0                                              |
| pnpm lint            | `pnpm lint`                                    | exit 0                                              |
| 启动后 provider 注册 | `GET /llm/providers`                           | 返 4 provider (deepseek/doubao/qwen/custom), 0 warn |
| 真实调用 LLM         | `POST /v1/chat/once` (走 LlmOrchestrator)      | 返真 AIMessage, 不再抛 [Stub] Error                 |
| 真实调 embedding     | `POST /ai/knowledge/ingest` (走 Qdrant ingest) | 返真 number[][], 不再抛 [Stub] Error                |

---

## V0.5 Provider (4 OpenAI 兼容, 装包后自动 work)

| Provider ID | 用途                      | env                                          |
| ----------- | ------------------------- | -------------------------------------------- |
| `deepseek`  | 主力 chat (国产 LLM 兜底) | `LLM_DEEPSEEK_API_KEY`                       |
| `doubao`    | 火山方舟 (豆包)           | `LLM_DOUBAO_API_KEY`                         |
| `qwen`      | 阿里通义千问 (DashScope)  | `LLM_QWEN_API_KEY`                           |
| `custom`    | 自定义 OpenAI 兼容        | `LLM_CUSTOM_API_KEY` + `LLM_CUSTOM_BASE_URL` |

> 注: V0.5 4 provider 同时支持 chat (completions) + embedding (embeddings) 双 capability. V1.x 升级
> 加 base/large embedding 模型时, 改 env `LLM_DEFAULT_EMBEDDING_PROVIDER=deepseek` 切厂商, 0 代码改动.

---

## V1.x 计划 (VS-3b/c/d/e)

| Step                                                       | 范围                                                                                                                                                                                             | 治本                                                                 | 状态                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------- |
| **VS-3a 装包 + 修 stub**                                   | 2 改 + 1 删 + 1 写 (server, @langchain/core + @langchain/openai 装包)                                                                                                                            | B4 #4 LangChain stub 治本 (4 provider 调抛 [Stub] Error)             | ✅ 完成 (npx tsc 0 错)             |
| **VS-3b Qdrant + OpenAI 兼容 embedding (plan B)**          | 1 删 (bge-embedding.service.ts 删) + 2 改 (qdrant.service.ts 装包 + ai-engine.module.ts 改 RagService 走 LlmModule.ProviderRegistryService) + 1 改 (docker-compose.yml 删 TEI 容器, 保留 Qdrant) | V3.0 真 RAG 基础设施 (Qdrant 1.x + OpenAI 兼容 4 provider embedding) | 🚧 进行中 (大炮 14:57 拍板 plan B) |
| **VS-3c knowledge_chunks migration + KB search 接 vector** | 1 新写 migration + 1 新写 entity + 3 改 (server)                                                                                                                                                 | V0.x LIKE → V1.x vector search                                       | ⏳ 待                              |
| **VS-3d client similarity score + 高亮**                   | 1-2 改 (client)                                                                                                                                                                                  | 搜索结果 UI 增强                                                     | ⏳ 待                              |
| **VS-3e e2e smoke**                                        | 1 新写 e2e-spec (server)                                                                                                                                                                         | 端到端验证                                                           | ⏳ 待                              |

### VS-3b plan B 部署命令 (大炮跑, 2 步)

**重大变更**: 大炮 14:57 拍板 plan B, **删 bge 自托管 TEI 容器, 改走 OpenAI 兼容 4 provider embedding
(deepseek/doubao/qwen/custom)**. 跟 VS-3a LangChain OpenAI 兼容 base class 1:1 复用, 0 新增技术栈.

```bash
# 1. pnpm add @qdrant/js-client-rest (装包, 跟 VS-3a LangChain 同 pattern)
cd E:\Work\Project\backend\mofang-nestjs
pnpm add @qdrant/js-client-rest

# 2. 启动 Qdrant 单容器 (--profile rag, plan B 删除 TEI 容器)
cd E:\Work\Project\backend\mofang-nestjs
docker compose --profile rag up -d qdrant

# 验证 (大炮跑):
# - docker ps | grep mofang-qdrant        # Qdrant 跑起来
# - curl http://localhost:6333/healthz     # Qdrant healthz OK
# - GET http://localhost:6333/collections  # 返 { collections: [] } (空)

# 3. pnpm build + npx tsc 验 0 错
pnpm build
npx tsc -p tsconfig.build.json --noEmit
```

### OpenAI 兼容 embedding 性能 + 成本 (跟 chat 同 4 provider)

- **模型** (V0.5 默认, V1.x 升级 base/large):
  - `deepseek`: deepseek-chat + text-embedding-3-small (1024 维, 国产兜底)
  - `doubao`: doubao-pro-32k + doubao-embedding (1024/2048 维)
  - `qwen`: qwen-plus + text-embedding-v3 (1024 维)
  - `custom`: 用户自定义 OpenAI 兼容
- **成本**: 4 vendor 按 token 收费, KB 1000 条 ≈ ¥1-3 一次性 (1 vendor 1 次 embed)
- **性能**: 厂商 API 200-500ms/请求, KB 批量 100 条 ~5s
- **V1.x 升级 path**: 改 env `LLM_DEFAULT_EMBEDDING_PROVIDER=deepseek` 切厂商, 0 代码改动

### plan B vs plan A 维护性对比 (大炮 14:47 拍板理由)

| 维度                 | A: bge 自托管 TEI           | B: OpenAI 兼容 API (拍板)              |
| -------------------- | --------------------------- | -------------------------------------- |
| 部署容器数           | 2 (Qdrant + TEI)            | 1 (Qdrant)                             |
| 故障点               | 3 (Qdrant + TEI + bge 模型) | 2 (Qdrant + 厂商 API)                  |
| 镜像下载             | 110MB TEI + 50MB bge        | 0 (复用 VS-3a 装的 LangChain)          |
| 数据隐私             | ✅ 数据不出本地 (合规强)    | ❌ 数据出本地 (合规弱, V0.5 SaaS 够用) |
| 跟 V0.2 KISS culture | ❌ 新增技术栈               | ✅ 复用现有                            |
| V1.x 升级            | 改 env (跟 B 一样)          | 改 env                                 |

---

## 文档元信息

- **作者**: agent
- **基于**: V0.5 卸 LangChain 包 + 装 stub 临时治本 (V2026-09-12)
- **本次变更**: VS-3a (2026-10-14) 删 stub + 改 import 真包
- **下次 review**: VS-3b Qdrant + bge 集成完成后
- **格式**: Markdown
- **存路径**: `mofang-nestjs/src/llm/README.md`
- **配套**: `docs/progress/v3-deep-scan-2026-10-14.md` (V3 主报告) + `docs/specs/ai-voice-training-v0.2.md` (V0.2 spec)
