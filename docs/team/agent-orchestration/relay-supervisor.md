# Relay Supervisor 运维说明（AF-069）

> 单一事实源：框架仓 `docs/autonomous-loop.md` §8.1 / §8.2；本仓档位数字见 `README.md` §5。
> 工具契约：`tools/TOOL-RELAY-SUPERVISOR.json`。
> 状态目录：`docs/team/agent-orchestration/transport/`（gitignored）。

## 1. 它解决什么

MiniMax Code 回复通常 10–30 分钟。Doubao cron 最小间隔 1 小时，永久扫目录任务又违反 §8.2。Relay Supervisor 是本地常驻进程：

- 文件系统事件负责秒级发现；
- 任务级 `nextCheckAt` 负责事件丢失、进程重启、网络盘不触发时的兜底；
- 每个 job 绑定 `taskId`、精确回执文件、profile、deadline；
- 命中后归档回执并写通知；超时后报告并停止；
- 不创建永久 cron，不扫描无关 `relay-response-*.md`。

## 2. 命令

```powershell
# 注册一个任务（回执尚未生成也可以先注册）
pnpm orchestration:relay register --taskId AF-0xx --file docs/worklog/pending/relay-response-AF-0xx-YYYYMMDD-HHMM.md --profile M

# 查看在途 job / 通知
pnpm orchestration:relay list
pnpm orchestration:relay inbox --unread

# 单轮检查（调试 / 手工兜底）
pnpm orchestration:relay tick

# 常驻 supervisor（登录时由计划任务启动）
pnpm orchestration:relay watch

# 命中并摘要后清理
pnpm orchestration:relay ack --taskId AF-0xx

# 任务取消 / 不再等待
pnpm orchestration:relay cancel --taskId AF-0xx
```

## 3. 生命周期

1. 派发前：计算 profile（S/M/L/XL）。
2. 投递确认后：注册 job；回执路径与简报里的“回复输出约定”必须逐字一致。
3. supervisor 监听 pending 目录；只处理已注册 job 的精确文件名。
4. 文件大小 > 0 且 mtime 稳定后，归档到 `docs/worklog/pending/archive/`，写 `transport/relay-notifications/<taskId>.json|md`。
5. 主控 `inbox` 读取通知、摘要给用户；验收仍走既有回执链，通知不是验收结论。
6. `ack` 清理 job；通知置为 `read`。

## 4. 可靠性设计

| 机制       | 实现                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| 单实例     | `transport/relay-supervisor-lock/.run-once.lock`，进程崩溃 15 分钟后可被新实例接管 |
| 账本原子写 | `writeJsonAtomic`，先写 `.tmp` 再替换                                              |
| 文件稳定   | `size > 0` 且 `mtime` 稳定 2.5 秒；最多 5 次 settling 重试，避免抢读半截内容       |
| 崩溃恢复   | 通知已落盘但账本未写时，重启按通知恢复为 `notified`，并补归档                      |
| 超时       | `deadline` 到期未命中置 `timed-out`，不再续期                                      |
| 审计       | `transport/relay-audit.jsonl`，只写 taskId、动作、路径、大小、哈希、时间           |
| 隐私       | 通知不复制回执正文；只存路径、大小、SHA-256 与状态                                 |

## 5. Windows 计划任务

推荐“登录时启动 + 失败重启”，不做常驻 Windows 服务：

- 任务名：`Mofang Relay Supervisor`
- 触发：当前用户登录时
- 动作：隐藏窗口运行 `node scripts/orchestration/relay-supervisor.mjs watch`
- 设置：`MultipleInstances=IgnoreNew`，失败重启 3 次 / 间隔 1 分钟，无执行时限

安装命令见本任务交付记录；安装后用 `Get-ScheduledTask` 与 `pnpm orchestration:relay list` 复核。

## 6. 资源预算与验收

- 目标：RSS ≤ 120 MB；空闲 CPU ≤ 0.5%；句柄稳定，不随 job 数线性增长。
- 空账本时定时器只检查到期 job，不读目录；目录读取只在事件或 job 到期时发生。
- 若 RSS 超预算或 supervisor 反复崩溃：先 `cancel` 在途 job，再排查日志；不要用永久 cron 替代。
- 不跑 LLM、不占 GPU、不读业务数据库。

## 7. 失败模式

| 现象                        | 处置                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| `supervisor 单实例锁被占用` | 先 `Get-Process node` 确认是否已有 watch；不要强删锁                    |
| 回执一直不出现              | 到 deadline 自动 `timed-out`；检查 MiniMax 是否按约定写文件，再决定重派 |
| 通知存在但 job 仍 pending   | 重启 supervisor 或 `tick`，会按通知恢复为 `notified`                    |
| 回执文件为空                | 不判完成；继续按档位检查，deadline 到期转超时                           |
| 需要立即停止                | `cancel --taskId`，再处理 MiniMax 侧任务                                |
