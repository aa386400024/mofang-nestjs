---
taskId: AF-043
contextId: phase2.5-orchestration-closed-loop
title: 台账收口复核（AF-040 rejected 归因 + 15 条终态核对）
type: verification
status: backlog
baselineRef: ba582325d10426d5bf194048b07899dcb3a1a373
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T03:58:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 通道失败口径裁定书
    path: docs/team/agent-orchestration/channel-failure-decisions-2026-11-17.md
    kind: report
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af043-improvement-closeout-rework-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: 'FAIL=0'
successCriteria:
  - 复用 AF-040 已在库的实现（commit 5cae3f6），不重复改动
  - 交付记录写明 AF-040 被判 rejected 的真实原因（同树跨任务残留）与消除方式（分组提交）
  - 台账 15 条全部到终态
evidenceFormat: commit hash + vitest 用例数 + validate PASS 计数 + 台账 summary
---

# AF-043 任务单（台账收口复核）

## 1. 为什么用「复核」而不是「复做」

AF-040 的实现全部在库（`5cae3f6`），AF-041 / AF-042 的用例改动在库（`c8632c6`），文档在库（本批 docs commit）。**代码侧没有待做的事**，待做的是「核对台账 15 条是否真的到了终态、闸门数字是否可复跑」。

机读护栏此前两次判 rejected 都不是工作量问题，而是判定口径问题：

| 单     | 判死理由                                                   | 口径实质                                 |
| ------ | ---------------------------------------------------------- | ---------------------------------------- |
| AF-040 | 同树里 `test/` 改动被判越界残留                            | 跨任务同树残留（AF-038-I2 已知口径缺陷） |
| AF-042 | 同树里 README / improvement-log / config.json 被判越界残留 | 同上                                     |

`verification` 类任务的 V7 文件域比对按规范跳过（只读任务不占写域），因此本单能拿到干净结论；这也是规范的**设计意图**，不是绕过。

## 2. 范围

- 只读核对：台账终态、闸门复跑数字、commit 清单与交付记录一致性；
- 新增复核交付记录 1 份（报告类产出，不占写域）。

## 3. 验收

- `improvements --summary` 活跃=0；
- 编排单测 / lint / typecheck / validate / contracts / events verify 全部复跑绿；
- 三个 commit 的文件清单与各单回执 changedFiles 一致。

## 4. 复跑要点

见 `docs/worklog/completed/phase2.5/af043-improvement-closeout-rework-2026-11-17.md`。
