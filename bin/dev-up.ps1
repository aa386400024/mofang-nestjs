# ============================================================
# mofang-nestjs 本地开发启动脚本 (Windows PowerShell)
#
# 在你 Windows PowerShell 或 VSCode 终端跑:
#   .\bin\dev-up.ps1
#
# 作用:
#   1. 测服务器 mysql/redis 是否可达
#   2. (可选) 跑 migration 建表
#   3. 起 nest watch (npm run start:dev)
#
# 退出: Ctrl+C
# ============================================================

$ErrorActionPreference = "Stop"

# 颜色
function Ok($msg)   { Write-Host "✅ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "▶  $msg" -ForegroundColor Cyan }

# 项目根 = 脚本所在目录的上 1 级
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommandPath
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

Info("项目根: $ProjectRoot")

# ==================== 1. .env 检查 ====================
if (-not (Test-Path ".env")) {
    Err ".env 不存在, 请: Copy-Item .env.example .env"
}
Ok(".env 存在")

# ==================== 2. node_modules 检查 ====================
if (-not (Test-Path "node_modules")) {
    Warn("node_modules 未装, 正在跑 npm ci (可能需要几分钟)...")
    npm ci
    if ($LASTEXITCODE -ne 0) { Err "npm ci 失败" }
}
Ok("node_modules OK")

# ==================== 3. 测试连接 ====================
Info("测试 MySQL 连通性...")
$mysqlTest = Test-NetConnection -ComputerName "117.72.30.78" -Port 3306 -WarningAction SilentlyContinue
if (-not $mysqlTest.TcpTestSucceeded) {
    Err "MySQL 117.72.30.78:3306 连不上`n  京东云安全组没放行? 服务器 mysql 没起?"
}
Ok("MySQL 可达")

Info("测试 Redis 连通性...")
$redisTest = Test-NetConnection -ComputerName "117.72.30.78" -Port 6379 -WarningAction SilentlyContinue
if (-not $redisTest.TcpTestSucceeded) {
    Err "Redis 117.72.30.78:6379 连不上`n  京东云安全组没放行? 服务器 redis 没起?"
}
Ok("Redis 可达")

# ==================== 4. (可选) 跑迁移 ====================
$migrations = Read-Host "跑数据库迁移吗? (y/N)"
if ($migrations -eq "y" -or $migrations -eq "Y") {
    Info("跑 migration:run...")
    npm run migration:run
    if ($LASTEXITCODE -ne 0) { Err "migration 失败" }
    Ok("迁移完成")
}

# ==================== 5. 起 nest watch ====================
Info("起 nest watch (Ctrl+C 退出)...")
npm run start:dev