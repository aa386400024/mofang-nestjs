---
taskId: AF-524
contextId: phase2.5-orchestration-closed-loop
title: AF-393 危机收束定向复刻批次
type: verification
status: backlog
baselineRef: 9451eb71c3d5d84214857f594400044caa256b66
dependsOn: []
priorTasks: [AF-393, AF-521]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T09:22:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只跑真实对练批次、写批次与场次数据并产出证据；不改业务代码、不碰 engine-core、不改表结构和线上配置。批次会产生 LLM 调用费用。
gateProfile: full
objective: 对旧批次 hRW4V44-t43yyty_EyLke 中 7 场 crisis_outcome=incomplete 的角色×模式组合做定向复刻，验证 AF-393 修复后在相同 legacy 档、相同 maxTurns=20 条件下不再产生 crisis_practice_max + incomplete，并补足可对外表述的危机样本量。
successCriteria:
  - 用当前 integrate HEAD 重建并启动实例，批次 engineVersion 对应本 HEAD，不得复用旧实例结果。
  - 7 个历史 incomplete 组合各复刻 3 次，按角色×模式分组为 4 个批次，合计 21 场；全部 terminal，失败场次逐场说明原因。
  - 每个子批次 batchHealth 真数字入证据：valid、llmCallRatio、fallbackRatio、counterConsistent、degradedTurns。
  - 所有 crisis 活跃场次 crisisOutcome 为 safety_plan_completed；crisis_practice_max 且 incomplete 的场次为 0。若某组合未采样到危机，必须逐组合写明，不得用全局 0 掩盖。
  - 危机活跃样本达到 10 场；不足 10 场时追加一轮同组合批次，追加后仍不足则按实际结果判定并说明边界，不伪造样本。
  - 输出批次级与场次级证据 JSON 及 Markdown 报告；证据落 data/phase25-exit/af524-crisis-replication/，报告落 docs/worklog/completed/phase2.5/。
  - 不改 src/、test/、migration、prompt、.env；git diff --stat HEAD -- src src/test 为空；git diff --stat HEAD -- src/engine-core 为空。
  - events verify PASS；交付记录六组机读标记齐全。
outOfScope:
  - 不改业务代码；批次暴露代码缺陷另开任务单。
  - 不做真人督导师盲标，不改出口④临床判定。
  - 不启动 1000 场出口⑤批次。
  - 不修共享 Redis 队列命名空间与 MySQL 启动恢复，另开任务单。
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
    path: docs/worklog/completed/phase2.5/af524-crisis-replication-2026-11-26.md
    kind: report
  - name: 批次证据
    path: data/phase25-exit/af524-crisis-replication/
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

# AF-524 · AF-393 危机收束定向复刻批次

## 1. 背景

AF-521 在 AF-393 修复后跑了 28 场真实对练，其中危机样本 3 场，全部 `safety_plan_completed`、`incomplete=0`；但这只能说明“没有复现”，不能宣布历史 7 场 `crisis_outcome=incomplete` 已闭环。

旧批次 `hRW4V44-t43yyty_EyLke` 的 7 场 incomplete 全部是 `exit_reason=crisis_practice_max`，`sessionProfile=legacy`、`maxTurns=20`。本单按这 7 个角色×模式组合定向复刻，直接检验同一路径。

## 2. 复刻组合

| 组合 | characterSlug | counselorModeId | 旧场次轮数 | 旧危机峰值 |
|---|---|---|---|---|
| 1 | `vpt_self_worth_intellectualization_l1` | `expert` | 15 | 1 |
| 2 | `vpt_workplace_intellectualization_l1` | `expert` | 12 | 2 |
| 3 | `vpt_workplace_intellectualization_l1` | `cold` | 8 | 1 |
| 4 | `vpt_general_secure_l1` | `intermediate` | 11 | 2 |
| 5 | `vpt_general_secure_l1` | `cold` | 9 | 1 |
| 6 | `vpt_grief_avoidance_l1` | `expert` | 9 | 1 |
| 7 | `vpt_grief_avoidance_l1` | `intermediate` | 9 | 1 |

按批次接口的笛卡尔积语义，分成 4 个子批次：

- `self_worth_intellectualization_l1` × `[expert]` × repeats 3 = 3 场
- `workplace_intellectualization_l1` × `[expert,cold]` × repeats 3 = 6 场
- `general_secure_l1` × `[intermediate,cold]` × repeats 3 = 6 场
- `grief_avoidance_l1` × `[expert,intermediate]` × repeats 3 = 6 场

合计 21 场；`sessionProfile=legacy`、`maxTurns=20`、`scenarioType` 不传。

## 3. 范围

在范围内：

- 用 `pnpm build` 构建当前 HEAD，从当前工作树启动验证实例。
- 通过 `POST /admin/api/auto-practice/batch` 发起上述 4 个批次。
- 只读轮询批次、场次、逐字稿字段，导出批次级与场次级证据。
- 写交付记录与证据 JSON。

明确不在范围内：

- 不改 `src/`、`test/`、`scripts/`、migration、`.env`、prompt。
- 不修批次暴露的代码问题；发现问题另开任务单。
- 不做真人盲标，不改出口④的临床结论。
- 不跑 1000 场批次，不跑全量 `pnpm test`。

## 4. 红线

- 批次证据只落数值、枚举、ID、计数，不落对话原文。
- 不用旧实例产出冒充当前 HEAD 结果；engineVersion 与 HEAD 不对应即作废。
- 不把“未采样到危机”写成“安全门通过”。
- 不改代码、不改表结构、不改线上配置；验证实例使用 `REDIS_DB=5` 隔离。

## 5. 闸门

- `pnpm build` exit 0。
- `pnpm typecheck` 0 error；`pnpm lint` 0 error。
- `git diff --stat HEAD -- src src/test` 为空；`git diff --stat HEAD -- src/engine-core` 为空。
- 4 个子批次全部 terminal；batchHealth、llmCallRatio、fallback、counter 真数字入证据。
- `node scripts/orchestration/cli.mjs events verify` PASS。
