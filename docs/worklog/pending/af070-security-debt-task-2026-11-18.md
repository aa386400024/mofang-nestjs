---
taskId: AF-070
contextId: phase2.5-orchestration-closed-loop
title: AF-069 收口：安全审计无修复项风险接受、lint 覆盖与 supervisor 安装可迁移
type: fix
status: backlog
baselineRef: 0749d153b795a14b38d738a3f30e6d208a11f360
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T09:00:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - package.json
    - eslint.config.mjs
    - .github/workflows/ci.yml
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/team/agent-orchestration/security/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af070-security-debt-2026-11-18.md
    kind: report
gates:
  - command: pnpm lint
    check: lint 覆盖 scripts mjs/cjs 且 0 error 0 warning
    threshold: 0 error 0 warning
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: 0 error
  - command: pnpm exec vitest run scripts/orchestration/__tests__/relay-supervisor.spec.mjs
    check: relay supervisor 定向单测全绿
    threshold: 0 failed
  - command: pnpm orchestration:validate
    check: 编排索引与契约校验通过
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链哈希与投影一致
    threshold: PASS
successCriteria:
  - 用 pnpm auditConfig.ignoreGhsas 只接受 GHSA-fc5q-39xc-vjpf 一条无修复版本的 high advisory，并有可审计的风险接受文档
  - 风险接受文档写清 advisory、受影响路径、为何无修复、暴露面、补偿控制、复核日期与责任人
  - lint 脚本覆盖 scripts 下 mjs/cjs，scripts 配置关闭 type-aware 规则，pnpm lint 对全仓 0 error 0 warning
  - 新增幂等的 relay supervisor 安装脚本，支持显式 Node 26 路径，安装后计划任务仍为 Running
  - 记录 Node 26 本地运行口径，后续闸门不再用低于 engines.node 的运行时
  - 不修改 src 业务代码、practice-runner、engine-core 与任何 LLM/数据库行为
  - 回执包含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组字段
  - 不执行与 AF-070 无关的批量数据、migration、seed 或环境清理
---
# AF-070 · AF-069 收口

## 背景

AF-069 已归档，但 PR #19 的 Security Audit 因 `picomatch@4.0.7` 的 GHSA-fc5q-39xc-vjpf（ReDoS，当前 registry 无 patched version）失败，阻塞受保护 PR 合并。

同时登记三条 AF-069 遗留：

- BL-AF069-01：`pnpm lint` 不覆盖 `scripts/**/*.mjs`。
- BL-AF069-02：仓 `engines.node>=26`，本地 PATH / 计划任务运行时低于 26。
- BL-AF069-03：Windows 计划任务是机器级工件，迁移后需重装且无仓内安装脚本。

## 目标

1. 以“可审计的风险接受”而不是关掉 Security Audit，处理无修复版本的 high advisory。
2. 让 lint 真正覆盖 orchestrator 的 mjs/cjs 脚本，并保持 0 error。
3. 把 supervisor 计划任务安装固化为仓内幂等脚本，支持 Node 26。
4. 记录 Node 26 本地运行口径，消除“测试在 22/24、仓要求 26”的口径漂移。

## 边界

- 不改 `src/` 业务代码、`practice-runner`、`engine-core`、LLM 调用、数据库与 migration。
- 不删除、不移动任何用户文件或并行产物。
- 不关闭 Security Audit、不删 required checks、不使用 `--no-verify`。
- 风险接受只针对 GHSA-fc5q-39xc-vjpf；其他 high/critical 仍必须阻断。
