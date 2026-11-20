---
taskId: AF-089
contextId: phase2.5-exit-remediation
title: Phase2.5 长会话档案与出口④临床标注协议
type: implementation
status: backlog
baselineRef: af4c0c88eb760daa4533027eaf034f8c696d1c18
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T17:30:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/auto-practice/
    - test/auto-practice/
    - docs/worklog/
    - docs/reference/psych-cases/
  modules:
    - auto-practice-runner
    - counselor-prompt
    - clinical-eval
  interfaces:
    - RunPracticeInput
    - BatchBody
    - CounselorGenerateOptions
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af089-phase25-session-realism-exit4-protocol-2026-11-18.md
    kind: report
  - name: 出口④临床标注协议
    path: docs/reference/phase2.5-exit4-clinical-label-protocol.md
    kind: spec
gates:
  - command: corepack pnpm typecheck
    check: 全量类型检查 0 error
    threshold: error=0
  - command: corepack pnpm lint
    check: lint 0 error 0 warning
    threshold: error=0, warning=0
  - command: corepack pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: 内核边界 12/12 通过
    threshold: passed=12, failed=0
  - command: corepack pnpm exec vitest run test/auto-practice/practice-runner.spec.ts test/auto-practice/counselor-agent.spec.ts
    check: 定向单测全绿
    threshold: failed=0
successCriteria:
  - 新增可选长会话档案，缺省路径与既有 15 轮行为逐字不变
  - 50 轮档案的 maxTurns=50、自然收尾最早轮次=35、停滞阈值放宽到字面 4 / 无推进 5、危机后置窗 6 轮
  - 咨询师 prompt 增加长会话收尾纪律，明确 40-50 轮目标且不得在 35 轮前自然收尾
  - 批次入口与队列 job 透传 sessionProfile，未传时走 legacy 档案
  - 出口④临床标注协议写清六维 schema、双人盲标 + 仲裁流程、现有 12 份真实案例只有 trust/bond/safety 三维可判、verbal/depth/style 标为缺真值，不得用合成数据冒充 80%
  - 真实案例覆盖率报告：12 案例 / 496 轮，逐维标注计数与缺口
  - engine-core 零 diff
  - 提交只含本任务文件，不混入并行产物
---

# AF-089 · Phase2.5 长会话档案与出口④临床标注协议

## 1. 背景

用户要求把 Phase2.5 出口④按临床级标准处理，同时修正“一场 50 分钟咨询只有 20 多轮”的会话真实性问题。只读盘点确认：

- 当前 `DEFAULT_MAX_TURNS=15`，批次入口缺省也是 15；
- `close-discipline` 明确鼓励“该收就收”，`MIN_TURNS_BEFORE_CLOSE=5`；
- 停滞阈值 `STAGNANT_LITERAL_STREAK_LIMIT=2` / `STAGNANT_NO_PROGRESS_LIMIT=3` 对长会话过早；
- 仓库内 12 份真实案例卡共 496 轮，Ground Truth 的 delta 只覆盖 trust 461 / bond 9 / safety 2，verbal / depth / style 无真值；
- `synthetic-supervisor-v1` 明确 `synthetic=true`，不能作 80% 验收。

## 2. 范围

本单只做两件事：

1. **长会话档案**：把“会话长度 / 收尾轮次 / 停滞阈值 / 危机窗”收敛成可选档案，缺省 legacy 行为不变；新增 long 档案供 50 分钟批次使用。
2. **出口④临床标注协议**：把六维真值 schema、双人盲标 + 仲裁、现有案例覆盖率与缺口写成可执行标准；不伪造标注、不把合成数据改成通过。

角色库扩充另立任务（AF-090），1000+ 场批次另立任务（AF-091），不在本单夹带。

## 3. 非目标

- 不改 `src/engine-core`；
- 不改真实 DB / Redis / `.env`；
- 不跑新 LLM 批次；
- 不把 `synthetic-supervisor-v1` 的指标写成出口④通过；
- 不新增角色、不改来访池模板。

## 4. 验收口径

- legacy 档案与 HEAD 行为逐字等价（单测快照）；
- long 档案的停止判据由纯函数 `decideTurn` 显式接收，不在循环里散落阈值；
- `sessionProfile` 从 HTTP batch body → queue job → runner 全链路透传；
- 出口④协议文档明确“当前只能判未通过 / 部分可判”，并给出补齐路径；
- 定向闸门与内核边界全绿。

## 5. 风险

- 长会话会让单场成本与时长上升，属于预期；用档案显式选择，不默认打开。
- prompt 增加长会话纪律会改变 `prompt_version` 指纹，属于有意变更，需在交付记录写清。
- 真实督导标注仍需外部临床资源；本单只交付协议与覆盖率，不冒充完成验收。
</content>
