# AF-365 · 编排 v2.1：状态面解耦、风险分级、PR 生命周期与执行器心跳 · 交付记录

- 任务：AF-365（`phase2.5-orchestration-closed-loop`，R2 / `gateProfile: full`）
- 类型：implementation
- 基线：`06955ce535be1b2df9bc1571738934ef3960f340`（integrate HEAD，AF-360 squash 合并提交）
- 分支：`task/AF-365-orchestration-v21`
- 交付日期：2026-11-23
- 框架侧：`D:\work\Project\agent-collaboration-framework` 分支 `feat/v2.1-operational-contracts` → commit `e4124037b8e5da2ac92070bb13da75f921044f9d`（2.1.0 候选，未打 tag；最近正式发行仍为 `v2.0.0` → `67d3290`）
- priorTasks：AF-364（orchestrator 资源域扩展，已并入）、AF-363（executor 角色域越界，已取消）

## 1. 交付摘要

把框架 v2.1 的可执行条款落到 mofang 适配层，按六组交付：

1. **状态面与业务分支解耦**
   - `task-entry-gate.mjs` 定义状态面路径与守卫：`task/*` 分支拒绝提交状态面，状态面不得与实现混提；例外需 `ORCH_ALLOW_STATE_COMMIT=1` 且写原因。
   - `cli.mjs state sync [--apply]`：dry-run 只报告脏文件；`--apply` 重建索引与快照投影（`events rebuild` + `refreshSnapshotArtifacts`），不重写 `state/journal.jsonl` 事件源。
   - `ci-task-gate.mjs` 增加 `taskSheetSnapshot` 与 `accepted-state-free`：任务分支不提交索引时，任务单 + 可合并 durable 回执即可验收；最终 HEAD 有回执时合成 `completed`，支持 squash 生命周期。
   - `state/executor-sessions.json` 与 `transport/executor-sessions.json` 均属单机运行态；会话状态落 `transport/`（仓库既有 ignore），不随任务分支入库。

2. **风险分级门禁**
   - `scripts/orchestration/risk-gate.mjs`：`R0/R1/R2` 解析与 `gatePlan`。显式 `riskClass` 优先；显式 R0 遇运行时路径自动抬 R1；`gateProfile=full` 强制 R2；R0 只允许纯文档，跳过项显式列出。
   - `.github/workflows/ci.yml` 新增 `risk-gate` job（context 名 `Risk Gate`），输出 `risk_class/run_contracts/run_security/run_unit/run_coverage/run_e2e/run_build`；重检查 job 全部 `needs: risk-gate` + 条件执行。`lint` / `orchestration-gate` 常跑。
   - `branch-protection.mjs` required contexts 由 13 项升至 14 项，首项 `Risk Gate`；Contracts context 对齐 2.1.0。

3. **PR 生命周期**
   - `pr-release.mjs` 新增仓库级 `list / triage / close / supersede`：`ready / blocked / stale / duplicate / orphan` 分类；`close/supersede` 默认 dry-run，`--apply` 才 PATCH 关闭并评论；支持 `--pr` / `--taskId` 反查。
   - `branch-workflow.mjs` 新增 `deriveSlug`，剥离 taskId 与 AF-/WP- 编号，`branch plan` 默认 slug 不再被自身校验拒绝。

4. **回执脚手架与 strict 债务**
   - `receipt-scaffold.mjs`：从任务单 frontmatter 生成六组骨架，`gateResults=[]`、`scopeCheck=null`、`reviewVerdict=null`，不伪造 passed；`cli receipt scaffold` 默认 dry-run，`--apply` 落 `transport/receipts/`，已有回执拒绝覆盖。
   - `config.worklogStrictBaseline = { legacyPointers: 133, missingTaskSheets: 14 }`；`worklog verify --strict` 超基线即 FAIL，并输出 `legacy=133/133 无任务单=14/14`。

5. **执行器心跳与超时回收**
   - `executor-session.mjs`：`start/ack/progress/heartbeat/cancel/terminal/status/list/reap`；`ack` 确认接手，`progress` 上报 0–100 整数并续租且禁止回退，`cancel` 只写 `cancelRequestedAt` 由执行器下一心跳确认终态；终态不得再心跳，`terminalAt` 必填且不早于 `heartbeatAt`。
   - `cli session reap`：超租约判 `lost`，置 runtime `heldForHuman=true`，不自动重派。GUI 窗口 PID / 焦点只作投递证据，不作执行存活证据。

6. **框架契约包 2.1.0 消费**
   - 新增 `contracts/agent-collaboration-framework/2.1.0/`：15 份 schema + `PROVENANCE.json`（源 commit `e412403`、15 文件 SHA-256/bytes）+ `README.md`。
   - `verify-framework-bundle.mjs` 去掉硬编码 2.0.0，按 `--bundle` / `ORCH_FRAMEWORK_BUNDLE` / 最高 semver 解析；`validator.mjs` 自动取最高版本目录。
   - `contract-enums.mjs/json` 投影 2.1.0，新增 `RISK_CLASSES`、`EXECUTOR_SESSION_STATUSES`；`event-store.mjs` 索引 schemaRef 与 `version` 升 1.2.0，并重建索引。

## 2. 关键决策

