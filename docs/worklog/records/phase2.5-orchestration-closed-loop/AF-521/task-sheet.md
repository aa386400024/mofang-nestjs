---
taskId: AF-521
contextId: phase2.5-orchestration-closed-loop
title: AF-393 修复后的生产批次与 long 会话灰度验证
type: verification
status: backlog
baselineRef: a721af85e6fcd69d0d295da0c7cfae541da2a414
dependsOn: []
priorTasks: [AF-393, AF-389]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T08:30:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只跑真实对练批次、写批次与场次数据并产出证据；不改业务代码、不碰 engine-core、不改表结构与线上配置。批次会产生 LLM 调用费用。
gateProfile: full
objective: 用当前 integrate HEAD 重建的运行实例跑一批真实对练，验证 AF-393 修复后的危机收束是否把 crisis_outcome=incomplete 清零，同时补一批 long 会话样本，为出口④/⑤提供新证据。
successCriteria:
  - 当前 HEAD 重新构建并启动的实例 engineVersion 不再是旧 af281r 的 v2026.11.16-...，批次记录能证明代码为本 HEAD。
  - 24 场生产批次（4 个危机高发角色 × cold/expert/intermediate × 2 repeats，legacy 档，maxTurns=20）terminal 24/24，batchHealth.valid=true，llmCallRatio≥0.95，renderFallbackRatio<5%，counterConsistent=true。
  - 4 场 long 批次（2 角色 × expert/cold，sessionProfile=long，maxTurns=50）terminal 4/4；失败场次逐场说明原因，不用“累计完成”掩盖。
  - 24 场批次中所有 crisis 活跃场次 crisisOutcome 为 safety_plan_completed；incomplete 为 0。若本批没有 crisis 样本，必须明确写“未采样到危机”，不得据此宣称安全门通过。
  - 输出批次级证据 JSON 与 Markdown 报告：批次 ID、场次/轮次/状态分布、crisis_outcome 分布、成本与 token、逐场 exit_reason；数据落 data/phase25-exit/af521-.../，报告落 docs/worklog/completed/phase2.5/。
  - 不改 src/、test/；git diff --stat HEAD -- src src/test 为空；git diff --stat HEAD -- src/engine-core 为空。
  - events verify PASS；交付记录六组机读标记齐全。
outOfScope:
  - 不改业务代码；如果批次暴露代码缺陷，另开任务单，不在本单顺手修。
  - 不改 engine-core、migration、表结构、prompt、env 配置。
  - 不跑全量 pnpm test（本单无源码改动，类型与 lint 只做卫生确认）。
  - 不做真人督导师盲标、不改出口④的临床判定；AI 分与批次指标只作候选证据。
  - 不触碰 admin-dashboard 与 Flutter 代码。
scope:
  files:
    - docs/worklog/
    - data/phase25-exit/
    - data/batch-reports/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af521-af393-postfix-batch-2026-11-26.md
    kind: report
  - name: 批次证据
    path: data/phase25-exit/af521-af393-postfix-batch/
    kind: dataset
gates:
  - command: pnpm build
    check: 当前 HEAD 构建通过
    threshold: exit=0
  - command: pnpm typecheck
    check: TypeScript 零错误
    threshold: exit=0
  - command: pnpm lint
    check: ESLint 零错误
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 输出为空
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: PASS
---

# AF-521 · AF-393 修复后的生产批次与 long 会话灰度验证

## 1. 背景

AF-393 修掉了 legacy 档危机窗到点硬切、风险收束轮不可达的问题，但交付记录 `BL-AF393-01` 明确写明：**只修代码路径，未重跑批次**。上一批 `hRW4V44-t43yyty_EyLke`（48 场 / 840 轮）仍有 7 场 `crisis_outcome=incomplete`，全部是旧代码产物，不能用来判断修复是否生效。

当前 3000 端口实例来自 `mofang-nestjs-af281r/dist/app`，engineVersion 为 `v2026.11.16-6cfb46e-250-g48cccbeb-dirty`，不是当前 `integrate` HEAD。直接拿它跑批次会把旧代码结果记成新证据，因此本单第一步必须按当前 HEAD 重建并重启实例。

## 2. 范围

在范围内：

- 用 `pnpm build` 构建当前 HEAD，停掉旧 `af281r` 实例，从当前工作树启动新实例。
- 通过 `POST /admin/api/auto-practice/batch` 发起两批真实对练：24 场生产批次 + 4 场 long 批次。
- 只读查询批次、场次、逐字稿字段，导出批次级证据。
- 写交付记录与批次证据目录。

明确不在范围内：

- 不改 `src/`、`test/`、`scripts/`、migration、`.env`、prompt。
- 不修批次暴露的代码问题；发现问题另开任务单。
- 不做真人盲标，不改出口④的临床结论。
- 不跑全量 `pnpm test`。

## 3. 批次设计

**生产批次（24 场）**

- 角色：`vpt_depression_avoidant_l1`、`vpt_grief_avoidance_l1`、`vpt_workplace_intellectualization_l1`、`vpt_general_secure_l1`（上一批 crisis 高发角色）
- 模式：`cold` / `expert` / `intermediate`
- repeats：2
- `sessionProfile`：`legacy`（保持与上一批 incomplete 场次同档，直接验证 AF-393 的 legacy 修复）
- `maxTurns`：20
- `scenarioType`：不传（沿用 runner 缺省 `full_simulation`）

**long 批次（4 场）**

- 角色：`vpt_depression_avoidant_l1`、`vpt_trauma_disorganized_l1`
- 模式：`cold` / `expert`
- repeats：1
- `sessionProfile`：`long`
- `maxTurns`：50

## 4. 红线

- 批次证据只落数值、枚举、ID、计数，不落对话原文。
- 不用旧实例产出冒充当前 HEAD 结果；engineVersion 必须与当前 HEAD 对应。
- 不把“没有危机样本”写成“安全门通过”。
- 不改代码、不改表结构、不改环境配置。

## 5. 闸门

- `pnpm build` exit 0。
- `pnpm typecheck` 0 error；`pnpm lint` 0 error。
- `git diff --stat HEAD -- src src/test` 为空；`git diff --stat HEAD -- src/engine-core` 为空。
- 生产批次 24/24 terminal、long 批次 4/4 terminal；batchHealth、llmCallRatio、fallback、counter 真数字入报告。
- `node scripts/orchestration/cli.mjs events verify` PASS。
