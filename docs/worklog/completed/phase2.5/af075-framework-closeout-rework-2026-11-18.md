# AF-075 框架收口返修交付记录（补齐 scope，承接 AF-074）

- 任务单：`docs/worklog/pending/af075-framework-closeout-scope-task-2026-11-18.md`
- 任务 ID：`AF-075`（返修承接 `AF-074`，提案 `RW-AF-074-1`）
- 分支：`task/AF-075-framework-closeout-scope`（自 `integrate` `fbe2470ff9c421c84232d3f317636bbd49c71afc` 切出）
- 日期：2026-11-18
- 结论：`conditional-pass`（实现与闸门通过；连续长跑 / stale-ack 实战另立 `IM-053`）

## 1. 返修原因与处置

AF-074 的实现已完成，但回执被机读护栏判 `rejected`：任务单 scope 漏列 `docs/team/agent-orchestration/tools/TOOL-ORCH-CLI.json`、`TOOL-QUEUE-SCHEDULER.json` 两个实际改动文件。没有改代码去规避，也没有把已归档任务改写成通过；按框架返修机制新开 AF-075，补齐 scope 后重跑同一批改动。

本单不重写 AF-074 的拒绝事件；`docs/worklog/completed/phase2.5/af074-framework-closeout-2026-11-18.md` 顶部已补验收事实说明，最终结论以本记录为准。

## 2. 落地内容

新增：

- `scripts/orchestration/gui-relay-send.ps1`：主桌面发送器。定位已运行的执行代理窗口 → 点击输入框 → 剪贴板粘贴 brief → Win32 `keybd_event` 发送 Ctrl+V / Enter → 写 `transport/gui-sent/<taskId>.json` 与前后截图 → 前台还给原窗口。支持 `-DryRun`；抢不到前台即失败。
- `scripts/orchestration/README.md`：编排脚本实现索引与 GUI 投递闭环说明。
- `docs/team/agent-orchestration/framework-version-anchor.md`：框架 tag / commit / 未发版 HEAD 唯一锚点。
- `docs/worklog/completed/phase2.5/af075-framework-closeout-rework-2026-11-18.md`：本记录。

修改：

- `scripts/orchestration/gui-dispatch.mjs`：新增 `acks/`、`gui-sent/` 常量与 `ackRelativePath` / `guiSentRelativePath`；新增 `readDeliveryAck` / `readGuiSentRecord` / `confirmDeliveryFromAck` / `autoConfirmDelivery`；ack 校验 `taskId`、`receivedAt`、且不得早于本次 `preparedAt`；brief 新增「投递确认」段与状态面红线。
- `scripts/orchestration/acceptance-runner.mjs`：新增 `DELIVERY_RECORD_MARKERS` / `findMissingDeliveryMarkers`，六组标记支持英文键与中文块标题；`manualReviewItems` 改用该函数。
- `scripts/orchestration/scheduler.mjs`：新增 `autoConfirmDeliveries`；`advanceOnce` 在 `releaseExpiredLeases` 之后、`releaseFailedDeliveries` 之前执行 ack 自动确认。
- `scripts/orchestration/cli.mjs`：新增 `channel send`（支持 `--dry-run` / `--wait-ack` / `--ack-timeout` / `--no-click-input` / `--window-title`）与 `channel auto-confirm`；`channel rules` 增加送达确认协议。
- `package.json`：新增 `orchestration:channel`。
- `docs/team/wp-task-template.md`、`docs/team/agent-orchestration/acceptance-checklist.md`：补六组机读字段标记与 ack / GUI 投递核对项。
- `docs/team/agent-orchestration/README.md`：修正 `v2.0.0` tag object → commit 写法，补 main HEAD 未发版锚点；§5.1 补 `send` / `auto-confirm` / ack 协议。
- `docs/team/agent-orchestration/tools/TOOL-ORCH-CLI.json`、`TOOL-QUEUE-SCHEDULER.json`：工具契约描述同步新增能力。
- 状态面生成物：`docs/team/agent-orchestration/{orchestration-snapshot.json,state/journal.jsonl,task-state-index.json}`、`web/orchestration/data.js`（CLI 生成，不手改）。

## 3. gateResults（闸门结果）

