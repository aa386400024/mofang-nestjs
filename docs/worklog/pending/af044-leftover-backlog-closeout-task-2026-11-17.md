---
taskId: AF-044
contextId: phase2.5-orchestration-closed-loop
title: 遗留待办五项落地（V7 commit 比对面 / 非失败事实 / 熔断半开 / CI token 来源 / 跨仓可靠性文档）
type: implementation
status: backlog
baselineRef: 2a354ca01f150e18852ba11c3b2b1eba04f01b1b
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T04:10:00.000Z
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
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af044-leftover-backlog-closeout-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: pnpm lint
    check: lint 无新增错误
    threshold: 'errors=0'
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 'errors=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: 'FAIL=0'
  - command: pnpm orchestration:contracts
    check: 框架契约包哈希一致
    threshold: 'FAIL=0'
successCriteria:
  - 五项遗留待办逐条落地，并有对应单测或文档证据
  - 台账登记 5 条并全部到 done，活跃=0
  - 框架仓 docs/reliability.md 与 docs/receipt-contract.md 同步修订，schema 哈希不变
evidenceFormat: commit hash + vitest 用例数 + lint/typecheck 结果 + validate PASS 计数 + 台账 summary
---

# AF-044 任务单（遗留待办五项）

## 1. 来源

三项来自真实误判，不是优化臆想：

| 事实                                                          | 后果                                      | 遗留项                                            |
| ------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| V7 按 `git diff` 全树比对                                     | AF-040 / AF-042 实现全在库却判 `rejected` | AF-043-I1 改按 commit 比对                        |
| `channel fallback` 缺 `--cause` 缺省判 `deterministic-defect` | AF-041 直接 `failed`（终态不可复活）      | AF-043-I2 / AF-042-I1 cause 必填 + 非判决性 cause |
| 熔断只有 `closed` / `open`                                    | 冷却期满无法安全放试探                    | 半开自动闭合                                      |
| CI 容器内无 `git credential`                                  | `--require-ci` 在 Actions 里取不到 token  | token 来源读 Actions 上下文                       |
| 框架 §4.1 / §5.1 口径落后于适配层实现                         | 规范与实现漂移                            | 跨仓文档修订                                      |

## 2. 范围

代码：`acceptance-runner`（commit 比对分流）、`handover-contract`（`changedFiles.commits` 校验）、`branch-workflow`（`filesInCommit`）、`scheduler` / `cli`（解析器注入）、`dispatch-channel`（非失败事实与半开）、`gui-dispatch`（bypassed 状态）、`ci-status`（token 来源与 GHES 基址）、用例与 README。
文档：后端 README §5.1/§5.2/§5.3/§5.5；框架 `docs/reliability.md` §4.1/§5.1、`docs/receipt-contract.md` §3.1、`CHANGELOG.md`。

## 3. 验收

- 单测 189 passed（基线 179，净增 10 例）；
- `validate` / `contracts` 全 PASS；
- 台账 5 条 done，活跃=0；
- 框架仓 schema 哈希不变（本次只动 `docs/` 与 `CHANGELOG.md`）。
