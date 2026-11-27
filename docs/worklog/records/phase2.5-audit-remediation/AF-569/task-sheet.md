---
taskId: AF-569
contextId: phase2.5-audit-remediation
title: 出口④ safety 六场 no_plan AI 双盲复评与收口
type: implementation
status: backlog
baselineRef: 9b26a9b3617a7b2c9bd55af54edea37965062fe2
riskClass: R2
gateProfile: full
dependsOn:
  - AF-529
  - AF-536
  - AF-561
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T11:07:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - src/auto-practice/
    - test/auto-practice/
    - scripts/eval/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/phase2.5-audit-remediation/AF-569/
  modules: [auto-practice]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af569-safety-ai-double-blind-2026-11-27.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/auto-practice/session-structure-audit.spec.ts
    check: 定向双盲与危机识别回归全绿
    threshold: exit 0
  - command: pnpm test
    check: 全量测试无失败
    threshold: exit 0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零 diff
    threshold: 输出为空
successCriteria:
  - 用 AF-529 的 packet-09/10/20/36/37/46 六份逐字稿复算当前 safety cap，记录修复前 2 分与修复后原始/封顶/最终分
  - 对六 packet 跑 AI 双盲 R1/R2，并对分歧跑 R3 仲裁，输出独立评分、仲裁表、最终 CSV 与 provenance
  - 任一 packet 最终 safety 仍低于 3 时，定位是评分口径还是真实内容缺口；真实缺口只修根因并复评，不下调阈值、不改锚点
  - 六场若全部 safety 大于等于 3，将 48 packet 的 safety 门从 6 场等于 2 更新为定向复评通过，并明确这是 AI proxy 而非临床验收
  - 交付记录写清模型、调用次数、token、成本、六场 before/after、残留项与不翻绿边界
  - 不做真实督导师双盲，不写 clinicalAcceptanceEligible=true，不改 engine-core、前端、admin-dashboard
---

# AF-569 · 出口④ safety 六场 no_plan AI 双盲复评与收口

## 背景

AF-529 复评六门 5/6，唯一失败项是 safety：packet-09/10/20/36/37/46 均为 2 分，封顶原因全部是 `safety.crisis.no_plan`。随后 AF-536 修正了“咨询师筛查/第三方担忧/工作词被误判为来访者危机披露”的评分假阳性，AF-561 又在 runner 侧补了危机窗安全内容门。但这两项修复都没有用 AI 双盲重新判定六场，README 仍停留在 AF-529 的 6 场=2。

本任务只做 AI 层面的定向双盲复评与必要根因修复。真实督导师双盲 + 仲裁仍未发生，因此不得把本任务结果写成临床质量达标。

## 范围

- 从 AF-529 盲包中抽取六个安全失败 packet，复算当前 `evaluateSafetyCap()`，记录修复前后 cap 与 `crisisDisclosed`。
- 用 `bin/ai-double-blind.ts run` 对六 packet 跑 R1/R2 独立评分和 R3 仲裁；模型沿用 AF-529 口径 R1 `MiniMax-M2.7`、R2 `MiniMax-M3.1-Flash`、R3 `MiniMax-M3`。
- 输出六场最终 safety、六维分、仲裁记录、调用/token/成本与 provenance。
- 若 packet 仍为真实内容缺口（如第三方风险未处理），在 `src/auto-practice/` 修根因并补回归；若需要新会话验证，只跑最小定向批次，不重复 48 场。
- 回写 `phase2.5-README.md` 与 `phase2.5-wp-list-2026-11-08.md` 的出口④ safety 状态；只改 safety 六场，不改 κ、exact、style 等其它门。

## 不在范围

- 不做真实督导师双盲、不写 `humanSupervision=true`、不写临床验收达标。
- 不重跑完整 48 场新批次，不重算 48 packet 的 κ/其他五门。
- 不下调 safety 阈值、不改 9 锚点、不改 engine-core。
- 不改前端、admin-dashboard、Flutter。
