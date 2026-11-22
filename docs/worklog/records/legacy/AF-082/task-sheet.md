---
taskId: AF-082
contextId: phase2.5-orchestration-closed-loop
title: 改进项处置提交封套（承接 AF-081 已完成实现）
type: implementation
status: backlog
baselineRef: 845d20d8b2e3b376bd32ab7280a6872b58a72cd8
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T04:40:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/handover-contract.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - docs/team/agent-orchestration/README.md
    - docs/team/agent-orchestration/improvement-dispositions-2026-11-18.md
    - docs/team/agent-orchestration/production-readiness-checklist-2026-11-18.md
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af082-commit-envelope-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿，覆盖跨仓提交声明与三单 relay 回归
    threshold: 0 failed
  - command: corepack pnpm lint
    check: lint 全绿且 scripts 覆盖生效
    threshold: 0 error 0 warning
  - command: corepack pnpm test
    check: 全量单测全绿（收尾只跑一次）
    threshold: 0 failed
  - command: node scripts/orchestration/cli.mjs validate
    check: 状态索引、任务单、回执与契约目录全部 PASS
    threshold: exit 0
successCriteria:
  - IM-046 回执支持外部仓提交声明，校验 repo + SHA 形状，不混入本仓 commits 比对
  - IM-047 产出生产前 checklist（部署 / secrets / 迁移 / 监控 / 回滚五类）
  - IM-053 用三单序列自动化回归覆盖 send→ack→auto-confirm 与 stale-ack 拒绝
  - IM-044 / IM-052 给出书面处置结论（当前架构下不实施的理由与重启条件）
  - 全量测试只跑一次且记录真实数字，不新跑 LLM 批次、不改业务 src
---

# AF-082 · 活跃改进项集中处置（AF-079 重登记；AF-080 回执声明越界返修）

## 背景

AF-079 登记时把 `docs/team/production-readiness-checklist-2026-11-18.md` 写进 scope，但 orchestrator Agent Card 的资源域只有 `docs/team/agent-orchestration/`，`run-once` 因此报 `scope-domain-conflict`。任务登记后 scope 无原地修订入口，按「不绕过门禁」原则：取消 AF-079，把清单移入授权目录，以 AF-082 重新登记执行。

AF-077/078 后框架链路已闭环，改进台账仍有 5 个活跃项：IM-044 / IM-046 / IM-047 / IM-052 / IM-053。本单逐项处置，并在收尾跑一次全量测试。

## 处置口径

| 项 | 处置 | 理由 |
| --- | --- | --- |
| IM-046 | 实现 | 回执增加 `changedFiles.externalCommits`（repo + SHA 形状），跨仓提交不再只能塞 `artifactRefs.others`；本仓 `commits` 仍只解析本仓 |
| IM-047 | 实现 | 产出生产前 checklist，五类工作有单一入口，不冒充已完成生产演练 |
| IM-053 | 实现 | 三单序列自动化回归：逐单 ack→auto-confirm，旧 ack 早于本轮 preparedAt 必须拒绝 |
| IM-044 | 书面结论 | 当前 Transport 接口同步返回 handoverRef，HTTP 需要调度层异步化；单机文件通道 + GUI relay 已是当前生产路径。登记为「暂不实施」，重启条件写进处置文档 |
| IM-052 | 书面结论 | 同一 Windows 用户下 CLI 无法做密码学角色隔离；当前用 brief 红线 + 编排者独占状态面，真正隔离需要独立 OS 账号/容器。登记为「暂不实施」，重启条件写进处置文档 |

## 范围

- 只改编排脚本、单测、编排文档与工作记录。
- 不改 `src/` 业务代码，不新跑 LLM 批次，不改数据库 / Redis。
- 加固点不放宽既有硬门。
- 本单不修改 Agent Card 资源域；通过把文档放回授权目录来满足资源域校验。
