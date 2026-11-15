# IM-004 显式归档命令 — 交付记录

- **状态**：✅ 编排 CLI 新增 `archive` 子命令与可测归档纯函数；IM-004 流转 `candidate → queued → accepted`（实现落地待人工验收转 done）（2026-11-16，定向测试 56 passed）
- **基线 HEAD**：`3393bc7`（AF-005~008 台账回填 + IM-004 登记提交）
- **范围**：`scripts/orchestration/` 编排脚本与单测、`package.json` 脚本注册；`src/engine-core`、`src/migration`、业务 `src/**/*.ts`、`test/` 零 diff；prod 依赖零新增

---

## 一、背景与根因

IM-004 登记的问题：任务实际验收归档后，台账状态机不会自动迁移到 `archivedTasks`，看板持续显示 backlog / 未验收，需人工改索引。

对 `scheduler.mjs` / `acceptance-runner.mjs` / `state-store.mjs` / `cli.mjs` / `config.json` 取证后确认根因有三层：

1. **自动归档仅覆盖运行态闭环任务**：`scheduler.processReceipts` 只处理 `status ∈ {submitted, working}` 且 `artifacts.deliveryRecord` 已存在的任务；通过验收后由 `archiveTask` 迁入归档段。事后补登的历史任务登记为 `backlog`、从未走 ready → submitted/working 运行态，不会进入该流程。
2. **自治开关关闭时整段不跑**：`config.autoLoop.enabled=false`，`shouldAdvance` 为假时调度器只输出只读快照，领单 / 验收归档 / 返修均不执行。
3. **缺少显式归档通道**：CLI 没有归档子命令，事后交付的历史任务只能手改 `task-state-index.json`，断链指针与状态脱节由此产生。

## 二、方案与改动

本次落地 IM-004 建议方向中的「CLI 归档命令」一条；归档迁移逻辑抽为可单测纯函数，scheduler 内部自动归档复用同一实现。

| 文件                                                     | 改动                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/scheduler.mjs`                    | 新增导出 `ARCHIVE_STATUSES`（`completed / rejected / canceled`）与纯函数 `archiveTaskEntry(index, taskId, opts)`：校验任务在活跃列表、未归档过、终态合法；从 `tasks` 移除并 push 到 `archivedTasks`（条目 `{taskId, status, artifacts, note?}`）；现有内部 `archiveTask` 改为复用该函数 |
| `scripts/orchestration/cli.mjs`                          | 新增 `cmdArchive(args)`：位置参数 `taskId` + `--status / --sheet / --record / --reply / --note`；传入工件路径相对 `REPO_ROOT` 解析并校验存在（不存在即报错，不写断链指针）；`saveIndex` 后刷新快照双写；错误退出码 2；登记一次调度工具审计；switch 与 help 接线                         |
| `package.json`                                           | 新增脚本 `orchestration:archive`                                                                                                                                                                                                                                                        |
| `scripts/orchestration/__tests__/orchestration.spec.mjs` | 新增 `archiveTaskEntry` 用例：归档成功迁移与工件合并、默认终态 completed、任务不存在抛错、重复归档抛错、非法终态抛错、合法终态对齐白名单                                                                                                                                                |

### 归档条目口径

对齐既有归档范式（AF-001~004）：归档条目只保留 `taskId` / `status` / `artifacts{taskSheet?, deliveryRecord?, reply?}` 指针与可选 `note`；运行态字段（租约、历史、验收结论）不回填进归档段。

### 命令用法

```text
pnpm orchestration:archive <taskId> [--status completed|rejected|canceled]
  [--sheet <file>] [--record <file>] [--reply <file>] [--note <text>]
```

## 三、边界决策

- **本次只做显式归档闸门命令**：对齐 improvements 终态流转的人工边界——归档是编排者 / 人工确认后的动作，CLI 提供受控通道而非隐式批量迁移。运行态闭环任务的自动归档仍由 `processReceipts` 负责，两条路径复用同一纯函数。
- **自动扫描归档留后续**：「run-once / 快照刷新时自动识别已有交付记录的历史任务并归档」属扩大自动迁移范围，本批不实现；作为后续方向记入 IM-004 备注与本记录遗留项。
- **未改自治开关**：`autoLoop.enabled` 维持 `false`；是否开启自治循环属编排者决策，不在本批改动。

## 四、闸门证据

| 命令 / 校验                                                                   | 结果                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 退出码 0，56 passed（含新增 5 条归档用例）                                                                  |
| `pnpm typecheck`                                                              | 退出码 0，`tsc -b tsconfig.check.json` 无错误                                                               |
| `pnpm lint:fast`                                                              | 退出码 0，0 warning / 0 error，1350 文件，93 规则                                                           |
| 编码探测                                                                      | `scheduler.mjs` / `cli.mjs` / `orchestration.spec.mjs` / `package.json` 均 `BOM=False`、`CR=False`（纯 LF） |
| CLI 冒烟                                                                      | `archive` 无参数 → 退出码 2 并打印用法，不写索引；`status` 只读命令退出码 0，快照正常读取                   |

- 本批为编排脚本纯逻辑改动，不进 `src` / `test` 运行时；定向 vitest 覆盖，未重跑全量 3381 例基线（沿用既有口径）。
- `lint:fast` 范围仅 `src test bin`，`scripts/*.mjs` 与 `web/*.js` 不经 oxlint / tsconfig，由 vitest 用例与人工复核兜底。

## 五、遗留与未决

- **自动扫描归档（后续方向）**：在 `run-once` / 快照刷新路径识别「已有交付记录、可验收通过」的历史任务并自动归档，仍需设计触发门槛与防误归档护栏；未纳入本批。
- **IM-004 终态**：当前 `accepted`（实现落地）；`done` 须待人工验收确认归档命令与台账口径无误后显式流转。
- **归档视图**：按现有看板口径，归档任务不出现在活跃列表；若需在网页展示「已验收」历史任务，需另加归档视图与字段口径（与上批回填记录遗留项一致）。
