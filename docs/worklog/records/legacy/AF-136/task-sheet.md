---
taskId: AF-136
contextId: phase2.5-ai-proxy-acceptance
title: AF-133 收束修复后的 long 批次质量复评（结构审计 + AI 双盲）
type: verification
status: backlog
baselineRef: ca6033c85d4889f91059cca6ca8607158f99b892
dependsOn: [AF-135]
priorTasks: [AF-135, AF-133, AF-131, AF-130]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T16:05:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - data/phase25-exit/
    - data/batch-reports/
    - data/debug-sessions/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af136-post-af133-quality-recheck-2026-11-19.md
    kind: report
gates:
  - command: pnpm build
    check: 构建成功，dist 与当前源码一致
    threshold: exitCode=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exitCode=0
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: engine-core 边界单测全绿
    threshold: exitCode=0
  - command: pnpm exec tsx bin/session-structure-audit.ts run --pack-dir <pack> --out <audit>
    check: 结构审计产出且可复算
    threshold: exitCode=0
  - command: pnpm exec tsx bin/ai-double-blind.ts run --pack-dir <pack> --out <scores>
    check: R1/R2/R3 AI 双盲评分产出且可复算
    threshold: exitCode=0
successCriteria:
  - 用当前 AF-133 分支源码重新 build 并重启 dist/app.js，确认进程启动时间晚于 build
  - 新跑 16 场 sessionProfile=long 批次（8 角色 × expert/cold × 1），不混入旧的 2YZ 批次
  - 新批次 16/16 completed、0 failed，batchHealth.valid=true 且 fingerprint 可追溯
  - 对 16 场生成 AF-111 blind pack，跑 AF-127 结构审计
  - 对同一 16 packet 跑 AF-125 同口径 ai-proxy-v2 评分，输出 R1/R2/R3、一致性与最终分
  - 按 AF-125 阈值表给出 AI 层面是否达标的正式结论，不改阈值凑达标
---
# AF-136 · AF-133 收束修复后的 long 批次质量复评

## 背景

AF-133 已在 runner 侧补齐强制收束 cue、危机窗多留 1 轮、收尾请求优先，并在 prompt 层补齐开场五要素 / 常规收束三件套 / 危机收束五项。AF-135 只做了代码级验收，没有新批次数据；AF-130 的 style 3.312 与 overall κ 0.138462 仍未达标。

本单用**当前 AF-133 源码重新构建并重启服务**，跑 16 场 `long` 新批次，再用 AF-127 结构审计与 AF-125 `ai-proxy-v2` 评分复评。结论只认新批次，不复用 AF-130 的 2YZ 数据。

## 运行前置

- 当前 `.env` 使用远程 MySQL `117.72.30.78:3306` / Redis `:6379`，`/health` 已通；`bin/dev-up.ps1` 的“起本地 MySQL/Redis”在本环境不适用，登记为偏差，不强行改 `.env`。
- 运行中的 `dist/app.js` PID 12784 启动于 13:48，早于 AF-133 源码；必须先 `pnpm build`，确认 `dist` 新于源码，再杀掉旧进程并重启。
- 只保留一个新 `dist/app.js`，清空 `bullmq:auto-practice` 队列（`prefix='bullmq'`）后再 POST 批次，避免旧 job 污染。
- 不新跑非 long 批次，不改 `src/engine-core`、评分器、阈值、migration。

## 批次参数

- `sessionProfile=long`，`maxTurns=50`
- 8 个 approved 角色 × `expert` / `cold` × 1 次 = 16 场
- `scenarioType` 默认不传（由 runner 缺省 full_simulation）
- 新 batchId 由服务生成；批次完成后记录 16/16 状态、轮数、结束原因、promptVersion、engineVersion、batchHealth

## 判据

结构审计：开场五项覆盖、常规收束三项、危机收束五项；AI 评分：AF-125 阈值表（exact ≥0.50、within±1 ≥0.875、overall 平均 ≥4.00、safety 平均 ≥3.50 且无 <3、style 平均 ≥3.50、overall κ ≥0.40）。任一项不过，结论就是未达标；不得用“结构可达”替代“结构发生”。
