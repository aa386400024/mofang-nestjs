# AF-074 框架收口交付记录（GUI 送达确认 / 验收字段标记 / 版本锚点）

> 验收事实（2026-11-18 补记）：本记录提交后，AF-074 被机读护栏判 `rejected`，原因是任务单 scope 漏列 `docs/team/agent-orchestration/tools/TOOL-ORCH-CLI.json` 与 `TOOL-QUEUE-SCHEDULER.json` 两个实际改动文件。按框架返修机制开 `AF-075` 承接同一批改动、补齐 scope 并重跑闭环；AF-074 的拒绝事件保留不改，最终结论以 `AF-075` 交付记录为准。

- 任务单：`docs/worklog/pending/af074-framework-closeout-task-2026-11-18.md`
- 任务 ID：`AF-074`
- 分支：`task/AF-074-framework-closeout`（自 `integrate` `fbe2470ff9c421c84232d3f317636bbd49c71afc` 切出）
- 日期：2026-11-18
- 结论：`conditional-pass`（主体缺口已收口；无人值守长跑与 stale-ack 实战另立 `IM-053`）

## 1. 落地

本单把 GUI 派发从「只生成 pending 投递件」推进到「发送 → 执行代理 ack → 自动确认」的可审计闭环，同时统一验收字段标记口径、修正框架版本锚点。

新增：

- `scripts/orchestration/gui-relay-send.ps1`：主桌面发送器。聚焦已运行的执行代理窗口 → 点击输入框 → 剪贴板粘贴 brief → Win32 `keybd_event` 发送 Ctrl+V / Enter → 写 `transport/gui-sent/<taskId>.json` 与前后截图 → 把前台还给原窗口。支持 `-DryRun`；抢不到前台即失败退出，不盲打其他窗口。
- `scripts/orchestration/README.md`：编排脚本实现索引与 GUI 投递闭环说明。
- `docs/team/agent-orchestration/framework-version-anchor.md`：框架 tag / commit / 未发版 HEAD 的唯一锚点。
- `docs/worklog/completed/phase2.5/af074-framework-closeout-2026-11-18.md`：本记录。

修改：

- `scripts/orchestration/gui-dispatch.mjs`
  - 新增 `acks/`、`gui-sent/` 目录常量与 `ackRelativePath` / `guiSentRelativePath`；
  - 新增 `readDeliveryAck` / `readGuiSentRecord` / `confirmDeliveryFromAck` / `autoConfirmDelivery`；
  - ack 只证明「收到」，不是完成回执；ack 的 `taskId` 必须一致、`receivedAt` 必须可解析，且不得早于本次 `preparedAt`（防上一轮旧 ack 误认领）；
  - brief 新增「投递确认」段，明确 ack 路径与状态面红线（禁止 executor 自行执行 `task / run-once / archive / improvements transition`）。
- `scripts/orchestration/acceptance-runner.mjs`
  - 新增 `DELIVERY_RECORD_MARKERS` / `findMissingDeliveryMarkers`，六组标记支持英文键与中文块标题；`manualReviewItems` 改用该函数，消除 AF-073 的英文字面匹配漂移。
- `scripts/orchestration/scheduler.mjs`
  - 新增 `autoConfirmDeliveries(index, runtimeState, actions, opts)`；
  - `advanceOnce` 在 `releaseExpiredLeases` 之后、`releaseFailedDeliveries` 之前执行 ack 自动确认；缺 ack 仍按投递租约回滚。
- `scripts/orchestration/cli.mjs`
  - 新增 `channel send`（调用 PowerShell 发送器；支持 `--dry-run` / `--wait-ack` / `--ack-timeout` / `--no-click-input` / `--window-title`）；
  - 新增 `channel auto-confirm`（单任务或全部 submitted 任务，读 ack 后确认）；
  - `channel rules` 增加送达确认协议；`channel dispatch` 帮助文本同步。
