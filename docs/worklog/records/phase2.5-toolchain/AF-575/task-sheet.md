---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-575
contextId: "phase2.5-toolchain"
type: fix
title: "quality lint 闸门返修验收（第 2 次）"
status: backlog
baselineRef: "2ba07843ab04e8a44d266e996da875e4c7f5730e"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs:
  - "docs/team/conventions.md"
  - "docs/team/agent-orchestration/README.md"
createdAt: "2026-11-27T16:35:00+08:00"
objective: "AF-574 因回执 commit 集合包含 scope 外的 AF-572 记录包被机读护栏判 rejected；本单把 AF-572/573/574 记录包全部纳入 scope，并以六组机读标记齐全的交付记录与全量串行测试证据通过验收。"
successCriteria:
  - "scripts/ops/quality 14 个 TS 文件 ESLint 0 error / 0 warning"
  - "pnpm lint 0 error，pnpm typecheck 0 error"
  - "全量 5147 用例在同一轮内 0 失败（串行执行规避本机 363 并发冷启动超时）"
  - "src/engine-core 零 diff"
  - "回执 reviewVerdict=passed，机读护栏 verdict=passed，任务 completed 并归档"
outOfScope:
  - "不新增 type-aware tsconfig 或单独类型检查工程"
  - "不改 quality 脚本业务规则、阈值、报告字段或 CLI 参数"
  - "不改 test/、src/、admin-dashboard/、Flutter 前端"
references:
  - ref: "docs/worklog/completed/phase2.5/af573-quality-scripts-lint-2026-11-27.md"
    kind: report
    note: "AF-573 实现与原始闸门证据"
priorTasks: ["AF-574", "AF-573", "AF-572"]
constraints:
  - "禁止裸 npx；统一 pnpm exec"
  - "回执 changedFiles.commits 只能声明 scope 覆盖的提交"
scope:
  files:
    - "scripts/ops/quality/"
    - "package.json"
    - "eslint.config.mjs"
    - "docs/worklog/records/phase2.5-toolchain/AF-572/"
    - "docs/worklog/records/phase2.5-toolchain/AF-573/"
    - "docs/worklog/records/phase2.5-toolchain/AF-574/"
    - "docs/worklog/records/phase2.5-toolchain/AF-575/"
    - "docs/worklog/completed/phase2.5/"
  modules: []
  interfaces: []
exclusions:
  - "src/"
  - "test/"
  - "admin-dashboard/"
agentRole: orchestrator
artifacts:
  - name: "返修交付记录"
    path: "docs/worklog/completed/phase2.5/af575-quality-scripts-lint-rework-2026-11-27.md"
    kind: report
artifactSchema: null
deliveryPath: null
gates:
  - command: "pnpm exec eslint \"scripts/ops/quality/**/*.ts\""
    check: "quality TS 脚本 0 error / 0 warning"
    threshold: "exit 0"
  - command: "pnpm lint"
    check: "全仓 lint 0 error"
    threshold: "exit 0"
  - command: "pnpm typecheck"
    check: "类型检查 0 error"
    threshold: "exit 0"
  - command: "pnpm exec vitest run --exclude \"**/e2e/**/*.ts\" --no-file-parallelism"
    check: "全量用例 0 失败"
    threshold: "exit 0"
  - command: "git diff --stat HEAD -- src/engine-core"
    check: "engine-core 零 diff"
    threshold: "输出为空"
evidenceFormat: "命令 + 退出码 + 文件/用例计数"
riskClass: R1
riskRationale: "仅重出验收证据与回执，无新增业务代码"
gateProfile: standard
escalationTriggers:
  - "全量串行测试仍出现失败"
  - "返修需要改动 test/ 或业务代码"
priority: null
deadline: null
retention: null
---

# AF-575 · quality lint 闸门返修验收（第 2 次）

AF-574 回执的 `changedFiles.commits` 含 `20c81c92`，其中新增了 AF-572 任务包；AF-574 scope 未包含 AF-572 目录，机读护栏判定“scope 外提交文件”并 rejected。

本单把 AF-572/573/574/575 四个记录包目录显式纳入 scope，重出六组标记齐全的交付记录与 passed 回执。实现代码不变。
