---
taskId: AF-445
contextId: phase2.5-orchestration-closed-loop
title: 修复 GUI relay 子进程 PSModulePath 污染与 hash 依赖
type: implementation
status: backlog
baselineRef: 11da698132a249b3e53c96adc8bcab0f85780fe6
dependsOn: []
priorTasks: [AF-444]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T08:55:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/cli.mjs
    - scripts/orchestration/gui-relay-send.ps1
    - scripts/orchestration/__tests__/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-445/
    - docs/worklog/completed/phase2.5/af445-relay-psmodulepath-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af445-relay-psmodulepath-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs channel send --taskId AF-445 --dry-run
    check: relay 干跑成功
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec vitest run scripts/orchestration/__tests__/
    check: 编排脚本单测通过
    threshold: exit=0
---

# 背景

`channel send` 在 cli 内起 `powershell.exe` 子进程跑 `gui-relay-send.ps1` 时稳定失败（exit 9，`The term 'Get-FileHash' is not recognized`），而同一脚本手工直调可正常干跑。AF-437 / AF-442 / AF-444 三次复现，导致 executor 任务一律无法真正派给外部执行器，只能靠 fallback 由编排者代执行。

# 根因判断

Node 进程从 pwsh 7 里启动时继承了被改写的 `PSModulePath`（只含 PowerShell 7 的模块目录），Windows PowerShell 5.1 子进程因此找不到 `Microsoft.PowerShell.Utility` 提供的 `Get-FileHash`（`ConvertTo-Json` 同源）。

# 目标

1. cli 在起 relay 子进程时显式修复 `PSModulePath`，把 `WindowsPowerShell\v1.0\Modules` 放在首位。
2. relay 脚本的哈希改成纯 .NET `SHA256` 实现，不再依赖任何 cmdlet 模块，双保险。
3. 干跑与真实派发链路可复现成功。

# 做法

`cli.mjs` 的 `spawnSync` 传自建 `env`；`gui-relay-send.ps1` 的 `Get-FileSha` 换成 `[System.Security.Cryptography.SHA256]`；新增一条单测覆盖 `PSModulePath` 归一化函数。

# 成功判据

1. `channel send --dry-run` 返回 `ok:true / dry-run-ok`。
2. `pnpm lint` 0 error；编排脚本单测全绿。
3. 真实派发一次 executor 任务能收到 ack（外部执行器实际完成）。
