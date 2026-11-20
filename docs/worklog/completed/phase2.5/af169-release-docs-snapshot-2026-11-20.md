# AF-169 · Phase2.5 发布快照文档与脚本侧整合（scope 收窄重开）

- taskId: AF-169
- contextId: phase2.5-orchestration-closed-loop
- baselineRef: 06ba825cfe6cf0b88a9f42450769793ce8f709a4
- dependsOn: [AF-168]
- policyRefs: [conventions.md#1.3]
- finalStatus: completed
- reviewVerdict: passed

## 1. 落地

本任务在 AF-168 代码侧提交之上，把 AF-164 HEAD 的文档、脚本、数据、前端编排视图与仓库级配置差异落成 AF-169 单任务提交。

关键内容：

- `docs/worklog/`：AF-161/AF-163 记录包迁移后的最终布局；旧 pending 任务单与 archive 回执按新记录包结构删除，完成态交付记录保留在 `docs/worklog/completed/`。
- `docs/team/agent-orchestration/`：README、executor 角色卡、状态面与编排投影。
- `scripts/`：编排与发布工具链最终状态。
- `data/phase25-exit/`：Phase2.5 退出证据。
- `web/orchestration/`、`.github/`、`.husky/`、`package.json`、`AGENTS.md`：发布与 CI 配置。
- `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-169/`：任务单与 manifest。

## 2. 闸门证据（gateResults）

| 命令 | exit code | 结果 |
| --- | --- | --- |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` | 0 | 全量类型检查零错误 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 0 | 记录包严格校验通过 |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 事件链一致 |

## 3. 范围（scopeCheck）

- scopeCheck: in-scope
- 仅 `docs/worklog/`、`docs/team/agent-orchestration/`、`scripts/`、`data/phase25-exit/`、`web/orchestration/`、`.github/`、`.husky/`、`package.json`、`AGENTS.md`。
- 未触碰 `src/`、`bin/`、`test/`、`admin-dashboard/`。
- `src/engine-core` 零改动。
- `parallelArtifactsExcluded: true`；未跟踪 relay 回交文件未入库。
- `noOutscopeRefactor: true`。

## 4. 契约核对（contractChecks）

- `contractRef`：`urn:agent-collaboration-framework:schema:task-sheet:1.1.0`。
- `taskId` 贯穿任务单、提交、回执、交付记录。
- `taskSheet`：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-169/task-sheet.md`。
- 状态面只经 CLI 登记、提级、领取。
- 记录包 manifest 与回执落入 records，符合 AF-161 口径。

## 5. 遗留（backlogItems）

- IM-AF169-01：PR 远端 13 项检查需在推送后逐项确认。
- IM-AF169-02：旧分支 `task/AF-152-quality-admin`、`task/AF-164-release-integrate` 在合并后清理。
- manualReviewList: []

## 6. 偏差表（deviationTable）

| 项 | 任务单原方案 | 实际方案 | 原因 |
| --- | --- | --- | --- |
| docs scope | `docs/` 全目录 | `docs/worklog/` + `docs/team/agent-orchestration/` | 实际快照差异只在这两处；`docs/` 全目录超出 orchestrator 资源域 |
| 任务编号 | AF-167 | AF-169 | AF-167 因 scope 越域取消，收窄后重开 |

## 7. 结论（reviewVerdict）

finalStatus: completed
reviewVerdict: passed
verdictRationale: 文档侧快照完整；记录包与状态面一致；未触碰代码侧与内核；闸门全绿。
