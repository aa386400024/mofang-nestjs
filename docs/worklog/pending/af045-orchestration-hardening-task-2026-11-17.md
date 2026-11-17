---
taskId: AF-045
contextId: phase2.5-orchestration-closed-loop
title: 收口三项（CI 门禁实弹 / 框架条款漂移自动校验 / 熔断派发侧硬拦截）
type: implementation
status: backlog
baselineRef: 830da1a21e9ba1c909bff1bd6473652beeecc0ee
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T04:30:00.000Z
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
    path: docs/worklog/completed/phase2.5/af045-orchestration-hardening-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 'failed=0'
  - command: pnpm test
    check: 全量单测通过
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
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件日志投影一致
    threshold: 'mismatch=0'
successCriteria:
  - `branch merge --require-ci` 实弹跑通阻断与放行两条路径，放行路径的合并提交真实落入 integrate
  - 框架仓规范正文条款有可执行锚点校验，删改条款即 CI 失败（反例单测覆盖）
  - 熔断在派发侧硬拦截：open 整轮不派发、half-open 只放一次试探，均有单测
  - 两仓提交并 push，远端 CI 全绿，台账登记到 done
evidenceFormat: commit hash + vitest 用例数 + CI check 数 + conformance 检查项数 + 台账 summary
---

# AF-045 任务单（收口三项）

## 1. 来源

AF-044 收口后遗留的三个可选方向，用户确认「这几个都做了吧」全做：

| 方向                | 触发事实                                                    | 本轮交付                                        |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `--require-ci` 实弹 | 门禁只有单测覆盖，没有一次真实远端结论参与合并              | 阻断路径 + 放行路径各跑一次真实调用             |
| 框架 `docs/` 漂移   | schema 哈希只锁机读契约，正文条款被改写时 CI 全绿却两套口径 | 条款锚点清单 + 静态检查 + 反例单测              |
| 熔断派发侧          | AF-044 里只到「开闸事件可观察」，派发仍会把新单送进坏通道   | 领单前硬拦截，open 整轮停派、half-open 只放一次 |

## 2. 范围

代码：`scripts/orchestration/scheduler.mjs`（新增 `resolveChannelCircuit` 与领单拦截）、`__tests__/orchestration.spec.mjs`（新增 3 例）、`docs/team/agent-orchestration/README.md` §5.2/§5.3。
框架：`conformance/normative-anchors.json`（新）、`conformance/checks.py#check_normative_docs`、`conformance/tests/test_checks.py`（新增 3 例）、`conformance/README.md`、`docs/tools.md` §8。

## 3. 验收

- 编排单测基线 189 → 本轮后净增 3 例；
- 框架 `run.py` 检查项数含新增「规范正文条款锚点一致」，失败 0；
- 框架 unittest 13 → 16；
- 远端 CI：阻断路径判 `unknown` 且被拦；放行路径 `pass` 并完成 squash 合并。
