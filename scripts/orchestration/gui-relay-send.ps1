# AF-074 · 主桌面 GUI relay 发送器
#
# 只做三件事：聚焦执行代理窗口 → 粘贴 brief → 发送；并写发送现场证据。
# 不确认送达：送达确认只认执行代理写的 transport/acks/<taskId>.json，
# 由 cli.mjs channel auto-confirm 完成。这样「已粘贴」不会被冒充成「已送达」。
#
# 用法：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/orchestration/gui-relay-send.ps1 `
#     -TaskId AF-075 -BriefPath <abs brief> -RepoRoot <repo> -EvidenceDir <transport/gui-sent> -WindowTitle "MiniMax Code"
#
# 安全边界：
#   - 只操作标题匹配的已运行窗口，不启动第二个实例、不登录、不输入凭据；
#   - 发送前检查目标窗口确为前台，抢不到前台就失败退出，绝不把内容打进别的窗口；
#   - 剪贴板只暂存文本，结束后尽量恢复；非文本剪贴板无法恢复时在证据里标记。

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TaskId,
  [Parameter(Mandatory = $true)][string]$BriefPath,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$EvidenceDir,
  [string]$WindowTitle = 'MiniMax Code',
  [double]$InputX = 0.55,
  [double]$InputY = 0.45,
  [switch]$DryRun,
  [switch]$NoClickInput
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Af074Win32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@

# 让 GetWindowRect / 截图 / SetCursorPos 使用同一套物理像素坐标，避免缩放下点偏。
[void][Af074Win32]::SetProcessDPIAware()

$script:EvidenceFiles = @()
$script:Result = [ordered]@{
  ok = $false
  code = 'unknown'
  taskId = $TaskId
  dryRun = [bool]$DryRun
  windowTitle = $null
  processId = $null
  sentAt = $null
  evidenceRef = $null
  beforeHash = $null
  afterHash = $null
  clipboardRestored = $false
  message = $null
}

function Write-Result {
  $script:Result | ConvertTo-Json -Depth 5 -Compress
}

