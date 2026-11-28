---
taskId: AF-594
contextId: phase2.5-quality-gates
title: AI 会话热路径内存与写放大根治
type: fix
status: backlog
baselineRef: 122fd586ddc41c0a5b5acc254467cb652c263493
dependsOn: []
priorTasks: [AF-593]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T08:35:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/persistence/
    - src/engine-adapters/rendering/
    - src/engine-adapters/wiring/
    - src/ai-engine/providers/
    - src/ai-companion/providers/
    - src/consent/providers/
    - src/llm/common/base/
    - test/engine-adapters/
    - test/ai-engine/
    - test/ai-companion/
    - test/consent/
    - test/llm/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af594-ai-hotpath-performance-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters test/ai-engine test/ai-companion test/consent test/llm
    check: 会话热路径定向测试全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: 0 failed
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: empty output
successCriteria:
  - 工作记忆仓改为有界实现：单会话条数上限、全局会话上限、会话 TTL，写入与召回都不再全量扫描整个进程
  - 会话关闭时清理该会话工作记忆；Qdrant 未配置与 Qdrant 不可达两条路径都使用同一有界回落仓
  - 续聊不再重复 save 会话行；只在新建会话时 insert，流结束用原子累加写 token
  - promptTokens 从上游 usage 回填，completionTokens 按本轮累加，token 字段可用于成本审计
  - 同意前置校验命中 Redis 短 TTL 缓存；撤回同意时缓存失效
  - LLM chat / embedding 客户端按配置键复用，避免每请求重建
  - 定向测试、typecheck、lint、全量测试全绿，engine-core 零 diff
objective: 消除会话引擎随运行时间恶化的内存与 CPU 曲线，并把 AI 对话每轮固定 DB 往返压到最小
outOfScope:
  - 不改 engine-core 任何文件（有界仓放在 engine-adapters）
  - 不改会话表结构 / 不加 migration
  - 不改前端、不改 LLM 供应商协议
  - 不引入新依赖
constraints:
  - 有界仓必须实现既有 MemoryStore 端口语义，召回排序与过滤口径不得变化
  - 会话清理只能通过适配层可选能力，不允许改内核端口签名
  - 续聊归属校验必须保留，缺失或越权仍抛 LlmConversationNotFound
  - token 累加必须保留原有 endedAt / crisisEventId 写入
---

# AF-594 · AI 会话热路径内存与写放大根治

> 状态：📋 待执行（2026-11-28）
> 执行方：自做
> 分支：task/AF-594-ai-hotpath-performance（stacked 自 AF-593 head，PR 取代 #306）
> 唯一事实源：本轮性能审计结论 + AF-593 已归档实现
> 改动范围：仅后端 src/test/docs

## 0. 必读入口

1. `README.md`
2. `docs/README.md`
3. `docs/team/conventions.md`
4. `docs/team/agent-orchestration/README.md`
5. 本任务单

## 1. 背景

- `InMemoryMemoryStore` 默认 TTL null，`remember()` 每次全 Map sweep；每轮对练写 2 条，会话关闭不清，进程内线性增长。
- AI 流式对话续聊每轮重复 `save` 会话、末尾 `update`、recorder 再 `findOne + save`，加 consent 查询约 5~6 次 DB 往返。
- `promptTokens` 硬编码 0，`completionTokens` 被覆盖而非累加，token 字段不可用于计费。
- 同意校验每轮查一次 `user_consents`；LLM 客户端每请求 new。

AF-593 已提供 `ChatSessionRecorder`，本任务在其 head 上继续。

## 2. 范围

**在范围内：**

- 新增 `BoundedInMemoryMemoryStore`（engine-adapters/persistence），并在 `createEngineMemoryStore` 装配。
- `TurnRenderOrchestrator.forgetSession` 通过可选能力清理该会话记忆。
- `LlmOrchestratorService` 会话创建与 token 写入。
- `ConsentService` 正向缓存与失效。
- chat / embedding 客户端复用。
- 对应测试与交付记录。

**明确不在范围内：**

- 不改 `src/engine-core/**`；不新增端口方法。
- 不改 `ai_chat_sessions` / `llm_conversations` 表结构。
- 不做摘要 cron / 历史分页。
- 不引入 Redis 之外的新基础设施。

## 3. 交付物

1. `BoundedInMemoryMemoryStore`：按 tenant+session 分桶；单会话 200 条、全局 1000 会话、会话空闲 TTL 6h；写入只清理本会话过期条目；召回只扫本会话；`forgetSession` 可选方法。
2. 装配层：Qdrant 与纯内存都使用同一个 bounded fallback；`recallPolicy` 继续透传。
3. `TurnRenderOrchestrator.forgetSession`：清 histories 后调用 bounded store 的 `forgetSession`（结构性类型判断，不改端口）。
4. `LlmOrchestratorService`：续聊仅做归属校验；新会话才 insert；token 用单条 SQL 原子累加，`promptTokens` 取 `chunk.promptTokens`。
5. `ChatSessionRecorder`：保持幂等 upsert，减少一次不必要的整行回写（能安全合并则合并）。
6. `ConsentService`：`assertAccepted` 正缓存 300s，record/withdraw/bind 失效。
7. LLM 客户端缓存：chat 按 baseUrl+model+apiKey+影响请求的配置键，embedding 按 baseUrl+model+apiKey；缓存上限 32。

## 4. 红线

- engine-core 零改动，`boundary.spec.ts` 不改。
- 召回语义与排序必须与内核 `evaluateRecallCandidate` 一致，复用内核纯函数。
- 会话越权校验不得放宽。
- 心理原文不得进日志。

## 5. 闸门

- 定向：`pnpm exec vitest run test/engine-adapters test/ai-engine test/ai-companion test/consent test/llm`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `git diff --stat HEAD -- src/engine-core` 为空

## 6. 交付记录

`docs/worklog/completed/phase2.5/af594-ai-hotpath-performance-2026-11-28.md`，含七组机读标记。

## 7. 回写清单

- 交付记录、状态面归档、PR、commit message `fix(af594): bound engine memory and collapse chat writes`。
</content>
