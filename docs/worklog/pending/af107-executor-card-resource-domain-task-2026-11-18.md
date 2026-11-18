---
taskId: AF-107
contextId: phase2.5-exit4-quality-remediation
title: 扩展 executor Agent Card 资源域覆盖 bin
type: implementation
status: backlog
baselineRef: c1bb8750f996faf74e1350c85e101d88967105d0
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T22:58:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/agent-cards/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af107-executor-card-resource-domain-2026-11-18.md
    kind: report
gates:
  - command: node -e "const c=JSON.parse(require('fs').readFileSync('docs/team/agent-orchestration/agent-cards/executor.json','utf8'));if(!c.resources.includes('bin/'))process.exit(1)"
    check: executor card 资源域包含 bin/
    threshold: exitCode=0
successCriteria:
  - executor Agent Card 的 resources 声明增加 bin/，与实际执行域一致
  - 不改 cannotDo / requiresApproval 任何一条约束
  - 不扩大 executor 的 src / test 授权（本任务只补漏掉的 bin/ 目录）
  - 交付记录写明冲突现象与为什么必须在卡片层修
  - engine-core 零 diff
---
# AF-107 扩展 executor Agent Card 资源域覆盖 bin

## 背景

AF-106 登记后被 `run-once` 以 `scope-domain-conflict` 拦下：任务单需要改
`bin/seed-character-profiles.ts`，而 executor Agent Card 的 `resources` 只声明了
`src/` / `test/` / `docs/worklog/pending/` / `docs/worklog/completed/`，不含 `bin/`。

这是**框架资源域与真实执行域不一致**：`bin/` 是本仓的运维 / 种子脚本目录，
executor 在既有任务里已经实际读过并执行过这些脚本。若靠放宽任务 scope 绕过，
卡片就失去"可写域"的约束意义；正确修法是把卡片声明补到与实际一致。

## 目标

在 executor Agent Card 的 `resources` 里增加 `bin/`，让需要改种子 / 运维脚本的
实现任务不再被误拦。

## 非目标

- 不放宽 `cannotDo` / `requiresApproval` 的任何一条（尤其"不直接提交 / 不推送"）。
- 不把整个仓库声明为可写域；只补真实执行域里缺失的 `bin/`。
- 不顺手改 scheduler 的域校验规则。

## 验收

- `executor.json` 的 `resources` 含 `bin/`；
- 用一段只读脚本断言该声明存在（gate 命令见 frontmatter）；
- 交付记录写明"AF-106 被拦 → 卡片补域 → AF-108 继续实现"的因果链。
