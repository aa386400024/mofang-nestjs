# AF-340 交付记录 · 真人度形态层限次候选 shape-capped

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-340/task-sheet.md`
- 基线：`04990ede0f6abf504d63b54f0ee914c0647ce770`
- 日期：2026-11-23

## 1. 改了哪些文件

| 文件 | 变更 |
| --- | --- |
| `src/shared/realism/realism-prompt-tightening.ts` | `TIGHTENING_ARMS` 扩到 10 个；新增 `buildShapeCappedBlock`，只在 `buildTighteningPromptBlock` 分派 |
| `test/shared/realism/realism-prompt-tightening.spec.ts` | 分支清单更新为 10；新增 3 例形态限次单测，共 21 例 |
| `docs/worklog/completed/phase2.5/af340-realism-shape-capped-report-2026-11-23.md` | 实测报告 |
| `docs/worklog/completed/phase2.5/af340-realism-shape-capped-2026-11-23.md` | 本交付记录 |
| `docs/worklog/records/.../AF-340/` | 任务单、manifest、回执 |

## 2. 关键设计决策

1. **只动形态层一行**。`shape-capped` 与 `full` 行数相同，只把「每轮执行」替换为「整场最多三次、本轮最多一次；前一轮已经用过就跳过」。配额层与事件层逐字保留，保证变量隔离。
2. **复用 `tightened` 的形态句，不另写一套**。这样与已测 `tightened` 可以对照，也能确认差异来自“只改一层”而不是文案差别。
3. **不改生产块、不切 `RENDER_REALISM_MODE`、不调 `humanization-v1` 阈值**。实验臂只在离线 CLI 生效。

## 3. 闸门数字

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 296 文件通过 / 1 跳过（297）；4538 例通过 / 4 跳过（4542） |
| `git diff --stat HEAD -- src/engine-core` | 输出为空，engine-core 零改动 |
| 定向单测 | 21/21 通过 |
| `pnpm orchestration:preflight` | PASS |

## 4. 实测

12 轮 long，2 人设 × 8 次重复，192 次调用、0 失败。

- 焦虑：density 均值 `5.679187` / 中位 `5.619239` / 范围 `4.417671–7.031250`，`0/8` 在窗。
- 回避：density 均值 `6.381240` / 中位 `6.723164` / 范围 `4.678363–7.042254`，`0/8` 在窗。
- 对 full：事件率降 40.2% / 32.7%，密度只降 21.1% / 9.3%。
- 分离：`[4.273504, 4.678363)` 中点 `4.4759335`，8/0/8/0。

结论：只压形态层减不到位；AF-339 与 AF-340 从两个方向证明三层联合施压，任一层保留“每轮”语义就压不进窗口。

## 5. 与任务单的偏差

| 任务单要求 | 实际 | 处理 |
| --- | --- | --- |
| 只新增 `shape-capped` | 已新增，未追加其他臂 | 一致 |
| 8 次 × 2 人设 12 轮 | 192 次调用，0 失败 | 一致 |
| 不改生产 / 不调阈值 | 未改 | 一致 |

## 6. commit message

`feat(af340): 真人度形态层限次候选 shape-capped 实测`
