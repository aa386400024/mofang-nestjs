---
taskId: AF-056
contextId: phase2.5-orchestration-enforcement
title: 服务端编排门与 integrate 分支保护闭环
type: implementation
status: backlog
baselineRef:
dependsOn: [AF-055]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, conventions.md#1.4, agent-orchestration/README.md#0, agent-orchestration/autonomous-team-design.md#6.1]
createdAt: '2026-11-17T10:30:00Z'
deadline: null
agentRole: orchestrator
scope:
  files:
    - .github/
    - scripts/orchestration/
    - package.json
    - AGENTS.md
    - docs/team/conventions.md
    - docs/team/wp-task-template.md
    - docs/team/agent-orchestration/
    - docs/worklog/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af056-server-side-orchestration-gate-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与 CI 逐提交门正反用例全绿
    threshold: failed=0
  - command: node scripts/orchestration/ci-task-gate.mjs --base a27aba504b48b245f59a8f6ef1791310b68f94a9 --head 3defc1ac2490a5bbc0e9a145f894e8f51b6e9ec5
    check: AF-053 与 AF-055 全历史提交逐项通过
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: errors=0
  - command: pnpm lint
    check: lint 无 error / warning
    threshold: errors=0 warnings=0
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: FAIL=0
  - command: pnpm orchestration:contracts
    check: 框架 2.0.0 契约包一致
    threshold: FAIL=0
successCriteria:
  - CI 对 PR 与 integrate push 的每个新增提交校验 taskId、任务状态、scope 和任务单存在性；纯状态面提交按既有口径放行
  - 无 taskId 的非状态面提交、canceled/rejected 借用、越界文件与缺失任务单在服务端阻断
  - integrate 启用必需检查、strict 最新分支、enforce admins、禁止 force push/deletion，并保留既有 12 项检查
  - 新流程支持登记与实现均在任务分支，PR 检查通过后 squash 合并，避免保护规则与直推登记提交互相冲突
  - 提供可复用的 GitHub PR 创建/等待/合并/清理 CLI，不依赖本机安装 gh，不输出 token
  - AF-055 交付记录与回执 durable 副本入库；不触碰业务 src、数据库、Redis、L4 master/tag/release/deploy
evidenceFormat: 单测数 + 真实历史逐提交门输出 + 负向提交阻断 + GitHub API protection 读写回执 + 下一任务 PR 全流程证据
---

# AF-056 · 服务端编排门与 integrate 分支保护闭环

## 目标

把本地 Husky 的强制编排门升级为 GitHub 服务端硬门，并解决“必需检查”与当前直推 L3 的冲突。保护启用后的目标流程：登记/实现/验收状态均进入任务分支 → PR 远端检查 → squash 合并 integrate → 清理分支。

## 边界

- 不修改业务 `src/**`、前端锁文件、批次报告、数据库或 Redis。
- 不改变框架通用契约和任务状态枚举；只扩展本仓适配层与发布工具。
- 不把 master/tag/release/deploy 自动授权扩大；integrate 保护不自动等于 L4 发布。
- GitHub token 只从既有安全凭据源读取，不打印、不写文件、不入库。

## 实施要点

1. 新增逐提交 CI 门，复用 `evaluateTaskEntry` 的 active / state-plane-only / archived-transition 语义。
2. CI 新 Job 只覆盖 PR→integrate、push integrate 与显式 task/integrate dispatch，避免 release/master 的既有 L4 流程被误伤。
3. 分支保护保留 master 已有 12 项检查并新增 Orchestration Gate；保护配置先 dry-run，再在 AF-056 合入后 apply。
4. PR 发布工具必须校验本任务 completed/passed、分支 HEAD、远端检查结论和合并后 SHA，不允许 pending/unknown 放行。
5. AF-057 用新流程做独立实弹验证；若保护或门禁设计有误，返修而不是关闭保护。
