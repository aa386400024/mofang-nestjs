---
taskId: AF-382
contextId: phase2.5-orchestration-closed-loop
title: 编排资源域补充公开仓密钥备份路径
type: implementation
status: backlog
baselineRef: 31eaf7d2faabcdd5957b10cfc0ee4065e795a526
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T20:20:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 仅补充 orchestrator 资源域白名单，使密钥备份删除进入授权范围。
gateProfile: light
objective: 把公开仓已跟踪的 .env.bak.rsa-fix-2026-10-15 加入 orchestrator 资源域，解除 AF-381 的 scope-domain-conflict。
successCriteria:
  - orchestrator.json 的 resources 包含 .env.bak.rsa-fix-2026-10-15
  - Agent Card 校验与编排单测通过
  - 不放宽其他资源域，不修改角色权限
outOfScope:
  - 不删除密钥文件本体
  - 不改 CI、PR 生命周期或业务代码
  - 不新增资源域通配符规则
references: []
priorTasks:
  - AF-381
  - AF-380
constraints:
  - 状态面只能经 CLI 写入
  - 任何提交不得使用 --no-verify
scope:
  files:
    - docs/team/agent-orchestration/agent-cards/orchestrator.json
    - docs/worklog/records/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af382-orchestrator-resource-env-bak-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: exit 0，0 failed
assertions:
  - orchestrator.json 可被 validateAgentCard 解析
  - resources 仅新增一条精确路径，未加通配符
---

## 背景

AF-381 需要从公开 HEAD 删除 `.env.bak.rsa-fix-2026-10-15`，但该根文件不在 orchestrator Agent Card 的 `resources` 资源域内，`run-once` 返回 `scope-domain-conflict`。本任务只做资源域白名单补充，使删除动作进入授权范围。

## 范围

- 在 `docs/team/agent-orchestration/agent-cards/orchestrator.json` 的 `resources` 增加精确路径 `.env.bak.rsa-fix-2026-10-15`。
- 不加通配符、不改 `limits`、不改其他角色卡。

## 验收

- 编排单测通过。
- `validateAgentCard` 解析无错误。
