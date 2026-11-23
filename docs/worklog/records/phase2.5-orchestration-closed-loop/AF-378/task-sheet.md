---
taskId: AF-378
contextId: phase2.5-orchestration-closed-loop
title: 私有仓 Actions 额度零成本治理：本地闸门、ready 触发与测试分片合并
type: implementation
status: backlog
baselineRef: e4b535c15836e60938b3b599135cb950b592a8aa
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T19:20:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R2
riskRationale: 改 CI 触发拓扑、风险门禁输出、分支保护 required contexts 与本地 pre-push 钩子，属于 CI 基础设施变更。
gateProfile: full
objective: 在不购买自托管 runner 的前提下，把私有仓 GitHub Actions 额度压到可长期运行的范围
successCriteria:
  - draft PR 的 push 不触发全量 CI，PR 转为 ready-for-review 时触发全量
  - 同一 PR 新 push 会取消上一轮 CI，避免重复消耗额度
  - Unit 三个分片同时采集覆盖率，Coverage Gate 从 Unit 分片产物合并，不再重复跑第二套测试
  - R0 纯文档 PR 显式跳过 lint 与 typecheck，但 required check 仍有 success 状态
  - 本地 pre-push 执行 lint、typecheck 与全量单测，阻断可本地发现的失败
  - 分支保护 required contexts 与合并后的 CI job 名称一致
outOfScope:
  - 不购买或接入自托管 runner
  - 不改业务代码、engine-core、数据库迁移与生产配置
  - 不改 master、release、deploy 分支保护
references: []
priorTasks:
  - AF-377
  - AF-372
constraints:
  - 状态面只能经 CLI 写入
  - 不关闭分支保护，不减少 required check 覆盖
  - 任何提交不得使用 --no-verify
scope:
  files:
    - .github/workflows/
    - .husky/
    - package.json
    - scripts/orchestration/
    - docs/worklog/records/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af378-ci-zero-cost-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs scripts/orchestration/__tests__/v21-adapters.spec.mjs
    check: 编排单测全绿
    threshold: exit 0，0 failed
  - command: pnpm lint
    check: ESLint 全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: TypeScript 全量类型检查通过
    threshold: exit 0
  - command: pnpm test
    check: 全量单测通过
    threshold: exit 0，0 failed
assertions:
  - draft push 不生成全量 job，ready_for_review 事件生成
  - Coverage Gate 只依赖 risk-gate 与 unit 分片，不再依赖 coverage-shards
  - R0 的 Lint + Typecheck 与 Coverage Gate 均显式 skipped 但 check 为 success
---

## 背景

仓库私有化后 GitHub Free 只有 2,000 分钟/月，而当前全量 CI 约 25 分钟额度/轮，其中 Unit 与 Coverage 对同一套测试重复执行。用户明确不购买自托管 runner，采用零新增成本方案。

## 范围

- PR 触发改为 opened/synchronize/reopened/ready_for_review，draft 阶段不跑全量。
- Unit 分片合并覆盖率采集，Coverage Gate 复用 Unit 产物；移除独立 coverage-shards。
- 风险门禁增加 run_lint 输出，R0 显式跳过 lint 与 typecheck。
- 增加本地 pre-push 闸门。
- 同步 branch-protection required contexts 与 pr-release 判定。