| 命令 | 退出码 | 真实结果 |
| --- | --- | --- |
| `corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 1 file / **236 tests passed / 0 failed**，570ms |
| `corepack pnpm lint` | 0 | 0 error / 0 warning；脚本段已覆盖 `scripts/**/*.{mjs,cjs}`；仅 pnpm 报 node 引擎 WARN（v22.23.2 vs 仓库 >=26，非代码失败） |
| `node scripts/orchestration/cli.mjs validate` | 0 | 17 项 PASS（交付时；状态索引 / 工具契约 / 协议视图 / 交付包 / Agent Card / AF-070–AF-075 运行态任务单 / 事件日志 schema+哈希链 / 索引投影） |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 交付时事件日志 **307 条**；schema + 哈希链 + 索引投影一致 |
| `node --check`（gui-dispatch / acceptance-runner / scheduler / cli） | 0 | 四个改动脚本语法通过 |
| `powershell.exe -File scripts/orchestration/gui-relay-send.ps1 ... -DryRun` | 0 | 定位 MiniMax Code（PID 12444）；写 `AF-074.sent.json` 与前/后截图；`code=dry-run-ok` |
| 真实发送测试（`AF-074-TEST`，消息明确「请忽略、不要执行任何任务」） | 0 | 窗口收到并显示测试消息；`beforeHash != afterHash`；`clipboardRestored=true`；证据 `transport/gui-sent/AF-074-TEST.{before,after}.png|sent.json` |
| `node scripts/orchestration/cli.mjs channel send --taskId AF-074 --dry-run` | 2 | 守卫生效：`file` 通道不得驱动桌面 |
| `node scripts/orchestration/cli.mjs channel auto-confirm --taskId AF-074` | 0 | 未确认 1 条，原因 `not-pending-gui-relay`；不伪造送达 |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空输出；未触碰内核边界 |

复现说明：PowerShell 工具会话 PATH 没有 `pnpm` / `git`，统一用 `corepack pnpm` 与 `D:\Git\cmd` 前缀；真实用户终端可直接用 `pnpm`。真实发送测试不产生任务 ack，只作发送链路证据，不作为任何任务的送达确认。

交付后复核（AF-075 已 completed、状态面写入后）：`corepack pnpm exec vitest run test/engine-core/boundary.spec.ts` 12 tests passed / 0 failed；`node scripts/orchestration/cli.mjs validate` 20 项 PASS；`node scripts/orchestration/cli.mjs events verify` 314 条、schema + 哈希链 + 索引投影一致；`corepack pnpm lint` 在代码最后改动后重跑仍 0 error / 0 warning。

## 4. scopeCheck（范围核对）

`in-scope`。改动全部落在 AF-075 任务单授权范围：`scripts/orchestration/`、`package.json`、`docs/team/`、`docs/worklog/`；本单已显式把两个工具契约 JSON 纳入 scope，消除 AF-074 的越界声明。未改 `src/`、`test/`、`data/`、`migration`、数据库 schema。并行产物排除：主工作树 `mofang-nestjs` 的 AF-069 未提交改动未触碰。

## 5. contractChecks（契约核对）

- `taskId` 贯穿任务单、交付记录、回执：`AF-075`；AF-074 的拒绝事实保留。
- 状态写只经 CLI：`task register` → `task promote` → `run-once` → 后续回执摄入 / 归档。
- 任务单 scope 覆盖新增脚本、文档、模板、package.json、两个工具契约 JSON 与交付记录路径。
- 版本口径：`v2.0.0` 是 annotated tag object `c507188`，指向 commit `67d3290`；`main` HEAD `7395748` 未发版；不新增框架 tag/release（L4 留给 Human）。
- 六组机读字段：`gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict` 全部出现，验收器支持中文别名。

## 6. backlogItems（遗留登记）

| 编号 | 影响 | 排期 / 处置 |
| --- | --- | --- |
| `IM-053`（新增） | ack 自动确认已代码化，但连续多任务长跑、超时回滚、旧 ack 隔离仍需实战回归 | 下一轮真实执行任务由 relay supervisor 记录连续 3 单的 send→ack→auto-confirm→receipt 延迟与回滚次数 |
| `IM-044` | mcp / http transport 仍为预留位 | 不在本单；需框架契约版本与跨机长跑设计 |
| `IM-046` | 跨仓提交不能写入回执 `changedFiles.commits` | 不在本单；涉及框架 schema 与 vendoring |
| `IM-047` | 生产收口清单未排期 | 用户已明确暂缓生产 |
| `IM-052` | executor 自行执行状态写命令的越权面 | brief 红线 + ack 已降低；CLI 角色硬隔离需独立契约，保留 queued |

`IM-043` 已复核闭环：`package.json` lint 第二段覆盖 `scripts/**/*.{mjs,cjs}`，本单 lint 实跑退出 0；已流转 `accepted → done`。
`IM-045` 已收口为 ack + auto-confirm，真实发送链路已验证；无人值守长跑拆到 `IM-053`，已流转 `accepted → done`。

## 7. deviationTable（偏差说明）

| 项 | 任务单原方案 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 发送按键通道 | PowerShell `SendKeys` 粘贴 | 首轮 `SendKeys` 在 Electron 窗口不落地；改用 Win32 `keybd_event` Ctrl+V / Enter | 实测 `SendKeys` 不可靠；`keybd_event` 真实发送成功 |
| 输入框定位 | 仅聚焦窗口，不点坐标 | 增加窗口相对坐标点击（默认 x=0.55 / y=0.45），可用 `--no-click-input` 关闭 | 首次 y=0.64 点到下方工具条，按实际布局修正 |
| 自动化桌面 | 不强制点击，靠焦点 | 主桌面 + 发送后还原前台；未使用虚拟桌面 / PiP | 用户明确拒绝虚拟桌面（缺少管理员密码） |
| ack 自动确认 | 收到 ack 即 confirm | 增加 `preparedAt` 时间下界，旧 ack 早于本次投递即拒绝 | 防止 stale ack 误确认新投递 |
| 版本发布 | 只做适配层文档锚定 | 未打新 tag / release | L4 冻结动作需 Human 批准 |

## 8. reviewVerdict（验收结论）

`conditional-pass`。

理由：代码缺口、字段标记漂移、版本口径、lint 覆盖与真实发送链路均已收口并有可复现证据；`IM-053` 是明确的非阻塞验证项（连续长跑与 stale-ack 实战），不影响本单交付，但按验收规则「有遗留登记」判 `conditional-pass`，不写成 `passed`。

## 9. 未做 / 明确边界

- 未新跑 LLM 批次；未改业务 `src/`、`test/`、数据库 / Redis。
- 未实现 `IM-044` HTTP transport、`IM-046` 跨仓 commits schema、`IM-047` 生产收口清单。
- 未做 L4 冻结动作（框架 tag / release / master / 部署）。
- 真实发送测试在 MiniMax 新建「未命名会话」，消息明确要求忽略；不影响任务状态面。
