---
taskId: AF-511
contextId: phase2.5-memory-runtime
title: 彻底移除未使用的 DeepSeek provider、配置与生产镜像残留
type: fix
status: backlog
baselineRef: 8ca2f3f9ff027ac725ad5514faf7366b0aae0f57
dependsOn: []
priorTasks: [AF-510]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T17:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/llm/
    - src/ai-engine/
    - src/auto-practice/practice-runner.service.ts
    - src/engine-adapters/persistence/session-summary.generator.ts
    - src/engine-adapters/wiring/render-config.factory.ts
    - src/knowledge-base/providers/search.service.ts
    - scripts/smoke-ai-engine.cjs
    - test/
    - .env.example
    - docker-compose.yml
    - docker/litellm/config.yaml
    - admin-dashboard/src/views/AutoPractice.vue
    - docs/runbooks/memory-runtime-production-release.md
    - docs/architecture/ai-engine-roadmap-v1.1.md
    - docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md
    - docs/architecture/v6.0-ai-engine.md
    - docs/reference/ai-simulation-blueprint-v1.1.md
    - docs/specs/active/ai-voice-training-v0.3.md
    - docs/worklog/completed/phase2.5/af511-deepseek-removal-2026-11-25.md
    - docs/worklog/records/phase2.5-memory-runtime/AF-511/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af511-deepseek-removal-2026-11-25.md
    kind: report
gates:
  - command: git grep -n -i deepseek -- src test scripts .env.example docker-compose.yml docker/litellm/config.yaml admin-dashboard/src
    check: 代码、测试、模板与容器配置中不再有 DeepSeek 引用
    threshold: empty output
  - command: pnpm lint
    check: lint 0 error
    threshold: '0'
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: '0'
  - command: pnpm test
    check: 全量单测全绿
    threshold: 0 failed
  - command: pnpm build
    check: 构建成功
    threshold: exit 0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty output
  - command: docker ps --filter name=mofang-nestjs-api
    check: 生产 API healthy
    threshold: Up (healthy)
  - command: curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health
    check: 生产健康检查 200
    threshold: '200'
successCriteria:
  - DeepSeek provider 文件、AIProviderId.DEEPSEEK 枚举值、ALL_PROVIDER_IDS 条目与启动注册分支全部删除。
  - 默认 chat provider 与引擎渲染默认候选改为 MiniMax，不再以 DeepSeek 作兜底占位。
  - .env.example、docker-compose 注释、litellm 配置、admin-dashboard 模型展示中不再出现 DeepSeek。
  - 受影响单测改为覆盖 qwen/doubao/minimax 等现役 provider，全量测试、lint、typecheck、build 全绿。
  - 生产库已审计：llm_conversations.provider_id 及所有 provider/model 列无 deepseek 历史值，无需数据迁移。
  - 生产镜像重建并部署，容器 healthy、/health 200、管理后台记忆接口带鉴权 200。
  - 不改 src/engine-core；不泄露服务器密码、Qdrant key、MiniMax key、admin 口令。
---

# AF-511 · 彻底移除 DeepSeek

> 状态：📋 待执行（2026-11-25）
> 仓库：D:\work\Project\backend\mofang-nestjs-af281r
> 基线：integrate 8ca2f3f9（AF-510 squash 合并后）

## 1. 背景

用户确认 DeepSeek 从项目开始至今从未实际使用，要求彻底删除，不再保留 provider 源码、枚举、配置模板与生产镜像残留。

生产库只读审计结果：

- `llm_conversations.provider_id` 分组为空（0 行）。
- 信息架构中所有 `%provider%` / `%model%` 列对 `deepseek` 的匹配计数为 0。

## 2. 范围

**在范围内：**

- 删除 `src/llm/providers/deepseek.provider.ts`、`AIProviderId.DEEPSEEK`、`ALL_PROVIDER_IDS` 条目、`registerDefaultProviders` 的 DeepSeek 分支。
- 清理 `src/llm` 路由默认值与 tier 映射、`render-config.factory.ts` 兜底默认值。
- 清理 `.env.example` 中 `LLM_DEEPSEEK_*`、默认 provider 与相关注释。
- 清理 `docker/litellm/config.yaml` 的 DeepSeek 模型块与 `docker-compose.yml` 注释。
- 清理 admin-dashboard 模型展示映射。
- 更新受影响单测与 smoke 脚本。
- 更新现役架构/spec/runbook 口径（不改历史 worklog 与 archive）。
- 重建生产镜像并部署验证。

**明确不在范围内：**

- 不改 `src/engine-core/**`。
- 不删历史 worklog、archive、已完成回执中的历史记录（它们是被审计的历史事实）。
- 不做数据库迁移：生产库审计为 0 条 DeepSeek 值。
- 不处理 AF-481 的 cachedTokens 接线。

## 3. 实施要点

1. 先删 provider 与枚举，再全局 grep 找断链，逐个改到 0 引用。
2. 默认 chat provider 统一改 `minimax`；`ENGINE_RENDER_PRIMARY_PROVIDER` 缺省回落同一值。
3. `.env.example` 明确 `LLM_DEFAULT_CHAT_PROVIDER=minimax`，删除 `LLM_DEEPSEEK_API_KEY` 与 `LLM_DEEPSEEK_*` 注释块。
4. 测试中把 DeepSeek 夹具替换为现役 provider（优先 qwen/doubao/minimax），不要仅改字符串导致断言失去意义。
5. 生产重建前保留 `mofang-nestjs-api:rollback-af511`；部署后验证 health、admin memories、启动日志。

## 4. 验收

- `git grep -n -i deepseek -- src test scripts .env.example docker-compose.yml docker/litellm/config.yaml admin-dashboard/src` 空输出。
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` 全绿。
- 生产 API `Up (healthy)`，`/health` 200，`/admin/api/memories` 带鉴权 200。
- 生产镜像内 `src/llm/providers/deepseek.provider.ts` 不存在（构建产物验证）。