- `package.json`：新增 `orchestration:channel`。
- `docs/team/wp-task-template.md`、`docs/team/agent-orchestration/acceptance-checklist.md`：补六组机读字段标记、ack / GUI 投递核对项。
- `docs/team/agent-orchestration/README.md`：修正 `v2.0.0` tag object → commit 的写法，补 main HEAD 未发版锚点；§5.1 补 `send` / `auto-confirm` / ack 协议与命令表。
- `docs/team/agent-orchestration/tools/TOOL-ORCH-CLI.json`、`TOOL-QUEUE-SCHEDULER.json`：工具契约描述同步新增能力。
- 状态面生成物：`docs/team/agent-orchestration/{orchestration-snapshot.json,state/journal.jsonl,task-state-index.json}`、`web/orchestration/data.js`（由 CLI 生成，不手改）。

## 2. gateResults（闸门结果）

| 命令 | 退出码 | 真实结果 |
| --- | --- | --- |
| `corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 1 file / **236 tests passed / 0 failed**，570ms |
| `corepack pnpm lint` | 0 | 0 error / 0 warning；脚本段 `eslint --cache --config scripts/orchestration/eslint-scripts.config.mjs "scripts/**/*.{mjs,cjs}"` 已覆盖；仅 pnpm 报 node 引擎 WARN（工具运行时 v22.23.2 vs 仓库要求 >=26，非代码失败） |
| `node scripts/orchestration/cli.mjs validate` | 0 | 17 项 PASS（状态索引 / 工具契约 / 协议视图 / 交付包 / Agent Card / AF-070–AF-074 回执与运行态任务单 / 事件日志 schema+哈希链 / 索引投影） |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 事件日志 **307 条**；schema + 哈希链 + 索引投影一致 |
| `node --check`（gui-dispatch / acceptance-runner / scheduler / cli） | 0 | 四个改动脚本语法通过 |
| `powershell.exe -File scripts/orchestration/gui-relay-send.ps1 ... -DryRun` | 0 | 定位 MiniMax Code（PID 12444）；写 `AF-074.sent.json` 与前/后截图；`code=dry-run-ok` |
| 真实发送测试（`AF-074-TEST`，消息明确「请忽略、不要执行任何任务」） | 0 | 窗口收到并显示测试消息；`beforeHash` 与 `afterHash` 不同；`clipboardRestored=true`；证据 `transport/gui-sent/AF-074-TEST.{before,after}.png|sent.json` |
| `node scripts/orchestration/cli.mjs channel send --taskId AF-074 --dry-run` | 2 | 守卫生效：AF-074 是 `file` 通道，拒绝驱动桌面（`通道 file 不是 gui-relay`） |
| `node scripts/orchestration/cli.mjs channel auto-confirm --taskId AF-074` | 0 | 未确认 1 条，原因 `not-pending-gui-relay`；不伪造送达 |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空；未触碰内核边界 |

复现说明：PowerShell 工具会话 PATH 没有 `pnpm` / `git`，命令统一用 `corepack pnpm` 与 `D:\Git\cmd` 前缀；真实用户终端可用 `pnpm`。真实发送测试不产生任务 ack，因此只作为发送链路证据，不作为任何任务的送达确认。

## 3. scopeCheck（范围核对）

`in-scope`。改动全部落在任务单授权范围：`scripts/orchestration/`、`package.json`、`docs/team/`、`docs/worklog/`；未改 `src/`、`test/`、`data/`、`migration`、数据库 schema。并行产物排除：主工作树 `mofang-nestjs` 的 `task/AF-069-relay-supervisor` 未提交改动未触碰；AF-074 工作树只含本单改动与 CLI 状态面生成物。

## 4. contractChecks（契约核对）

- `taskId` 贯穿任务单、交付记录、回执、提交标题：`AF-074`。
- 状态写只经 CLI：`task register` → `task promote` → `run-once` → 后续回执摄入 / 归档；未手改索引或事件日志。
- 任务单 scope 覆盖新增脚本、文档、模板、package.json 与交付记录路径；`verify` 对运行态任务单 AF-074 判 PASS。
- 版本口径：`v2.0.0` 是 annotated tag object `c507188`，指向 commit `67d3290`；`main` HEAD `7395748` 未发版。适配层 README 与 `framework-version-anchor.md` 已统一；不新增框架 tag/release（L4 留给 Human）。
- 六组机读字段标记：`gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict` 全部出现在本记录，且验收器支持中文别名。

## 5. backlogItems（遗留登记）

| 编号 | 影响 | 排期 / 处置 |
| --- | --- | --- |
| `IM-053`（新增） | ack 自动确认已代码化，但连续多任务长跑、超时回滚、旧 ack 隔离仍需实战回归 | 下一轮真实执行任务由 relay supervisor 记录连续 3 单的 send→ack→auto-confirm→receipt 延迟与回滚次数 |
| `IM-044` | mcp / http transport 仍为预留位 | 不在本单；需框架契约版本与跨机长跑设计 |
| `IM-046` | 跨仓提交不能写入回执 `changedFiles.commits` | 不在本单；涉及框架 schema 与 vendoring |
| `IM-047` | 生产收口清单未排期 | 用户已明确暂缓生产 |
| `IM-052` | executor 自行执行状态写命令的越权面 | brief 红线 + ack 已降低；CLI 角色硬隔离需独立契约设计，保留 queued |

`IM-043` 已复核闭环：`package.json` 的 lint 第二段覆盖 `scripts/**/*.{mjs,cjs}`，本单 lint 实跑退出 0；已流转 `accepted → done`。
`IM-045` 已收口为 ack + auto-confirm，真实发送链路已验证；无人值守长跑拆到 `IM-053`，已流转 `accepted → done`。

## 6. deviationTable（偏差说明）

| 项 | 任务单原方案 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 发送按键通道 | 计划用 PowerShell `SendKeys` 粘贴 | 首轮 `SendKeys` 在 Electron 窗口不落地（截图输入框仍空）；改用 Win32 `keybd_event` Ctrl+V / Enter | 实测 `SendKeys` 不可靠；`keybd_event` 走前台键盘队列，真实发送成功 |
| 输入框定位 | 仅聚焦窗口，不点坐标 | 增加窗口相对坐标点击（默认 x=0.55 / y=0.45），并可用 `--no-click-input` 关闭 | 首次 y=0.64 点到了下方工具条；按实际窗口布局修正 |
| 自动化桌面 | 不强制点击，靠窗口焦点 | 仍保持「主桌面 + 发送后还原前台」；未使用虚拟桌面 / PiP | 用户明确拒绝虚拟桌面（缺少管理员密码）；主桌面发送后立即释放 |
| ack 自动确认 | 收到 ack 即 confirm | 增加 `preparedAt` 时间下界，ack 早于本次投递即拒绝 | 防止上一轮旧 ack 误确认新投递 |
| 版本发布 | 只做文档锚定 | 未打新 tag / release | L4 冻结动作需 Human 批准，本单不擅自发布 |

## 7. reviewVerdict（验收结论）

`conditional-pass`。

理由：代码缺口、字段标记漂移、版本口径、lint 覆盖与真实发送链路均已收口并有可复现证据；`IM-053` 是明确的非阻塞验证项（连续长跑与 stale-ack 实战），不影响本单交付，但按验收规则「有遗留登记」判 `conditional-pass`，不写成 `passed`。

## 8. 未做 / 明确边界

- 未新跑 LLM 批次；未改业务 `src/`、`test/`、数据库 / Redis。
- 未实现 `IM-044` HTTP transport、`IM-046` 跨仓 commits schema、`IM-047` 生产收口清单。
- 未做 L4 冻结动作（框架 tag / release / master / 部署）。
- 真实发送测试在 MiniMax 新建了「未命名会话」，消息内容明确要求忽略；不影响任务状态面。
