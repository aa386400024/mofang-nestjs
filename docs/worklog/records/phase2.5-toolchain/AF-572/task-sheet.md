---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-572
contextId: "phase2.5-toolchain"
type: fix
title: "quality 运维脚本纳入 lint 闸门"
status: backlog
baselineRef: "400d4c483e2df4f82d9a73bb2b829351b3f1118e"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs:
  - "docs/team/conventions.md"
  - "docs/team/agent-orchestration/README.md"
createdAt: "2026-11-27T12:20:00+08:00"
objective: "把 scripts/ops/quality 下 14 个 TypeScript 运维脚本纳入 pnpm lint / lint:fix 覆盖，清零现有 185 errors / 4 warnings，防止质量工具自身带病运行。"
successCriteria:
  - "package.json 的 lint 与 lint:fix 命令覆盖 scripts/ops/quality/**/*.ts"
  - "scripts/ops/quality 14 个 TS 文件在既有非 type-aware scripts 规则下 0 error / 0 warning"
  - "修复只涉及 lint 合规，不改变脚本输出、判定口径、阈值或运行行为"
  - "pnpm lint 0 error，pnpm typecheck 0 error，pnpm test 全量无失败"
  - "src/engine-core 零 diff"
outOfScope:
  - "不为 scripts/ops/quality 新增 type-aware tsconfig 或单独类型检查工程"
  - "不改 quality 脚本的业务规则、阈值、报告字段或 CLI 参数"
  - "不改 src/、test/、admin-dashboard/、Flutter 前端"
references:
  - ref: "eslint.config.mjs"
    kind: spec
    note: "scripts/**/*.ts 已配置 disableTypeChecked，本单复用该段"
priorTasks: []
constraints:
  - "禁止裸 npx；统一 pnpm exec"
  - "自动修复后用 git diff 逐文件复核，避免语义变化"
scope:
  files:
    - "scripts/ops/quality/"
    - "package.json"
    - "eslint.config.mjs"
    - "docs/worklog/records/phase2.5-toolchain/AF-572/"
    - "docs/worklog/completed/phase2.5/"
  modules: []
  interfaces: []
exclusions:
  - "src/"
  - "test/"
  - "admin-dashboard/"
  - "docs/team/agent-orchestration/state/"
requiredSkills:
  - "windows-shell-engineering"
requiredTools:
  - "workspace-write"
agentRole: executor
artifacts:
  - name: "交付记录"
    path: "docs/worklog/completed/phase2.5/af572-quality-scripts-lint-2026-11-27.md"
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
  - command: "pnpm test"
    check: "全量测试无失败"
    threshold: "exit 0"
  - command: "git diff --stat HEAD -- src/engine-core"
    check: "engine-core 零 diff"
    threshold: "输出为空"
evidenceFormat: "命令 + 退出码 + 文件/用例计数"
riskClass: R1
riskRationale: "仅工具链 lint 覆盖与格式修复，无业务运行时变更"
gateProfile: standard
escalationTriggers:
  - "自动修复改变脚本行为或输出"
  - "需要为 scripts 新增类型工程才能过闸"
priority: null
deadline: null
retention: null
---

# AF-572 · quality 运维脚本纳入 lint 闸门

`package.json` 当前 `lint` 只覆盖 `{src,test,bin}/**/*.ts` 与 `scripts/**/*.{mjs,cjs}`，`scripts/ops/quality/` 下 14 个 TS 运维脚本不在闸门内。实测直接跑 ESLint 为 **185 errors / 4 warnings**，其中 120 个可自动修复。

本单把这些文件纳入 `lint` / `lint:fix`，复用 `eslint.config.mjs` 已有的 `scripts/**/*.ts` 非 type-aware 段，清理到 0 error / 0 warning；不新增类型工程，不改脚本判定逻辑。

## 不在范围

- 不改 quality 脚本的业务规则、阈值、报告字段或 CLI 参数。
- 不改 `src/`、`test/`、`admin-dashboard/`、Flutter 前端。
