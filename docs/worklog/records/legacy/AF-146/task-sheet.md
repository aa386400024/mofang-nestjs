---
taskId: AF-146
contextId: phase2.5-orchestration-closed-loop
title: 最终收束通道复测、全量闸门与出口④质量判读
type: implementation
status: backlog
baselineRef: 82911050e23524cf9c10d4af8a275f0f61920251
dependsOn: [AF-140]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T23:40:00+08:00
deadline: null
agentRole: executor
priorTasks: [AF-144, AF-145, AF-140, AF-141]
scope:
  files:
    - src/auto-practice/counselor-agent.service.ts
    - src/auto-practice/practice-runner.service.ts
    - src/auto-practice/metrics/session-structure-audit.ts
    - test/auto-practice/counselor-final-closing.spec.ts
    - test/auto-practice/practice-runner-final-closing.spec.ts
    - test/auto-practice/practice-runner-decide-turn.spec.ts
    - test/auto-practice/practice-runner.spec.ts
    - docs/worklog/pending/af144-final-closing-channel-task-2026-11-19.md
    - docs/worklog/pending/af145-final-closing-quality-close-task-2026-11-19.md
    - docs/worklog/pending/af146-final-closing-quality-close-task-2026-11-19.md
    - docs/worklog/completed/phase2.5/af146-final-closing-quality-close-2026-11-19.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af146-final-closing-quality-close-2026-11-19.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: engine-core 边界隔离 12 项全过
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
successCriteria:
  - AF-144 的最终收束独立通道与确定性补全代码完整落地，maxTurns 当轮必触发并自然收尾
  - 全量测试通过，practice-runner 的 52 轮旧断言按 AF-144 新语义更新为 50 轮
  - 真实 long 批次 16/16 完成、685 轮、valid=true、llm_call_ratio=1、fallback=0
  - 结构审计与 AI 双盲按 AF-125 阈值逐项判读，不调低任何阈值，不把 AI 分写成临床验收
  - 出口条件表按真实结果回写，唯一失败项与后续动作明确登记
---

## 背景

AF-144 已完成最终收束独立生成通道与确定性补全，但原任务单由 AF-143 复制，`scope` 未包含 `test/auto-practice/practice-runner.spec.ts`（该断言在 AF-144 语义下必须从 52 轮改为 50 轮），且 artifact 指向 AF-143 记录。AF-144 因此取消，由 AF-145 以完整 scope 承接同一实现、全量闸门、真实批次复测与出口④回写。

## 交付边界

- 只动本任务 scope 内文件；不重跑 LLM 批次以外的额外实验，不调低 `overall κ ≥ 0.40`、`style ≥ 3.50`、`safety ≥ 3` 等阈值。
- 真实批次 `-O6D-lCqS2CGb7uS3aJI4` 已跑完，复测直接复用；pack、结构审计、AI 双盲产物落在 `data/phase25-exit/af144-*`。
- 闸门只跑定向 `typecheck` / `lint` / `boundary`，收尾跑一次全量 `pnpm test`。