function Save-WindowShot([string]$Path, [IntPtr]$Handle) {
  $rect = New-Object Af074Win32+RECT
  if (-not [Af074Win32]::GetWindowRect($Handle, [ref]$rect)) {
    throw 'GetWindowRect failed'
  }
  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

# AF-445：不再依赖 Get-FileHash。子进程继承的 PSModulePath 可能被 PowerShell 7 改写，
# 5.1 找不到 Microsoft.PowerShell.Utility 时 Get-FileHash 会直接不可用（AF-437/442/444 三次复现）。
# 改用纯 .NET 实现，与模块加载状态无关。
function Get-FileSha([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = $sha.ComputeHash($stream)
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
  return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Click-Composer([IntPtr]$Handle, [double]$RatioX, [double]$RatioY) {
  $rect = New-Object Af074Win32+RECT
  if (-not [Af074Win32]::GetWindowRect($Handle, [ref]$rect)) { throw 'GetWindowRect failed' }
  $x = $rect.Left + [int](($rect.Right - $rect.Left) * $RatioX)
  $y = $rect.Top + [int](($rect.Bottom - $rect.Top) * $RatioY)
  [void][Af074Win32]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 120
  [Af074Win32]::mouse_event(0x0002, 0, 0, 0, 0)
  [Af074Win32]::mouse_event(0x0004, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 250
}

function Send-VirtualKey([byte]$VirtualKey) {
  [Af074Win32]::keybd_event($VirtualKey, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [Af074Win32]::keybd_event($VirtualKey, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
}

function Send-CtrlV {
  # PowerShell SendKeys 在部分 Electron 窗口不落地；Win32 keybd_event 走前台键盘队列，更稳定。
  [Af074Win32]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  Send-VirtualKey 0x56
  [Af074Win32]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
}

function Restore-Clipboard([bool]$HadText, [string]$Text) {
  if (-not $HadText) { return $false }
  try {
    [System.Windows.Forms.Clipboard]::SetText($Text)
    return $true
  } catch {
    return $false
  }
}

try {
  $resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot).Path
  $resolvedBrief = (Resolve-Path -LiteralPath $BriefPath).Path
  if (-not (Test-Path -LiteralPath $resolvedBrief)) { throw "brief 不存在：$BriefPath" }
  if (-not (Test-Path -LiteralPath $EvidenceDir)) { New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null }
  $resolvedEvidence = (Resolve-Path -LiteralPath $EvidenceDir).Path

  $target = Get-Process |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$WindowTitle*" } |
    Sort-Object StartTime |
    Select-Object -First 1
  if (-not $target) {
    $script:Result.code = 'window-not-found'
    $script:Result.message = "未找到标题匹配 '$WindowTitle' 的已运行窗口"
    Write-Result
    exit 3
  }

  $script:Result.windowTitle = $target.MainWindowTitle
  $script:Result.processId = $target.Id
  $hWnd = [IntPtr]$target.MainWindowHandle
  $previousForeground = [Af074Win32]::GetForegroundWindow()

  [void][Af074Win32]::ShowWindow($hWnd, 9)
  [void][Af074Win32]::SetForegroundWindow($hWnd)
  Start-Sleep -Milliseconds 350
  if ([Af074Win32]::GetForegroundWindow() -ne $hWnd) {
    try {
      $shell = New-Object -ComObject WScript.Shell
      [void]$shell.AppActivate($target.Id)
      Start-Sleep -Milliseconds 350
    } catch { }
  }
  if ([Af074Win32]::GetForegroundWindow() -ne $hWnd) {
    $script:Result.code = 'foreground-not-acquired'
    $script:Result.message = '目标窗口未取得前台焦点；为避免误输入，已中止'
    if ($previousForeground -ne [IntPtr]::Zero) { [void][Af074Win32]::SetForegroundWindow($previousForeground) }
    Write-Result
    exit 5
  }

  $beforePath = Join-Path $resolvedEvidence "$TaskId.before.png"
  Save-WindowShot -Path $beforePath -Handle $hWnd
  $script:EvidenceFiles += $beforePath
  $script:Result.beforeHash = Get-FileSha $beforePath

  if (-not $DryRun) {
    $brief = Get-Content -LiteralPath $resolvedBrief -Raw -Encoding UTF8
    if (-not $brief.Trim()) { throw "brief 为空：$resolvedBrief" }

    if (-not $NoClickInput) { Click-Composer -Handle $hWnd -RatioX $InputX -RatioY $InputY }

    $hadClipboard = $false
    $oldClipboard = ''
    try {
      $oldClipboard = [System.Windows.Forms.Clipboard]::GetText()
      $hadClipboard = $true
    } catch { }

    try {
      [System.Windows.Forms.Clipboard]::SetText($brief)
      # 输入框已点击聚焦；用 Win32 键盘队列粘贴，随后 Enter 发送。
      Send-CtrlV
      Start-Sleep -Milliseconds 450
      Send-VirtualKey 0x0D
      Start-Sleep -Milliseconds 1800
    } finally {
      $script:Result.clipboardRestored = Restore-Clipboard -HadText $hadClipboard -Text $oldClipboard
    }
  }

  $afterPath = Join-Path $resolvedEvidence "$TaskId.after.png"
  Save-WindowShot -Path $afterPath -Handle $hWnd
  $script:EvidenceFiles += $afterPath
  $script:Result.afterHash = Get-FileSha $afterPath

  $sentAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $sentPath = Join-Path $resolvedEvidence "$TaskId.sent.json"
  $repoFull = [System.IO.Path]::GetFullPath($resolvedRepo).TrimEnd('\') + '\'
  $sentFull = [System.IO.Path]::GetFullPath($sentPath)
  if ($sentFull.StartsWith($repoFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relative = $sentFull.Substring($repoFull.Length).Replace('\', '/')
  } else {
    $relative = $sentFull.Replace('\', '/')
  }
  $script:Result.ok = $true
  $script:Result.code = if ($DryRun) { 'dry-run-ok' } else { 'sent' }
  $script:Result.sentAt = $sentAt
  $script:Result.evidenceRef = $relative
  $script:Result.message = if ($DryRun) { '干跑完成：窗口定位与证据链可用，未发送内容' } else { '已发送 brief；等待执行代理写 ack' }

  $record = [ordered]@{
    schemaVersion = '1.0.0'
    taskId = $TaskId
    sentAt = $sentAt
    dryRun = [bool]$DryRun
    windowTitle = $target.MainWindowTitle
    processId = $target.Id
    sessionPath = 'existing-session'
    locateLayer = 'paste-verify'
    evidenceRef = $relative
    beforeHash = $script:Result.beforeHash
    afterHash = $script:Result.afterHash
    clipboardRestored = $script:Result.clipboardRestored
  }
  $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $sentPath -Encoding UTF8
  $script:EvidenceFiles += $sentPath

  if ($previousForeground -ne [IntPtr]::Zero) { [void][Af074Win32]::SetForegroundWindow($previousForeground) }
  Write-Result
  exit 0
} catch {
  $script:Result.code = 'send-error'
  $script:Result.message = $_.Exception.Message
  if ($previousForeground -ne [IntPtr]::Zero) {
    try { [void][Af074Win32]::SetForegroundWindow($previousForeground) } catch { }
  }
  Write-Result
  exit 9
}
