# Relay Supervisor 安装与迁移

> 适用 AF-069 的 relay supervisor。supervisor 本体与 CLI 见 `relay-supervisor.md`（AF-069 合并后生效）。
> 本文只负责“机器级计划任务”的可复现安装。

## 为什么需要安装脚本

`Mofang Relay Supervisor` 是 Windows 计划任务，不是仓内文件：

- 换机器、重装系统、切换 Node 运行时后都不会自动恢复；
- 手工 `schtasks` 容易漏掉工作目录、触发器、失败重启策略；
- 任务动作必须指向 **Node >= 26**，否则与 `package.json` 的 `engines.node` 口径漂移。

`scripts/orchestration/install-relay-supervisor.ps1` 把这件事固化成幂等操作：任务已存在就更新动作/触发器/恢复策略，不存在就注册。

## 前置

- 后端仓已合并 AF-069，存在 `scripts/orchestration/relay-supervisor.mjs`。
- Node 26 可用。默认从 PATH 解析；便携版可直接传绝对路径。
- 当前用户能注册/更新计划任务（必要时以管理员身份运行）。

## Node 26 本地口径

仓 `package.json` 为 `engines.node >=26`，CI 使用 `node-version: '26'`。本地闸门与计划任务都必须用 26，避免“在 22/24 上跑绿、在 26 上才暴露”的假绿。

便携版安装示例（不替换系统 Node）：

```powershell
$ver = '26.12.1'
$zip = "$env:TEMP\node-v$ver-win-x64.zip"
Invoke-WebRequest "https://nodejs.org/dist/v$ver/node-v$ver-win-x64.zip" -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath 'D:\tools' -Force
& "D:\tools\node-v$ver-win-x64\node.exe" --version
```

后续所有 `pnpm` / `node` 闸门用该绝对路径，或把 `D:\tools\node-v$ver-win-x64` 放到 PATH 最前。

## 安装 / 更新

```powershell
pwsh -File scripts/orchestration/install-relay-supervisor.ps1 `
  -NodeExe 'D:\tools\node-v26.12.1-win-x64\node.exe'
```

只注册不启动：

```powershell
pwsh -File scripts/orchestration/install-relay-supervisor.ps1 -NoStart
```

脚本行为：

| 项 | 值 |
| --- | --- |
| 任务名 | `Mofang Relay Supervisor` |
| 动作 | `<node26>\node.exe scripts\orchestration\relay-supervisor.mjs watch` |
| 工作目录 | 后端仓根 |
| 触发器 | 当前用户登录时 |
| 失败恢复 | 1 分钟后重试，最多 3 次 |
| 多实例 | `IgnoreNew`（避免双 supervisor） |
| 执行时限 | 无限制 |

## 迁移检查清单

换机器 / 重装后按顺序核对：

1. `node --version` 或显式 Node 路径 >= 26。
2. `scripts/orchestration/relay-supervisor.mjs` 存在（AF-069 已合并）。
3. 运行安装脚本；输出 `State=Running`。
4. `Get-ScheduledTask -TaskName 'Mofang Relay Supervisor'` 的 `Actions[0].WorkingDirectory` 等于当前仓根。
5. `pnpm orchestration:relay list` 无残留 job；`docs/team/agent-orchestration/transport/relay-supervisor-lock` 只有当前进程锁。
6. 如需停用：`Stop-ScheduledTask -TaskName 'Mofang Relay Supervisor'`，不要删除仓内账本。

## 卸载

```powershell
Unregister-ScheduledTask -TaskName 'Mofang Relay Supervisor' -Confirm:$false
```

卸载只移除计划任务；`transport/relay-jobs.json` 与审计日志是运行态，按需保留或另行清理。
