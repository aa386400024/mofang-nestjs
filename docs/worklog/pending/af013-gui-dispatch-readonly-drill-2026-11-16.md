---
taskId: AF-013
contextId: phase2.5-orchestration-closed-loop
title: GUI 派发只读演练（进程自愈、四层定位、路径固化、失败重试与转人工、派发审计）
type: verification
status: backlog
baselineRef: 09df090
dependsOn: [AF-010, AF-011]
policyRefs: [framework/human-in-the-loop.md, framework/reliability.md, autonomous-team-design.md#gui-channel]
createdAt: 2026-11-16
---

# AF-013 · GUI 派发只读演练与通道规则固化

> 状态：📋 待立项（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `scripts/orchestration/`（派发通道规则 / 审计）、演练回执归档
> 唯一事实源：`docs/team/agent-orchestration/autonomous-team-design.md` §3（派发通道）、§7（autoLoop 阶段 2 前置）、§8 P0-5
> 任务性质：通道演练 + 规则固化；演练任务为纯只读调研，零业务代码改动、零提交

## 0. 【必读入口】动手前按顺序读完

1. `docs/team/agent-orchestration/autonomous-team-design.md` §3、§7、§8
2. 框架仓 `docs/human-in-the-loop.md`（升级消息标准字段、人工接管边界）
3. 框架仓 `docs/reliability.md` §3（失败定性、重试上限）、§6（崩溃恢复）
4. 本机桌面操作规范：computer-use-automation Skill（进程发现 / 启动、元素树、快捷键、剪贴板、结果校验）
5. 现有 relay 口径：`.user_skills/minimax-code-relay`（会话降级链、单任务队列、发送失败只重试一次）

## 1. 背景

现有 GUI 派发为半人工：主控写长简报 → 人工粘贴 → cron 轮询回执；输入框定位不稳定（Electron 无固定坐标）。设计备忘定稿四层定位 + 进程自愈：进程 / 窗口未开启时自动发现并启动，真正不可恢复才升级人工。本单在只读零风险任务上跑通「唤起 → 定位 → 粘贴 → 发送校验 → 回执落盘 → 回收」全链路，把稳定路径、降级顺序、失败重试与转人工规则固化为通道规则与审计口径，作为 autoLoop 阶段 2 的前置条件之一。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- 进程自愈：派发前探测执行代理进程 / 窗口；未开启则经应用目录发现并启动，等待窗口就绪；启动失败重试一次；真正不可恢复才保持任务 ready、写审计并升级 Human；
- 定位四层：窗口健康探测 → 元素树定位输入框 → 快捷键兜底（Mini Chat → 新任务页）→ 剪贴板粘贴 + 发送结果校验（文本进框、消息入流、输入框清空）；
- 会话降级链：旧会话追加（默认）→ Mini Chat 小窗 → 主窗口新建任务页；
- 交接文件化：GUI 只传 taskId 与交接件 / 回执路径，不贴长简报（依赖 AF-009 交接件结构、AF-010 派发接线）；
- 演练任务：纯只读调研 / 文档核对类，不写业务源码、不建任务分支、不提交；演练回执归档 `docs/worklog/pending/archive/`；
- 派发审计：通道、会话路径、尝试次数、结果、时间戳；记录三层路径各自成功率与失败特征，输出通道规则备忘；
- 失败处置：发送失败只重试一次（换路径）；登录门等人工步骤交人工接管，不自行填凭证。

**明确不在范围内：**

- 多任务并行派发；常驻后台守护进程；MCP / HTTP 通道；
- 演练不验证实现类任务的闸门与合并（归后续阶段 3）；
- 不改业务 `src/` / `test/`；不新增生产依赖；演练产物不进提交。

## 3. 目标架构 / 交付物

- **交付物 1：通道规则模块** —— 定位层级、降级顺序、重试上限、转人工判定、审计字段；纯规则 + 可注入的进程 / 剪贴板接口，便于单测；
- **交付物 2：演练回执与规则备忘** —— 只读演练任务单、回执、路径成功率记录；固化后的默认路径与例外清单；
- **交付物 3：测试** —— 定位层降级顺序、失败重试上限、转人工判定、审计字段齐全等纯函数用例；桌面真实操作部分不在单测内复现。

## 4. 红线（违反即返工）

- 单任务队列：一次只派一个 executor 任务；上一任务未回收不发下一个；
- 不自动登录、不填账号密码 / 凭证；人工步骤走接管通道；
- 审计与回执不含对话原文；只留路径、计数、结果；
- 演练结论基于真实观察截图 / 文件证据，不凭印象判定路径成功率。

## 5. 闸门（实施时填真实数字）

通道规则模块：`pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`；`pnpm typecheck`；`pnpm lint:fast`；编码无 BOM、纯 LF。桌面演练本身不跑业务闸门；pnpm 强制。本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af013-gui-dispatch-readonly-drill-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与演练回执归档；索引 / 阶段入口同步回写；
- [ ] 索引状态迁移追加 `history`，工件指针填全；
- [ ] 通道规则备忘路径登记进 README 或设计备忘引用位；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 演练回执 / 交付记录。
