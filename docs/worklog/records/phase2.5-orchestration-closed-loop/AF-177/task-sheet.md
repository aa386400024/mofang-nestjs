---
taskId: AF-177
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 出口④ 24 个 character-mode 簇 48 packet κ 复验
type: implementation
status: backlog
baselineRef: f4ec502c9f102b0a014ec0b8f7c55ef91d71946b
dependsOn: [AF-176]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T06:48:00Z
deadline: null
agentRole: executor
scope:
  files:
    - bin/long-session-acceptance.ts
    - test/auto-practice/af111-long-session-acceptance.spec.ts
    - docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af177-kappa48-2026-11-20.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/af111-long-session-acceptance.spec.ts
    check: 定向全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
successCriteria:
  - pack CLI 支持 --modes 与最多 48 packet，按 characterSlug×counselorModeId 分层轮转取样，24 个 cell 各 2 场
  - 新 long 批次至少 24 场（8 角色 × cold/expert/intermediate），16/16 健康口径扩展为 24/24
  - 48 packet 的 AI 双盲 overall κ、AC1、α 与 character-mode cluster bootstrap 全部落盘
  - κ 点估计与阈值 0.40 如实判定，达不到就登记遗留，不下调阈值、不写临床达标
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---

# AF-177 · 24 个 character-mode 簇 48 packet κ 复验

## 1. 背景

AF-147 96 场校准只有 8 个 characterSlug，overall κ 0.365854；AF-152 的 character-mode 簇只有 16 个（8 角色 × 2 模式），cluster bootstrap CI 仍宽。AF-176 已把开场与危机收束结构拉到 16/16 开场，但 κ 没变。本单补第三档 `intermediate`，把独立簇从 16 扩到 24，用 48 packet 做一次可复核的 κ 复验。

## 2. 实现要求

1. `bin/long-session-acceptance.ts pack` 新增 `--modes <csv>`（缺省 `expert,cold`），`--limit` 上限从 16 提到 48。
2. 取样改为按 `characterSlug|counselorModeId` 分层，排序后逐 cell 轮转；48 packet 时 24 个 cell 各 2 场，不允许某档被挤掉。
3. 新增/扩展 `test/auto-practice/af111-long-session-acceptance.spec.ts`，覆盖 3 模式分层与 48 上限。
4. 跑 24 场 long 批次（8 角色 × 3 模式 × 1 repeat）；再用 `pack --limit 48` 取 48 packet（必要时同批 repeats=2，保证每 cell 2 场）。
5. 用 `bin/ai-double-blind.ts` 跑 R1/R2/R3；输出 `overall κ / exact / within±1 / AC1 / α / character-mode bootstrap CI`。
6. 结论固定 candidate；κ <0.40 就登记 backlog，不调阈值。

## 3. 边界

- 不改评分模型与 prompt，不改 0.40 / 3.50 / safety≥3 阈值。
- 不改 `src/engine-core`。
- 不把 AI 代理分写成临床质量达标。
