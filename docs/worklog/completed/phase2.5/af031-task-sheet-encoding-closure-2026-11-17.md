# AF-031 交付记录：任务单编码缺陷收口与验收护栏复验

- 任务单：`docs/worklog/pending/af031-task-sheet-encoding-closure-task-2026-11-17.md`
- 返修链：AF-024（rejected：V7 误判）→ AF-029（canceled：依赖口径）→ AF-030（rejected：任务单 CRLF）→ AF-031（本单）
- 角色：orchestrator
- 交付时间：2026-11-17（本地 +08:00）
- 结论：**passed**。同一类返修到此为止，不再空转。

## 1. 问题与根因

AF-030 的三处护栏修复本身是对的（V7 任务单豁免、索引三键、时间戳归一），四闸也全绿；它被判 `rejected` 的唯一原因是**自己的任务单文件带 CR**：

```
机读护栏不通过：taskSheet: 含 CR
```

根因是本机工具链：`Set-Content` / `Out-File` 一律把行尾改写为 CRLF，而我用 `Set-Content` 改了一次 `createdAt`。仓规要求 Markdown 为 LF + 无 BOM，V5 检查就会拦下。

这不是框架缺陷，是写文件方式错误。本单把它固化成可复用的口径，并把 AF-030 的护栏修复复验一遍。

## 2. 处置

| 动作                                                                                 | 结果                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 用 `[IO.File]::WriteAllText(path, text, UTF8Encoding($false))` 重写受影响的 markdown | AF-029 / AF-030 / AF-031 任务单 CR 归零、BOM 归零            |
| 字节级复核                                                                           | `ReadAllText` 无 `\r`；`ReadAllBytes` 前 3 字节非 `EF BB BF` |
| 本单任务单先自检再登记                                                               | 登记 → 提级 → 领单（`claim` / `dispatch`）一路无拦           |

写 Markdown 的正确姿势（本仓口径，README §4.0 同源）：

```powershell
$text = [IO.File]::ReadAllText($path) -replace "`r`n", "`n"
[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
```

## 3. 闸门

| 字段             | 实测                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateResults`    | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` → exit 0，**164 passed / 0 failed**（1.07s）；`ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` → exit 0，**20 PASS / 0 FAIL**（含运行态任务单 5 个、Review 交接件 1 个、状态索引、事件日志、索引投影一致）；`node scripts/orchestration/cli.mjs events verify` → exit 0，**110 条**事件，哈希链与索引投影一致；`pnpm orchestration:contracts` → exit 0，14 文件哈希与 v2.0.0(`c507188`) 一致 |
| `scopeCheck`     | `in-scope`：只改 `docs/worklog/` 的本单任务单/交付记录与 `docs/team/agent-orchestration/` 的编码口径；AF-030 的代码修复未回退、未改写                                                                                                                                                                                                                                                                                                                                            |
| `contractChecks` | taskId 一致 ✅；V5 编码（LF/BOM）PASS ✅；状态写入只经 `commitIndex` ✅；索引 schema PASS ✅；事件 schema + 哈希链 PASS ✅                                                                                                                                                                                                                                                                                                                                                       |
| `backlogItems`   | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `deviationTable` | 无（本单为纯复验与编码收口，无计划外改动）                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `reviewVerdict`  | `passed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 4. 复验结论（AF-030 三处修复仍然有效）

- **V7 任务单豁免**：`runAcceptance` 对本任务任务单变更项判 pass，同目录其它任务单仍 fail（单测固定）。
- **索引三键**：`task-state-index 1.1.0` 归档 artifacts 只含 `taskSheet / deliveryRecord / reply`，`validate` 该行 PASS。
- **时间戳归一**：`toUtcIso` 生效后事件 `at` 全为 UTC `Z`；当前段经 `rechain --from EV-0075` 重算后 110 条链一致。

## 5. 遗留

- AF-024 / AF-029 / AF-030 的 rejected / canceled 记录保留为真实历史，不改写；三条的返修内容均已在仓库落地并复验。
- GUI 派发通道（AF-024 交付面）仍带 `IM-028`（决策链运行时接线）与 `AF-024-R2`（回滚路径真实实证）两条欠账，挂在 AF-024 回执里，后续任务承接。

## 6. 回写清单

- `docs/worklog/pending/af031-task-sheet-encoding-closure-task-2026-11-17.md`
- `docs/worklog/completed/phase2.5/af031-task-sheet-encoding-closure-2026-11-17.md`（本记录）
- `docs/team/agent-orchestration/transport/receipts/AF-031.json`
- 编码修正：`docs/worklog/pending/af029-*.md`、`docs/worklog/pending/af030-*.md`（CRLF → LF，无内容改动）
- 运行态：`task-state-index.json`、`orchestration-state.json`、`orchestration-snapshot.json`、`state/journal.jsonl`、`web/orchestration/data.js`
