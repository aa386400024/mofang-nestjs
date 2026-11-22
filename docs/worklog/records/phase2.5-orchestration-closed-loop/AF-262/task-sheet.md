---
taskId: AF-262
contextId: phase2.5-orchestration-closed-loop
title: 豆包来访者本地切流与回滚预案
type: implementation
status: backlog
baselineRef: 377c7ffc5ff32f83d2b4a5cc1867ee6181cd9189
dependsOn: [AF-261]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T09:20:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - docs/runbooks/
    - .env
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af262-visitor-cutover-local-2026-11-22.md
    kind: report
  - name: 切流预案
    path: docs/runbooks/doubao-visitor-cutover.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-switch-check.ts
    check: 真实 .env 解析出来访者 doubao、引擎主候选 doubao、备候选 minimax
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 20 --max-tokens 160 --timeout-ms 45000
    check: 20 轮真实生产路由全轮命中豆包
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-262 · 豆包来访者本地切流与回滚预案

## 背景

AF-248/251/252/253/259/260/261 已把豆包路由、prompt 开关、未知 emotion 投影、渲染双路径、单轮/多轮真实 smoke 与 provider 成本分账补齐。现在缺的是**把开关真正落到环境**并给出可回滚的切流预案。

本任务只切**本地** `.env`；不重启正在运行的服务，不碰远端部署。远端切换由大炮按预案执行。

## 目标

1. 新增 `bin/visitor-switch-check.ts`：只读真实 `.env`，解析 `resolveVisitorRuntime()` 与 `RenderConfigFactory`，输出旧 VisitorService 与引擎渲染两条链路的实际开关，不发网络。
2. 备份本地 `.env` 到 `data/`，写入 `VISITOR_LLM_PROVIDER=doubao` 与 `VISITOR_DOUBAO_MODEL=doubao-seed-character-260628`；不重启服务。
3. 新增 `docs/runbooks/doubao-visitor-cutover.md`：切流前置、步骤、验证、观察指标、停止条件、回滚一行操作。
4. 跑 20 轮真实生产路由 smoke，作为长上下文补充证据。

## 非目标

- 不改 `src/engine-core`。
- 不重启本地或远端服务。
- 不改远端部署环境。
- 不做并发/429/5xx/回退注入 smoke。
- 不填豆包官方单价。

## 验收

- `visitor-switch-check` 输出 `llmProvider=doubao`、`primary=doubao`、备候选 `minimax`。
- 20 轮 smoke 全轮 `providerHint=doubao`、无空输出/降级/回退。
- `.env` 已备份，回滚只需把 `VISITOR_LLM_PROVIDER` 改回 `minimax`。
- lint 0 error；CI 同口径 tsc 0 error；`git diff HEAD -- src/engine-core` 为空。
