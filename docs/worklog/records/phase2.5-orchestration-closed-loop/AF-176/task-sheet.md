---
taskId: AF-176
contextId: phase2.5-orchestration-closed-loop
title: Phase2.5 出口④ 开场与危机收束确定性结构收口
type: implementation
status: backlog
baselineRef: 297ff0a91da94a3aaf39239e1cc9a56fe1e85d7c
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T05:12:00Z
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/practice-runner.service.ts
    - src/auto-practice/metrics/session-structure-audit.ts
    - test/auto-practice/practice-runner-decide-turn.spec.ts
    - test/auto-practice/session-structure-audit.spec.ts
    - docs/worklog/pending/af176-deterministic-structure-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af176-deterministic-structure-close-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af176-deterministic-structure-close-2026-11-20.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/session-structure-audit.spec.ts test/auto-practice/practice-runner-decide-turn.spec.ts test/engine-core/boundary.spec.ts
    check: 定向全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
  - command: git diff --name-only 297ff0a -- src/engine-core
    check: 零 diff
    threshold: empty
successCriteria:
  - standard/long 档首轮咨询师输出由 runner 确定性补齐开场五要素，legacy 档逐字不变
  - 危机升级后的计划/修复轮由 runner 确定性补齐风险收束五组，不伪造来访者事实，legacy 不变
  - 新增定向单测覆盖开场补齐、风险补齐、legacy 不变与结构审计 5/5、3/3、5/5
  - 新 long 批次至少 16 场，批次健康 valid=true、llmCallRatio=1、fallback=0、counterConsistent=true
  - 结构审计开场 5 项全覆盖 16/16，收束按模式完整 16/16；安全硬上限封顶后无 packet safety<3
  - AI 六项硬门中 exact、within±1、overall 均值、style、safety 通过；overall κ 仍按独立任务处理，不下调阈值或写成达标
  - src/engine-core 零 diff，全量测试与 lint/typecheck 真实通过
---
# AF-176 · Phase2.5 出口④ 开场与危机收束确定性结构收口

## 1. 背景

AF-146 单批 16 packet 的最新质量门为 4/6：exact、within±1、overall 均值、style 通过，safety 与 overall κ 失败。AF-152 把 safety 硬上限搬到后处理后，暴露出 3 个 packet safety<3；结构审计仍有 4 场 risk-incomplete、1 场 none，开场全项 10/16、收束全项 11/16。

根因不是评分员，而是咨询师输出对“开场知情框架”和“危机安全计划”的依从性不稳定：AF-129 只加了 prompt，AF-144 只对常规收束做了确定性补齐，开场与风险收束仍完全依赖模型。

## 2. 实现要求

1. 在 `session-structure-audit.ts` 新增开场五要素的确定性补齐函数，以及风险收束五组的确定性补齐函数；只补结构句式，不伪造来访者说过的事实。
2. 在 `practice-runner.service.ts` 中仅对 `standard` / `long` 档首轮咨询师输出补开场；仅对危机升级后的计划/修复轮补风险收束；`legacy` 分支保持逐字不变。
3. 补齐后的文本仍按咨询师口吻输出，安全计划使用通用、可执行的求助路径，不写入诊断、不承诺疗效。
4. 新增单测覆盖：
   - 开场补齐后结构审计五项全中；
   - 风险补齐后五组全中；
   - legacy 档字节不变；
   - 危机序列不因补齐而提前结束或额外延长。
5. 跑新 long 批次 ≥16 场，完成结构审计与 AI 双盲；批次健康四项必须为真。
6. 若新批次 safety 或结构仍不达标，不得改阈值、不得把 4/6 写成达标；按实际结果登记遗留。

## 3. 边界

- 不改 `src/engine-core`。
- 不改 AI 评分阈值（0.40 / 3.50 / safety≥3）。
- 不把结构命中写成临床质量达标；继续保持 `ai_proxy_candidate / humanSupervision=false / clinicalAcceptanceEligible=false`。
- 不改 AF-146/AF-152 已归档证据；新证据单独落 `data/phase25-exit/af176-*`，由后续数据任务入库。

## 4. 验收

- 定向测试、typecheck、lint、全量测试真实通过。
- 新批次结构审计达到 16/16 开场、16/16 收束按模式完整；safety 封顶后无 packet<3。
- 交付记录写明 gateResults、scopeCheck、contractChecks、backlogItems、deviationTable、reviewVerdict。