- **状态面只由 CLI 写**：不手改 `task-state-index.json` / `state/journal.jsonl`。状态面与实现分支分离，避免 #137 的 422 rebase 冲突重演。
- **R2 不放宽**：风险分级只对 R0/R1 剪枝；R2 仍跑 contracts / security / unit / coverage / e2e / build 全量，`skipped` 必须显式列出。
- **心跳而非窗口存活**：`executor-session` 是执行存活唯一证据；reap 只判 `lost` 并转人工，不自动重派，避免错误恢复放大故障。
- **2.1.0 是候选提交，不是发行版**：文档统一写候选 commit `e412403`，不声称已有 `v2.1.0` tag；契约包 `PROVENANCE` 记录来源分支与 commit。
- **任务单 gate 命令纠偏**：任务单写 `node scripts/orchestration/cli.mjs test`，该子命令不存在；实际以 `pnpm exec vitest run` 与 `pnpm test` 取证，记录在偏差表，不伪造命令输出。

## 3. gateResults

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm test` | 0 | 311 passed / 1 skipped（files）；4739 passed / 4 skipped（tests）；28.19s |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 260 / 260 passed |
| `pnpm exec vitest run scripts/orchestration/__tests__/v21-adapters.spec.mjs` | 0 | 13 / 13 passed |
| `node scripts/orchestration/verify-framework-bundle.mjs` | 0 | `[PASS]` 2.1.0，15 个文件哈希与版本一致 |
| `node scripts/orchestration/cli.mjs validate` | 0 | 全部 PASS，含索引投影一致 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 0 | 见回执；legacy=133/133、无任务单=14/14 |
| `node scripts/orchestration/ci-task-gate.mjs --base 06955ce --head HEAD` | 0 | total=2 passed=2；实现提交与回执提交均 pass |
| `git diff --stat HEAD -- src/engine-core` | — | 空（未触纯层） |

机器：Windows / PowerShell 7.6.4 / Node v22.23.2 / pnpm 9.15.0。无长驻 `nest start --watch` / `vite dev`。

## 4. 变更文件

新增：

- `scripts/orchestration/risk-gate.mjs`
- `scripts/orchestration/receipt-scaffold.mjs`
- `scripts/orchestration/executor-session.mjs`
- `scripts/orchestration/__tests__/v21-adapters.spec.mjs`
- `contracts/agent-collaboration-framework/2.1.0/`（15 schema + PROVENANCE + README）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-363/`（取消记录）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-364/`（取消记录）
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-365/`（任务单 + manifest）
- `docs/worklog/completed/phase2.5/af361-orchestration-v21-2026-11-23.md`（AF-363 取消交付记录）
- `docs/worklog/completed/phase2.5/af364-orchestrator-card-2026-11-23.md`（AF-364 取消交付记录）

修改：

- `.github/workflows/ci.yml`
- `package.json`（`orchestration:risk/state/session/receipt`）
- `scripts/orchestration/{branch-protection,branch-workflow,ci-task-gate,cli,config,contract-enums,event-store,pr-release,scope-mutex,state-store,task-entry-gate,validator,verify-framework-bundle}.mjs`（含 `contract-enums.json`）
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
- `docs/team/agent-orchestration/{README,autonomous-team-design,framework-version-anchor}.md`
- `docs/team/agent-orchestration/agent-cards/{README.md,orchestrator.json}`

状态面（不入本分支）：

- `docs/team/agent-orchestration/task-state-index.json`
- `docs/team/agent-orchestration/state/journal.jsonl`
- `docs/team/agent-orchestration/orchestration-snapshot.json`
- `web/orchestration/data.js`

## 5. 偏差与未决

| 任务单/预期 | 实际 | 处置与理由 |
| --- | --- | --- |
| R2 仍 13/13 | required contexts 为 14 项（新增 Risk Gate） | 风险门本身是新增必需检查；14/14 才是 R2 全量，文档同步改 14 |
| gate 命令 `cli.mjs test` | CLI 无 `test` 子命令 | 用 `pnpm exec vitest run` + `pnpm test` 取证，不新增同名命令以免与 pnpm test 混淆 |
| 状态面由“独立状态分支”承载 | 当前提供 `state sync` 与守卫，尚未自动创建 `state/*` 分支 | 机制先落地并保证任务分支干净；自动建状态分支涉及远端写，留待状态同步批次 |
| 执行器会话 ack/progress/cancel | 已补齐 `ack/progress/cancel`，并有 4 例单测 | 与任务单验收口径一致 |
| 远程保护 14 项 / Contracts 2.1.0 | 本地常量与 dry-run 已更新，远程保护尚未 apply | 需在 PR 检查面出现新 context 后再 apply，避免旧 context 缺失阻塞合并 |
| 框架 v2.1 提交未推送、未打 tag、未开 PR | 按计划待双仓验证后处理 | 本记录只声明候选 commit，不声明发行 |

## 6. 未完成项 / 风险

1. 远程 `integrate` 保护仍是 13 项旧 contexts；PR 创建后需核对新 context 是否由 head workflow 产生，再 apply 14 项保护。若 base workflow 生效，需先 apply 或临时回退 Contracts 改名。
2. 状态面四文件在工作区仍为脏，按新守卫不进入本任务提交；需在状态分支或收尾快照单独提交。
3. 框架仓 `e412403` 未推送、未开 PR；双仓 PR 需按发布分层执行。
4. 旧 `task/AF-*` 远端分支仍在（PR 已关闭但分支未清理），按需另行清理。
