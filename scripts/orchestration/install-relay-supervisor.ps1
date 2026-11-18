#Requires -Version 7.0
<#
.SYNOPSIS
  安装/更新本机 Relay Supervisor 计划任务（幂等）。

.DESCRIPTION
  AF-069 的 supervisor 是机器级工件：迁移、重装或换 Node 运行时后必须重装。
  本脚本把计划任务的动作、工作目录、触发器和恢复策略固化为仓内可复现操作。

  要求 Node >= 26（与 package.json engines 对齐）。默认从 PATH 解析 node.exe；
  也可显式传入便携版 Node 26 的绝对路径。

.PARAMETER NodeExe
  node.exe 绝对路径；省略时使用 PATH 中的 node。

.PARAMETER TaskName
  计划任务名，默认 Mofang Relay Supervisor。

.PARAMETER RepoRoot
  后端仓根，默认脚本上两级目录。

.PARAMETER NoStart
  只注册/更新，不立即启动。

.EXAMPLE
  pwsh -File scripts/orchestration/install-relay-supervisor.ps1 `
    -NodeExe 'D:\tools\node-v26.12.1-win-x64\node.exe'

.EXAMPLE
  pwsh -File scripts/orchestration/install-relay-supervisor.ps1 -NoStart
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$NodeExe,
  [string]$TaskName = 'Mofang Relay Supervisor',
  [string]$RepoRoot,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

$supervisor = Join-Path $RepoRoot 'scripts\orchestration\relay-supervisor.mjs'
if (-not (Test-Path -LiteralPath $supervisor -PathType Leaf)) {
  throw "relay-supervisor.mjs 不存在：$supervisor（请先合并 AF-069）"
}

if (-not $NodeExe) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'PATH 中找不到 node.exe；请用 -NodeExe 指定 Node 26 绝对路径' }
  $NodeExe = $cmd.Source
}
$NodeExe = (Resolve-Path -LiteralPath $NodeExe).Path
if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "node.exe 不存在：$NodeExe" }

$nodeVersion = (& $NodeExe --version).Trim()
$major = [int](($nodeVersion.TrimStart('v') -split '\.')[0])
if ($major -lt 26) {
  throw "当前 Node 为 $nodeVersion，低于 package.json engines.node (>=26)；请指定 Node 26 的 -NodeExe"
}

$action = New-ScheduledTaskAction `
  -Execute $NodeExe `
  -Argument 'scripts\orchestration\relay-supervisor.mjs watch' `
  -WorkingDirectory $RepoRoot

$userId = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($PSCmdlet.ShouldProcess($TaskName, $(if ($existing) { '更新计划任务' } else { '注册计划任务' }))) {
  if ($existing -and -not $NoStart -and $existing.State -eq 'Running') {
    # 动作（尤其 NodeExe）变更后必须重启，否则旧进程会继续用旧运行时。
    Stop-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
  }

  if ($existing) {
    Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  } else {
    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $trigger `
      -Principal $principal `
      -Settings $settings `
      -Description 'mofang-nestjs relay supervisor：事件驱动 + 有界兜底扫描（AF-069）' | Out-Null
  }

  if (-not $NoStart) { Start-ScheduledTask -TaskName $TaskName }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  TaskName      = $task.TaskName
  State         = $task.State
  NodeExe       = $NodeExe
  NodeVersion   = $nodeVersion
  WorkingDir    = $RepoRoot
  Execute       = $task.Actions[0].Execute
  Arguments      = $task.Actions[0].Arguments
  LastTaskResult = $info.LastTaskResult
} | Format-List
