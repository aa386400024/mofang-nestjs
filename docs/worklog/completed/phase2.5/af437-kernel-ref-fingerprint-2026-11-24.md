# AF-437 说明（投递失败归档）

- 日期：2026-11-24
- 任务：AF-437（executor）→ **已 rejected 并归档**
- 原因：GUI relay 发送器 `scripts/orchestration/gui-relay-send.ps1` 在 cli 子进程中报 `Get-FileHash` 不可用（exit 9），投递判失败，任务被自动闭合归档。
- 处置：同一实现在 **AF-442** 下完成并入库（指纹模块 + 记录/服务改动 + 单测）。本文件仅是记录包占位，不含实现。
- 环境侧待修：relay 子进程的 PowerShell 模块路径（`PSModulePath`）被调用方污染，导致 `Microsoft.PowerShell.Utility` 下的 `Get-FileHash` 无法自动加载。
