---
taskId: AF-245
contextId: phase2.5-orchestration-closed-loop
title: V5 逐 persona 差异审计工具与过拟合检查
type: implementation
status: backlog
baselineRef: c2baed2ddc386cc0ab4aa1496782b4c4f6046243
dependsOn: [AF-243]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T06:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af245-persona-delta-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af245-persona-delta.spec.ts
    check: 定向单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量单测全绿
    threshold: exit=0
---

# AF-245 · V5 逐 persona 差异审计工具与过拟合检查

## 背景

V5 三轮总均分高于 V2 `0.166667`，但总均分可能被少数 persona 拉动。AF-241 的经验说明：逐场复核才能发现真实瓶颈。现在需要把“逐 persona 差异”做成可复用工具，避免每次手工比。

## 目标

1. 新增 `bin/visitor-sim-persona-delta.ts`：读 `scores.json`，按 `personaId × difficulty` 聚合 E（V2）与 H（V5）的均分和五个维度均分，输出 Markdown 表与 delta。
2. 提供纯函数 `auditPersonaDeltas(sessions, baselineArm, candidateArm)`，便于单测和后续对任意两个 arm 复用。
3. 对 AF-243 三轮数据跑审计，回答：
   - V5 的增益是否集中在少数 persona；
   - 是否存在明显回落的 persona（delta < -0.25）；
   - 五个维度里增益主要来自关系在场还是自然度。
4. 交付记录给出三轮合并的 persona 表、赢/平/输计数、以及“是否过拟合”的判断。

## 非目标

- 不改 V5 prompt，不重跑模型。
- 不改主候选，不做生产路由。
- 不评价临床有效性；只看离线影子评分。

## 验收

- 纯函数有单测覆盖 persona 解析、均分与 delta 计算。
- 三轮 AF-243 数据跑通，输出每 persona 的 E/H 均分与 delta。
- 结论明确：增益是否集中、是否有显著回落、下一步应修哪个 persona。
