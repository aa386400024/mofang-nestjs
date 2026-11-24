---
taskId: AF-449
contextId: phase2.5-orchestration-closed-loop
title: 零语料算子剧本补语料落地（含 AF-447 归档补齐件）
type: implementation
status: backlog
baselineRef: df537e60cbc150fedfd84bfc3554c496f923419b
dependsOn: []
priorTasks: [AF-448, AF-447, AF-427]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T10:05:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/af448-scripted-corpus.ts
    - docs/worklog/inbox/af449-scripted-corpus-task-2026-11-24.md
    - docs/worklog/completed/phase2.5/af447-scripted-corpus-2026-11-24.md
    - docs/worklog/completed/phase2.5/af448-scripted-corpus-2026-11-24.md
    - docs/worklog/completed/phase2.5/af449-scripted-corpus-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-449/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af449-scripted-corpus-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --dry-run
    check: 干跑三个零语料算子全部命中且不写盘
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
---

# 背景

`docs/architecture/behavior-operator-delta-ledger-v1.0.md` 表三显示 `normalization` / `affirmation` / `boundary_cross` 三类算子在真实语料里命中轮次为 0（台帐只读 `traces[].deltaDetail.events`），这些算子的 delta 幅度是否生效、是否被 cap 吞掉无法用语料验证。

实现已在 AF-448 完成（剧本 + 生产同款规则分类器 + 内核 delta 聚合，台帐表三三类均达 100.0% 实测/系数比）。本任务承接落地提交，并把 AF-447 被重签发后 `worklog verify --strict` 必需的归档补齐件一并纳入 scope——AF-448 的 scope 不含该文件，回执预检与 preflight 都会判越界。

# 目标

1. 提交 `scripts/ops/quality/af448-scripted-corpus.ts` 与 AF-448 交付记录（实现与证据已就绪，本单只负责合法落库）。
2. 提交 AF-447 归档补齐件 `docs/worklog/completed/phase2.5/af447-scripted-corpus-2026-11-24.md`（记录重签发事实，不含实现内容）。
3. 本单自身交付记录 `af449-scripted-corpus-2026-11-24.md` 写明承接关系与最终闸门数字。

# 边界

- 不新增脚本逻辑、不改剧本台词、不改 `src/engine-core`、不改台帐脚本。
- 合成语料落 `data/debug-sessions/`（gitignored），不入库。

# 成功判据

1. `pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --dry-run` exit=0，三类零语料算子均命中。
2. `pnpm typecheck` 0 error；`git diff --stat HEAD -- src/engine-core` 为空。
3. `node scripts/orchestration/cli.mjs worklog verify --strict` PASS（AF-447 / AF-448 / AF-449 三个记录包的 artifactPath 全部存在）。
