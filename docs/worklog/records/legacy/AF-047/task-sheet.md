---
taskId: AF-047
contextId: phase2.5-orchestration-enforcement
title: 开发任务强制编排门（入口、Skill、Husky 与 scope 校验）
type: implementation
status: backlog
baselineRef: a27aba504b48b245f59a8f6ef1791310b68f94a9
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T17:01:18+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - AGENTS.md
    - docs/team/conventions.md
    - docs/team/agent-orchestration/
    - docs/team/wp-task-template.md
    - docs/worklog/pending/
    - docs/worklog/completed/
    - scripts/orchestration/
    - package.json
    - .husky/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af047-dev-orchestration-mandatory-2026-11-17.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测与强制门禁用例全绿
    threshold: 'failed=0'
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 'errors=0'
  - command: pnpm lint
    check: lint 无新增 error / warning
    threshold: 'errors=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: 'FAIL=0'
  - command: pnpm orchestration:contracts
    check: 框架契约包哈希一致
    threshold: 'FAIL=0'
successCriteria:
  - AGENTS.md 明确“任何开发/数据/环境任务无编排任务即停工”，并给出唯一入口
  - Husky pre-commit 在编排任务缺失、状态不可写、暂存文件越出任务 scope 时阻断提交
  - 只读问答/纯分析显式豁免，不强迫为查询建任务
  - 编排状态面生成物与任务单自身不被误判为 scope 残留
  - 门禁脚本具备 no-task / scope-mismatch / valid-task 三类负向与正向用例
  - 外置 AI Skill 与偏好记录同步强化，保证新会话开工即走编排入口
evidenceFormat: vitest 用例数 + 三类门禁用例结果 + typecheck/lint 结果 + validate/contracts PASS 计数 + git diff 范围
---

# AF-047 · 开发任务强制编排门

## 1. 背景

2026-11-17 的清库重建与 8 场批次工作中，实际执行全部完成，但事后核查发现：

- `status` 中 0 个活跃任务、64 个归档任务；
- 事件日志 184 条且哈希链一致，说明状态面健康；
- 本次工作没有任务单、没有 `run-once` 领单、没有机读回执，也没有进入归档；
- AI 在开工时加载了 workspace-context-restore，却漏掉其中的编排状态面检查；
- 内部待办清单被误当作任务管理，替代了仓库正式状态面。

根因不是框架缺失，而是执行入口没有硬约束。本任务把“开发必须走编排”从口头约定升级为入口规则、AI Skill、包脚本与 Git 钩子四层约束。

## 2. 目标

### 2.1 生效范围

以下工作必须进入 `agent-collaboration-framework` 任务闭环：

- 修改业务代码、测试、脚本、配置、migration、seed；
- 修改数据库、Redis、批量数据、评测数据或本机运行产物；
- 启动/停止开发服务并改变环境状态；
- 为后续实现做会产出文件或状态变更的操作。

以下只读工作不强制建任务：

- 代码/文档阅读、搜索、解释、方案讨论；
- `status` / `events verify` / `git status` 等只读检查；
- 用户明确只要结论、不会产生写入的分析。

### 2.2 硬门禁

1. 开工前必须 `pnpm orchestration:status`，确认当前状态面。
2. 有写入意图时必须先落任务单，`task register` → `task promote` → `run-once` 领单。
3. 没有处于 `ready / submitted / working / input-required / completed` 的匹配任务，不能改文件、库、Redis 或运行态。
4. 暂存文件必须落在任务单 `scope.files` 内；状态面生成物、任务单自身按豁免处理。
5. 开发结束必须产出交付记录与机读回执，经 `run-once` 验收入口，再按 CLI 归档。
6. 不伪造事件、不手改索引、不把内部待办当作框架任务。

### 2.3 交付物

- `scripts/orchestration/task-entry-gate.mjs`：可执行的提交前门禁与只读自检。
- `.husky/pre-commit`：先跑编排门禁，再跑 lint-staged。
- `AGENTS.md`：会话入口的强制停工规则。
- 编排适配层与任务模板：写明唯一入口、只读豁免、状态要求和回执。
- 编排单测：覆盖 no-task、scope-mismatch、valid-task。
- 外置 Skill：workspace-context-restore 与 orchestration-cli-runbook 强化“无任务不得开工”；用户长期偏好登记。

## 3. 范围与红线

- 只改上述流程文件与编排脚本，不改业务运行逻辑、engine-core、migration、seed。
- 不修改 `agent-collaboration-framework` 通用规范；项目强制取值归适配层。
- 不新增依赖，门禁只用 Node 标准库与仓内已有 `yaml`。
- 不做提交前自动 `git add`、不自动修改暂存区、不删除文件。
- 只读查询和纯讨论保持零任务可用，避免把咨询类请求拖进任务流程。

## 4. 验收

- 单测覆盖三类核心路径：无任务阻断、越 scope 阻断、合法任务放行。
- 在真实仓执行一次只读 dry-run，确认当前无活跃任务时会被阻断。
- 登记 AF-047 后再次 dry-run，确认任务处于 working 时放行本任务暂存范围。
- `AGENTS.md`、适配层 README、任务模板、两个外置 Skill 与用户偏好口径一致。
- 全绿闸门数字写入交付记录和机读回执。
