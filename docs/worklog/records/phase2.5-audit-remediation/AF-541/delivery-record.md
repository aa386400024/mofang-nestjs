---
taskId: AF-541
contextId: phase2.5-audit-remediation
title: 扩充 executor 资源域以覆盖部署与 CI 文件
status: completed
completedAt: 2026-11-26T18:05:00+08:00
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
commit: 任务分支 HEAD（以回执 changedFiles.commits 为准）
---

# AF-541 扩充 executor 资源域

## 结论

审计 P0/P1 修复含仓根部署与 CI 文件，但 executor Agent Card 只声明了 `src/`、`bin/`、`test/` 等目录，调度阶段对这些文件报 `scope-domain-conflict`。本任务把 `Dockerfile`、`Dockerfile.prod`、`docker-compose.yml`、`docker-compose.prod.yml`、`.dockerignore`、`package.json`、`.github/workflows/` 补进 executor 的 `resources`，只扩资源域，不改执行语义。

## 改动

- `docs/team/agent-orchestration/agent-cards/executor.json`：`resources` 增加上述 7 项。
- 归档 AF-540 的 durable 回执与 manifest 随本任务一并入库。

## 闸门

- `pnpm orchestration:preflight`：PASS（task=AF-541，files=5 covered=1，其余为已声明工件/状态面）。
- `node scripts/orchestration/cli.mjs validate`：任务单、Agent Card、回执、索引与事件链全部 PASS。

## 偏差

无。未改任何业务代码或执行语义。
