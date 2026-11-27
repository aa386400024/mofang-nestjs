---
taskId: AF-576
contextId: phase2.5-toolchain
title: 编排 CLI 护栏收口：域预检、失效依赖、单 sheet 校验与重冻指纹
type: fix
status: backlog
baselineRef: c19a8246f9ae018966549946896a1ad02ecf7840
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, docs/team/agent-orchestration/README.md]
createdAt: 2026-11-27T17:20:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/
    - docs/team/agent-orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af576-orchestration-guardrails-2026-11-27.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: exit 0
  - command: pnpm lint
    check: lint 0 error
    threshold: exit 0
  - command: pnpm typecheck
    check: tsc 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全量测试完成并记录真实通过/失败数字
    threshold: 0 failed（环境性并发超时须隔离复跑并记录）
successCriteria:
  - register 在写记录包与事件前完成 agentRole 资源域预检，越域直接拒绝并给出可用角色建议
  - canceled / rejected / failed 任务的历史交付指针缺文件只告警，不再让 worklog strict 失败；completed 仍必须存在
  - dependsOn 指向 failed / canceled / rejected 时产生 dependency-invalid 动作，status 运行健康行显性标出失效依赖
  - cli validate 支持 only-sheet，单任务单结论与全仓既有失败分离，默认全仓行为不变
  - receipt freeze 重冻后清除运行态 receiptFingerprint，下一次 run-once 必须重新验收
  - 上述五类行为均有单测覆盖，且 lint / typecheck / 全量测试结果如实记录
objective: 收口 AF-572 至 AF-575 返修中暴露的五项编排护栏缺口，减少一次域冲突重签发引发的多任务膨胀与静默死等
outOfScope:
  - 不改业务代码与 engine-core
  - 不改框架仓契约正文与 schema
  - 不批量改写历史任务单与历史回执
constraints:
  - 状态面只经 CLI 写入
  - 不引入新依赖
  - 保持默认 cli validate 全仓口径兼容
---

## 背景

AF-572 因 `agentRole` 与 `scope` 资源域不匹配，登记后到派发才报 `scope-domain-conflict`，被迫重签发为 AF-573；AF-574 又因被取消任务的交付指针缺文件，拖出额外返修；AF-571 重冻回执还出现验收指纹未失效。五项改进已登记在台账，本单一次性收口。

## 实施范围

1. `task register` 在 `createTask` 之前调用 `validateScopeDomain`，越域时输出冲突文件和建议角色。
2. `verifyWorklog` 只对 `completed` 强制交付记录存在；其余终态缺文件降为 warning。
3. `dependencyState` 区分 unknown 与 failed/canceled/rejected；后者产生 `dependency-invalid`，`status` 打印失效依赖。
4. `cli validate --only-sheet` 只以目标任务单结论决定退出码，并输出机读结论行。
5. `receipt freeze` 成功后删除运行态 `receiptFingerprint`，强制下一次验收重新计算。

## 验收方式

先跑定向单测，再跑 `pnpm lint` / `pnpm typecheck` / `pnpm test`；全量测试若复现既有 AF-073 spawnSync 并发超时，隔离复跑并如实记录，不把环境噪声写成通过。
