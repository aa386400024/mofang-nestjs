---
taskId: AF-021
contextId: framework-evolution
title: 非生产收尾：CI 再提速、master 保护、journal 分段归档、归档语义与 WP38 flake
type: implementation
status: completed
baselineRef: 540cf44
dependsOn: [AF-020]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, agent-orchestration/README.md#40]
createdAt: 2026-11-17T01:00:00+08:00
---

# AF-021 · 非生产收尾（企业级）

> 状态：✅ 已完成（2026-11-17）
> 执行方：orchestrator 自做
> 仓库：`D:\work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源：`.github/workflows/ci.yml`、`scripts/orchestration/event-store.mjs`、`docs/team/agent-orchestration/README.md`
> 任务性质：CI 工具链 + 状态语义 + 测试时序治理
> 改动范围：仅后端 CI / scripts / 一处 debug service 与其 spec + 编排文档；业务 `src/` 其余零改动；生产部署排除

## 1. 目标

在 AF-020 已闭环基础上，把除生产部署外的收尾项一次性做到可交付：

1. CI 再提速：Docker 构建缓存、Coverage 分片/合并、TypeScript 增量检查。
2. `master` 分支保护落地（单人仓可执行口径）。
3. journal 长期保留与压缩归档，保持 append-only 审计链。
4. `archived` 投影语义对齐框架 `rec.status`。
5. IM-034：WP38 并发 30s 超时根治。

## 2. 范围与隔离

- 允许：`.github/workflows/ci.yml`、`scripts/orchestration/**`、`src/admin-debug/debug-session.service.ts`、`test/admin-debug/wp38-debug-session-resume.spec.ts`、编排 README / worklog。
- 禁止：生产部署、框架仓改动、`src/engine-core/**`、未跟踪设计稿 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`。
- 一个提交一个意图；既有债登记不就地清理。

## 3. 验收口径

- CI YAML 可解析，job 名称与 `master` 必需检查 contexts 一致。
- journal 轮转前后事件总数、`eventSeq`、`prevHash`/`hash` 链、索引投影一致；归档段不可变。
- 归档只发生在终态之后，禁止用 `to` 改写终态；非终态归档必须先补齐合法迁移链。
- WP38 ③ 以服务登记的异步任务 drain 同步，不依赖固定超时轮询。
- 收尾闸门：`pnpm lint`、`tsc --noEmit -p tsconfig.json`、`pnpm test` 全绿。

## 4. 交付回写

- [x] 代码与文档落地
- [x] 定向测试 / 全量闸门记录
- [x] 交付记录成对归档
- [x] 阶段入口与 AF-020 遗留口径回写
- [x] 新 CI run 实测数字：`43915822192` 10/10、130s；`43918327585` attempt 2 12/12、稳态 111s；Coverage Gate 合并 48.31/47.37/44.25/48.09 全过
