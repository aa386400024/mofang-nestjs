# AF-005~008 台账归档回填与闭环缺口登记 — 交付记录

- **状态**：✅ 台账索引回填归档 + 闭环自动化缺口登记候选 IM-004（2026-11-16，定向测试 51 passed）
- **基线 HEAD**：`101b113`（看板快照自动刷新提交）
- **范围**：`docs/team/agent-orchestration/` 台账与快照产物；`src/engine-core`、`src/migration`、业务 `src/**/*.ts`、`test/` 零 diff

---

## 一、背景

AF-005~008 四条框架演进任务已完成编码、提交、推送并验收（本仓 `ff27fdf`、框架仓 `49f0eb5`），任务单与合并交付记录均在 `completed/phase2.5/`。但编排台账索引 `task-state-index.json` 未回填：四条仍留在活跃 `tasks` 数组、`status=backlog`、`verdict=null`，任务单指针指向已不存在的 `pending/` 路径，`deliveryRecord=null`。看板据此显示「待立项 · 未验收」，与实际交付状态脱节。

## 二、回填动作

| 文件                                                        | 改动                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/team/agent-orchestration/task-state-index.json`       | AF-005~008 从 `tasks` 移入 `archivedTasks`，`status=completed`；`taskSheet` 指向 `completed/phase2.5/af005~008-...md`，`deliveryRecord` 指向合并交付记录 `af005-008-framework-evolution-implementation-2026-11-15.md` |
| `docs/team/agent-orchestration/improvement-log.json`        | 新增候选 **IM-004**（`candidate` / `implementation` / `gap` / `adapter`）：任务交付归档后台账状态未自动回填                                                                                                           |
| `docs/team/agent-orchestration/orchestration-snapshot.json` | CLI 刷新：活跃任务 0、归档 25、improvements 汇总 4 条                                                                                                                                                                 |
| `web/orchestration/data.js`                                 | 与快照同源刷新                                                                                                                                                                                                        |

回填口径对齐既有归档范式（AF-001~004）：归档条目只保留 `taskId` / `status` / `artifacts` 指针，运行态字段不回填。

## 三、登记的闭环缺口（IM-004）

- **现象**：任务实际验收归档后，台账状态机不会自动迁移到 `archivedTasks`，需人工改索引；快照持续显示 backlog / 未验收。
- **影响**：看板状态与交付记录脱节，闭环未自动化；断链指针也会误导阅读。
- **建议方向**（候选，待评审立项）：交付包或验收落地后由编排链路自动迁移任务单元到归档段并写 `completed` 与工件指针；或 CLI 提供归档命令，在交付记录落盘后回填索引。
- **边界**：CLI 登记只产 `candidate`；立项（queued）、实现（accepted）与终态流转仍须编排者 / 人工闸门显式执行。

## 四、闸门证据

| 命令 / 校验                                                                   | 结果                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 退出码，51 passed                                                                      |
| `task-state-index.json` JSON 解析                                             | 通过；活跃 0、归档 25；四条工件路径全部存在                                              |
| `improvement-log.json` JSON 解析                                              | 通过；IM-004 `candidate / implementation / gap / adapter`，evidence 两条                 |
| 快照投影                                                                      | `improvements.total=4 / active=4 / items=4`，`archivedCount=25`；`data.js` 含 IM-001~004 |
| 编码探测                                                                      | 两个台账 JSON 均 `bom=False`、`cr=0`（纯 LF）                                            |

- 本批无 `.mjs` / `.ts` 源码改动，未重跑全量 typecheck / lint:fast（沿用上一提交基线：0 error、0 warning / 0 error、1350 文件）。

## 五、遗留与未决

- IM-004 为 `candidate`，是否立项实现「归档状态自动回填」待编排者评审。
- 按现有看板口径，归档任务不出现在活跃列表；若需在视图中展示「已验收」历史任务，需另加归档视图与字段口径。
