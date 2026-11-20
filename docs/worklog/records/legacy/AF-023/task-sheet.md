---
taskId: AF-023
contextId: phase2.5-orchestration-closed-loop
title: 运行态闭环补齐：立项、回执摄入、验收归档与租约持单
type: implementation
status: completed
baselineRef: 8607d68
dependsOn: [AF-020, AF-022]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs:
  - conventions.md#1.3
  - conventions.md#1.4
createdAt: 2026-11-17T09:30:00+08:00
deadline: 2026-11-17T18:00:00+08:00
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/
    - web/orchestration/
    - .prettierignore
    - package.json
  modules: []
  interfaces: []
artifacts:
  - name: AF-023 实施记录
    path: docs/worklog/completed/phase2.5/af023-orchestration-runtime-closure-implementation-2026-11-17.md
    kind: report
  - name: 任务立案与回执摄入模块
    path: scripts/orchestration/task-intake.mjs
    kind: code
  - name: 回执摄入模块
    path: scripts/orchestration/receipts.mjs
    kind: code
  - name: 编排单测
    path: scripts/orchestration/__tests__/orchestration.spec.mjs
    kind: test
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot
    check: 编排单测全绿（含台账、回执、租约持单用例）
    threshold: 'failed=0'
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层按框架 2.0.0 schema 机读校验全 PASS
    threshold: 'fail=0'
  - command: pnpm orchestration:contracts
    check: 框架契约包版本、tag 与文件哈希一致
    threshold: 'mismatch=0'
  - command: pnpm lint
    check: ESLint 带缓存零错误
    threshold: 'exit=0'
  - command: pnpm typecheck
    check: TypeScript 全量项目引用检查零错误
    threshold: 'exit=0'
  - command: pnpm test
    check: 后端全量测试零失败
    threshold: 'failed=0'
successCriteria:
  - 任务单可从 Markdown frontmatter 立项，也可从 transport 交接件补登，均经框架 schema 校验后写入事件日志与索引投影
  - transport 回执可被摄入，七组字段与工件指针校验通过后投影到任务 artifacts，并落审计归档副本
  - 回执摄入后自动验收、归档，索引终态与 autoVerdict 可追溯
  - 单任务队列生效：持单未回收不发下一单；租约超时释放写 releaseReason 并转人工，不自动重派
  - 派发失败回滚到 ready，不留下 submitted 空转任务
evidenceFormat: 命令 + exit code + 用例数 / 检查项数；运行态证据取索引、journal、回执与归档副本
---

# AF-023 运行态闭环补齐（任务单）

## 1. 背景

AF-020 已补齐编排规范层（任务单、索引、验收、台账），但真实运行态未跑通：`autoLoop.enabled=false`、`allowedTaskTypes` 不含 investigation、`transport/tasks/DR-001.json` 处于 ready 且无回执、`processReceipts` 不读 `transport/receipts/*.json`。本轮把「立项 → 领单 → 派发 → 回执 → 验收 → 归档 → 下一单」的真实闭环补齐，并以 DR-001 只读演练任务作首个真实样本。

## 2. 切片（scope）

纳管 `scripts/orchestration/`（调度、回执、交接件契约、CLI、校验）、`docs/team/agent-orchestration/`（适配层声明、运行态与设计备忘）、`docs/worklog/`（任务单、交付记录、归档副本）、`web/orchestration/` 快照数据与 `.prettierignore`、`package.json` 依赖与脚本。

不纳管：`src/`、`test/` 业务实现；`admin-dashboard/`；框架仓本体；真实发布与生产部署（L4 冻结动作，仍归 Human）。

## 3. 交付

- 新增 `task-intake.mjs`（Markdown frontmatter 解析、索引记录投影、两种登记入口）与 `receipts.mjs`（回执扫描、七组字段校验、工件投影、幂等摄入、审计归档）。
- `scheduler.mjs`：单任务队列、派发失败回滚、先回收回执再领单、租约超时 `releaseReason=lease-expired` 并 `heldForHuman=true` 不自动重派、归档前复制 transport 任务单。
- `handover-contract.mjs`：任务单 `artifacts` 数组 / 索引指针分离、回执 `artifactRefs` 对象形状、`reviewVerdict=null` 合法。
- `cli.mjs`：`task register` / `task import` / `task resume`、transport 包装解包、receipt schema 校验、归档计数、watch 启动先跑一轮、快照幂等写。
- 配置与适配层声明：`autoLoop.enabled=true`、六类任务、`maxConcurrentTasks=1`、`statePlane` 与 `conformance` 两段补齐。
- 首个真实样本 `DR-001`：`task import` → claim + dispatch → 回执摄入 → `receipt-ingested` → `archive-completed`。

详细证据与偏差见实施记录 `af023-orchestration-runtime-closure-implementation-2026-11-17.md`。
