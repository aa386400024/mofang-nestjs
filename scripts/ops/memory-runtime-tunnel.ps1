#Requires -Version 7.0
<#
.SYNOPSIS
  本地记忆链路 SSH 隧道（Qdrant 6333 / TEI 8080）一键启动、停止、查看状态。

.DESCRIPTION
  远端 Qdrant 与 TEI 只监听服务器 127.0.0.1，本地后端需要访问时通过 SSH 本地转发。
  本脚本把原来手工执行的长命令固化为 start / stop / status，机器重启或断线后一条命令恢复。

  安全约定：
  - 不把服务器密码写进脚本、仓库或 PID 文件。
  - 密码只从 -Password 参数（不推荐，会进 shell 历史）或 SSH_PASS 环境变量读取；
    也可以预先配置 SSH key，此时无需密码。
  - 密码通过临时 askpass 脚本交给 ssh，脚本内容只引用环境变量，不落明文。

.EXAMPLE
  $env:SSH_PASS = '<server-password>'
  pwsh -File scripts/ops/memory-runtime-tunnel.ps1 start

.EXAMPLE
  pwsh -File scripts/ops/memory-runtime-tunnel.ps1 status
  pwsh -File scripts/ops/memory-runtime-tunnel.ps1 stop
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'status', 'restart')]
  [string]$Action = 'status',

  [string]$SshHost = '117.72.30.78',
  [string]$SshUser = 'root',
  [int]$QdrantPort = 6333,
  [int]$TeiPort = 8080,
  [string]$Password
)

$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $env:LOCALAPPDATA 'mofang'
$pidFile = Join-Path $stateDir 'memory-runtime-tunnel.pid'
$askpassFile = Join-Path $env:TEMP 'mofang-memory-askpass.cmd'

function Test-LocalPort {
  param([int]$Port)
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$conn
}

function Get-TunnelProcess {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  $raw = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if (-not $raw) { return $null }
  $processId = [int]$raw
  return Get-Process -Id $processId -ErrorAction SilentlyContinue
}

function Stop-Tunnel {
  $proc = Get-TunnelProcess
  if ($proc) {
    # ssh 可能拉起子进程；按进程树停止，避免只杀父进程留下端口占用
    & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
    Start-Sleep -Milliseconds 800
    Write-Host "已停止 SSH 隧道（PID $($proc.Id)）"
  } else {
    Write-Host '未发现由本脚本启动的 SSH 隧道进程'
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

function Show-Status {
  $proc = Get-TunnelProcess
  $qdrant = Test-LocalPort -Port $QdrantPort
  $tei = Test-LocalPort -Port $TeiPort
  $state = if ($proc) { "running (PID $($proc.Id))" } else { 'not-running' }
  Write-Host "tunnel=$state qdrant:$QdrantPort=$qdrant tei:$TeiPort=$tei"
  if (-not $proc -and ($qdrant -or $tei)) {
    Write-Host '提示：端口已被非本脚本进程占用，可能是旧的手工 ssh 隧道。'
  }
  return ($proc -and $qdrant -and $tei)
}

function Start-Tunnel {
  if ((Test-LocalPort -Port $QdrantPort) -or (Test-LocalPort -Port $TeiPort)) {
    Write-Host "端口 $QdrantPort/$TeiPort 已有监听，先执行 stop 或确认旧隧道来源"
    Show-Status | Out-Null
    return $false
  }

  if (-not $Password) { $Password = $env:SSH_PASS }
  if (-not $Password) {
    if (-not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.ssh\id_*'))) {
      throw '未提供密码且未发现 SSH key。请设置 $env:SSH_PASS 或使用 -Password，或先配置 SSH key。'
    }
  }

  if ($Password) {
    # askpass 只引用环境变量，不写入密码
    @'
@echo off
echo %SSH_PASS%
'@ | Set-Content -LiteralPath $askpassFile -Encoding ascii
    $env:SSH_PASS = $Password
    $env:SSH_ASKPASS = $askpassFile
    $env:SSH_ASKPASS_REQUIRE = 'force'
  }

  $sshArgs = @(
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-L', "127.0.0.1:${QdrantPort}:127.0.0.1:${QdrantPort}",
    '-L', "127.0.0.1:${TeiPort}:127.0.0.1:${TeiPort}",
    "$SshUser@$SshHost"
  )

  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $proc = Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -PassThru -WindowStyle Hidden
  Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ascii

  $deadline = (Get-Date).AddSeconds(12)
  while ((Get-Date) -lt $deadline) {
    if ((Test-LocalPort -Port $QdrantPort) -and (Test-LocalPort -Port $TeiPort)) {
      Write-Host "SSH 隧道已启动（PID $($proc.Id)）：127.0.0.1:$QdrantPort -> $SshHost，127.0.0.1:$TeiPort -> $SshHost"
      return $true
    }
    if ($proc.HasExited) { break }
    Start-Sleep -Seconds 1
  }

  Write-Host 'SSH 隧道启动失败：端口未在 12 秒内建立，查看 ssh 输出或确认服务器可达'
  Stop-Tunnel
  return $false
}

switch ($Action) {
  'start' { exit ([int](-not (Start-Tunnel))) }
  'stop' { Stop-Tunnel; exit 0 }
  'status' { $ok = Show-Status; exit ([int](-not $ok)) }
  'restart' { Stop-Tunnel; Start-Sleep -Seconds 1; exit ([int](-not (Start-Tunnel))) }
}
