---
taskId: AF-465
contextId: phase2.5-visitor-register-eval
title: 来访者语域指纹机制稳定性评测（10 角色 × 双模式 × AI 盲评）
type: verification
status: backlog
baselineRef: 65a7f00f951ee24906347bfb9e26b6eb696db293
dependsOn: []
priorTasks: [AF-462, AF-463]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-24T18:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - scripts/eval/visitor-register-stability/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-visitor-register-eval/AF-465/
  modules:
    - eval
  interfaces: []
artifacts:
  - name: 机制稳定性评测报告
    path: docs/worklog/completed/phase2.5/af465-visitor-register-stability-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/eval/visitor-register-stability/__tests__/metrics.spec.mjs
    check: 指标纯函数单测全绿
    threshold: 0 failed
  - command: node --check scripts/eval/visitor-register-stability/run-eval.mjs
    check: 评测入口语法可解析
    threshold: exit 0
  - command: pnpm lint
    check: 全量 lint
    threshold: 0 error
successCriteria:
  - 固化可复现评测入口，产出 manifest / turns / metrics / ratings 四类落盘件
  - 跑满 10 个标定角色 × base/active 各 30 轮，共 20 场，失败轮为 0
  - 每场固定同一份 30 轮咨询师脚本，脚本哈希入 manifest
  - 双 AI 评委盲评，A/B 匿名且左右随机，逐场抽 8 轮，输出四维评分与一致性
  - 报告按角色给出 base/active/delta、注入检查、BDI 护栏、跨角色方向与失败原因
  - 不改生产源码、不碰 engine-core、不提交原始心理台词
---

## 1. 背景

AF-463 只覆盖念安 1 个角色、1 次、30 轮，属于 smoke test。本任务把结论升级到“机制是否稳定”：
跨 10 个标定角色、双模式、固定脚本、AI 盲评，并按预注册门槛判定，而不是跑完再挑角度。

## 2. 范围

新增评测脚本与单测，跑真实 debug 会话，产出聚合报告。生产源码不改；原始台词只留本地
`data/eval/`（gitignore），仓库只提交指标、评分与报告。

## 3. 方法

- 10 个 `VISITOR_SPEECH_REGISTER_ROLE_KEYS` 全覆盖。
- base 与 active 各一场，30 轮，同一角色同一脚本逐字一致。
- active 进程 `VISITOR_REGISTER_MODE=active` 且白名单覆盖 10 角色；base 进程 `off`。
- 逐轮抓 `promptFull`、回复、BDI、delta、crisis、eventTags、usage、耗时。
- 主指标：`register-v1` 四维盲评 + 配对偏好；确定性指标只作解释变量。
- 双 AI 评委、A/B 匿名、左右随机；逐场抽第 1/4/8/12/16/20/25/30 轮。

## 4. 判定门槛（预注册）

- 注入：active 100% 带语域块，base 0%。
- 方向：10 角色中至少 8 个 active 优于 base；中位 `register_fit` 提升 ≥ +0.5。
- 刻板：`stereotype_risk` ≥ 4 的角色 ≥ 9/10，且无角色比 base 下降 > 0.5。
- 稳定：`cross_turn_stability` ≥ 4 的角色 ≥ 8/10；后 10 轮标志词命中不低于前 10 轮的 70%。
- 不回归：助手腔、临床术语、建议式回答、标签化表达不增加；crisis 检测不变。
- 护栏：同轮 BDI 策略 / delta / crisis 与 base 完全一致；不一致则该场作废。
- 成本：prompt 开销中位 ≤ +25%，p95 延迟 ≤ +15%。

## 5. 偏差处理

若某角色脚本无法在 30 轮内形成有效压力点，只允许在开跑前修改并重算哈希；开跑后不改。
若 AI 评委一致性低于阈值，报告降级为“方向一致但证据有限”，不强行给机制结论。
