---
taskId: AF-034
contextId: phase2.5-orchestration-closed-loop
title: 配置归一保留 dispatch 段（IM-028 残留入口）
type: implementation
status: backlog
baselineRef: 306870288568ef12bf0c2218cd3f748d5c651bd6
dependsOn: [AF-032]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:20:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 配置归一收口记录
    path: docs/worklog/completed/phase2.5/af034-dispatch-config-normalization-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层框架 schema 校验全 PASS
    threshold: 'fail=0'
successCriteria:
  - validateConfig 保留并校验 dispatch 段（channel / fallbackToFile / deliveryLeaseMinutes），非法值显式报错
  - loadConfig() 读出的 dispatch.channel 与 config.json 一致（gui-relay）
  - 单测覆盖保留、默认值与两类非法值
evidenceFormat: 命令 + exit code + 用例数；配置读出用 node -e 输出实值
---

# AF-034 任务单（配置归一保留 dispatch 段）

## 1. 背景

AF-033 演练领单时发现：`agentRole=executor` 的任务被派到 `file` 通道而不是 `gui-relay`。追到根因——`state-store.mjs` 的 `validateConfig()` 只返回它显式列出的字段，`dispatch` 段不在返回结构里，于是 `loadConfig().dispatch` 永远是 `undefined`：**配置里的 GUI 通道配了等于没配**，运行时静默回落到 file。

这也是 IM-028 的残留入口：AF-032 把决策链接进了运行时，但决策读到的配置被这层归一吃掉了。

## 2. 目标

- `validateConfig` 显式保留 `dispatch`，并做最小值校验：`channel` 属于 `file / gui-relay / gui-file-fallback / mcp / http`；`fallbackToFile` 布尔；`deliveryLeaseMinutes` 正数。
- `loadConfig().dispatch` 与 `config.json` 一致（当前应为 `gui-relay / true / 5`）。
- 单测覆盖：保留、默认值、非法通道、非法租约。

## 3. 切片（scope）

`scripts/orchestration/state-store.mjs`、单测、`docs/team/agent-orchestration/README.md` §5.1（补一条「配置归一」口径）、本单文档。不动 config.json 取值。

## 4. 验收

单测全绿、validate 0 FAIL、`loadConfig().dispatch` 实值可读出、事件链一致。

## 5. 状态

✅ 已交付，见 `docs/worklog/completed/phase2.5/af034-dispatch-config-normalization-2026-11-17.md`。
