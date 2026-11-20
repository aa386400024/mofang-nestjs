# 编排脚本实现索引（L2 工具链）

> 规则真相源在 `docs/team/agent-orchestration/README.md` 与框架仓；本文件只帮后来者定位实现文件，不复制契约正文。

## 入口

| 文件                    | 职责                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cli.mjs`               | 命令入口：`status / run-once / channel / task / branch / archive / improvements / events / validate / snapshot / pack` |
| `scheduler.mjs`         | 单轮调度：释放租约 → ack 自动确认 → 投递回滚 → 回执摄入 → 终态扫档 → 领单派发                                          |
| `dispatch.mjs`          | 派发记录、选路消费、回执指纹                                                                                           |
| `dispatch-channel.mjs`  | 通道选路决策、失败预算、熔断判定                                                                                       |
| `gui-dispatch.mjs`      | brief 生成、投递状态机、ack 确认、降级回退                                                                             |
| `gui-relay-send.ps1`    | 主桌面发送器：聚焦执行代理窗口 → 粘贴 brief → 发送 → 写 `transport/gui-sent/` 证据；`-DryRun` 只验证定位               |
| `acceptance-runner.mjs` | 机读验收：V1–V7、六组交付记录字段标记、人工复核项                                                                      |
| `receipts.mjs`          | 回执摄入与幂等指纹                                                                                                     |
| `relay-supervisor.mjs`  | relay 回执回收：事件优先 + 有界兜底                                                                                    |
| `state-store.mjs`       | 事件日志 + 索引投影 + 文件锁                                                                                           |
| `task-entry-gate.mjs`   | 提交前准入：在办任务、scope、状态面豁免                                                                                |

## GUI 投递闭环

1. `run-once` 领单，写 `transport/tasks/<taskId>.json` 与 `transport/briefs/<taskId>.brief.md`，`delivery.state=pending`。
2. `channel send --taskId <id>` 聚焦执行代理窗口、粘贴 brief、发送，写 `transport/gui-sent/<taskId>.json` 与前后截图；发送后把前台还给原窗口，不长期占用桌面。
3. 执行代理按 brief 第一步写 `transport/acks/<taskId>.json`（只证明收到，不是完成回执）。
4. `channel auto-confirm` 或下一轮 `run-once` 的 `autoConfirmDeliveries` 读 ack；taskId 一致、`receivedAt` 可解析才把 `pending → delivered`。
5. 缺 ack 不确认，由 `releaseFailedDeliveries` 按投递租约回滚 `ready + heldForHuman`；不把「已粘贴」冒充「已送达」。

## 边界

- 发送器不启动第二个 MiniMax 实例、不登录、不代输凭据；抢不到前台即失败退出。
- 执行代理禁止执行 `task / run-once / archive / improvements transition` 等编排写命令；状态迁移只由 orchestrator CLI 做。
- `transport/` 是运行态，gitignore；durable 证据进 `docs/worklog/records/<context>/<taskId>/`（旧 `docs/worklog/pending/archive/` 只做兼容读取），交付正文进 `docs/worklog/completed/`。
- `acceptance-runner` 的六组标记只判存在性；内容可信度仍按 `docs/team/agent-orchestration/acceptance-checklist.md` 五类核对。
