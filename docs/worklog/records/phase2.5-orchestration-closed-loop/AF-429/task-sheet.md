---
taskId: AF-429
contextId: phase2.5-orchestration-closed-loop
title: AF-427 端到端用例在无语料检出下误红：CI 环境缺 data/debug-sessions 导致 shard 1/3 失败
type: fix
status: backlog
baselineRef: 67e54372e171920fad603e667b181cfce59cb9b7
dependsOn: []
priorTasks: [AF-427]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T06:58:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af429-af427-ci-corpus-guard-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    check: 9 passed
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
---

# 背景

AF-427 新增的 `scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs` 有两条端到端用例读 `data/debug-sessions` 真实语料。该目录在 `.gitignore` 第 111 行被忽略（本机有、CI 检出没有），于是 CI `Unit (shard 1/3)` 在无目录时抛 `目录不存在` 而红，两次运行均复现。

AF-427 已归档，按「验收阶段发现新问题另开任务单」开本单修复。

# 目标

在无语料检出下让端到端用例跳过而非失败；有语料时仍全量断言（本机 9 passed 不变）。

# 做法

- 用例前置 `HAS_CORPUS = fs.existsSync(CORPUS_DIR)`，两条端到端用例在缺失时提前返回，并在注释里写明原因（`data/debug-sessions` 被 gitignore）。
- 解析器 / cap 占用 / 合成夹具用例不依赖真实语料，保持原有断言强度。

# 成功判据

1. `data/debug-sessions` 存在时 9 passed；不存在时同样不红（跳过两条端到端）。
2. `pnpm lint` 0 error。
3. 修复随 AF-427 的 PR #212 一并合入（AF-427 补丁尾提交），不新开 PR。
