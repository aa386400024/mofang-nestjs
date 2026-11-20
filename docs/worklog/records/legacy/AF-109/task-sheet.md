---
taskId: AF-109
contextId: phase2.5-exit4-quality-remediation
title: 出口④ WP-K 四态判定与 8 角色 long 批次复测
type: documentation
status: backlog
baselineRef: b739b6a821a15260fdc93c74382f17f5cc852428
dependsOn: [AF-108]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T23:00:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/
    - data/batch-reports/
    - data/phase25-exit/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af109-exit4-quality-verdict-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec tsx bin/batch-report.ts --snapshot data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json --format json
    check: WP-K 归档快照链路可复跑
    threshold: exitCode=0
successCriteria:
  - 同口径 8 角色 expert+cold long 批次跑完并落库，target 与 baseline 的 acceptance/角色集合/模式集合一致
  - 新批次逐字稿来访者 <think> 泄漏为 0，咨询师空输出为 0
  - WP-K 正式四态结论由 CLI 产出，不用手算、不伪造 improved
  - 出口④结论与证据写入 phase2.5-README §3.2 出口条件表
  - 不可比时明确写 incomparable 与不可比原因，不写成“质量达标”
---
# AF-109 出口④ WP-K 四态判定与 8 角色 long 批次复测

## 背景

AF-108 已把推理块从聚合 / 流式出口剥离，并把 8 个角色补成 approved。历史 96 场批次
`g3ONzlqSGMVJqkFMF9Lwh` 的逐字稿已随环境迁移清理，库内查无该批次；只能拿它的归档快照
`data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json` 作基线。

## 目标

1. 跑同口径新批次：8 个 approved 角色 × `expert` + `cold`，`maxTurns=50`；
2. 用 WP-K CLI 做正式四态判定（improved / neutral / regressed / incomparable）；
3. 审计新批次来访者 `<think>` 与咨询师空输出；
4. 把结论回写 `docs/worklog/pending/phase2.5-README.md` §3.2 出口条件表。

## 非目标

- 不改业务代码；发现新问题另开任务。
- 不做真实督导师双人盲标（没有真值）；涉及人工盲标的维度只能标“不可判定”。
- 不把 `incomparable` 包装成达标。

## 批次口径

- 角色：8 个 approved slug（4 个 A 类 + 4 个 B 类）；
- 模式：`expert` + `cold`（与 96 场基线一致）；
- 重复：1 次 → 16 场；
- 档案：`long`，`maxTurns=50`（约 50 分钟会谈）；
- 场景：`full_simulation`；审议 `rule_only`。

## 验收

- 16/16 场 completed，batchHealth.valid=true；
- 来访者 `<think>` 0 / 咨询师空输出 0；
- WP-K 输出正式结论行；README §3.2 与结论一致。
