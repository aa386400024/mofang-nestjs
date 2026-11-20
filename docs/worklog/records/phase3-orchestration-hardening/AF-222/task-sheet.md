---
taskId: AF-222
contextId: phase3-orchestration-hardening
title: 跨机编排硬化批次（单写者 CAS / 编号占用 / 归档前置 / 记录包完整性 / 密钥卫生 / 两阶段提交门 / 豆包可发现性）
type: implementation
status: backlog
baselineRef: 9fd9792
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-21T02:35:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - scripts/security/
    - docs/team/agent-orchestration/
    - docs/security/
    - .env.example
    - .prettierignore
    - package.json
  modules:
    - orchestration
  interfaces: []
artifacts:
  - name: 交付记录 01 跨机单写者
    path: docs/worklog/completed/phase3-orchestration/af222-01-cross-machine-hardening-2026-11-21.md
    kind: report
  - name: 交付记录 02 记录包与密钥卫生
    path: docs/worklog/completed/phase3-orchestration/af222-02-record-integrity-and-secret-hygiene-2026-11-21.md
    kind: report
  - name: 交付记录 03 豆包可发现性
    path: docs/worklog/completed/phase3-orchestration/af222-03-doubao-env-discoverability-2026-11-21.md
    kind: report
  - name: 交付记录 04 两阶段提交门
    path: docs/worklog/completed/phase3-orchestration/af222-04-ci-gate-two-phase-commit-2026-11-21.md
    kind: report
  - name: 跨机单写者与编号分配口径
    path: docs/team/agent-orchestration/cross-machine-single-writer.md
    kind: report
  - name: 跨机密钥交接规程
    path: docs/security/secret-handoff.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/ scripts/security/__tests__/
    check: 编排护栏与 env-doctor 定向用例全绿
    threshold: exit=0
  - command: pnpm exec vitest run test/config/wp25-env-example-coverage.spec.ts
    check: 部署契约双向断言绿
    threshold: exit=0
  - command: node scripts/orchestration/ci-task-gate.mjs --base f32b62b --head HEAD
    check: 真实历史逐提交全通过
    threshold: ok=true
  - command: pnpm lint
    check: ESLint 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量用例 0 failed（收尾一次）
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - run-once / watch 用 GitHub ref 原子创建做跨机单写者 CAS，抢不到锁本轮不迁移任何状态；无凭据时降级并在 status 明示。
  - 任务登记执行编号三源占用检查（远端 task/* 分支、远端 integrate 索引、本地 records），命中即拒并给出下一个可用号；提供 task next-id。
  - 归档前校验 scope 内实现是否已全部提交，未提交则保持 in-flight 并产出 archive-blocked-uncommitted。
  - docs/worklog/records/** 字节不再被 prettier 改写；pnpm env:doctor 按模板键集体检 .env 且不打印任何密钥值；交接规程可执行。
  - CI 逐提交门接受两阶段提交（实现提交凭提交内任务单入场），越界仍判红，验收门不放宽。
  - .env.example 增补豆包 provider 注释（有效模型 ID / 下线别名 / 覆盖键 / 跨机交接指引），生效键集零变化。
---

## 背景与批次说明

本批次原拆为 AF-217（跨机单写者硬化）、AF-218（记录包完整性与密钥卫生）、AF-219（豆包可发现性）、AF-220（两阶段提交门）。迁移过程中遇到两个真实机制问题：

1. 远端 `origin/integrate` 已前进到 `f32b62b`，另一台机器已用 AF-213 归档、并占用 AF-214 分支，原三单编号撞车；
2. 同一 context 下多个任务同时处于 submitted 时，下一轮 `run-once` 会把先前的 in-flight 判为「归档前闭合终态」并 rejected 归档（AF-217/218/219 实证）。

因此本批次合并为一个任务单在一次提交内收口，四份交付记录按子项编号保留（af222-01..04）。撞号与并发闭合的口径记入 backlog，作为下一单（取号跨机仲裁）的输入。
