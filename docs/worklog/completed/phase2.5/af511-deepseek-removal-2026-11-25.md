# AF-511 · 彻底移除 DeepSeek 实施记录（2026-11-25）

> 任务：`docs/worklog/records/phase2.5-memory-runtime/AF-511/task-sheet.md`
> 分支：`task/AF-511-deepseek-removal`
> 基线：`8ca2f3f9ff027ac725ad5514faf7366b0aae0f57`（AF-510 squash 合并后）
> 仓库：`D:\work\Project\backend\mofang-nestjs-af281r`

## 1. 结论

DeepSeek 已从现役代码、枚举、配置模板、容器配置、管理后台展示、现役文档与生产镜像中全部移除。
生产库审计确认无 DeepSeek 历史值，未做数据迁移。

## 2. 改动清单

### 2.1 代码与配置

- 删除 `src/llm/providers/deepseek.provider.ts`。
- `src/llm/common/enums/llm.enums.ts`：删除 `AIProviderId.DEEPSEEK`、`ALL_PROVIDER_IDS` 条目与相关注释。
- `src/llm/config/llm.config.ts`：删除 DeepSeek chat/embedding provider 注册与 `LLM_DEEPSEEK_API_KEY` 分支。
- `src/llm/registry/llm-router.service.ts`：默认 chat provider 改为 `MINIMAX`，删除三档 DeepSeek 模型映射。
- `src/engine-adapters/wiring/render-config.factory.ts`：渲染主候选兜底改为 `MINIMAX`。
- `.env.example`：删除 `LLM_DEEPSEEK_API_KEY` 与 `LLM_DEEPSEEK_*` 注释块，默认 chat provider 改 `minimax`，provider/fallback/model 示例去 DeepSeek。
- `docker/litellm/config.yaml`：删除 DeepSeek model 块与重试注释。
- `docker-compose.yml`：删除 DeepSeek 注释。
- `admin-dashboard/src/views/AutoPractice.vue`：删除 `deepseek-chat` 展示映射。
- `scripts/smoke-ai-engine.cjs`：`hasKey` 删除 `LLM_DEEPSEEK_API_KEY`。
- 若干源码注释改为 doubao/qwen/minimax 口径：`src/llm/README.md`、`src/llm/llm.module.ts`、provider/base/provider-registry、`src/ai-engine/ai-engine.module.ts`、`src/ai-engine/entities/llm-conversation.entity.ts`、`src/auto-practice/practice-runner.service.ts`、`src/engine-adapters/persistence/session-summary.generator.ts`、`src/knowledge-base/providers/search.service.ts`。

### 2.2 测试

- 受影响夹具与断言改为现役 provider（qwen / doubao / minimax），不是只改字符串：
  - `test/llm/minimax-provider.spec.ts`：删除 DeepSeek 注册/档位/API key 断言，回归面收敛为 doubao/qwen。
  - `test/engine-adapters/wp8-wiring.spec.ts`：默认 provider 断言改 `MINIMAX`，候选序列用 `minimax + qwen + doubao`，模型名覆盖改 `MiniMax-M3.1-Flash`。
  - `test/engine-adapters/wp-h-render-availability.spec.ts`、`wp11-psyguard-probe.spec.ts`、`wp12-memory-closeout.spec.ts`、`wp6-llm-render.spec.ts`、`wp7-turn-render.spec.ts`、`wp9c-token-fields.spec.ts`：provider 夹具改 qwen/minimax。
  - `test/llm/af210-doubao-tier-mapping.spec.ts`：DeepSeek 档位断言替换为 OPENAI/QWEN 现役档位。
  - `test/config/wp25-env-example-coverage.spec.ts`：`LLM_<PROVIDER>_API_KEY` 派生族从 5 个改为 4 个。
  - `test/llm/custom-embedding-provider.spec.ts`：空 key 夹具由 DeepSeek 改 OPENAI。

