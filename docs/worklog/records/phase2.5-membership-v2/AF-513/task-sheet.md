---
taskId: AF-513
contextId: phase2.5-membership-v2
title: AF-512 返修：交付记录机读字段与任务记录 scope 对齐
type: fix
status: backlog
baselineRef: 2495b682
dependsOn: []
priorTasks:
  - AF-512
scope:
  files:
    - docs/worklog/completed/phase2.5/af512-membership-v2-enterprise-implementation-2026-11-25.md
    - docs/worklog/records/phase2.5-membership-v2/
  modules: []
  interfaces: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.1
  - conventions.md#1.3
  - conventions.md#三
createdAt: 2026-11-25T23:45:00+08:00
agentRole: orchestrator
---

# AF-513 · AF-512 返修：交付记录机读字段与任务记录 scope 对齐

> 状态：📋 待执行（2026-11-25）
> 执行方：自做（MainAgent）
> 仓库：D:\work\Project\backend\mofang-nestjs-af070，基线 2495b682
> 任务性质：返修（验收机读护栏）
> 改动范围：仅任务记录包与交付记录；不改业务代码、不改 spec、不改已归档任务单正文

---

## 1. 背景

AF-512 实现与闸门均已通过，但 `run-once` 验收给出两条机读护栏失败：

1. 交付记录未出现六组字段标记：`gateResults` / `scopeCheck` / `contractChecks` / `backlogItems` / `deviationTable` / `reviewVerdict`。
2. 提交事实包含 `docs/worklog/records/phase2.5-membership-v2/AF-512/manifest.json`，但 AF-512 任务单 scope 未声明任务记录包路径，触发 `V7 文件域残留`。

AF-512 已按终态归档，按编排规则不回写已归档任务；本返修任务在 AF-512 提交之上补交付记录的机读字段，并把任务记录包纳入本任务 scope，重新走回执与验收。

---

## 2. 范围

**在范围内：**

- 只修改 `docs/worklog/completed/phase2.5/af512-membership-v2-enterprise-implementation-2026-11-25.md`，补齐六组机读字段标记表。
- 允许新增/更新 `docs/worklog/records/phase2.5-membership-v2/` 下的任务记录包与回执副本。
- 回执 `changedFiles.commits` 只声明本返修补丁提交。

**明确不在范围内：**

- 不改 `src/**`、`test/**`、`bin/**`。
- 不改 `docs/specs/active/membership-system-v2.0.md`。
- 不改 AF-512 任务单正文与 manifest 哈希。
- 不改已归档 AF-512 的事件链。

---

## 3. 验收标准

1. 交付记录出现六个字段标记：`gateResults`、`scopeCheck`、`contractChecks`、`backlogItems`、`deviationTable`、`reviewVerdict`。
2. 交付记录中的闸门数字与 AF-512 回执一致，不新增未验证结论。
3. `pnpm orchestration:preflight` PASS。
4. `pnpm orchestration:run` 摄入回执后验收通过并归档。
5. `git diff --stat HEAD -- src/engine-core` 为空。

---

## 4. 闸门

- `pnpm orchestration:preflight` exit 0。
- `pnpm orchestration:run` 摄入回执后 `reviewVerdict=passed`。
- `git diff --stat HEAD -- src/engine-core` 为空。

---

## 5. 交付

- 交付记录在原 AF-512 交付记录上追加“机读回执字段对齐”章节。
- 回执 `docs/team/agent-orchestration/transport/receipts/AF-513.json`。
- commit message：`docs(af513): 补齐 AF-512 交付记录机读字段`
