---
taskId: 'AF-072'
contextId: 'phase2.5-orchestration-closed-loop'
receiptRef: 'docs/worklog/pending/archive/AF-072-receipt-RC-AF-072-1.json'
deliveryRecordRef: 'docs/worklog/completed/phase2.5/af072-af071-ci-chain-rework-2026-11-18.md'
type: fix
baselineRef: 0749d153b795a14b38d738a3f30e6d208a11f360
priorTasks: ['AF-071', 'AF-070']
finalStatus: completed
reviewVerdict: passed
contractRef: urn:agent-collaboration-framework:schema:receipt:1.0.0
---

# 交付记录 · AF-072 提交链原子化与 CI 任务识别

> 本单只修提交链，不改业务实现：把 AF-070/AF-071 的两条提交压成一条只含 AF-072 的原子提交，使 CI 的逐提交 scope 校验与任务识别都能通过。

## 0. 任务标识

| 字段 | 值 |
| --- | --- |
| `taskId` | `AF-072` |
| `contextId` | `phase2.5-orchestration-closed-loop` |
| `type` | `fix` |
| `baselineRef` | `0749d153b795a14b38d738a3f30e6d208a11f360` |
| `priorTasks` | `['AF-071', 'AF-070']` |
| `policyRefs` | `conventions.md#1.3` |

## 1. 落地

| 类别 | 内容 | 说明 |
| --- | --- | --- |
| 提交 | `6e0196d01672…`（单条原子提交） | 标题只含 `AF-072`；包含 AF-070/AF-071 的全部实现、交付记录、回执与状态面快照 |
| 保留 | `AF-070` rejected | 原 scope 越界的机读结论不删除，作为返修链起点 |
| 保留 | `AF-071` completed | 本地验收与 durable 回执保留，作为返修中间态证据 |
| 修改 | `docs/team/agent-orchestration/agent-cards/orchestrator.json` | resources 增加 `scripts/`、`web/orchestration/`，使 AF-072 的目录级 scope 与资源域一致 |
| 修改 | 状态面 | `task-state-index` / `journal` / `snapshot` / `web/orchestration/data.js`，由 CLI 写入 |

- 不重写业务代码：`src/`、`test/`、`practice-runner`、`engine-core`、LLM、数据库与 migration 均未改动。
- 原子提交是任务分支上的历史收口；`integrate` 仍只接受受保护 PR。

## 2. 证据（`gateResults`）

| 闸门 | 实际命令 | 退出码 | 错误 | 警告 | 用例 / 文件数 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 脚本 lint | `pnpm lint`（Node 26） | 0 | 0 | 0 | — | TS + `scripts/**/*.{mjs,cjs}`；0 error / 0 warning |
| 类型 | `pnpm typecheck`（Node 26） | 0 | 0 | 0 | — | `tsc -b tsconfig.check.json` |
| 定向单测 | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 0 | 0 | 1 文件 / 233 例 | 233 passed / 0 failed |
| 全量单测（收尾一次） | `pnpm test`（Node 26） | 0 | 0 | 0 | 205 文件 passed + 1 skipped / 3647 例 passed + 9 skipped | 27.58s |
| 编排契约 | `pnpm orchestration:validate` | 0 | 0 | 0 | — | 全部 PASS；AF-072 运行态任务单 PASS |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | 0 | 0 | 0 | 294 条事件 | 归档后复核；schema/哈希链/索引投影一致 |
| CI 任务门 | `node scripts/orchestration/ci-task-gate.mjs --base 0749d15 --head 6e0196d --task-id AF-072` | 0 | 0 | 0 | 1 提交 / 27 文件 | `PASS reason=pass files=27`；单条提交可解析、scope 自洽 |
| 生产依赖审计 | `pnpm audit --audit-level=high --prod --registry=https://registry.npmjs.org` | 0 | 0 | 0 | 4 漏洞：3 moderate + 1 high（1 ignored） | `GHSA-fc5q-39xc-vjpf` 风险接受；其他 high 仍阻断 |
| 安装脚本语法 | `[Parser]::ParseFile(install-relay-supervisor.ps1)` | 0 | 0 | 0 | — | `PS_SYNTAX_OK` |
| 计划任务迁移 | `pwsh install-relay-supervisor.ps1 -RepoRoot <主仓> -NodeExe <Node26>` 两次 | 0 | 0 | 0 | 1 任务 / 1 action | `State=Running`、`NodeVersion=v26.12.1`、PID 16296 |
| 边界 | `git diff --stat HEAD -- src/engine-core` | 0 | 0 | 0 | — | 输出为空；未动内核/引擎 |

