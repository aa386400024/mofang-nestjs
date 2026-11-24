---
taskId: AF-475
contextId: phase2.5-visitor-register-eval
title: 语域成本评测改为单进程逐轮配对测量
type: fix
status: backlog
baselineRef: 17a15e53e468a5f9aa19484802ad5da952b8743f
dependsOn: []
priorTasks: [AF-471, AF-474]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-24T23:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - scripts/eval/visitor-register-stability/
    - src/admin-debug/
    - test/admin-debug/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-visitor-register-eval/AF-475/
  modules:
    - visitor-register-eval
    - admin-debug
  interfaces:
    - debug-session-create
    - run-sessions
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af475-register-cost-paired-measurement-implementation-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug/wp58-debug-session.spec.ts scripts/eval/visitor-register-stability/__tests__/paired-order.spec.mjs
    check: 调试会话语域开关与配对顺序单测全绿
    threshold: 0 failed
  - command: pnpm lint
    check: lint 通过
    threshold: 0 error
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 0 error
successCriteria:
  - 调试会话创建接口支持 registerMode=off/active；非法值返回 400，off 不向引擎传 speechRegister 与 speechRegisterAudit。
  - run-sessions.mjs 支持 --paired 与 --port，每个角色只依赖一个后端端口，在同一进程内按会话分别开 base(off) 与 active(active)。
  - 配对场次按轮次紧邻执行，奇偶轮翻转 base/active 顺序，逐轮落 partial JSON，最终 metrics 与 manifest 标记 paired=true。
  - 旧双端口跑法保留，不影响既有 AF-466/AF-471 产物复算。
  - README 写清 paired 命令、端口与配对口径。
  - 本次只修测量口径与调试接口开关，不改生产 prompt、不压缩语域块、不改 context budget。
  - 单测与 lint/typecheck 通过；真实 600 轮配对评测若环境不具备则明确记录未执行，不宣称成本门通过。
---

## 1. 背景

AF-466 的 10 角色 base/active 评测把两种模式分别放在 3010/3011 两个后端进程上，且每个角色整场 30 轮串行。AF-471 归因显示 active 的 p95 延迟增量集中在 post-TTFT 与后段轮次，同时单次 p95 本身方差很大。双进程运行漂移与整场串行会把“语域块导致的解码变慢”和“进程/时段差异”混在一起，直接压缩语域块可能用产品回归换统计噪声。

## 2. 目标

先把成本门的测量工具改成单进程、逐轮配对：同一后端进程内，每个角色同一时段交替跑 base 与 active，每轮紧邻执行并翻转顺序，降低进程漂移与轮次趋势的混杂。产品 prompt 改动留到有干净配对数据之后。

## 3. 实现口径

- DebugSession create body 增加 registerMode，缺省保持原行为；off 时不挂语域渲染字段。
- run-sessions 增加 paired 路径：只 health 一个端口；每角色开两场会话，逐轮按奇偶顺序执行；逐轮落 partial，最终写 metrics 与 paired manifest。
- 新增纯函数 pairedTurnOrder 固定顺序规则并补单测。
- 旧双端口路径保留，作为历史复算入口。

## 4. 非目标

- 不改生产 prompt、不压缩语域块、不调整 MAX_HISTORY_TURNS 或 contextTokens。
- 不补 provider cachedTokens 采集。
- 不在本任务内判断成本门是否通过；真实评测结果另行出报告。
