---
taskId: AF-223
contextId: phase3-orchestration-hardening
title: 跨机取号仲裁（远端占号预约 CAS / 重建排除自身分支 / 运行态目录忽略）
type: implementation
status: backlog
baselineRef: db4c93d
dependsOn: []
priorTasks: [AF-222]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-21T02:55:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - .gitignore
  modules:
    - orchestration
  interfaces: []
artifacts:
  - name: 交付记录 取号仲裁
    path: docs/worklog/completed/phase3-orchestration/af223-task-id-reservation-2026-11-21.md
    kind: report
  - name: 跨机单写者与编号分配口径
    path: docs/team/agent-orchestration/cross-machine-single-writer.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/
    check: 编排护栏定向用例全绿（含新增占号预约与重建放行）
    threshold: exit=0
  - command: node scripts/orchestration/ci-task-gate.mjs --base db4c93d --head HEAD
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
  - 取号不只读三源，而是先在远端创建占号 ref（refs/heads/orchestration-task-ids/<ID>）做 CAS；创建失败即视为被抢，自动顺延到下一个号，最多尝试 N 次。
  - task next-id 默认给出只读建议，--reserve 时返回已成功占号的编号；占号 payload 记录 actor、机器、时间，可审计。
  - 重建同一任务时，本机已推送的同名任务分支不再阻塞登记：占用合并支持排除自身分支，并在输出中明示「仅本机同名分支占用，按重建放行」；编号同时受远端占号 ref 仲裁。
  - 归档完成后占号 ref 可释放，避免远端 ref 无界增长；释放失败不阻塞归档，只产出 warning。
  - 运行态目录 transport/ 纳入 .gitignore，工作区不再持续出现未跟踪的运行态文件。
---
