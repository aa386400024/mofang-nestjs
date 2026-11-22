---
taskId: AF-285
contextId: phase2.5-orchestration-closed-loop
title: 生产主候选上线前真实链路复核（doubao 主 + minimax 备 + 回滚开关自检）
type: verification
status: backlog
baselineRef: 2769836e85dc6a0ac7b6d423e2596740e5da2b25
dependsOn: [AF-283]
priorTasks: [AF-278, AF-269, AF-271, AF-273, AF-282, AF-283]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T15:30:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 上线前真实链路复核记录
    path: docs/worklog/completed/phase2.5/af285-production-candidate-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao
    check: 主候选开关与回滚链装配正确
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 3
    check: 豆包主候选真实流式 3 轮成功且无降级/回退
    threshold: exit=0 且 stop=3/3
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 3
    check: 回滚候选真实流式 3 轮成功且无降级
    threshold: exit=0 且 stop=3/3
  - command: git diff --stat HEAD -- src test bin docker docs/runbooks
    check: 本单零代码改动
    threshold: 输出为空
---
# AF-285 · 生产主候选上线前真实链路复核

## 背景

AF-278 记录过 doubao 主候选 3/3 smoke 基线；AF-282 改了取消/失败归因，AF-283 补了告警与灰度判读，但两条改动合并后尚未在真实模型链路上重跑一次“主候选 + 回滚候选”双通道 smoke。上线前需要一份可复现的当前证据：豆包主候选真的出流、MiniMax 备候选真的可用、开关自检与回滚链装配没有漂移。

## 目标

1. 用 `bin/visitor-switch-check.ts --expect-primary doubao` 核对 `.env` 主候选、备候选链、模型名，不联网、不打印密钥。
2. 用 `bin/visitor-render-smoke.ts --provider doubao --caller router --turns 3` 真实调用豆包，记录 TTFT、tokens、stop、fallback/degraded。
3. 用同一脚本跑 `--provider minimax`，确认回滚候选在当前 key 与模型配置下仍可出流。
4. 把命令、退出码、关键数字与偏差写入交付记录。

## 非目标

- 不改 `.env`、不改候选链、不改渲染代码、不改告警规则。
- 不做压测、不做批量评测、不消耗超过 2×3 轮的模型调用。
- 不把 smoke 结果当成质量评测结论，只作为“链路可用”证据。

## 方法

- 两条 smoke 串行执行，避免并发互相影响 TTFT。
- 记录每轮 TTFT、prompt/completion tokens、stopReason、fallbackUsed、degraded。
- 任何一条失败先保留日志与错误原文，再判断是候选配置、key、网络还是模型侧问题；不静默重试掩盖。

## 验收

- 两个 smoke 各 3/3 stop，fallbackUsed=false、degraded=false（或写明真实偏差与原因）。
- 开关自检 exit 0，输出主候选 doubao、备候选 minimax。
- `git diff --stat HEAD -- src test bin docker docs/runbooks` 为空。
- 交付记录含真实命令、退出码、逐轮数字、日志路径与结论；回执六组字段齐全。
