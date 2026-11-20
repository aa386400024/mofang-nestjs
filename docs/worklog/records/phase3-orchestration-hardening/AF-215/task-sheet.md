---
taskId: AF-215
contextId: phase3-orchestration-hardening
title: 部署契约补全：豆包 provider 可发现性（模型口径 / 覆盖键 / 跨机交接指引）
type: documentation
status: backlog
baselineRef: 792e76f
dependsOn: []
priorTasks: [AF-213, AF-214]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-21T02:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - .env.example
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase3-orchestration/af215-doubao-env-discoverability-2026-11-21.md
    kind: report
gates:
  - command: pnpm exec vitest run test/config/wp25-env-example-coverage.spec.ts
    check: 部署契约双向断言绿
    threshold: exit=0
  - command: pnpm env:doctor --json
    check: 模板生效键集与改前完全一致（只加注释，不动契约）
    threshold: 键集差为空
  - command: pnpm lint
    check: ESLint 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
successCriteria:
  - .env.example 的生效键集一个不变；只新增注释说明，wp25 双向断言（代码读的键 ⇄ 模板生效行）仍绿。
  - 注释里写清方舟当前有效模型 ID 与已下线别名（含 404 实测结论），防止照旧名配置后在运行期 404。
  - 注释里写清 ENGINE_RENDER_<KIND>_MODEL_<PROVIDER> 覆盖能力的存在与形态，并说明为什么它不能作为生效行（AST 只能看到模板字符串）。
  - 注释里给出跨机交接指引：同一把 key、交接规程指向 docs/security/secret-handoff.md、验收命令 pnpm env:doctor --keys。
---

# AF-215 · 部署契约补全：豆包 provider 可发现性

## 背景

`.env.example` 是部署契约，由 `test/config/wp25-env-example-coverage.spec.ts` 双向守卫（代码读的键必须有生效行；模板生效行必须有读取点）。AF-210 接入豆包 provider 后，键本身已入契约：

- `LLM_DOUBAO_API_KEY=`（L182，生效行）
- `ENGINE_RENDER_FALLBACK_PROVIDERS=`（L838，生效行 + 说明）

**缺口不在键，在注释**：

1. 方舟在 2026-11-20 已下线 `doubao-lite` / `doubao-pro-32k` / `doubao-pro-128k` 等旧别名（实测 404）。模板没写这条，运维照旧名配会在运行期炸。
2. AF-210 新增了 provider 维度覆盖 `ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>`，模板完全没提。它**不能**写成生效行——代码里是模板字符串，wp25 的 AST 反查看不到，会立即变成 orphan 报错。只能在注释里给发现性。
3. 跨机协作下同一个 key 要配两台机器，模板没有指向交接规程。

## 设计

只改注释（`#` 开头），生效键集零变化：

- 在 `LLM_DOUBAO_API_KEY` 段补：现行有效模型 ID（`doubao-seed-2-1-lite-260915` / `doubao-seed-2-1-pro-260628`）、已下线别名与 404 结论、方舟 endpoint。
- 在 `ENGINE_RENDER_FALLBACK_PROVIDERS` 段补：`ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>` 的形态与示例，并写明「为什么它不是生效行」。
- 补跨机交接指引：同一把 key、规程 `docs/security/secret-handoff.md`、验收 `pnpm env:doctor --keys LLM_DOUBAO_API_KEY,ENGINE_RENDER_FALLBACK_PROVIDERS`。

## 范围

- 只改 `.env.example`（注释行），以及 `docs/worklog/` 下任务单与交付记录。
- 不碰代码、不碰测试、不新增生效键、不碰 engine-core。

## 验收

- wp25 双向断言绿；`pnpm env:doctor --json` 的模板键集与改前一致（差集为空）。
- lint / typecheck 绿；engine-core 零 diff。

commit message：`docs(AF-215): 部署契约补全豆包 provider 模型口径与跨机交接指引`
