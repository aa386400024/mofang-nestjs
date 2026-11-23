---
taskId: AF-393
contextId: phase2.5-orchestration-closed-loop
title: 危机收束不可达缺口修复：所有档位危机场次必须完成风险五组
type: fix
status: backlog
baselineRef: 2b9968e2f41f1542eb913e0898904be273844907
dependsOn: []
priorTasks: [AF-176, AF-187, AF-188, AF-391, AF-392]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T23:26:00+08:00
deadline: null
agentRole: executor
riskClass: R1
riskRationale: 只改 auto-practice 业务层危机窗出口与结构补齐条件，不触碰 engine-core、不调用 LLM、不改数据库结构。
gateProfile: standard
objective: 修复最新批次 7 场 crisis_outcome=incomplete：legacy 档危机窗计数一到就硬切，风险收束轮不可达；同时保证任何档位在危机活跃时收尾都会补齐风险五组。
successCriteria:
  - legacy 档危机窗在 postTurns 达到 crisisPracticeTurns 时不再直接结束，至少保留 1 轮风险收束轮；收束轮之后才以 crisis_practice_max 结束。
  - standard / long 档既有“用满后留 1 轮收束、收束后结束”的行为不变。
  - 危机活跃且本轮为 crisisClosing 时，确定性补齐风险五组；补齐按会话级覆盖账本去重。
  - 新增 runner 级回归用例：legacy 档危机披露后第 7 轮触发 crisisClosing，退出原因为 crisis_practice_max，crisisOutcome 为 safety_plan_completed。
  - 更新 legacy 档出口单测与既有的 practice-runner 危机窗用例，明确“危机窗 4 + 1 收束轮”的新契约。
  - 定向 vitest 全绿；pnpm lint 0 error；pnpm typecheck 0 error；git diff --stat HEAD -- src/engine-core 为空。
outOfScope:
  - 不修改 engine-core 纯层。
  - 不改风险分级阈值、不改升级路径（AF-137）与安全修复轮（AF-138）的既有语义。
  - 不重跑练习批次、不写数据库、不调用 LLM。
  - 不修改 admin-dashboard 与 Flutter 代码。
scope:
  files:
    - src/auto-practice/practice-runner.service.ts
    - test/auto-practice/practice-runner-decide-turn.spec.ts
    - test/auto-practice/practice-runner.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af393-crisis-risk-closing-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts test/auto-practice/practice-runner.spec.ts test/auto-practice/session-profile.spec.ts
    check: 危机窗出口与风险收束定向用例全绿
    threshold: exit=0
  - command: pnpm lint
    check: ESLint 零错误
    threshold: exit=0
  - command: pnpm typecheck
    check: TypeScript 零错误
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 输出为空
---

# AF-393 · 危机收束不可达缺口修复

## 1. 背景

最新有效批次 `hRW4V44-t43yyty_EyLke` 有 7 场 `crisis_outcome=incomplete`，全部 exit_reason 为 `crisis_practice_max`，turn_count 8–15、max_turns 20。根因是 legacy 档 `crisisRiskClosingRound=false` 时，`decideCrisisWindowStop` 在 `postTurns >= crisisPracticeTurns` 当轮直接硬切，下一轮的风险收束 cue 永远没有机会发出；`applyDeterministicStructure` 只在 `cue.crisisClosing` 时补齐五组，因此这些场次以 incomplete 收尾。

这不是评分口径问题，是安全收束不可达。修复原则：危机活跃的场次，无论 legacy / standard / long，都必须在结束前完成一轮风险五组收束；普通 legacy 会话的轮次与话术不变。

AF-391 因 `agentRole: orchestrator` 的资源域不覆盖 src/test 被调度器拦截并取消；AF-392 因 scope 漏 `practice-runner.spec.ts` 取消；本单以 executor 角色、完整测试 scope 重登同一内容。

## 2. 范围

在范围内：

- `src/auto-practice/practice-runner.service.ts`：调整危机窗出口，legacy 也保留 1 轮风险收束；收束轮后结束。
- `test/auto-practice/practice-runner-decide-turn.spec.ts`：更新 legacy 出口断言；新增 runner 级安全收束完成用例。
- `test/auto-practice/practice-runner.spec.ts`：更新既有危机窗用例的轮次断言。
- 交付记录、记录包。

明确不在范围内：

- 不改 `engine-core`。
- 不改危机升级路径、风险分级和修复轮逻辑。
- 不重跑真实批次，不写数据库。

## 3. 交付物

- 代码修复与回归用例。
- `docs/worklog/completed/phase2.5/af393-crisis-risk-closing-2026-11-23.md` 交付记录。
- 回执六组机读标记。

## 4. 红线

- 风险五组补齐必须来自 `completeRiskClosingText`，不得手写另一套模板。
- 不把 incomplete 计数改小来“制造达标”，只修不可达路径。
- 心理原文不进日志、不进交付记录。

## 5. 闸门

- 定向 vitest、lint、typecheck 全绿。
- `git diff --stat HEAD -- src/engine-core` 为空。
- 事件链 `events verify` PASS。
