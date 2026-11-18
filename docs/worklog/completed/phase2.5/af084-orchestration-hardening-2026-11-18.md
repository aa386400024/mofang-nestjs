# AF-084 · 编排框架硬化交付记录

- 任务：AF-084 编排框架硬化：scope 重签发、回执预检、两阶段提交与 LF 规范化
- 分支：`task/AF-084-orchestration-hardening`（自 `integrate` `32b287a`）
- 日期：2026-11-18
- 结论：`passed`

## 1. 交付内容

| 能力 | 实现 | 说明 |
| --- | --- | --- |
| scope 重签发 | `scripts/orchestration/reissue.mjs` + `cli.mjs task reissue / task rescope` | scope 不原地改写；一次显式操作完成「登记新任务 → 提级 → 取消原任务」，强制 `priorTasks`，默认 dry-run |
| 回执预检 | `scripts/orchestration/receipt-lint.mjs` + `cli.mjs receipt lint` | 七组字段、scope 外声明、状态面生成物、工件存在性、CR/BOM 五类前置检查 |
| 两阶段提交 | `task-entry-gate.mjs` 提示 + `README §5.6.3` | 实现提交在 `submitted` 阶段完成；回执摄入与 completed/archived 状态面单独提交；硬门未放宽 |
| LF 规范化 | `scripts/orchestration/text-normalize.mjs` + `cli.mjs docs normalize` | 默认只读检查，`--apply` 才写盘；仅允许 `docs/` 下文本文件 |
| 口径文档 | `docs/team/agent-orchestration/README.md §5.6` | 重签发规则、预检项、两阶段顺序、规范化用法 |

## 2. 改动文件

新增：

- `scripts/orchestration/reissue.mjs`
- `scripts/orchestration/receipt-lint.mjs`
- `scripts/orchestration/text-normalize.mjs`
- `docs/worklog/pending/af084-orchestration-hardening-task-2026-11-18.md`
- `docs/worklog/completed/phase2.5/af084-orchestration-hardening-2026-11-18.md`

修改：

- `scripts/orchestration/cli.mjs`
- `scripts/orchestration/task-entry-gate.mjs`
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
- `docs/team/agent-orchestration/README.md`

状态面生成物（`task-state-index.json` / `orchestration-snapshot.json` / `state/journal.jsonl` / `web/orchestration/data.js`）由 CLI 产出，按两阶段提交单独入库，不写进本回执的 `changedFiles`。

## 3. 闸门证据

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 编排定向单测 | `corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 1 file passed；251 tests passed / 0 failed；1.20s |
| 全量单测（收尾一次） | `corepack pnpm test` | 207 files passed / 1 skipped；3682 tests passed / 8 skipped；21.96s |
| lint | `corepack pnpm lint` | exit 0；0 error / 0 warning；仅 node engine WARN（v22.23.2 vs >=26） |
| 契约校验 | `node scripts/orchestration/cli.mjs validate` | 35 项 PASS / 0 FAIL |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | 356 条事件；schema 1.0.0；哈希链与索引投影一致 |
| 文档换行 | `node scripts/orchestration/cli.mjs docs normalize --path docs/worklog/pending/af084-orchestration-hardening-task-2026-11-18.md` | PASS：UTF-8 无 BOM + LF |
| 回执预检 | `node scripts/orchestration/cli.mjs receipt lint --taskId AF-084` | 正式回执落盘后、`run-once` 前执行；预检不通过即修正，不进入摄入 |

## 4. 边界与未做项

- 未新跑 LLM 批次；未改业务 `src/`、数据库、Redis。
- 未新增状态事件类型、未改框架契约版本；scope 变更采用任务版本化重签发，避免跨仓契约升级。
- `receipt lint` 保持独立命令，不改变 `run-once` 既有摄入行为；是否接入摄入前置留给后续任务评估。
- 既有技术债不在本单清偿；如发现新问题按台账登记。

## 5. 验收结论

四项框架摩擦点均已工具化与文档化：scope 修正有受审计入口，回执格式问题可在摄入前发现，实现提交与状态面提交有明确顺序，跨平台换行问题有只读检查与显式落盘。硬门强度未降低，测试与契约校验全绿，结论 `passed`。
