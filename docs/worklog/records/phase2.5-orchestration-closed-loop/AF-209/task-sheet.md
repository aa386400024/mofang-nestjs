---
taskId: AF-209
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R3：语域审计、场景矩阵与不可朗读文本拦截
type: implementation
status: backlog
baselineRef: fcac5b2c1b881d0b6fbac9ca0e7b29cb4982c5ad
dependsOn: []
priorTasks: [AF-207, AF-208]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T23:36:35+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/realism/
    - src/engine-adapters/rendering/
    - test/auto-practice/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af209-realism-r3-register-2026-11-20.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af208-realism-event.spec.ts test/auto-practice/af208-realism-audit.spec.ts test/engine-adapters/af208-realism-retry.spec.ts test/auto-practice/af209-register-audit.spec.ts test/auto-practice/af209-realism-matrix.spec.ts test/engine-adapters/af209-register-retry.spec.ts
    check: R2 回归 + R3 定向测试全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型检查 0 error
    threshold: exit=0
  - command: pnpm exec eslint --no-cache "{src,test}/**/*.ts"
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试 0 failed
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 7 类角色 × 3 类场景 × 4 类状态带的真人度 profile、话轮形态、事件计划与语域约束保持确定性，场景默认面对面。
  - 语域审计能确定性识别不可朗读文本（括号动作、星号动作、界面词），并作为硬违约；临床上不属于来访者口语的咨询术语、书面连接词、助手口吻、元话语作为软信号，只记录不误判为硬失败。
  - active 模式的语域约束进入 prompt，且与场景/角色一致；off/audit 模式 prompt 逐字不变，不增加调用。
  - active 模式遇到不可朗读文本时最多重试一次；重试仍失败保留可读文本并记录违约，不降级成兜底句；流式不重试。
  - 日志只记录 mode/scene/role/state/shape/违约类型/信号/事件计数，不打印台词原文。
  - 定向测试、类型检查、lint、全量测试全绿；engine-core 零 diff；交付记录与回执齐全。
---

# AF-209 · 来访者真人度 R3

## 目标

R2 已解决“这一轮说多长、像不像口语”的形态层问题；本单推进到“说出来的话是否属于来访者语域，以及场景是否始终正确”：

1. **场景矩阵固化**：把 `in_person / online_voice / online_text` 与 7 类角色、4 类状态带的交叉行为固化成确定性测试，防止后续 prompt 改动把默认面对面冲掉。
2. **语域审计**：新增来访者口语语域检查，识别不该由来访者说出的咨询/诊断术语、书面连接词、助手口吻、元话语；这些先作为软信号，不直接判失败。
3. **不可朗读文本硬拦**：括号动作、星号动作、界面词（如“对方正在输入”“语音条”“聊天框”）不能被 TTS 朗读，也不能出现在咨询室场景；命中即硬违约，active 最多重试一次。
4. **场景一致性**：面对面场景不得出现线上界面语；线上文字场景也不得写界面动作；所有场景都只输出可直接朗读的台词。

## 硬约束

- 不碰 `src/engine-core`。
- 不新增 env 键；`RENDER_REALISM_MODE` 仍为 `off/audit/active`，默认 `off`。
- 不随机改写字句，不注入固定模板；重试只追加“本轮重说要求”。
- 语域软信号不得升级为硬失败；只有不可朗读文本才是新增硬违约。
- 日志只记分类与计数，不记台词原文；风险轮仍跳过形态/配额强判。
- 不宣称临床有效性；本单只到“临床代理门槛 + 工程闸门”。

## 验收边界

- 本单不做真实 LLM 批量复跑，也不改 AI 双盲评分口径；真实批次与 AI 评分器留给 R4。
- 历史导出只用于回归口径核对，不作为生产重试率证据。
