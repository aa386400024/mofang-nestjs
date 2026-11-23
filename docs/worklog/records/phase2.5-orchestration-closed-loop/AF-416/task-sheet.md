---
taskId: AF-416
contextId: phase2.5-orchestration-closed-loop
title: 调试会话原子写硬化：唯一临时文件 / writeFile 重试 / 回填串行
type: fix
status: backlog
baselineRef: d259db7bc4e48b64ce478fe718098bb008157000
dependsOn: []
priorTasks: [AF-414]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T04:25:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/admin-debug/
    - test/admin-debug/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af416-atomic-write-hardening-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug/af414-atomic-write-retry.spec.ts test/admin-debug/debug-session-persistence.spec.ts
    check: 原子写与持久化定向单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿，记录真实数字
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 临时文件名唯一（含 pid 与随机后缀），跨进程并发写同一会话不再互相覆盖；写失败清理自己的临时文件
  - writeFile 与 rename 共用可重试错误白名单与退避策略；重试耗尽抛出原始错误并附带 attempts / retried 标记
  - 重试参数支持 env 注入并夹取，非法值回落默认；默认行为与 AF-414 一致（3 次尝试、10ms 基数、指数退避）
  - 远端回填只在本地缺失或远端更新时执行，且走同一 per-session 写队列，不再与排队写并发
  - 补测：混合错误序列、退避序列断言、attempts/baseDelay 夹取、耗尽标记、唯一临时名、回填判定
  - 勘误 AF-414 交付记录的退避时长（70ms → 30ms），并如实登记根因未实证
  - 不碰 engine-core，不改变落盘 JSON 结构，不改变对外 API 语义
---

## 背景

AF-414 给 `rename` 加了有限重试，但 MiniMax Code 只读评审指出三处真实缺口：

1. 临时文件固定为 `${target}.tmp`，跨进程并发写同一会话会互相覆盖，重试反而放大窗口；
2. `writeFile` 未纳入重试，写阶段瞬时占用仍会直接失败；
3. `get()` 在远端 mirror 开启时每次读都全量写回本地，且绕过 `enqueue`，与排队写并发，是真实竞态；而现有测试只覆盖 mirror=null 分支。

同时 AF-414 交付记录写「退避上限 70ms」，代码实际为 3 次尝试 × 2 次 sleep = 10ms + 20ms = 30ms，口径需要勘误。

## 目标

1. 抽出 `src/admin-debug/atomic-write.ts`：唯一临时路径、可重试错误判定、带标记的耗尽错误、writeFile 与 rename 共用重试外壳；`debug-session-store.ts` 保留同名 re-export，避免破坏既有导入。
2. `writeRecord` 改用唯一临时文件 + `writeFile` 重试 + `rename` 重试，失败清理临时文件。
3. `get()` 回填改为「本地缺失或远端更新才写」，并走 `enqueue` 串行。
4. 重试参数 env 注入（`ADMIN_DEBUG_RENAME_RETRY_ATTEMPTS` / `ADMIN_DEBUG_RENAME_RETRY_BASE_DELAY_MS`），非法值回落默认。
5. 补齐 MiniMax 指出的测试缺口。

## 范围隔离

只改 `src/admin-debug/` 与 `test/admin-debug/`、交付记录、记录包；不改落盘结构、不改 API、不碰 `src/engine-core`、不碰前端。