- `reproNotes`：复用已实现的代码；Node 26 下复跑 lint/typecheck/定向 vitest/全量/编排校验/事件链/审计。CI 任务门按 `--base 0749d15 --head 6e0196d --task-id AF-072` 实跑；PR 侧还需远端 13 项 checks 全绿后才能 squash。
- 失败项定性：无确定性失败。`AF-070` 的 `scope-residual` 与 `AF-071` 的 `ambiguous-task-id` 均由本条原子提交消除；未通过删减 required checks 或 `--no-verify` 绕过。

## 3. 范围（`scopeCheck`）

| 核对项 | 结果 | 说明 |
| --- | --- | --- |
| 提交范围 | `in-scope` | 27 个文件全部落在 AF-072 scope：`package.json`、`scripts/`、`docs/team/agent-orchestration/`、`docs/security/`、`docs/worklog/`、`web/orchestration/` |
| 状态面 | exempt | 索引/日志/快照/看板数据由 CLI 写入，按 V7 口径豁免 |
| 并行产物 | `parallelArtifactsExcluded=true` | 未混入 AF-069 主工作区的 `data/batch-reports`、`relay-response-*` 等 |
| 越界重构 | `noOutscopeRefactor=true` | 不改 `src/`、`test/`、`practice-runner`、`engine-core`、LLM、数据库与 migration |

## 4. 契约（`contractChecks`）

| 项 | 结果 | 说明 |
| --- | --- | --- |
| `taskId` | pass | 提交标题只含 `AF-072`；任务单、回执、交付记录、状态索引一致 |
| `state-write` | pass | 登记/提级/领取经 CLI；未手改状态面 |
| `index-schema` | pass | AF-072 任务单 scope 覆盖 `scripts/` 全目录；运行态任务单 PASS |
| `event-chain` | pass | 保留 AF-070 rejected / AF-071 completed 历史；AF-072 状态事件同链 |
| `field-alignment` | pass | AF-070/AF-071/AF-072 证据链同源；`gateResults` 标记显式出现 |

## 5. 遗留（`backlogItems`）

| ID | 影响 | 级别 | 安排 |
| --- | --- | --- | --- |
| 无新增 | 本单只修提交链与任务识别 | — | — |
| `BL-AF070-01` | 安全风险接受需上游修复版复核 | medium | 2027-02-18 前复核 |
| `BL-AF070-02` | Windows 计划任务为机器级工件 | low | 用幂等安装脚本重装 |

## 6. 偏差（`deviationTable`）

| 项 | 任务单说 | 实际 | 处理 | 原因 |
| --- | --- | --- | --- | --- |
| ① 历史重写 | 原 AF-070/AF-071 提交已存在 | CI 逐提交校验要求每条提交都能解析到单一任务且 scope 自洽；原两条提交分别 `scope-residual` 与 `ambiguous-task-id` | 在任务分支上把两条提交压成一条 AF-072 原子提交，保留 AF-070/AF-071 交付记录与回执 | 不删证据、不改 integrate；只在未合并任务分支重写历史 |
| ② 任务编号 | 本可继续用 AF-071 | AF-071 提交标题已含两个任务号，且已归档；继续追加无法修复历史 | 新建 AF-072，`priorTasks=['AF-071','AF-070']` | 返修链显式可审计，不篡改已归档任务 |
| ③ 定向单测 | 无 relay-supervisor.spec | AF-072 基于 integrate，无该文件 | 跑 `orchestration.spec.mjs` 233 例 | 如实记录实际文件，不伪造 |

## 7. 结论（`reviewVerdict`）

- **reviewVerdict：passed**
- 理由：原子提交 `6e0196d` 只含 AF-072，27 个文件全部在 scope；本地 `ci-task-gate` 单提交 PASS；Node 26 下 lint/typecheck/233 例定向/3647 例全量/编排契约/事件链/审计均有真实数字；AF-070 rejected 与 AF-071 completed 的证据保留；无 `src`/`test`/内核改动，无并行产物混入。
- 后续：推送原子分支、更新 PR #20 HEAD，等待远端 13 项 checks（含 Security Audit、Orchestration Gate）全绿后 squash 合并。