### 2.3 现役文档

- `docs/runbooks/memory-runtime-production-release.md`：改为 DeepSeek 源码/枚举/模板已删除，告警检查不再列 DeepSeek。
- `docs/architecture/ai-engine-roadmap-v1.1.md`、`docs/architecture/v6.0-ai-engine.md`、`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`、`docs/reference/ai-simulation-blueprint-v1.1.md`、`docs/specs/active/ai-voice-training-v0.3.md`：provider 列表、目录树、兜底模型与 spec 口径去 DeepSeek。
- 历史 `docs/worklog/**`、`docs/archive/**`、AF-509/AF-510 回执按任务范围保留，不改写历史事实。

## 3. 关键设计决策

1. **默认 provider 统一为 MiniMax**：`LLM_DEFAULT_CHAT_PROVIDER` 与 `ENGINE_RENDER_PRIMARY_PROVIDER` 的最终兜底都改为 `MINIMAX`，避免删枚举后出现无默认值。
2. **不做数据迁移**：生产库只读审计 `llm_conversations.provider_id` 分组为空，所有 `%provider%` / `%model%` 列匹配 `deepseek` 计数为 0。
3. **构建产物必须清干净**：`tsc` 不清理旧 `dist`，首次构建仍残留 `dist/llm/providers/deepseek.provider.js`；已删除 `dist` 后重建，生产镜像内确认无该文件、无 `deepseek` 字符串。
4. **测试语义替换而非字符串替换**：避免把 DeepSeek 夹具机械改成 qwen 后断言失去覆盖意义；默认 provider、候选顺序、tier 映射均按现役 provider 重新构造。

## 4. 闸门证据

| 闸门                                                                                                                         | 结果                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `git grep -n -i deepseek -- src test scripts .env.example docker-compose.yml docker/litellm/config.yaml admin-dashboard/src` | 空输出                                                                              |
| `pnpm lint`                                                                                                                  | exit 0，0 error                                                                     |
| `pnpm typecheck`                                                                                                             | exit 0，0 error                                                                     |
| `pnpm test`                                                                                                                  | 336 passed / 1 skipped（337 files）；4961 passed / 4 skipped（4965 tests）          |
| `pnpm build`                                                                                                                 | exit 0                                                                              |
| `dist` 残留检查                                                                                                              | `dist/llm/providers/deepseek.provider.js` 不存在；全量 `dist/**/*.js` 无 `deepseek` |
| `git diff --stat HEAD -- src/engine-core`                                                                                    | 空输出                                                                              |
| 生产 API 容器                                                                                                                | `mofang-nestjs-api Up (healthy) mofang-nestjs-api:latest`                           |
| 生产 `/health`                                                                                                               | `200`                                                                               |
| 生产 `/admin/api/memories?limit=1`（Basic auth）                                                                             | `200`，返回 `tier=long_term` 条目                                                   |
| 生产启动日志                                                                                                                 | 无 `deepseek` 匹配                                                                  |
| 生产镜像 provider 文件                                                                                                       | `/app/dist/llm/providers/deepseek.provider.js` 不存在                               |

## 5. 生产镜像与回滚

- 新镜像：`mofang-nestjs-api:af511-20261125` / `latest`，镜像 ID `ca273933b436`。
- 回滚镜像：`mofang-nestjs-api:rollback-af511`（AF-509 运行镜像 `2935c7e5a378`）。
- 部署方式：`docker compose -f docker-compose.prod.yml up -d --force-recreate`。
- 生产 `.env` 未改动（AF-510 已无 `LLM_DEEPSEEK_API_KEY`）。

## 6. 遗留与非目标

- `PsyGuardHealthChecker` 仍报服务不可达（不阻断，按既有策略回落本地规则）。
- `QualityAnnotationService` 锚点清单文件缺失告警为既有非阻断项。
- AF-481 `cachedTokens` 接线不在本任务范围。
