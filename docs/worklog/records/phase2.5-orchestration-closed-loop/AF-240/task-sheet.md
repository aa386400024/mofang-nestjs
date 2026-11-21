---
taskId: AF-240
contextId: phase2.5-orchestration-closed-loop
title: Seed Character 来访者 prompt V3 难度分档与三轮对照
type: implementation
status: backlog
baselineRef: 1799b53b42648c87c953f708c3e0dc5b72e56dea
dependsOn: [AF-239]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T05:00:00+08:00
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
    path: docs/worklog/completed/phase2.5/af240-seed-v3-difficulty-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts
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

# AF-240 · Seed Character 来访者 prompt V3 难度分档与三轮对照

## 背景

AF-237/238/239 已验证 seed-v2 硬门槛三轮全过，但有两点未解：L1 回避率约 0.40 偏高，L3 盲评均分低于 A/C、短句占比过高（0.56–0.73），临床真实感偏平。V2 对所有难度使用同一套强防御预算，导致 L1 显得过度防御、L3 显得只剩短句。

## 目标

1. 新增 seed-v3：在 V2 的非合作/不推进约束上，按难度分档调节直接回答、具体细节与短句节流预算。
2. 增加影子 arm F（Seed Character / seed-v3），沿用 A/C/E 历史轮次，仅新生成 F 三轮各 12 场，四臂统一评分。
3. 比较 F 与 C/E：合作指数不高于 C、硬门槛全过、盲评均分不低于 E，且 L1 回避率下降、L3 短句率下降。

## 非目标

- 不改生产 visitor prompt、provider 路由或 feature flag。
- 不重新生成 A/C/E 历史会话；只复用 AF-237/AF-238 的 r1/r2/r3。
- 不做 Lite→M3.1 仿射映射，不让 Seed Character 当主评分员。

## 验收

- 回归测试覆盖 seed-v3 prompt 与 arm F 选择。
- 三轮 F 生成 36/36 场 0 失败；四臂评分硬门槛结果与 summary 落盘。
- 交付记录写清 V3 文案、分档依据、三轮数字、偏差与限制。
