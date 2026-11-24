# AF-455 · AF-453/AF-454 重签发链路归档补齐件落地（交付记录）

- 任务：AF-455（documentation / executor）
- 上下文：phase2.5-orchestration-closed-loop
- 基线：`e855dbcc2f8b5a1ad59873ca5a44a3fd0857ea26`（integrate，AF-452 收口）
- 前序：AF-454（实现）→ AF-453（因域冲突重签发的首版任务单）→ AF-446 / AF-322
- 分支：`task/AF-455-archive-backfill`（自 `task/AF-454-engine-core-comment` 的 `4d68dc05` 切出）
- 日期：2026-11-24

## 一、本任务解决的问题

AF-453 因 `agentRole: orchestrator` 与 scope 中的 `src/engine-core` 资源域冲突，在 `run-once` 派发阶段报 `scope-domain-conflict`，按 `task reissue` 重签发为 AF-454。AF-454 已完成实现提交 `4d68dc05`（两处内核注释对齐 AF-322 标定值）、闸门全绿、回执冻结并 `archive-completed`。

重签发留下一个结构性尾巴，会直接卡住提交与 CI：

1. AF-453 已闭合到 `canceled`，但 `worklog verify --strict` 对取消任务同样强制其 `artifactPath` 存在：
   ```
   交付记录缺文件：AF-453 → docs/worklog/completed/phase2.5/af453-engine-core-comment-2026-11-24.md
   ```
2. 该文件不在 AF-454 的 scope 内，混进 AF-454 的实现提交会触发 `[ORCH-GATE] FAIL reason=scope-residual`（AF-454 首次提交即被 husky 拦下，只能把补齐件放在工作区不暂存，靠文件系统存在性让本地 verify 通过）。
3. 只在本地放文件不够：CI 的 `Orchestration Gate` 在 PR HEAD 上执行 `cli.mjs worklog verify --strict --state-free`，checkout 里没有未跟踪文件，PR 必红。

scope 登记后不可原地改写，所以唯一合规路径是「由一个新任务的 scope 覆盖补齐件」。本任务即为此登记，只交付文档与记录包，零代码改动。

## 二、改动清单

| 文件                                                                      | 性质             | 说明                                                                                                               |
| ------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `docs/worklog/completed/phase2.5/af453-engine-core-comment-2026-11-24.md` | 新增（补齐件）   | 声明 AF-453 已重签发为 AF-454，实际实现与闸门证据看 af454 记录；本文件只为满足 verify 的存在性要求，不冒充实现证据 |
| `docs/worklog/completed/phase2.5/af455-archive-backfill-2026-11-24.md`    | 新增（交付记录） | 本文件                                                                                                             |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-453/`         | 新增（记录包）   | 冻结任务单 + manifest（CLI 生成，未改写）                                                                          |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-454/`         | 新增（记录包）   | 冻结任务单 + 冻结回执副本 `receipt-RC-AF-454-1.json`（内容哈希 `142fad86…`，由 `receipt freeze` 生成）             |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-455/`         | 新增（记录包）   | 本任务冻结任务单 + manifest                                                                                        |

未改动：任何 `src/` 代码（含 `src/engine-core`）、AF-453 / AF-454 的冻结任务单与冻结回执、其它任务的状态。

## 三、闸门

| 闸门         | 命令                                                         | 结果                                                                                             |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 记录包完整性 | `node scripts/orchestration/cli.mjs worklog verify --strict` | exit 0（补齐件落地后不再报 `交付记录缺文件：AF-453`）                                            |
| 内核零改动   | `git diff --stat HEAD -- src/engine-core`                    | 空输出                                                                                           |
| 代码零改动   | `git diff --stat HEAD~1`                                     | 仅上述文档与记录包                                                                               |
| 任务单预检   | `cli.mjs validate --sheet ...`                               | PASS（仅剩既有无关失败 `[FAIL] 回执 AF-384.json`，属 gitignored transport 中的历史回执，不阻断） |

## 四、与任务单的偏差

无。任务单要求的五条成功判据逐条满足，未新增文件域之外的文件。

## 五、本链路暴露的框架缺口（待统一入库）

- **AF454-B1**：`task register` 阶段不校验 `agentRole` 与 scope 的资源域匹配，只在 `run-once` 派发时报 `scope-domain-conflict`，代价是一次 reissue + 一个 canceled 任务 + 一件归档补齐件。建议 register 前做域冲突预检。
- **AF454-B2 / AF449-B3**：`worklog verify --strict` 对 canceled 任务同样强制 `artifactPath` 存在，而该路径不在重签发后的新任务 scope 内，只能靠「再开一个任务专门覆盖补齐件」这种间接手段解决。建议 `task reissue` 自动继承原任务 `artifactPath` 进新任务 scope（或在取消时自动生成占位并纳入 scope）。
- **本次新增观察（记入 AF-455 回执 backlogItems）**：`run-once` 的 GUI 派发租约（`gui-delivery-lease-expired`）与回执摄入是两条独立路径，就地执行完成的任务需要先 `receipt freeze`、再跑一次 `run-once` 才会走 `late-receipt-recovered` 收口；派发租约过期会把任务置为 `held-for-human` 并回滚 `ready`，本地执行场景下需要显式文档化或提供 `--local` 交付通道。

## 六、遗留

- 上述缺口统一进 `improvement-log.json` 的事项由后续带台账写权限的任务处理（台账只能经 `improvements --add / --transition` 写入，枚举封闭）。
- MiniMax 专用 worktree 隔离（备忘第 4 件）仍待开单。
