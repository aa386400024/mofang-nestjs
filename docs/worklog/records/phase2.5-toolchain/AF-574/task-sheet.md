---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-574
contextId: "phase2.5-toolchain"
type: fix
title: "quality 脚本 lint 闸门返修验收"
status: backlog
baselineRef: "cf830014158bff0547eb05d0aa3e6ce8b8234409"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs:
  - "docs/team/conventions.md"
  - "docs/team/agent-orchestration/README.md"
createdAt: "2026-11-27T16:20:00+08:00"
objective: "AF-573 实现已完成但回执取 conditional-pass 被编排器判 rejected；本返修任务在 AF-573 提交基础上，以全量串行测试的真实通过证据重出 passed 回执并完成归档与 PR。"
successCriteria:
  - "scripts/ops/quality 14 个 TS 文件 ESLint 0 error / 0 warning"
  - "pnpm lint 0 error，pnpm typecheck 0 error"
  - "全量 5147 用例在同一轮内 0 失败（串行执行规避本机 363 并发冷启动超时）"
  - "src/engine-core 零 diff"
  - "回执 reviewVerdict=passed，任务 completed 并归档"
outOfScope:
  - "不新增 type-aware tsconfig 或单独类型检查工程"
  - "不改 quality 脚本业务规则、阈值、报告字段或 CLI 参数"
  - "不改 test/、src/、admin-dashboard/、Flutter 前端"
references:
  - ref: "docs/worklog/completed/phase2.5/af573-quality-scripts-lint-2026-11-27.md"
    kind: report
    note: "AF-573 实现与闸门原始证据"
priorTasks: ["AF-573", "AF-572"]
constraints:
  - "禁止裸 npx；统一 pnpm exec"
  - "复跑证据必须来自真实命令输出，不把并发抖动写成代码回归"
scope:
  files:
    - "scripts/ops/quality/"
    - "package.json"
    - "eslint.config.mjs"
    - "docs/worklog/records/phase2.5-toolchain/AF-573/"
    - "docs/worklog/records/phase2.5-toolchain/AF-574/"
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
    path: "docs/worklog/completed/phase2.5/af574-quality-scripts-lint-rework-2026-11-27.md"
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

# AF-574 · quality 脚本 lint 闸门返修验收

AF-573 已完成 `scripts/ops/quality` 14 个 TS 脚本的 lint 清零与 `pnpm lint` / `lint:fix` 覆盖扩展，提交 `aed98230`。

其回执因标准 `pnpm test` 在本机 363 并发下 4 例冷启动超时，取 `conditional-pass`；编排器按门禁判 `rejected` 并归档。返修复核用同一代码树重跑：

- `pnpm exec vitest run --exclude "**/e2e/**/*.ts" --no-file-parallelism`：362 passed / 1 skipped 文件，5143 passed / 4 skipped 用例，0 失败。
- 隔离复跑三个超时文件 48/48 通过。

结论：失败是本机并发冷启动抖动，不是代码回归。本单只重出 `passed` 回执与交付记录，不改实现。
