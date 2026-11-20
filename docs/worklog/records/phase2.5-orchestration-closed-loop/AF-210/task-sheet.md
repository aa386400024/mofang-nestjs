---
taskId: AF-210
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R4：prompt 回显常开拦截、场景化语域与批次基线
type: implementation
status: backlog
baselineRef: e54012bfc3f7f01c36bf60695df7bfa775558dca
dependsOn: []
priorTasks: [AF-207, AF-208, AF-209]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T00:22:12+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/realism/
    - src/shared/text/
    - src/auto-practice/metrics/
    - src/engine-adapters/rendering/
    - scripts/ops/quality/
    - test/auto-practice/
    - test/engine-adapters/
    - test/shared/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af210-realism-r4-prompt-echo-2026-11-21.md
    kind: report
  - name: 批次基线报告
    path: data/phase25-exit/af210-realism-baseline/report.json
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af209-register-audit.spec.ts test/auto-practice/af209-realism-matrix.spec.ts test/engine-adapters/af209-register-retry.spec.ts test/auto-practice/af204-output-integrity-shape.spec.ts test/auto-practice/af187-encounter-output-integrity.spec.ts test/auto-practice/af210-prompt-echo-guard.spec.ts test/auto-practice/af210-register-scene.spec.ts test/auto-practice/af210-realism-baseline.spec.ts
    check: R3 回归 + R4 定向测试全绿
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
  - prompt 回显由输出完整性闸门常开拦截，不依赖 RENDER_REALISM_MODE；R3 的模板标记并入同一份词表，避免两套口径分叉。
  - 语域审计按场景区分：舞台动作与 prompt 回显所有场景都硬拦；聊天界面内容在 online_text 允许，在 in_person / online_voice 仍硬拦。
  - active 生成侧继续最多一次重试；off / audit 不增加调用；流式不重试；日志不打印台词原文。
  - 新增批次基线工具，扫描 data/debug-sessions，只输出会话数、轮数、违约/信号计数、事件密度与场景切片，不输出任何台词。
  - 在现有 360 场样本上产出可复算基线，并在交付记录中说明旧批次与 R4 后行为的差异。
  - 定向测试、类型检查、lint、全量测试全绿；engine-core 零 diff；交付记录与回执齐全。
---

# AF-210 · 来访者真人度 R4

## 目标

R3 已能识别 prompt 回显与不可朗读文本，但真实样本暴露两个缺口：

1. **scope 缺口**：`RENDER_REALISM_MODE` 默认 `off`，R3 的 `prompt_echo` 只在 audit/active 生效；输出完整性闸门的 prompt 词表又不覆盖全部模板段，导致 360 场样本里 34 条回显只有 9 条被常开闸门命中。
2. **场景误判**：线上文字咨询里“打开聊天框看看有没有回复”是正常内容，R3 当前把所有界面词都按不可朗读硬拦，会把真实表达判失败。

本单把这两处治本，并补一份可复算的批次基线，给后续 active 灰度提供锚点。

## 硬约束

- 不碰 `src/engine-core`。
- 不新增 env 键；不改变默认 `off`。
- prompt 回显词表只做单一真相源，不允许 `output-integrity` 与 `visitor-register-audit` 各维护一份。
- 批次基线只输出数字与 id，不输出台词；报告文件不入库。
- 不宣称临床有效性；只到“临床代理门槛 + 工程闸门”。

## 验收边界

- 本单不新跑真实 LLM 批次；只读既有 `data/debug-sessions` 做基线。
- AI 双盲评分接入留到 R5；本单不评“像不像真人”的主观分。
