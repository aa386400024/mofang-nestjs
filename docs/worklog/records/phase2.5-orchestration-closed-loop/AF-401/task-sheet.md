---
taskId: AF-401
contextId: phase2.5-orchestration-closed-loop
title: 调试页 TTS 路由前缀修复（对齐 /admin/api）
type: fix
status: backlog
baselineRef: f61680dd6f8e99056956a9492a3aef06c99cc3dd
dependsOn: []
priorTasks: [AF-398, AF-396]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T02:10:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/admin-debug/tts/
    - test/admin-debug/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/pending/archive/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af401-debug-tts-route-prefix-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug/debug-tts.spec.ts
    check: TTS 调试模块单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - DebugTtsController 实际路由为 /admin/api/debug/tts/render，与前端 client BASE 对齐
  - 单测覆盖控制器路由前缀，防止再次漂移
  - 后端重启后真实调用三模型均返回音频，首次未命中、二次命中缓存
---

## 背景

AF-398 已把调试页 TTS 接入合并进 `integrate`，前端 `admin-dashboard/src/api/client.ts` 的 `BASE = '/admin/api'` 并以 `post('/debug/tts/render')` 调用，实际请求路径为 `/admin/api/debug/tts/render`。但 `DebugTtsController` 声明为 `@Controller('debug/tts')`，后端真实路由是 `/debug/tts/render`，导致页面按钮必然 404。

## 目标

把控制器前缀对齐到 `admin/api/debug/tts`，补一条路由断言单测，并用真实 HTTP 调用验证三模型链路与缓存命中。

## 范围隔离

只改调试模块控制器与对应单测、交付记录；不碰 `src/voice`、Flutter、`src/engine-core`。
